import "../server-only.ts";

import {
  computeChapterContentHash,
  computeReviewWindowContentHash,
  readFinalChapter,
  reviewWindowKey,
} from "../project-files.ts";
import {
  getLatestReview,
  listReviewReports,
  type ReviewContentIdentityOptions,
} from "../repositories/review.repository.ts";

export async function buildReviewContentIdentityOptions(
  projectId: string,
  chapterNo: number,
  currentContent?: string | null,
): Promise<ReviewContentIdentityOptions> {
  const resolvedCurrentContent = currentContent === undefined
    ? await readFinalChapter(projectId, chapterNo)
    : currentContent;
  const currentWindowContentHashes: Record<string, string> = {};
  const deepWindows = new Map<string, { start: number; end: number }>();

  for (const report of listReviewReports(projectId, chapterNo)) {
    if (
      report.reviewMode === "deep"
      && report.windowStartChapter !== null
      && report.windowEndChapter !== null
      && report.windowStartChapter > 0
      && report.windowEndChapter >= report.windowStartChapter
      && report.windowEndChapter - report.windowStartChapter <= 1_000
    ) {
      deepWindows.set(
        reviewWindowKey(report.windowStartChapter, report.windowEndChapter),
        { start: report.windowStartChapter, end: report.windowEndChapter },
      );
    }
  }

  for (const [key, window] of deepWindows) {
    const chapters = await Promise.all(
      Array.from({ length: window.end - window.start + 1 }, (_, index) => window.start + index)
        .map(async (currentChapter) => ({
          chapterNo: currentChapter,
          content: currentChapter === chapterNo
            ? resolvedCurrentContent
            : await readFinalChapter(projectId, currentChapter),
        })),
    );
    if (chapters.every((chapter) => chapter.content !== null)) {
      currentWindowContentHashes[key] = computeReviewWindowContentHash(
        chapters.map((chapter) => ({ chapterNo: chapter.chapterNo, content: chapter.content! })),
      );
    }
  }

  return {
    currentContentHash: resolvedCurrentContent === null
      ? null
      : computeChapterContentHash(resolvedCurrentContent),
    currentWindowContentHashes,
  };
}

export async function listCurrentReviewReports(
  projectId: string,
  chapterNo: number,
  currentContent?: string | null,
) {
  const identities = await buildReviewContentIdentityOptions(projectId, chapterNo, currentContent);
  return listReviewReports(projectId, chapterNo, identities);
}

export async function getLatestCurrentReview(
  projectId: string,
  chapterNo: number,
  currentContent?: string | null,
) {
  const identities = await buildReviewContentIdentityOptions(projectId, chapterNo, currentContent);
  return getLatestReview(projectId, chapterNo, identities);
}
