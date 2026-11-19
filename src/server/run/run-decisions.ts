import { isRecoverableLlmTransportError } from "../llm.ts";
import { shouldAutoRescueBeforeQuickAudit } from "../writing/prose-rescue.ts";
import { decideDeepReview, decideMandatoryDeepReview } from "./review-policy.ts";
import type {
  ConflictRecord,
  QuickAuditVerdict,
  ReviewFailureCategory,
  ReviewPolicy,
  ReviewVerdict,
  ReviewTriggerReason,
} from "../types.ts";

type ProseRisk = Parameters<typeof shouldAutoRescueBeforeQuickAudit>[0]["proseRisk"];

export function hasBlockingContextConflicts(conflicts: ConflictRecord[]) {
  return conflicts.some((conflict) => conflict.severity === "hard");
}

export function shouldInvokeStyleRescue(input: {
  attemptsUsed: number;
  maxAttempts: number;
  chapterNo: number;
  retryCount: number;
  proseRisk: ProseRisk;
  quickAudit: Pick<QuickAuditVerdict, "verdict" | "issues">;
}) {
  if (input.attemptsUsed >= input.maxAttempts) {
    return false;
  }

  return shouldAutoRescueBeforeQuickAudit({
    chapterNo: input.chapterNo,
    retryCount: input.retryCount,
    proseRisk: input.proseRisk,
    quickAudit: input.quickAudit,
  });
}

export function shouldRewriteAfterQuickAudit(input: {
  attemptsUsed: number;
  maxAttempts: number;
  proseRisk: ProseRisk;
  quickAudit: Pick<QuickAuditVerdict, "verdict" | "issues" | "styleChecklistHits" | "charterViolations">;
}) {
  if (input.attemptsUsed >= input.maxAttempts || input.quickAudit.verdict !== "escalate") {
    return false;
  }

  const hasMajorNonStyleIssue = input.quickAudit.issues.some((issue) =>
    issue.severity === "major" && issue.type !== "style_drift"
  );
  if (hasMajorNonStyleIssue) {
    return false;
  }

  return input.proseRisk.severity !== "ok"
    || input.quickAudit.styleChecklistHits.some((hit) => hit.severity === "major")
    || input.quickAudit.charterViolations.length > 0;
}

export function shouldFallbackAfterAutoProseRescueFailure(error: unknown) {
  return isRecoverableLlmTransportError(error);
}

export function shouldInvokeDeepReview(input: {
  chapterNo: number;
  totalChapters: number;
  policy: ReviewPolicy;
  quickAudit: QuickAuditVerdict;
  hasHardConflict: boolean;
  hasMajorProgression: boolean;
  isCompletionCandidate?: boolean;
}) {
  const decision = decideDeepReview(input);
  return {
    shouldInvoke: decision.shouldDeepReview,
    triggerReasons: decision.triggerReasons,
  } satisfies {
    shouldInvoke: boolean;
    triggerReasons: ReviewTriggerReason[];
  };
}

export function shouldInvokeLlmStyleRescue(input: {
  chapterNo: number;
  proseRisk: {
    severity: "ok" | "warn" | "fail";
    shouldRetryStylePass: boolean;
  };
}) {
  if (!input.proseRisk.shouldRetryStylePass) {
    return false;
  }

  return input.proseRisk.severity === "fail" || input.chapterNo <= 5;
}

export function shouldInvokeQuickAudit(input: {
  chapterNo: number;
  totalChapters: number;
  retryCount: number;
  policy: ReviewPolicy;
  localGate: Pick<QuickAuditVerdict, "verdict">;
  isCompletionCandidate?: boolean;
}) {
  if (decideMandatoryDeepReview(input).shouldDeepReview) {
    return true;
  }

  if (input.localGate.verdict === "escalate" || input.retryCount > 0) {
    return true;
  }

  if (input.policy.manualCheckpointChapters.includes(input.chapterNo)) {
    return true;
  }

  if (input.chapterNo % input.policy.cadenceChapters === 0 && input.chapterNo >= input.policy.deepReviewStartChapter) {
    return true;
  }

  if (input.chapterNo >= input.totalChapters || input.isCompletionCandidate) {
    return true;
  }

  return false;
}

export function resolveDeepReviewOutcome(input: {
  retryCount: number;
  review: Pick<ReviewVerdict, "verdict" | "confidence">;
}) {
  const relaxedPassThreshold = input.retryCount >= 3 ? 0.6 : 0.8;

  if (input.review.verdict === "pass" && input.review.confidence >= relaxedPassThreshold) {
    return {
      action: "accept",
      relaxedPassThreshold,
    } as const;
  }

  if (input.review.confidence < 0.6 || input.review.verdict === "manual_review_window") {
    return {
      action: "manual_review",
      relaxedPassThreshold,
    } as const;
  }

  return {
    action: "rewrite",
    relaxedPassThreshold,
  } as const;
}

export function classifyReviewRepairPath(input: {
  review: Pick<ReviewVerdict, "issues" | "loopRisk" | "storyProgression" | "styleChecklistHits" | "charterViolations">;
  proseSeverity?: "ok" | "warn" | "fail";
  proseScore?: number | null;
}) {
  const category = classifyReviewFailureCategory({
    review: input.review,
  });

  if (category === "planning_failure") {
    const onlyAnchorMiss = input.review.issues.length > 0
      && input.review.issues.every((issue) => issue.type === "continuation_anchor_miss");
    const proseHealthy = (input.proseSeverity ?? "warn") === "ok"
      || (input.proseScore ?? 0) >= 0.75;
    if (onlyAnchorMiss && proseHealthy) {
      return "voice_polish" as const;
    }

    const hasPureStructureIssue = input.review.issues.some((issue) => issue.type === "structure_break");
    if (hasPureStructureIssue && !input.review.issues.some((issue) =>
      issue.type === "story_progression"
      || issue.type === "genre_fulfillment"
      || issue.type === "hook_debt"
      || issue.type === "payoff_miss"
      || issue.type === "relationship_drop"
      || issue.type === "blueprint_drift"
      || issue.type === "continuation_anchor_miss"
    )) {
      return "scene_rescue" as const;
    }

    return "planning_repair" as const;
  }

  if (category === "continuity_failure") {
    return "window_restart" as const;
  }

  if (category === "canon_failure") {
    return "manual_review" as const;
  }

  if (input.review.styleChecklistHits.length || input.review.charterViolations.length) {
    return "voice_polish" as const;
  }

  return "voice_polish" as const;
}

export function classifyReviewFailureCategory(input: {
  review: Pick<ReviewVerdict, "issues" | "loopRisk" | "storyProgression" | "styleChecklistHits" | "charterViolations">;
}): ReviewFailureCategory {
  const issueTypes = new Set(input.review.issues.map((issue) => issue.type));
  if (issueTypes.has("canon_failure")) {
    return "canon_failure";
  }

  if (issueTypes.has("continuity_window") || issueTypes.has("hard_conflict")) {
    return "continuity_failure";
  }

  if (
    issueTypes.has("story_progression")
    || issueTypes.has("genre_fulfillment")
    || issueTypes.has("scene_loop")
    || issueTypes.has("hook_debt")
    || issueTypes.has("payoff_miss")
    || issueTypes.has("relationship_drop")
    || issueTypes.has("blueprint_drift")
    || issueTypes.has("continuation_anchor_miss")
    || input.review.loopRisk.risk === "risk"
    || input.review.storyProgression.risk === "risk"
  ) {
    return "planning_failure";
  }

  if (input.review.styleChecklistHits.length || input.review.charterViolations.length) {
    return "prose_failure";
  }

  return issueTypes.has("structure_break") ? "planning_failure" : "prose_failure";
}
