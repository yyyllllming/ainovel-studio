import "../server-only.ts";

import { notFound } from "../errors.ts";
import { readFileSync } from "node:fs";
import { applyPatchOperations } from "../patch-utils.ts";
import {
  commitStageDir,
  computeContentHash,
  readFinalChapter,
  writeCommitStage,
  writeVersionFile,
} from "../project-files.ts";
import { resolveProjectFilePath } from "../paths.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getNextVersionNo, saveChapterVersion } from "../repositories/chapter.repository.ts";
import type { EditorPatch } from "../types.ts";
import { editorPatchSchema } from "../validation.ts";
import { safeParseJson } from "../utils/safe-json.ts";
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

export interface ApplyStoredPatchServiceDependencies {
  readFinalChapter: typeof readFinalChapter;
  resolveProjectFilePath: typeof resolveProjectFilePath;
  readPatchFile: (path: string) => string;
  writeVersionFile: typeof writeVersionFile;
  getNextVersionNo: typeof getNextVersionNo;
  saveChapterVersion: typeof saveChapterVersion;
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

export function createApplyStoredPatchService(input?: Partial<ApplyStoredPatchServiceDependencies>) {
  const deps = {
    readFinalChapter,
    resolveProjectFilePath,
    readPatchFile: (path: string) => readFileSync(path, "utf8"),
    writeVersionFile,
    getNextVersionNo,
    saveChapterVersion,
    commitService: createChapterCommitService(),
    spawnCommitReconciler: () => createLauncherService().spawnCommitReconciler(),
    updateProjectVoiceSnapshot,
    appendRunLog,
    findReplayableTimelineMutationEffect,
    resumeTimelineMutationEffect,
    ...input,
  } as ApplyStoredPatchServiceDependencies;

  return {
    async applyStoredPatch(input: {
      projectId: string;
      chapterNo: number;
      patchId?: string;
      patch?: EditorPatch;
    }) {
      const content = await deps.readFinalChapter(input.projectId, input.chapterNo);
      if (!content) {
        throw notFound("章节正文不存在");
      }

      let patch = input.patch ? editorPatchSchema.parse(input.patch) : undefined;
      if (!patch && input.patchId) {
        const safePatchPath = deps.resolveProjectFilePath(input.projectId, input.patchId, ["patches"]);
        patch = editorPatchSchema.parse(safeParseJson<unknown>(deps.readPatchFile(safePatchPath)));
      }
      if (!patch) {
        throw new Error("缺少 Patch 数据");
      }

      const mutationIdentity = `patch:${input.patchId ?? computeContentHash(JSON.stringify(patch))}`;
      const currentContentHash = computeContentHash(content.trimEnd() + "\n");
      const existingEffect = deps.findReplayableTimelineMutationEffect(
        input.projectId,
        input.chapterNo,
        mutationIdentity,
        currentContentHash,
      );
      if (existingEffect) {
        const invalidatedTimeline = await deps.resumeTimelineMutationEffect(
          existingEffect.operationKey,
          deps.invalidateFutureTimelineAfterChapterChange,
        );
        return {
          versionId: existingEffect.payload.versionId,
          content,
          invalidatedTimeline,
        };
      }

      const nextContent = applyPatchOperations(content, patch.operations);
      const normalizedContent = nextContent.trimEnd() + "\n";
      const contentChanged = content.trim() !== nextContent.trim();
      const mutationKeys = buildTimelineMutationKeys({
        projectId: input.projectId,
        chapterNo: input.chapterNo,
        oldContentHash: currentContentHash,
        newContentHash: computeContentHash(normalizedContent),
        mutationIdentity,
      });
      const versionNo = deps.getNextVersionNo(input.projectId, input.chapterNo);
      const versionPath = await deps.writeVersionFile(input.projectId, input.chapterNo, versionNo, nextContent);
      const versionId = deps.saveChapterVersion({
        projectId: input.projectId,
        chapterNo: input.chapterNo,
        versionNo,
        temperature: 0.2,
        path: versionPath,
        excerpt: nextContent.slice(0, 180),
        selected: false,
        source: "patch",
      });

      const stageDir = commitStageDir(input.projectId, `patch-${versionId}`);
      const manifest = await writeCommitStage(stageDir, [
        {
          relativePath: `chapters/chapter_${String(input.chapterNo).padStart(3, "0")}.md`,
          content: normalizedContent,
        },
      ]);

      const preparedCommit = await deps.commitService.prepareCommit({
        projectId: input.projectId,
        chapterNo: input.chapterNo,
        sessionId: null,
        sourceKind: "workshop",
        acceptedVersionId: versionId,
        idempotencyKey: `${mutationKeys.operationKey}:workshop`,
        manifest,
        stageDir,
        contentHash: computeContentHash(normalizedContent),
      });

      await deps.commitService.applyStagedFiles(preparedCommit.commitId);
      await deps.commitService.markFsApplied(preparedCommit.commitId);
      const invalidationReason = `第 ${input.chapterNo} 章应用 Patch 后，后续章节需要依据新正文重建。`;
      const invalidatedAt = nowIso();
      await deps.commitService.finalizeCommit(preparedCommit.commitId, contentChanged ? {
        ...mutationKeys,
        mutationIdentity,
        payloadJson: JSON.stringify({
          projectId: input.projectId,
          chapterNo: input.chapterNo,
          reason: invalidationReason,
          operationKey: mutationKeys.operationKey,
          invalidatedAt,
          versionId,
          contentHash: computeContentHash(normalizedContent),
          mutationIdentity,
        }),
      } : undefined);
      await deps.updateProjectVoiceSnapshot(input.projectId).catch((error) => { console.warn(`[apply-patch] voice snapshot update failed for ${input.projectId}:`, String(error)); return null; });
      deps.spawnCommitReconciler();
      const registeredEffect = contentChanged
        ? deps.findReplayableTimelineMutationEffect(
            input.projectId,
            input.chapterNo,
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
              input.projectId,
              input.chapterNo,
              invalidationReason,
              { operationKey: mutationKeys.operationKey, invalidatedAt },
            );
      deps.appendRunLog(input.projectId, "info", `第 ${input.chapterNo} 章已应用 Patch，并已排队重建分析产物`);
      return {
        versionId,
        content: nextContent,
        invalidatedTimeline,
      };
    },
  };
}

export async function applyStoredPatch(input: {
  projectId: string;
  chapterNo: number;
  patchId?: string;
  patch?: EditorPatch;
}) {
  createChapterSessionGuard().assertNoOpenSession(input.projectId, "应用 Patch", {
    allowDuringManualReview: true,
  });
  return createApplyStoredPatchService({
    invalidateFutureTimelineAfterChapterChange,
  }).applyStoredPatch(input);
}
