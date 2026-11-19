export type ManualReviewAction = "approve_continue" | "retry_chapter" | "auto_pick_version";

export function shouldAutoRestartWindowReview(input: {
  chapterNo: number;
  earliestAffectedChapter: number | null;
  previousAutoRestarts: number;
  maxAutoRestarts?: number;
}) {
  const maxAutoRestarts = input.maxAutoRestarts ?? 2;
  return Boolean(
    typeof input.earliestAffectedChapter === "number"
    && input.earliestAffectedChapter < input.chapterNo
    && input.previousAutoRestarts < maxAutoRestarts,
  );
}

export function shouldAutoPickVersionOnLowConfidence(input: {
  confidence: number;
  chapterNo: number;
  earliestAffectedChapter: number | null;
  previousAutoPickAttempts: number;
  lowConfidenceThreshold?: number;
  maxAutoPickAttempts?: number;
}) {
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? 0.6;
  const maxAutoPickAttempts = input.maxAutoPickAttempts ?? 1;
  const earliestAffectedChapter = input.earliestAffectedChapter ?? input.chapterNo;

  return input.confidence < lowConfidenceThreshold
    && earliestAffectedChapter >= input.chapterNo
    && input.previousAutoPickAttempts < maxAutoPickAttempts;
}

export function pickFallbackVersionForAutoReview<T extends { id: string; versionNo: number; temperature: number }>(
  versions: T[],
) {
  return [...versions].sort(
    (left, right) => left.temperature - right.temperature || left.versionNo - right.versionNo,
  )[0] ?? null;
}

export function resolveManualReviewAction(input: {
  action: ManualReviewAction;
  chapterNo: number;
  totalChapters: number;
  shouldCompleteOnApproval?: boolean;
}) {
  if (input.action === "retry_chapter") {
    return {
      restartFromChapter: input.chapterNo,
      completesProject: false,
    };
  }

  if (input.shouldCompleteOnApproval || input.chapterNo >= input.totalChapters) {
    return {
      restartFromChapter: null,
      completesProject: true,
    };
  }

  return {
    restartFromChapter: input.chapterNo + 1,
    completesProject: false,
  };
}
