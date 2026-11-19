import "../server-only.ts";

import { recalculateAutoRecurringCharacterCards } from "../character/auto-character-discovery-runtime.ts";
import {
  archiveInvalidatedChapter,
  clearNovelExport,
  deleteChapterArtifactsInRange,
  listWrittenChapters,
  readCanonFacts,
  readFinalChapter,
  readForeshadowEntries,
  replaceCanonFacts,
  replaceForeshadowEntries,
} from "../project-files.ts";
import {
  appendChapterInvalidations,
  deleteChapterRangeRecords,
  listChapterInvalidations,
  listChapterVersions,
} from "../repositories/chapter.repository.ts";
import { getBlueprint } from "../repositories/foundation.repository.ts";
import { getChapterReviewState, listReviewReports } from "../repositories/review.repository.ts";
import { appendRunLog, getRunState, upsertRunState } from "../repositories/run.repository.ts";
import { nowIso } from "../utils.ts";
import { getLatestCurrentReview } from "./review-content-identity.service.ts";

export async function softInvalidateChapterRange(
  projectId: string,
  input: {
    fromChapter: number;
    reason: string;
    reviewReason?: string | null;
    operationKey?: string | null;
    invalidatedAt?: string | null;
  },
) {
  const state = getRunState(projectId);
  const writtenChapters = await listWrittenChapters(projectId);
  const existingOperationRows = input.operationKey
    ? listChapterInvalidations(projectId).filter((row) => row.operationKey === input.operationKey)
    : [];
  const hasTimelineArtifacts =
    writtenChapters.some((chapterNo) => chapterNo >= input.fromChapter)
    || Boolean(state && state.currentChapter >= input.fromChapter)
    || Boolean(getBlueprint(projectId, input.fromChapter))
    || Boolean(getChapterReviewState(projectId, input.fromChapter))
    || listReviewReports(projectId, input.fromChapter).length > 0
    || listChapterVersions(projectId, input.fromChapter).length > 0
    || existingOperationRows.length > 0;
  if (!hasTimelineArtifacts) {
    return {
      startChapter: input.fromChapter,
      endChapter: input.fromChapter,
      invalidatedChapters: [] as number[],
    };
  }
  const rangeEnd = Math.max(
    input.fromChapter,
    ...writtenChapters,
    ...existingOperationRows.map((row) => row.rangeEndChapter),
    state?.currentChapter ?? 0,
  );

  if (rangeEnd < input.fromChapter) {
    return {
      startChapter: input.fromChapter,
      endChapter: input.fromChapter,
      invalidatedChapters: [] as number[],
    };
  }

  const invalidatedAt = input.invalidatedAt ?? existingOperationRows[0]?.invalidatedAt ?? nowIso();
  const existingChapters = new Set(existingOperationRows.map((row) => row.chapterNo));
  const [canonFacts, foreshadowEntries] = await Promise.all([
    readCanonFacts(projectId),
    readForeshadowEntries(projectId),
  ]);
  const invalidationRows = (
    await Promise.all(
      Array.from({ length: rangeEnd - input.fromChapter + 1 }, (_, index) => input.fromChapter + index).map(async (chapterNo) => {
        if (existingChapters.has(chapterNo)) {
          return null;
        }
        const content = await readFinalChapter(projectId, chapterNo);
        if (!content?.trim()) {
          return null;
        }
        const latestReview = await getLatestCurrentReview(projectId, chapterNo, content);
        const archived = await archiveInvalidatedChapter(projectId, chapterNo, {
          reason: input.reason,
          invalidatedAt,
          content,
        });
        if (!archived) {
          return null;
        }
        return {
          projectId,
          chapterNo,
          rangeStartChapter: input.fromChapter,
          rangeEndChapter: rangeEnd,
          reason: input.reason,
          archivedPath: archived.path,
          excerpt: archived.excerpt,
          reviewReason: latestReview?.reason ?? input.reviewReason ?? null,
          operationKey: input.operationKey ?? null,
          invalidatedAt,
        };
      }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (invalidationRows.length) {
    appendChapterInvalidations(invalidationRows);
  }

  deleteChapterRangeRecords(projectId, input.fromChapter, rangeEnd, { preserveInvalidations: true });

  await Promise.all([
    replaceCanonFacts(
      projectId,
      canonFacts.filter((fact) => fact.chapterNo < input.fromChapter || fact.chapterNo > rangeEnd),
    ),
    replaceForeshadowEntries(
      projectId,
      foreshadowEntries.filter((entry) => {
        const chapterNo = Number(entry.chapterNo ?? 0);
        return !Number.isFinite(chapterNo) || chapterNo < input.fromChapter || chapterNo > rangeEnd;
      }),
    ),
    deleteChapterArtifactsInRange(projectId, input.fromChapter, rangeEnd, { preserveInvalidatedHistory: true }),
    clearNovelExport(projectId),
  ]);
  recalculateAutoRecurringCharacterCards(projectId);

  upsertRunState(projectId, {
    stage: "paused",
    status: "paused",
    desiredState: "idle",
    heartbeatAt: null,
    currentChapter: input.fromChapter,
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
    invalidationRows.length
      ? `已将第 ${input.fromChapter} 章到第 ${rangeEnd} 章归档为失效历史，并清空当前有效时间线。`
      : `已清空第 ${input.fromChapter} 章到第 ${rangeEnd} 章的草稿、审核与上下文产物，准备重新生成。`,
  );

  return {
    startChapter: input.fromChapter,
    endChapter: rangeEnd,
    invalidatedChapters: Array.from(new Set([
      ...existingOperationRows.map((entry) => entry.chapterNo),
      ...invalidationRows.map((entry) => entry.chapterNo),
    ])).sort((left, right) => left - right),
  };
}
