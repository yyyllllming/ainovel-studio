import type { WritingCharterBudgetViolation } from "./style.ts";
import type {
  CoreProgressDeltaType,
  GenreFulfillmentAssessment,
  LoopRiskAssessment,
  PlannerQualitySummary,
  StoryProgressionAssessment,
} from "./story.ts";

export type ReviewTriggerReason =
  | "opening_window"
  | "mid_window"
  | "cadence"
  | "final_chapter"
  | "completion_candidate"
  | "manual_checkpoint"
  | "hard_conflict"
  | "low_confidence"
  | "major_progression";
export type ReviewMode = "quick" | "deep";
export type PerChapterCheckMode = "minimal";
export type ChapterReviewStatus = "provisional" | "deep_locked" | "manual_review";
export type ReviewFailureCategory =
  | "planning_failure"
  | "prose_failure"
  | "continuity_failure"
  | "canon_failure";
export type ReviewRepairStrategy =
  | "planning_repair"
  | "scene_rescue"
  | "voice_polish"
  | "window_restart"
  | "manual_review";

export interface ReviewPolicy {
  cadenceChapters: number;
  deepReviewStartChapter: number;
  perChapterCheckMode: PerChapterCheckMode;
  forceTriggers: ReviewTriggerReason[];
  manualCheckpointChapters: number[];
}

export interface ReviewIssue {
  type: string;
  location: string;
  severity: "minor" | "major";
  evidence?: string;
}

export interface StyleChecklistHit {
  dimension: string;
  description: string;
  severity: "minor" | "major";
}

export interface LocalFlavorLeadCount {
  lead: string;
  count: number;
}

export interface LocalFlavorSignals {
  severity: "ok" | "warn" | "fail";
  score: number;
  notes: string[];
  warnings: string[];
  momentMarkerCount: number;
  explanationLeadCount: number;
  judgmentLeadCount: number;
  phraseReuseHits: Array<{ phrase: string; count: number }>;
  pronounLeadCount: number;
  pronounLeadRatio: number;
  simileCount: number;
  contrastTemplateCount: number;
  abruptTurnCount: number;
  repeatedSentenceStarts: LocalFlavorLeadCount[];
  dominantLead: LocalFlavorLeadCount | null;
  sentenceCount: number;
}

export interface QuickAuditVerdict {
  reviewMode: "quick";
  verdict: "pass" | "escalate";
  confidence: number;
  reason: string;
  fixInstructions: string;
  issues: ReviewIssue[];
  triggerReasons: ReviewTriggerReason[];
  styleChecklistHits: StyleChecklistHit[];
  charterViolations: WritingCharterBudgetViolation[];
  storyProgression: StoryProgressionAssessment;
  genreFulfillment: GenreFulfillmentAssessment | null;
  loopRisk: LoopRiskAssessment;
  primaryDeltaDelivered: CoreProgressDeltaType | null;
  stuckDimensions: string[];
  localFlavorSignals?: LocalFlavorSignals;
  failureCategory?: ReviewFailureCategory;
  repairStrategy?: ReviewRepairStrategy;
}

export interface DeepReviewVerdict {
  reviewMode: "deep";
  verdict: "pass" | "rewrite_current" | "manual_review_window";
  confidence: number;
  reason: string;
  fixInstructions: string;
  issues: ReviewIssue[];
  triggerReasons: ReviewTriggerReason[];
  styleChecklistHits: StyleChecklistHit[];
  charterViolations: WritingCharterBudgetViolation[];
  storyProgression: StoryProgressionAssessment;
  genreFulfillment: GenreFulfillmentAssessment | null;
  loopRisk: LoopRiskAssessment;
  primaryDeltaDelivered: CoreProgressDeltaType | null;
  stuckDimensions: string[];
  localFlavorSignals?: LocalFlavorSignals;
  windowStartChapter: number;
  windowEndChapter: number;
  earliestAffectedChapter: number | null;
  failureCategory?: ReviewFailureCategory;
  repairStrategy?: ReviewRepairStrategy;
}

export type ReviewVerdict = DeepReviewVerdict;

export interface ReviewLineage {
  submissionId: string | null;
  versionId: string | null;
  contentHash: string;
  reviewerProfileId: string;
  promptHash: string;
  reviewSchemaVersion: string;
  windowContentHash: string | null;
}

export type ReviewArtifact = (Omit<QuickAuditVerdict, "localFlavorSignals"> | Omit<ReviewVerdict, "localFlavorSignals">) & {
  plannerQuality: PlannerQualitySummary | null;
  plannerTracePath: string | null;
  localFlavorSignals: LocalFlavorSignals | null;
  recordedAt: string;
} & ReviewLineage;

export interface ChapterReviewState {
  projectId: string;
  chapterNo: number;
  status: ChapterReviewStatus;
  quickCheckedAt: string | null;
  deepCheckedAt: string | null;
  openWindowId: string | null;
  lastReviewMode: ReviewMode | null;
  latestConfidence: number;
  earliestAffectedChapter: number | null;
  updatedAt: string;
}
