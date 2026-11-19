import "../server-only.ts";

import { readDraftSnapshot, readFinalChapter } from "../project-files.ts";
import { listChapterInvalidations, listChapterVersions } from "../repositories/chapter.repository.ts";
import { getBlueprint } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { getChapterReviewState, listConflicts } from "../repositories/review.repository.ts";
import { getRunProgress } from "../run/progress.service.ts";
import { listCurrentReviewReports } from "./review-content-identity.service.ts";

export async function getChapterDetail(
  projectId: string,
  chapterNo: number,
  input?: { includeConflicts?: boolean },
) {
  const [content, blueprint, versions, project, progress, reviewState, invalidatedHistory, conflicts] =
    await Promise.all([
      readFinalChapter(projectId, chapterNo),
      Promise.resolve(getBlueprint(projectId, chapterNo)),
      Promise.resolve(listChapterVersions(projectId, chapterNo)),
      Promise.resolve(getProject(projectId)),
      Promise.resolve(getRunProgress(projectId)),
      Promise.resolve(getChapterReviewState(projectId, chapterNo)),
      Promise.resolve(listChapterInvalidations(projectId, chapterNo)),
      input?.includeConflicts ? Promise.resolve(listConflicts(projectId)) : Promise.resolve(undefined),
    ]);

  const liveDraft = progress.currentChapter === chapterNo && progress.draftFile
    ? await readDraftSnapshot(projectId, progress.draftFile).catch(() => null) // draft file may not exist yet
    : null;
  const currentReviewContent = liveDraft?.content ?? content;
  const reviews = await listCurrentReviewReports(projectId, chapterNo, currentReviewContent);
  const awaitingManualReview = progress.stage === "manual_review" && progress.currentChapter === chapterNo;
  const earliestAffectedChapter =
    typeof progress.stageDetails.review?.earliestAffectedChapter === "number"
      ? progress.stageDetails.review.earliestAffectedChapter
      : null;
  const requiresWindowRestart =
    awaitingManualReview && earliestAffectedChapter !== null && earliestAffectedChapter < chapterNo;

  return {
    chapterNo,
    content,
    blueprint,
    versions,
    reviews,
    invalidatedHistory,
    reviewState,
    conflicts: conflicts ?? null,
    liveDraft: liveDraft
      ? {
          content: liveDraft.content,
          completed: liveDraft.completed,
        }
      : null,
    run: {
      running: progress.running,
      stage: progress.stage,
      currentChapter: progress.currentChapter,
      currentPosition: progress.currentPosition ?? 0,
      wordCount: progress.wordCount ?? 0,
      isCurrentChapter: progress.currentChapter === chapterNo,
      isStreaming: progress.running && progress.currentChapter === chapterNo && Boolean(progress.draftFile),
    },
    manualReview: {
      awaiting: awaitingManualReview,
      reason: awaitingManualReview ? progress.error ?? null : null,
      canApprove: awaitingManualReview && Boolean(content) && !requiresWindowRestart,
      canAutoPick: awaitingManualReview && versions.length > 0 && !requiresWindowRestart,
      isLastChapter: project?.chapterPlanningMode === "fixed"
        ? chapterNo >= (project?.targetChapters ?? chapterNo)
        : progress.stage === "completed" && progress.currentChapter === chapterNo,
      earliestAffectedChapter,
      requiresWindowRestart,
    },
  };
}

export function listProjectChapterVersions(projectId: string, chapterNo: number) {
  return listChapterVersions(projectId, chapterNo);
}

export async function listProjectChapterReviews(projectId: string, chapterNo: number) {
  const content = await readFinalChapter(projectId, chapterNo);
  return listCurrentReviewReports(projectId, chapterNo, content);
}
