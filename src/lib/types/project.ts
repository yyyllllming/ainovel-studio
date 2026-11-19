import type {
  ChapterPlanningMode,
  NarrativePerson,
  PaceProfile,
  SeriesMode,
  StoryLength,
} from "@/lib/project-structure";
import type {
  ChapterReviewState,
  ProjectRunLogEntry,
  ProjectRunProgress,
} from "./chapter.ts";
import type {
  FoundationPayload,
  SourceIdeaSummary,
} from "./foundation.ts";
import type { ProjectCardSummary } from "./card.ts";

export interface LlmProfile {
  id: string;
  name: string;
  defaultModel: string;
  baseUrl?: string;
}

export interface ModelAssignment {
  role: string;
  profileId: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  genre: string;
  style: string;
  targetChapters: number;
  premise: string;
  seriesMode: SeriesMode;
  seriesTitle: string | null;
  seriesIndex: number | null;
  storyLength: StoryLength;
  narrativePerson: NarrativePerson;
  chapterPlanningMode: ChapterPlanningMode;
  paceProfile: PaceProfile;
  completionCriteria: string;
  chapterBudgetMin: number;
  chapterBudgetTarget: number;
  chapterBudgetMax: number;
  hardChapterCap: number;
  hasVolumes: boolean;
  plannedVolumes: number | null;
  sourceIdeaId?: string | null;
  status: string;
  updatedAt?: string;
}

export type SteeringNoteScope = "next_arc" | "current_volume" | "persistent";

export interface SteeringNote {
  id: string;
  instruction: string;
  scope: SteeringNoteScope;
  createdAt: string;
  active: boolean;
  applyUntilChapter: number | null;
}

export interface StoryContractVolume {
  volumeNo: number;
  label: string;
  goal: string;
  status: "planned" | "active" | "completed";
  chapterStart: number;
  chapterEnd: number | null;
  chapterBudgetMin: number;
  chapterBudgetTarget: number;
  chapterBudgetMax: number;
  milestones?: Array<{
    id: string;
    label: string;
    goal: string;
    expectedChapterStart: number | null;
    expectedChapterEnd: number | null;
    status: "planned" | "active" | "completed";
    notes: string;
  }>;
}

export interface StoryContractSegmentPlanItem {
  id: string;
  chapterNo: number;
  title: string;
  intent: string;
  narrativeTitle?: string | null;
  narrativeIntent?: string | null;
  rewriteStatus?: "pending" | "ready" | "failed";
}

export interface StoryContractSegmentPlan {
  id: string;
  label: string;
  startChapter: number;
  endChapter: number;
  status: "planned" | "active" | "completed" | "queued";
  items: StoryContractSegmentPlanItem[];
}

export interface StoryContract {
  volumes: StoryContractVolume[];
  currentVolume: number;
  globalArc: string;
  endingPromise: string;
  completionChecks: string[];
  segmentPlans?: StoryContractSegmentPlan[];
  forecast: {
    min: number;
    target: number;
    max: number;
    finalRunReady: boolean;
    completionProgress: number;
    nextMilestone: string;
  };
  recentPlan: string[];
  updatedAt: string;
}

export interface ReviewPolicyConfig {
  cadenceChapters: number;
  deepReviewStartChapter: number;
  perChapterCheckMode: "minimal";
  forceTriggers: string[];
  manualCheckpointChapters: number[];
}

export interface ReviewPolicyDraft {
  cadenceChapters: number;
  deepReviewStartChapter: number;
  manualCheckpointChapters: string;
}

export interface ProjectConflictSummary {
  chapterNo: number;
  severity: string;
  message: string;
}

export interface ProjectInvalidatedHistoryEntry {
  id: string;
  chapterNo: number;
  rangeStartChapter: number;
  rangeEndChapter: number;
  reason: string;
  excerpt: string;
  reviewReason: string | null;
  invalidatedAt: string;
}

export interface ProjectNovelExportState {
  exists: boolean;
  status: "ready" | "failed" | "pending";
  path?: string;
  generatedAt?: string;
  chapterCount?: number;
  error?: string;
}

export interface ProjectRecentReview {
  chapterNo: number;
  submissionId: string | null;
  versionId: string | null;
  contentHash: string | null;
  reviewerProfileId: string | null;
  promptHash: string | null;
  reviewSchemaVersion: string | null;
  windowContentHash: string | null;
  stale: boolean;
  verdict: string;
  confidence: number;
  reason: string;
  createdAt: string;
}

export interface BlueprintRunHealthSummary {
  windowSize: number;
  sampleCount: number;
  repairRate: number;
  fallbackRate: number;
  hardConflictRate: number;
  medianVerificationScore: number | null;
  recommendation: "data_insufficient" | "keep_3" | "observe" | "safe_to_try_2";
}

export interface ProjectDetail {
  project: ProjectSummary;
  storyContract: StoryContract | null;
  steeringNotes: SteeringNote[];
  resolvedReviewPolicy: ReviewPolicyConfig;
  assignments: ModelAssignment[];
  foundation: FoundationPayload | null;
  foundationLocked: boolean;
  coreDrift?: boolean;
  blockingReason?: string | null;
  runState?: {
    stage?: string | null;
    desiredState?: ProjectRunProgress["desiredState"] | null;
    currentChapter?: number | null;
  } | null;
  sourceIdea: SourceIdeaSummary | null;
  blueprints: number[];
  writtenChapters: number[];
  recentReviews: ProjectRecentReview[];
  conflicts: ProjectConflictSummary[];
  reviewStates: ChapterReviewState[];
  invalidatedHistory: ProjectInvalidatedHistoryEntry[];
  runStatisticsSummary: BlueprintRunHealthSummary;
  novelExport: ProjectNovelExportState;
  logs: ProjectRunLogEntry[];
}

export type ProjectProgressSnapshot = ProjectRunProgress;

export interface ProjectSummaryResponse {
  projects: ProjectSummary[];
}

export interface ProjectProfilesResponse {
  profiles: LlmProfile[];
}

export interface ProjectCardsResponse {
  cards: ProjectCardSummary[];
}
