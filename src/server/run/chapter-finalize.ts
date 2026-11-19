import { notFound } from "../errors.ts";
import { buildCardProgressionsFromArtifacts } from "../character/card-progressions.ts";
import { extractCanonArtifacts } from "../story/canon.ts";
import {
  commitStageDir,
  computeContentHash,
  writeCommitStage,
  writeVersionFile,
} from "../project-files.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getNextVersionNo, saveChapterVersion } from "../repositories/chapter.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { upsertRunState } from "../repositories/run.repository.ts";
import { createChapterCommitService } from "../commit/chapter-commit.service.ts";
import { recordChapterFinalizationCheckpoint } from "./checkpoint.service.ts";
import { createLauncherService } from "./launcher.service.ts";
import { runningTasks } from "./run-internals.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { nowIso } from "../utils.ts";

export async function finalizeAcceptedChapter(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  options?: {
    preview?:
      | {
          artifacts: Awaited<ReturnType<typeof extractCanonArtifacts>>;
          progressions: ReturnType<typeof buildCardProgressionsFromArtifacts>;
        }
      | null;
    reviewStatus?: "provisional" | "deep_locked";
  },
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const context = await getProjectExecutionContext(projectId, project.style, executionContext);

  const versionNo = getNextVersionNo(projectId, chapterNo);
  const versionPath = await writeVersionFile(projectId, chapterNo, versionNo, chapterContent);
  const versionId = saveChapterVersion({
    projectId,
    chapterNo,
    versionNo,
    temperature: context.agents.writer.assignment.temperature,
    path: versionPath,
    excerpt: chapterContent.slice(0, 180),
    selected: false,
    source: "final",
  });

  const commitService = createChapterCommitService({
    createOutboxPayload: (commit) =>
      JSON.stringify({
        commitId: commit.commitId,
        projectId: commit.projectId,
        chapterNo: commit.chapterNo,
        reviewStatus: options?.reviewStatus ?? "provisional",
      }),
  });
  const stageDir = commitStageDir(projectId, `accepted-${versionId}`);
  const manifest = await writeCommitStage(stageDir, [
    {
      relativePath: `chapters/chapter_${String(chapterNo).padStart(3, "0")}.md`,
      content: chapterContent.trimEnd() + "\n",
    },
  ]);

  const preparedCommit = await commitService.prepareCommit({
    projectId,
    chapterNo,
    sessionId: null,
    sourceKind: "run",
    acceptedVersionId: versionId,
    idempotencyKey: `${projectId}:${chapterNo}:${versionId}:run`,
    manifest,
    stageDir,
    contentHash: computeContentHash(chapterContent.trimEnd() + "\n"),
  });
  await commitService.applyStagedFiles(preparedCommit.commitId);
  await commitService.markFsApplied(preparedCommit.commitId);
  await commitService.finalizeCommit(preparedCommit.commitId);
  if (process.env.AINOVEL_DISABLE_DETACHED_WORKERS !== "1") {
    createLauncherService().spawnCommitReconciler();
  }

  try {
    // Best-effort step checkpoint: a later lease acquisition resumes as "recovering"
    // and the cursor records that this chapter is already committed.
    recordChapterFinalizationCheckpoint({
      sessionId: runningTasks.get(projectId)?.sessionId ?? null,
      chapterNo,
    });
  } catch (error) {
    appendRunLog(
      projectId,
      "warning",
      `第 ${chapterNo} 章定稿 checkpoint 写入失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  }

  upsertRunState(projectId, {
    stage: "analysis",
    status: "analysis",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: chapterNo,
    stageDetails: {
      analysis: {
        factsExtracted: 0,
        summaryGenerated: false,
        progressionsExtracted: 0,
        reviewStatus: options?.reviewStatus ?? "provisional",
      },
    },
  });
  appendRunLog(projectId, "info", `第 ${chapterNo} 章已定稿，收尾分析已排队交给 reconciler。`);
}
