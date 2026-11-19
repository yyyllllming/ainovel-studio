import "../server-only.ts";

import { notFound } from "../errors.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getChapterVersion } from "../repositories/chapter.repository.ts";
import type { ChapterVersionRecord } from "../repositories/shared.ts";
import { readFinalChapter, readVersionFile, commitStageDir, writeCommitStage, computeContentHash } from "../project-files.ts";
import { resolveProjectFilePath } from "../paths.ts";
import { createChapterCommitService } from "./chapter-commit.service.ts";
import { createLauncherService } from "../run/launcher.service.ts";
import { updateProjectVoiceSnapshot } from "../content/project-voice-snapshot.service.ts";
import { createChapterSessionGuard } from "./chapter-session-guard.ts";
import { invalidateFutureTimelineAfterChapterChange } from "../story/timeline-invalidation.ts";
import { nowIso } from "../utils.ts";
import {
  buildTimelineMutationKeys,
  findReplayableTimelineMutationEffect,
  resumeTimelineMutationEffect,
} from "./timeline-mutation-effect.ts";

export interface RollbackVersionServiceDependencies {
  getChapterVersion: (versionId: string) => ChapterVersionRecord | null;
  resolveProjectFilePath: typeof resolveProjectFilePath;
  readFinalChapter: typeof readFinalChapter;
  readVersionFile: typeof readVersionFile;
  commitService: ReturnType<typeof createChapterCommitService>;
  invalidateFutureTimelineAfterChapterChange: (
    projectId: string,
    chapterNo: number,
    reason: string,
    options?: { operationKey: string; invalidatedAt: string },
  ) => Promise<unknown>;
  findReplayableTimelineMutationEffect: typeof findReplayableTimelineMutationEffect;
  resumeTimelineMutationEffect: typeof resumeTimelineMutationEffect;
  updateProjectVoiceSnapshot: typeof updateProjectVoiceSnapshot;
  appendRunLog: typeof appendRunLog;
  spawnCommitReconciler: () => { pid: number | null };
}

export function createRollbackVersionService(input?: Partial<RollbackVersionServiceDependencies>) {
  const deps = {
    getChapterVersion,
    resolveProjectFilePath,
    readFinalChapter,
    readVersionFile,
    commitService: createChapterCommitService(),
    spawnCommitReconciler: () => createLauncherService().spawnCommitReconciler(),
    updateProjectVoiceSnapshot,
    appendRunLog,
    findReplayableTimelineMutationEffect,
    resumeTimelineMutationEffect,
    ...input,
  } as RollbackVersionServiceDependencies;

  return {
    async rollbackVersion(projectId: string, chapterNo: number, versionId: string) {
      const version = deps.getChapterVersion(versionId);
      if (!version) {
        throw notFound("版本不存在");
      }
      if (version.projectId !== projectId || version.chapterNo !== chapterNo) {
        throw new Error("版本不属于当前章节");
      }

      const mutationIdentity = `rollback:${versionId}`;
      const currentContent = await deps.readFinalChapter(projectId, chapterNo);
      const currentContentHash = computeContentHash((currentContent ?? "").trimEnd() + "\n");
      const existingEffect = deps.findReplayableTimelineMutationEffect(
        projectId,
        chapterNo,
        mutationIdentity,
        currentContentHash,
      );
      if (existingEffect) {
        const invalidatedTimeline = await deps.resumeTimelineMutationEffect(
          existingEffect.operationKey,
          deps.invalidateFutureTimelineAfterChapterChange,
        );
        return { ...version, invalidatedTimeline };
      }

      const safeVersionPath = deps.resolveProjectFilePath(projectId, version.path, ["versions"]);
      const selectedContent = await deps.readVersionFile(safeVersionPath);

      const stageDir = commitStageDir(projectId, `rollback-${versionId}`);
      const normalizedContent = selectedContent.trimEnd() + "\n";
      const contentChanged = currentContent?.trim() !== selectedContent.trim();
      const mutationKeys = buildTimelineMutationKeys({
        projectId,
        chapterNo,
        oldContentHash: currentContentHash,
        newContentHash: computeContentHash(normalizedContent),
        mutationIdentity,
      });
      const manifest = await writeCommitStage(stageDir, [
        {
          relativePath: `chapters/chapter_${String(chapterNo).padStart(3, "0")}.md`,
          content: normalizedContent,
        },
      ]);

      const preparedCommit = await deps.commitService.prepareCommit({
        projectId,
        chapterNo,
        sessionId: null,
        sourceKind: "rollback",
        acceptedVersionId: versionId,
        idempotencyKey: `${mutationKeys.operationKey}:rollback`,
        manifest,
        stageDir,
        contentHash: computeContentHash(normalizedContent),
      });

      await deps.commitService.applyStagedFiles(preparedCommit.commitId);
      await deps.commitService.markFsApplied(preparedCommit.commitId);
      const invalidationReason = `第 ${chapterNo} 章回滚到版本 ${version.versionNo} 后，后续章节需要依据新正文重建。`;
      const invalidatedAt = nowIso();
      await deps.commitService.finalizeCommit(preparedCommit.commitId, contentChanged ? {
        ...mutationKeys,
        mutationIdentity,
        payloadJson: JSON.stringify({
          projectId,
          chapterNo,
          reason: invalidationReason,
          operationKey: mutationKeys.operationKey,
          invalidatedAt,
          versionId,
          contentHash: computeContentHash(normalizedContent),
          mutationIdentity,
        }),
      } : undefined);
      await deps.updateProjectVoiceSnapshot(projectId).catch((error) => { console.warn(`[rollback] voice snapshot update failed for ${projectId}:`, String(error)); return null; });
      deps.spawnCommitReconciler();
      const registeredEffect = contentChanged
        ? deps.findReplayableTimelineMutationEffect(
            projectId,
            chapterNo,
            mutationIdentity,
            computeContentHash(normalizedContent),
          )
        : null;
      const invalidatedTimeline = !contentChanged
        ? null
        : registeredEffect
          ? await deps.resumeTimelineMutationEffect(
              registeredEffect.operationKey,
              deps.invalidateFutureTimelineAfterChapterChange,
            )
          : await deps.invalidateFutureTimelineAfterChapterChange(
              projectId,
              chapterNo,
              invalidationReason,
              { operationKey: mutationKeys.operationKey, invalidatedAt },
            );

      deps.appendRunLog(projectId, "info", `第 ${chapterNo} 章已回滚到版本 ${version.versionNo}`);
      return {
        ...version,
        invalidatedTimeline,
      };
    },
  };
}

export async function rollbackVersion(projectId: string, chapterNo: number, versionId: string) {
  createChapterSessionGuard().assertNoOpenSession(projectId, "回滚版本", {
    allowDuringManualReview: true,
  });
  return createRollbackVersionService({
    invalidateFutureTimelineAfterChapterChange,
  }).rollbackVersion(projectId, chapterNo, versionId);
}
