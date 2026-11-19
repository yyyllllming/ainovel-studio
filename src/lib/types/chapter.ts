import type { ChapterPlanningMode } from "@/lib/project-structure";

export type OptimizeAction =
  | "polish"
  | "expand"
  | "rewrite"
  | "enhance_emotion"
  | "add_dialogue"
  | "change_pov";

export interface ChapterBlueprint {
  chapterNo: number;
  sceneGoal: string;
  characters: string[];
  locations: string[];
  conflicts: string[];
  foreshadows: string[];
  hookGuidanceMode?: "guided" | "unguided";
  hookBindings?: Array<{
    hookPlanId: string;
    foreshadowText: string;
  }>;
  emotionalTone: string;
  estimatedWords: number;
}

export interface ChapterVersion {
  id: string;
  versionNo: number;
  temperature: number;
  excerpt: string;
  selected: boolean;
}

export interface ReviewReport {
  id: string;
  submissionId: string | null;
  versionId: string | null;
  contentHash: string | null;
  reviewerProfileId: string | null;
  promptHash: string | null;
  reviewSchemaVersion: string | null;
  windowContentHash: string | null;
  stale: boolean;
  reviewMode?: "quick" | "deep";
  verdict: string;
  confidence: number;
  reason: string;
  fixInstructions: string;
  createdAt: string;
  issues?: Array<{
    type: string;
    location: string;
    severity: "minor" | "major";
    evidence?: string;
  }>;
}

export interface ChapterReviewState {
  chapterNo: number;
  status: "provisional" | "deep_locked" | "manual_review";
  latestConfidence: number;
}

export interface ChapterInvalidatedHistoryEntry {
  id: string;
  chapterNo: number;
  rangeStartChapter: number;
  rangeEndChapter: number;
  reason: string;
  excerpt: string;
  reviewReason: string | null;
  invalidatedAt: string;
}

export type ChapterRunStage =
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

export interface ChapterRunState {
  running: boolean;
  stage: ChapterRunStage;
  currentChapter: number;
  currentPosition: number;
  wordCount: number;
  isCurrentChapter: boolean;
  isStreaming: boolean;
}

export interface ChapterManualReviewState {
  awaiting: boolean;
  reason: string | null;
  canApprove: boolean;
  canAutoPick: boolean;
  isLastChapter: boolean;
  earliestAffectedChapter: number | null;
  requiresWindowRestart: boolean;
}

export interface ChapterPayload {
  chapterNo: number;
  content: string | null;
  liveDraft: {
    content: string;
    completed: boolean;
  } | null;
  blueprint: ChapterBlueprint | null;
  versions: ChapterVersion[];
  reviews: ReviewReport[];
  reviewState?: {
    status: "provisional" | "deep_locked" | "manual_review";
    latestConfidence: number;
  } | null;
  invalidatedHistory: ChapterInvalidatedHistoryEntry[];
  run: ChapterRunState;
  manualReview: ChapterManualReviewState;
}

export interface ProjectRunLogEntry {
  level: string;
  message: string;
  createdAt: string;
}

export interface ProjectRunProgress {
  running: boolean;
  stage: string;
  currentChapter: number;
  totalChapters: number;
  retryCount: number;
  confidence: number;
  wordCount?: number;
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
  logs: ProjectRunLogEntry[];
}
