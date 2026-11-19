import type { ChapterPlanningMode } from "../domain/project-structure.ts";
import type {
  ChapterReviewStatus,
  QuickAuditVerdict,
  ReviewMode,
  ReviewTriggerReason,
  ReviewVerdict,
} from "./review.ts";
import type { ConflictRecord, StoryContinuationDecisionType } from "./story.ts";

export interface RunStageDetails {
  blueprint?: { generated: boolean; conflictCount: number };
  context?: { totalTokens: number; conflicts: ConflictRecord[] };
  writing?: {
    draftFile: string;
    currentPosition: number;
    wordCount: number;
  };
  stylePass?: {
    applied: boolean;
    paragraphPasses: number;
    removedLexicon: string[];
    proseSeverity?: "ok" | "warn" | "fail";
    proseScore?: number;
    proseNotes?: string[];
  };
  planningRepair?: {
    applied: boolean;
    strategy: "planning_repair" | "voice_polish" | "scene_rescue";
    regeneratedChapterPlan?: boolean;
    regeneratedBlueprint?: boolean;
    completed?: boolean;
    nextAction?: "rewrite_with_fresh_blueprint" | "manual_review";
    chapterPlanGenerationId?: number;
    blueprintSourcePlanGenerationId?: number;
  };
  review?: {
    mode: ReviewMode;
    verdict: QuickAuditVerdict["verdict"] | ReviewVerdict["verdict"];
    confidence: number;
    retryCount: number;
    triggerReasons?: ReviewTriggerReason[];
    windowStartChapter?: number;
    windowEndChapter?: number;
    earliestAffectedChapter?: number | null;
  };
  analysis?: {
    factsExtracted: number;
    summaryGenerated: boolean;
    progressionsExtracted?: number;
    reviewStatus?: ChapterReviewStatus;
  };
  continuation?: {
    decision: StoryContinuationDecisionType;
    summary: string;
    nextPlan: string[];
    currentVolume: number;
    completionProgress: number;
  };
  lifecycle?: {
    lastActiveStage?: "blueprint" | "context" | "writing" | "style_pass" | "planning_repair" | "review" | "analysis";
  };
}

export interface RunProgressPayload {
  running: boolean;
  stage:
    | "idle"
    | "blueprint"
    | "context"
    | "writing"
    | "style_pass"
    | "planning_repair"
    | "review"
    | "analysis"
    | "completed"
    | "manual_review"
    | "paused"
    | "interrupted"
    | "failed";
  currentChapter: number;
  totalChapters: number;
  retryCount: number;
  confidence: number;
  draftFile?: string;
  currentPosition?: number;
  wordCount?: number;
  stageDetails: RunStageDetails;
  planningMode?: ChapterPlanningMode;
  currentVolume?: number;
  hardChapterCap?: number;
  forecastRange?: {
    min: number;
    target: number;
    max: number;
  };
  completionProgress?: number;
  nextPlan?: string[];
  error?: string;
  desiredState?: "idle" | "running" | "paused" | "stopped";
  heartbeatAt?: string | null;
  heartbeatAgeMs?: number | null;
  staleHeartbeat?: boolean;
  recoverable?: boolean;
  lastActiveStage?: "blueprint" | "context" | "writing" | "style_pass" | "planning_repair" | "review" | "analysis" | null;
  logs: Array<{ level: string; message: string; createdAt: string }>;
}
