import "../server-only.ts";

import { notFound } from "../errors.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { readFinalChapter } from "../project-files.ts";
import { resolveManualReviewAction } from "./manual-review.ts";
import { createRunProgressService } from "./progress.service.ts";
import { manualReviewActionSchema, chapterNoSchema, projectIdSchema } from "../validation.ts";
import type { ManualReviewAction } from "./manual-review.ts";
import { restartRunFromChapter } from "./restart-run.service.ts";
import { rollbackVersion } from "../commit/rollback-version.service.ts";
import { autoPickVersionForManualReview } from "./manual-review-engine.ts";
import { finalizeProjectCompletion, persistAcceptedChapterSignals } from "../services/manual-review.service.ts";

const progressService = createRunProgressService();

export interface ManualReviewRouteDependencies {
  getProject: typeof getProject;
  progressService: Pick<typeof progressService, "getRunProgressView">;
  autoPickVersionForManualReview: (
    projectId: string,
    chapterNo: number,
  ) => Promise<{
    version: {
      id: string;
      versionNo: number;
    };
    reason: string;
  }>;
  rollbackVersion: (projectId: string, chapterNo: number, versionId: string) => Promise<unknown>;
  readFinalChapter: typeof readFinalChapter;
  persistAcceptedChapterSignals: (projectId: string, chapterNo: number) => Promise<unknown>;
  finalizeProjectCompletion: (projectId: string, message: string, finalChapterNo?: number) => Promise<unknown>;
  appendRunLog: typeof appendRunLog;
  restartRunFromChapter: typeof restartRunFromChapter;
}

function shouldApprove(action: ManualReviewAction) {
  return action === "approve_continue" || action === "auto_pick_version";
}

export async function resolveManualReviewRequest(
  request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
  deps?: ManualReviewRouteDependencies,
) {
  const runtimeDeps = deps ?? {
    getProject,
    progressService,
    autoPickVersionForManualReview,
    rollbackVersion,
    readFinalChapter,
    persistAcceptedChapterSignals,
    finalizeProjectCompletion,
    appendRunLog,
    restartRunFromChapter,
  } satisfies ManualReviewRouteDependencies;

  const { projectId, chapterNo } = await context.params;
  projectIdSchema.parse(projectId);
  const parsedChapterNo = chapterNoSchema.parse(chapterNo);
  const payload = manualReviewActionSchema.parse(await request.json());

  const project = runtimeDeps.getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const progress = runtimeDeps.progressService.getRunProgressView(projectId);
  if (progress.stage !== "manual_review" || progress.currentChapter !== parsedChapterNo) {
    throw new Error("当前章节不在人工确认状态");
  }
  const state = {
    lastError: progress.error ?? null,
    stageDetails: progress.stageDetails,
  };
  const earliestAffectedChapter =
    typeof state.stageDetails.review?.earliestAffectedChapter === "number"
      ? state.stageDetails.review.earliestAffectedChapter
      : parsedChapterNo;
  const requiresWindowRestart = earliestAffectedChapter < parsedChapterNo;

  if (requiresWindowRestart && payload.action !== "retry_chapter") {
    throw new Error(`本次是窗口级退回，请从第 ${earliestAffectedChapter} 章重跑后再继续。`);
  }

  if (payload.action === "auto_pick_version") {
    const picked = await runtimeDeps.autoPickVersionForManualReview(projectId, parsedChapterNo);
    await runtimeDeps.rollbackVersion(projectId, parsedChapterNo, picked.version.id);
    runtimeDeps.appendRunLog(
      projectId,
      "info",
      `AI 自动选定版本 ${picked.version.versionNo} 作为第 ${parsedChapterNo} 章正式稿：${picked.reason}`,
    );
  }

  const decision = resolveManualReviewAction({
    action: payload.action,
    chapterNo: parsedChapterNo,
    totalChapters: project.chapterPlanningMode === "fixed" ? project.targetChapters : project.hardChapterCap,
    shouldCompleteOnApproval:
      project.chapterPlanningMode === "dynamic"
      && Boolean(state.stageDetails.review?.triggerReasons?.includes("completion_candidate")),
  });

  if (shouldApprove(payload.action)) {
    const content = await runtimeDeps.readFinalChapter(projectId, parsedChapterNo);
    if (!content) {
      throw new Error("当前还没有可确认的正文。请先回滚到一个候选版本，或应用 Patch 后再继续。");
    }
    await runtimeDeps.persistAcceptedChapterSignals(projectId, parsedChapterNo);

    if (decision.completesProject) {
      return runtimeDeps.finalizeProjectCompletion(
        projectId,
        `第 ${parsedChapterNo} 章已人工确认，项目完成`,
        parsedChapterNo,
      );
    }

    runtimeDeps.appendRunLog(
      projectId,
      "info",
      `第 ${parsedChapterNo} 章已人工确认，继续生成第 ${decision.restartFromChapter} 章`,
    );
    return runtimeDeps.restartRunFromChapter({
      projectId,
      fromChapter: decision.restartFromChapter ?? parsedChapterNo + 1,
    });
  }

  if (requiresWindowRestart) {
    runtimeDeps.appendRunLog(projectId, "warning", `根据深审窗口结论，从第 ${earliestAffectedChapter} 章起软失效并重新生成`);
    return runtimeDeps.restartRunFromChapter({
      projectId,
      fromChapter: earliestAffectedChapter,
      invalidationReason: `深审窗口判定从第 ${earliestAffectedChapter} 章起的时间线失效，需整体重跑。`,
      reviewReason: state.lastError ?? state.stageDetails.review?.verdict ?? null,
    });
  }

  runtimeDeps.appendRunLog(projectId, "warning", `第 ${parsedChapterNo} 章退回自动重写，并归档旧正文`);
  return runtimeDeps.restartRunFromChapter({
    projectId,
    fromChapter: decision.restartFromChapter ?? parsedChapterNo,
    invalidationReason: `人工确认退回第 ${decision.restartFromChapter ?? parsedChapterNo} 章，旧版本已归档为失效历史。`,
    reviewReason: state.lastError ?? null,
  });
}
