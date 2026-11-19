import "../server-only.ts";

import { listWrittenChapters } from "../project-files.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { softInvalidateChapterRange as softInvalidateChapterRangeService } from "../services/run-restart.service.ts";

const UPSTREAM_EDIT_INVALIDATION_REASON_PREFIX = "[upstream_revision]";

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
  return softInvalidateChapterRangeService(projectId, input);
}

export async function invalidateFutureTimelineAfterChapterChange(
  projectId: string,
  chapterNo: number,
  reason: string,
  options?: { operationKey: string; invalidatedAt: string },
) {
  const writtenChapters = await listWrittenChapters(projectId);
  const nextChapter = chapterNo + 1;
  if (!writtenChapters.some((current) => current >= nextChapter)) {
    return null;
  }

  const result = await softInvalidateChapterRange(projectId, {
    fromChapter: nextChapter,
    reason: `${UPSTREAM_EDIT_INVALIDATION_REASON_PREFIX} ${reason}`,
    reviewReason: reason,
    operationKey: options?.operationKey ?? null,
    invalidatedAt: options?.invalidatedAt ?? null,
  });

  appendRunLog(
    projectId,
    "warning",
    `由于第 ${chapterNo} 章正文已改动，已自动归档第 ${result.startChapter}-${result.endChapter} 章，后续需按新时间线续写。`,
  );
  return result;
}
