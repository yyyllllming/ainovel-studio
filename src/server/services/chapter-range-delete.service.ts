import "../server-only.ts";

import { recalculateAutoRecurringCharacterCards } from "../character/auto-character-discovery-runtime.ts";
import { createChapterSessionGuard } from "../commit/chapter-session-guard.ts";
import {
  clearNovelExport,
  deleteChapterArtifactsInRange,
  listWrittenChapters,
  removeCanonEntriesInChapterRange,
} from "../project-files.ts";
import { rawDb } from "../db/client.ts";
import { notFound } from "../errors.ts";
import {
  deleteChapterRangeRecords,
  listChapterInvalidations,
} from "../repositories/chapter.repository.ts";
import { getFoundation } from "../repositories/foundation.repository.ts";
import { getProject, getStoryContract, saveStoryContract } from "../repositories/project.repository.ts";
import { appendRunLog, buildRunProgress, getRunState, upsertRunState } from "../repositories/run.repository.ts";
import { listChapterDeltaRecords } from "../repositories/review.repository.ts";
import { calculateCompletionProgress, hydrateStoryContract } from "../story/story-contract.ts";
import { deriveStoryProgressState } from "../story/story-progression.ts";
import type { StoryContract } from "../types.ts";
import { clamp } from "../utils.ts";
import { deleteChapterRangePayloadSchema } from "../validation.ts";
import type { ProjectRecord } from "../repositories/shared.ts";

export interface DeleteChapterRangeInput {
  startChapter: number;
  endChapter: number;
}

export interface ChapterRangeDeleteRuntimeTask {
  paused: boolean;
  stopRequested: boolean;
}

export interface ChapterRangeDeleteRuntimeDependencies {
  getActiveTask: (projectId: string) => ChapterRangeDeleteRuntimeTask | undefined;
  hasLock: (projectId: string) => boolean;
  releaseLock: (projectId: string) => Promise<void>;
}

export interface ChapterRangeDeleteServiceDependencies extends Partial<ChapterRangeDeleteRuntimeDependencies> {
  deleteChapterRange: (projectId: string, input: DeleteChapterRangeInput) => Promise<unknown>;
}

function resetStoryContractAfterDeletion(
  projectId: string,
  project: ProjectRecord,
  currentContract: StoryContract | null,
  startChapter: number,
) {
  if (!currentContract) {
    return null;
  }

  const remainingDeltaRecords = listChapterDeltaRecords(projectId);
  const progressState = deriveStoryProgressState(remainingDeltaRecords);
  const latestChapter = progressState.latestChapter;
  const retainedSegments = currentContract.segmentPlans.filter((segment) => segment.endChapter < startChapter);
  const syncedContract = hydrateStoryContract(currentContract, {
    genre: project.genre,
    premise: project.premise,
    completionCriteria: project.completionCriteria,
    latestChapter,
    foundation: getFoundation(projectId),
  });
  const orderedVolumes = syncedContract.volumes.map((volume, index, all) => {
    const nextVolume = all[index + 1] ?? null;
    const effectiveEnd = volume.chapterEnd ?? (nextVolume ? nextVolume.chapterStart - 1 : null);
    if (latestChapter <= 0) {
      return {
        ...volume,
        status: index === 0 ? ("active" as const) : ("planned" as const),
        chapterEnd: null,
      };
    }
    if (effectiveEnd !== null && latestChapter >= effectiveEnd) {
      return {
        ...volume,
        status: "completed" as const,
        chapterEnd: effectiveEnd,
      };
    }
    if (latestChapter >= volume.chapterStart) {
      return {
        ...volume,
        status: "active" as const,
        chapterEnd: null,
      };
    }
    return {
      ...volume,
      status: "planned" as const,
      chapterEnd: null,
    };
  });
  const activeVolume = orderedVolumes.find((volume) => volume.status === "active") ?? orderedVolumes[0] ?? null;
  const completionProgress = latestChapter > 0
    ? calculateCompletionProgress(latestChapter, syncedContract, project.hardChapterCap)
    : 0;
  const nextContract: StoryContract = {
    ...syncedContract,
    volumes: orderedVolumes,
    currentVolume: activeVolume?.volumeNo ?? syncedContract.currentVolume,
    segmentPlans: retainedSegments,
    progressState,
    forecast: {
      ...syncedContract.forecast,
      finalRunReady:
        latestChapter > 0
          ? syncedContract.forecast.finalRunReady && latestChapter >= syncedContract.forecast.target
          : false,
      completionProgress,
      nextMilestone:
        latestChapter > 0
          ? syncedContract.forecast.nextMilestone
          : `优先完成${activeVolume?.label ?? "当前卷"}的核心目标`,
    },
  };
  saveStoryContract(projectId, nextContract);
  return nextContract;
}

export function createChapterRangeDeleteService(input?: Partial<ChapterRangeDeleteServiceDependencies>) {
  const deps = {
    getActiveTask: input?.getActiveTask ?? (() => undefined),
    hasLock: input?.hasLock ?? (() => false),
    releaseLock: input?.releaseLock ?? (async () => {}),
    deleteChapterRange: input?.deleteChapterRange,
  };

  return {
    async deleteChapterRange(projectId: string, payload: DeleteChapterRangeInput) {
      const run = deps.deleteChapterRange;
      if (run) {
        return run(projectId, payload);
      }

      const project = getProject(projectId);
      if (!project) {
        throw notFound("项目不存在");
      }
      createChapterSessionGuard().assertNoOpenSession(projectId, "删除章节");

      const parsed = deleteChapterRangePayloadSchema.parse(payload);
      const writtenChapters = await listWrittenChapters(projectId);
      const deltaChapters = listChapterDeltaRecords(projectId).map((record) => record.chapterNo);
      const invalidatedChapters = listChapterInvalidations(projectId).map((record) => record.chapterNo);
      const maxExistingChapter = Math.max(
        1,
        ...writtenChapters,
        ...deltaChapters,
        ...invalidatedChapters,
        getRunState(projectId)?.currentChapter ?? 1,
      );
      const startChapter = clamp(parsed.startChapter, 1, maxExistingChapter);
      const endChapter = clamp(parsed.endChapter, startChapter, maxExistingChapter);
      const activeTask = deps.getActiveTask(projectId);

      if (activeTask && !activeTask.paused) {
        throw new Error("自动写作进行中，请先暂停后再删除章节");
      }

      if (activeTask) {
        activeTask.stopRequested = true;
        activeTask.paused = false;
      }
      if (deps.hasLock(projectId)) {
        await deps.releaseLock(projectId);
      }

      // ── DB 段：一个事务里完成 records 删除、contract 重置、运行状态切换和日志 ──
      // 任一步失败整体回滚，避免半成品状态（删除提交但 contract/run state 残留）。
      const nextContract = rawDb.transaction(() => {
        deleteChapterRangeRecords(projectId, startChapter, endChapter);
        const contract = resetStoryContractAfterDeletion(
          projectId,
          project,
          project.storyContract ?? getStoryContract(projectId),
          startChapter,
        );

        upsertRunState(projectId, {
          stage: "paused",
          status: "paused",
          desiredState: "idle",
          heartbeatAt: null,
          currentChapter: startChapter,
          totalChapters: contract?.forecast.target ?? project.storyContract?.forecast.target ?? project.chapterBudgetTarget,
          retryCount: 0,
          confidence: 0,
          lastError: null,
          draftFile: null,
          currentPosition: 0,
          wordCount: 0,
          stageDetails: {},
        });

        appendRunLog(
          projectId,
          "warning",
          startChapter === endChapter
            ? `已删除第 ${startChapter} 章的正文、规划和审核产物`
            : `已删除第 ${startChapter} 章到第 ${endChapter} 章的正文、规划和审核产物`,
        );

        return contract;
      })();

      // ── 文件系统段：DB 已落地后再 best-effort 清理产物 ──
      // facts/foreshadows 的读改写收敛到 canon-files 的持锁入口，避免与 artifact sync 并发交叠丢写。
      await Promise.all([
        removeCanonEntriesInChapterRange(projectId, startChapter, endChapter),
        deleteChapterArtifactsInRange(projectId, startChapter, endChapter),
        clearNovelExport(projectId),
      ]);
      recalculateAutoRecurringCharacterCards(projectId);

      void nextContract;
      return buildRunProgress(projectId);
    },
  };
}

export async function deleteChapterRange(projectId: string, payload: DeleteChapterRangeInput) {
  return createChapterRangeDeleteService().deleteChapterRange(projectId, payload);
}
