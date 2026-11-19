import type {
  ChapterReviewState,
  QuickAuditVerdict,
  ReviewPolicy,
  ReviewTriggerReason,
  WritingCharter,
} from "../types.ts";
import type { StoryLength } from "../domain/project-structure.ts";
import { buildWritingCharterPromptContract } from "../style/style-steering.ts";

const DEFAULT_FORCE_TRIGGERS: ReviewTriggerReason[] = [
  "hard_conflict",
  "low_confidence",
  "major_progression",
  "manual_checkpoint",
  "final_chapter",
  "completion_candidate",
];

const PRE_START_FORCE_TRIGGERS = new Set<ReviewTriggerReason>([
  "hard_conflict",
  "manual_checkpoint",
]);

function uniqSortedChapters(chapters: number[]) {
  return Array.from(
    new Set(
      chapters
        .map((value) => Math.trunc(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((left, right) => left - right);
}

export function getDefaultCadenceForStoryLength(storyLength: StoryLength) {
  if (storyLength === "short") {
    return 1;
  }
  if (storyLength === "medium") {
    return 3;
  }
  return 4;
}

export function getDefaultDeepReviewStartChapterForStoryLength(storyLength: StoryLength) {
  void storyLength;
  return 1;
}

export function resolveReviewPolicy(
  storyLength: StoryLength,
  input?: Partial<ReviewPolicy> | null,
): ReviewPolicy {
  const cadence = Math.max(1, Math.trunc(input?.cadenceChapters ?? getDefaultCadenceForStoryLength(storyLength)));
  const deepReviewStartChapter = Math.max(
    1,
    Math.trunc(input?.deepReviewStartChapter ?? getDefaultDeepReviewStartChapterForStoryLength(storyLength)),
  );
  const forceTriggers = input?.forceTriggers?.length
    ? Array.from(new Set(input.forceTriggers))
    : DEFAULT_FORCE_TRIGGERS;

  return {
    cadenceChapters: cadence,
    deepReviewStartChapter,
    perChapterCheckMode: "minimal",
    forceTriggers,
    manualCheckpointChapters: uniqSortedChapters(input?.manualCheckpointChapters ?? []),
  };
}

export function getReviewWindowStartChapter(
  states: Array<Pick<ChapterReviewState, "chapterNo" | "status">>,
  currentChapter: number,
) {
  const lastDeepLocked = states
    .filter((state) => state.status === "deep_locked" && state.chapterNo < currentChapter)
    .sort((left, right) => right.chapterNo - left.chapterNo)[0];

  return Math.max(1, (lastDeepLocked?.chapterNo ?? 0) + 1);
}

export function buildReviewCharterPromptContract(input: {
  mode: "quick" | "deep" | "selector";
  writingCharter?: WritingCharter | null;
}) {
  if (!input.writingCharter) {
    return [];
  }

  return [
    ...buildWritingCharterPromptContract({
      writingCharter: input.writingCharter,
      stage: input.mode === "selector" ? "selector" : "reviewer",
    }),
    input.mode === "quick"
      ? "极简检查时，若发现作者习惯卡失守，要把问题写进 styleChecklistHits 和 charterViolations，并直接复用统一术语。"
      : input.mode === "deep"
        ? "深审时，若发现作者习惯卡失守，要把问题写进 styleChecklistHits 和 charterViolations，并用同一术语解释 earliestAffectedChapter 是否受影响。"
        : "自动选版时，优先排除 charterViolations 更重、机制露出更解释腔、章末策略更回钉的版本。",
  ].filter(Boolean);
}

export function decideMandatoryDeepReview(input: {
  chapterNo: number;
  totalChapters: number;
  policy: ReviewPolicy;
  isCompletionCandidate?: boolean;
}) {
  const reasons = new Set<ReviewTriggerReason>();
  if (input.chapterNo <= 6) {
    return {
      shouldDeepReview: true,
      triggerReasons: ["opening_window"] satisfies ReviewTriggerReason[],
    };
  }
  if (input.chapterNo >= input.totalChapters) {
    reasons.add("final_chapter");
  }
  if (input.isCompletionCandidate) {
    reasons.add("completion_candidate");
  }
  if (
    input.chapterNo >= input.policy.deepReviewStartChapter
    && input.chapterNo % input.policy.cadenceChapters === 0
  ) {
    reasons.add("cadence");
  }
  if (input.policy.manualCheckpointChapters.includes(input.chapterNo)) {
    reasons.add("manual_checkpoint");
  }
  if (input.chapterNo >= 7 && input.chapterNo <= 12 && input.chapterNo % 2 === 0) {
    reasons.add("mid_window");
  }
  return {
    shouldDeepReview: reasons.size > 0,
    triggerReasons: [...reasons],
  };
}

export function decideDeepReview(input: {
  chapterNo: number;
  totalChapters: number;
  policy: ReviewPolicy;
  quickAudit: QuickAuditVerdict;
  hasHardConflict: boolean;
  hasMajorProgression: boolean;
  isCompletionCandidate?: boolean;
}) {
  const mandatory = decideMandatoryDeepReview(input);
  const reasons = new Set<ReviewTriggerReason>(mandatory.triggerReasons);
  const hasReachedDeepReviewWindow = input.chapterNo >= input.policy.deepReviewStartChapter;
  if (input.hasHardConflict) {
    reasons.add("hard_conflict");
  }
  if (input.quickAudit.verdict === "escalate" || input.quickAudit.confidence < 0.68) {
    reasons.add("low_confidence");
  }
  if (input.hasMajorProgression) {
    reasons.add("major_progression");
  }

  const filteredReasons = [...reasons].filter((reason) =>
    mandatory.triggerReasons.includes(reason)
      ? true
      : input.policy.forceTriggers.includes(reason)
        && (hasReachedDeepReviewWindow || PRE_START_FORCE_TRIGGERS.has(reason)),
  );

  return {
    shouldDeepReview: filteredReasons.length > 0,
    triggerReasons: filteredReasons,
  };
}
