import type { CharacterCard, RelationshipEdge, WorldRule } from "./core.ts";
import type { CanonFact, LorebookPack, StoryMemory } from "./memory.ts";
import type {
  StyleExcerpt,
  StyleProfile,
  StyleReferenceSelection,
  WritingDnaProfile,
} from "./style.ts";
import type { ObligationCard, ProjectVoiceSnapshot } from "../content/types.ts";

export const ACTION_PATTERNS = [
  "combat", "pursuit", "stealth", "travel",
  "investigation", "negotiation", "survival",
  "recovery", "discovery",
] as const;
export type ActionPattern = (typeof ACTION_PATTERNS)[number];

export const ENDING_MOVES = [
  "new_risk", "new_discovery", "position_shift",
  "relation_shift", "emotional_close", "explicit_summary",
] as const;
export type EndingMove = (typeof ENDING_MOVES)[number];

export const MECHANISM_REVEAL_MODES = [
  "effect_first", "recognition_line",
  "explicit_summary", "triad",
] as const;
export type MechanismRevealMode = (typeof MECHANISM_REVEAL_MODES)[number];

export type StoryContinuationDecisionType =
  | "continue_chaptering"
  | "end_volume"
  | "enter_final_run"
  | "complete_story";
export type SteeringNoteScope = "next_arc" | "current_volume" | "persistent";
export type StoryVolumeStatus = "planned" | "active" | "completed";
export type MilestoneStatus = "planned" | "active" | "completed";
export type ProgressAssessmentRisk = "pass" | "watch" | "risk";

export const CORE_PROGRESS_DELTA_TYPES = [
  "situation_shift",
  "objective_shift",
  "information_shift",
  "relationship_shift",
  "power_shift",
  "world_shift",
  "cost_shift",
] as const;

export type CoreProgressDeltaType = (typeof CORE_PROGRESS_DELTA_TYPES)[number];

export const GENRE_OBLIGATION_PACK_IDS = [
  "core-only",
  "mythic_beastiary",
  "romance",
] as const;

export type GenreObligationPackId = (typeof GENRE_OBLIGATION_PACK_IDS)[number];

export interface SteeringNote {
  id: string;
  instruction: string;
  scope: SteeringNoteScope;
  createdAt: string;
  active: boolean;
  applyUntilChapter: number | null;
}

export interface Milestone {
  id: string;
  label: string;
  goal: string;
  expectedChapterStart: number | null;
  expectedChapterEnd: number | null;
  status: MilestoneStatus;
  notes: string;
}

export interface StoryContractVolume {
  volumeNo: number;
  label: string;
  goal: string;
  status: StoryVolumeStatus;
  chapterStart: number;
  chapterEnd: number | null;
  chapterBudgetMin: number;
  chapterBudgetTarget: number;
  chapterBudgetMax: number;
  milestones?: Milestone[];
}

export interface StoryForecast {
  min: number;
  target: number;
  max: number;
  finalRunReady: boolean;
  completionProgress: number;
  nextMilestone: string;
}

export interface StoryPromise {
  id: string;
  label: string;
  type: "mainline" | "relationship" | "world" | "ending";
  description: string;
}

export interface GenreObligationPackActivation {
  id: GenreObligationPackId;
  source: "auto" | "manual";
  active: boolean;
  notes: string[];
}

export interface StoryArenaCluster {
  id: string;
  label: string;
  summary: string;
  hints: string[];
}

export interface StoryOpponentCluster {
  id: string;
  label: string;
  summary: string;
  hints: string[];
}

export interface StoryRewardType {
  id: string;
  label: string;
  description: string;
}

export interface StoryRelationshipProgression {
  id: string;
  relationshipKey: string;
  label: string;
  description: string;
}

export interface StoryBadPattern {
  id: string;
  kind: "motif" | "scene" | "ending" | "reward";
  label: string;
  examples: string[];
}

export interface StoryPatchMappings {
  arenaHints: Record<string, string>;
  antagonists: Record<string, string>;
  rewardSignals: Record<string, string>;
}

export interface ProjectStorySeedPatch {
  arenaClusters: StoryArenaCluster[];
  opponentClusters: StoryOpponentCluster[];
  rewardTypes: StoryRewardType[];
  relationshipProgressions: StoryRelationshipProgression[];
  badPatterns: StoryBadPattern[];
  explicitMappings?: StoryPatchMappings;
}

export interface SegmentPlanItem {
  id: string;
  chapterNo: number;
  title: string;
  intent: string;
  narrativeTitle?: string | null;
  narrativeIntent?: string | null;
  narrativeSummary?: string | null;
  arcConnection?: string | null;
  nextHook?: string | null;
  rewriteStatus?: "pending" | "ready" | "failed";
  userOverridden?: boolean;
  requiredProgressDeltas: CoreProgressDeltaType[];
  requiredObligations: string[];
  focusCharacters: string[];
  arenaHints: string[];
  suggestedActionPattern: ActionPattern | null;
  antagonistHint: string | null;
  forbiddenRecentAxes: string[];
  arenaClusterId?: string | null;
  opponentClusterId?: string | null;
  rewardType?: string | null;
  relationshipBeatId?: string | null;
}

export interface SegmentPlan {
  id: string;
  label: string;
  startChapter: number;
  endChapter: number;
  status: "active" | "queued" | "completed";
  trigger: "seed" | "refresh";
  generatedAt: string;
  items: SegmentPlanItem[];
}

export interface StoryProgressState {
  latestChapter: number;
  recentPrimaryDeltas: CoreProgressDeltaType[];
  recentArenaKeys: string[];
  recentObjectiveKeys: string[];
  stuckDimensions: string[];
  mustAdvance: CoreProgressDeltaType[];
  recentAntagonistKeys: string[];
  recentActionPatterns: ActionPattern[];
  recentEndingMoves: EndingMove[];
  recentMechanismRevealModes: MechanismRevealMode[];
  recentMotifWindows: string[][];
  consumedFutureBeats?: string[];
  updatedAt: string;
}

export interface StoryContract {
  volumes: StoryContractVolume[];
  currentVolume: number;
  globalArc: string;
  endingPromise: string;
  completionChecks: string[];
  storyPromises: StoryPromise[];
  activeProgressionAxes: CoreProgressDeltaType[];
  genreObligationPacks: GenreObligationPackActivation[];
  arenaClusters?: StoryArenaCluster[];
  opponentClusters?: StoryOpponentCluster[];
  rewardTypes?: StoryRewardType[];
  relationshipProgressions?: StoryRelationshipProgression[];
  segmentPlans: SegmentPlan[];
  progressState: StoryProgressState;
  forecast: StoryForecast;
  recentPlan: string[];
  updatedAt: string;
}

export type ChapterPlanRiskFlag =
  | "scene_loop"
  | "hook_debt"
  | "relationship_drop"
  | "progression_stall"
  | "payoff_miss"
  | "continuation_blur"
  | "world_rule_weak"
  | "focus_scatter";

export type ChapterPlanStatus = "draft" | "ready" | "stale" | "failed";
export type ChapterPlanSource = "generated" | "lazy_backfill" | "degraded_backfill" | "manual_seed";
export type ChapterPlanGenerationState = "idle" | "generating" | "ready" | "failed" | "stale";
export type HookSlotPlanIntent = "active" | "deferred" | "cancelled";

export interface HookSlot {
  setupText: string;
  payoffWindow: [number, number];
  priority: "high" | "medium" | "low";
  planIntent: HookSlotPlanIntent;
  deferredUntilChapter?: number | null;
}

export interface ChapterPlan {
  projectId: string;
  chapterNo: number;
  purpose: string;
  plotSummary: string;
  requiredBeats: string[];
  keyEvents: string[];
  characterFocus: string[];
  relationshipShift: string;
  worldRuleUsage: string[];
  continuationAnchor: string;
  nextHook: string;
  hookSlots: HookSlot[];
  payoffTargets: string[];
  riskFlags: ChapterPlanRiskFlag[];
  riskComment?: string | null;
  status: ChapterPlanStatus;
  source: ChapterPlanSource;
  foundationDigest: string;
  storyContractDigest: string;
  inputDigest: string;
  generationId: number;
  generationState: ChapterPlanGenerationState;
  generationToken?: string | null;
  generationStartedAt?: string | null;
  usedSegmentSummaryFallback: boolean;
  segmentId?: string | null;
  segmentItemId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryContinuationDecision {
  chapterNo: number;
  decision: StoryContinuationDecisionType;
  summary: string;
  nextPlan: string[];
}

export interface FoundationWorkshopDraft {
  premise: string;
  mainline: string;
  storyHook: string;
  desiredTone: string;
  characterIdeas: CharacterCard[];
  worldviewIdeas: WorldRule[];
  relationshipIdeas: RelationshipEdge[];
  unresolvedQuestions: string[];
  styleReferences?: StyleReferenceSelection[];
  styleSamples?: string[];
  styleManualGuidance?: string;
  styleAvoidances?: string;
  styleSteeringCard?: string;
  styleProfile?: StyleProfile;
  styleSnapshotId?: string | null;
  styleSnapshotVersion?: number | null;
  styleDigest?: string;
  styleExemplars?: StyleExcerpt[];
}

export interface FoundationCharacterSuggestion {
  rawName: string;
  canonicalName: string;
  role: string;
  goal: string;
  traits: string[];
  sourceKind?: "message" | "draft" | "project_premise";
  evidenceSnippet?: string;
}

export interface FoundationCharacterRejection {
  rawName: string;
  reason: string;
  sourceKind?: "message" | "draft" | "project_premise";
  evidenceSnippet?: string;
}

export interface SyncMeta {
  version: number;
  revisionId: string;
  revision: number;
  latestIntentDigest: string;
  coreFactsHash: string;
  conflictLog: Array<{
    field: string;
    oldValue: unknown;
    newIntent: unknown;
    resolution: "overridden" | "removed" | "retained";
    resolvedAt: string;
  }>;
  lockedFields: string[];
  lastAppliedAt: string;
  lastAppliedChangeSet?: FoundationChangeSet | null;
  syncStatus: FoundationSyncResult;
}

export interface FoundationCoreEnvelope {
  draft: FoundationWorkshopDraft;
  syncMeta: SyncMeta;
  aiCharacterSuggestions?: FoundationCharacterSuggestion[];
  recentRejections?: FoundationCharacterRejection[];
}

export interface FoundationStructuredSuggestionCharacter {
  id: string;
  canonicalName: string;
  role: string;
  goal: string;
  traits: string[];
  rationale?: string;
}

export interface FoundationStructuredSuggestionWorldRule {
  id: string;
  name: string;
  description: string;
  rationale?: string;
}

export interface FoundationStructuredSuggestions {
  coreFactsHash: string;
  generatedAt: string;
  status: "fresh" | "stale" | "empty";
  characters: FoundationStructuredSuggestionCharacter[];
  worldRules: FoundationStructuredSuggestionWorldRule[];
  dismissedIds: string[];
}

export interface FoundationChangeSet {
  coreOverwrite?: {
    premise?: string;
    mainline?: string;
    storyHook?: string;
    desiredTone?: string;
  };
  worldviewUpserts?: WorldRule[];
  worldviewDeprecations?: string[];
  characterGoalOverrides?: Array<{
    name: string;
    goal: string;
  }>;
  notesOnly?: boolean;
}

export interface FoundationSyncResult {
  status: "applied" | "skipped" | "failed";
  mode: "delta" | "deterministic";
  reason?: string | null;
  coreFactsHashBefore?: string;
  coreFactsHashAfter?: string;
}

export interface FoundationDriftReport {
  coreDrift: boolean;
  blockingReason: string | null;
  workshopCoreFactsHash: string;
  formalCoreFactsHash: string;
  differences: string[];
}

export interface FoundationDeltaV1 {
  schemaVersion: "foundation-delta.v1";
  latestIntent: string;
  summaryPatch: {
    premise?: string;
    mainline?: string;
    storyHook?: string;
    desiredTone?: string;
  };
  characterOps: Array<{
    op: "upsert" | "remove" | "retain";
    name: string;
    aliases?: string[];
    payload?: CharacterCard;
  }>;
  worldviewOps: Array<{
    op: "upsert" | "remove" | "retain";
    name: string;
    aliases?: string[];
    payload?: WorldRule;
  }>;
  relationshipOps: Array<{
    op: "upsert" | "remove" | "retain";
    key: string;
    payload?: RelationshipEdge;
  }>;
  questionOps: Array<{
    op: "upsert" | "remove" | "retain";
    value: string;
  }>;
  conflictsWithPrevious: string[];
  lockedFields: string[];
  readyToGenerate: boolean;
  nextFocus: string;
}

export interface FoundationPayload {
  premise: string;
  mainline?: string;
  storyHook?: string;
  styleCard: string;
  styleProfile?: StyleProfile;
  styleSnapshotId?: string | null;
  styleSnapshotVersion?: number | null;
  styleDigest?: string;
  styleExemplars?: StyleExcerpt[];
  characters: CharacterCard[];
  worldview: WorldRule[];
  relationships: RelationshipEdge[];
}

export interface NovelExportRecord {
  exists: boolean;
  status: "ready" | "failed" | "pending";
  path?: string;
  generatedAt?: string;
  chapterCount?: number;
  error?: string;
}

export type NovelPreviewFormat = "txt" | "md";

export interface NovelPreviewSection {
  chapterNo: number;
  heading: string;
  paragraphs: string[];
}

export interface NovelPreviewPayload {
  title: string;
  format: NovelPreviewFormat;
  generatedAt: string;
  chapterCount: number;
  chapterNos: number[];
  missingChapterNos: number[];
  suggestedFileName: string;
  content: string;
  sections: NovelPreviewSection[];
}

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
  segmentId?: string | null;
  segmentItemId?: string | null;
  requiredProgressDelta?: CoreProgressDeltaType;
  actionPattern?: ActionPattern;
  antagonistHint?: string;
  arenaClusterId?: string | null;
  opponentClusterId?: string | null;
  rewardType?: string | null;
  relationshipBeatId?: string | null;
  sourcePlanGenerationId?: number | null;
}

export type HookPlanPriority = "high" | "medium" | "low";
export type HookPlanLifecycleStatus = "planned" | "planted" | "resolved" | "deferred" | "cancelled";

export interface HookPlan {
  id: string;
  projectId: string;
  chapterNo: number;
  slotIndex: number;
  sourcePlanGenerationId: number;
  setupText: string;
  payoffWindowStartChapter: number;
  payoffWindowEndChapter: number;
  priority: HookPlanPriority;
  lifecycleStatus: HookPlanLifecycleStatus;
  deferredUntilChapter?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintVerification {
  pass: boolean;
  score: number;
  reasons: string[];
  futureHookCompleteness: number;
  loopRiskScore: number;
  obligationScore: number;
}

export interface DiversityRequirements {
  bannedConflictTypes: string[];
  bannedSceneGoalTerms: string[];
  bannedLocations: string[];
  avoidPatterns: string[];
  requiredFocusCharacter: string | null;
  promptLines: string[];
}

export interface BlueprintCandidateAttempt {
  attemptNo: number;
  promptSummary: string;
  rawContent: string;
  candidate: ChapterBlueprint | null;
  verification: BlueprintVerification | null;
  diversityRequirements: DiversityRequirements | null;
}

export interface PlannerQualitySummary {
  candidateAttempts: number;
  selectedScore: number | null;
  selectedReason: string;
  repairUsed: boolean;
  fallbackUsed: boolean;
  usedRecoveryBlueprint?: boolean;
  failureReasons: string[];
}

export interface PlannerTraceArtifact {
  chapterNo: number;
  plannerContextSummary: string;
  futureContext: string;
  promptSummaries: string[];
  candidateAttempts: BlueprintCandidateAttempt[];
  selectedCandidateIndex: number | null;
  selectedReason: string;
  selectedScore: number | null;
  repairUsed: boolean;
  repairRawContent: string | null;
  repairCandidate: ChapterBlueprint | null;
  repairVerification: BlueprintVerification | null;
  repairError: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  usedRecoveryBlueprint?: boolean;
  recoveryShifts?: string[];
  finalBlueprint: ChapterBlueprint | null;
  plannerQuality: PlannerQualitySummary | null;
  recordedAt: string;
}

export interface StoryProgressionAssessment {
  risk: ProgressAssessmentRisk;
  score: number;
  summary: string;
  advancements: string[];
  stallSignals: string[];
  primaryDelta: CoreProgressDeltaType | null;
  deliveredDeltas: CoreProgressDeltaType[];
}

export interface GenreFulfillmentAssessment {
  risk: ProgressAssessmentRisk;
  score: number;
  summary: string;
  present: string[];
  missing: string[];
  activePacks: GenreObligationPackId[];
}

export interface LoopRiskAssessment {
  risk: ProgressAssessmentRisk;
  score: number;
  summary: string;
  repetitionAxes: string[];
  stuckDimensions: string[];
}

export interface ChapterDeltaRecord {
  id: string;
  projectId: string;
  chapterNo: number;
  segmentId: string | null;
  segmentItemId: string | null;
  primaryDeltaDelivered: CoreProgressDeltaType | null;
  deliveredDeltas: CoreProgressDeltaType[];
  storyProgression: StoryProgressionAssessment;
  genreFulfillment: GenreFulfillmentAssessment | null;
  loopRisk: LoopRiskAssessment;
  stuckDimensions: string[];
  arenaKey: string | null;
  arenaClusterId?: string | null;
  objectiveKey: string | null;
  antagonistKey: string | null;
  opponentClusterId?: string | null;
  rewardType?: string | null;
  actionPattern: ActionPattern | null;
  endingMove: EndingMove | null;
  mechanismRevealMode: MechanismRevealMode | null;
  motifTokens: string[];
  obligationHits: string[];
  summary: string;
  createdAt: string;
}

export interface ContextBudgetBreakdown {
  systemRules: number;
  styleCard: number;
  characterCards: number;
  dynamicFacts: number;
  historySummaries: number;
  currentDraft: number;
  outputReserve: number;
}

export interface ContextUsage {
  budgetTokens: number;
  estimatedInputTokens: number;
  serializedChars: number;
  sectionUsage: Record<string, { estimatedTokens: number; serializedChars: number }>;
}

export interface ConflictRecord {
  id: string;
  type: string;
  severity: "hard" | "soft";
  message: string;
  resolution?: "ignore" | "fix";
  note?: string;
}

export interface RunStatisticRecord {
  id: string;
  projectId: string;
  chapterNo: number;
  stage: "segment_rewrite" | "chapter_plan" | "blueprint" | "planning_repair" | "canon" | "conflict";
  metrics: Record<string, unknown>;
  createdAt: string;
}

export interface StructuredAvoidanceList {
  avoidArenaKeys: string[];
  avoidArenaClusters: string[];
  avoidObjectiveKeys: string[];
  avoidAntagonistKeys: string[];
  avoidOpponentClusters: string[];
  avoidRewardTypes: string[];
  avoidActionPatterns: ActionPattern[];
  avoidEndingMoves: EndingMove[];
  avoidMechanismModes: MechanismRevealMode[];
  avoidMotifTokens: string[];
  humanReadable: string[];
}

export interface PlannerAvoidanceDirectives {
  hardAvoid: string[];
  softAvoid: string[];
  promptLines: string[];
}

export interface ContextPack {
  totalTokens: number;
  breakdown: ContextBudgetBreakdown;
  usage?: ContextUsage;
  blueprint: ChapterBlueprint;
  chapterPlan?: ChapterPlan | null;
  recentChapterPlans?: string[];
  previousContinuationAnchor?: string | null;
  styleCard: string;
  styleProfile: StyleProfile;
  writingDna: WritingDnaProfile;
  projectPremise: string;
  previousChapterTail: string | null;
  storyContractSummary: string;
  currentVolumeGoal: string;
  completionProgress: string;
  activeSteeringNotes: string[];
  requiredCards: CharacterCard[];
  worldviewCards: WorldRule[];
  summaryWindow: {
    recentFullChapters: string[];
    detailedSummaries: string[];
    briefSummaries: string[];
  };
  memory: StoryMemory;
  lorebook: LorebookPack;
  facts: CanonFact[];
  conflicts: ConflictRecord[];
  writerNotes: string[];
  currentMilestoneLine?: string | null;
  currentSegmentIntentLine?: string | null;
  nextHookLine?: string | null;
  plannerContextSummary: string;
  futureContext: string;
  structuredAvoidance?: StructuredAvoidanceList;
  obligationCards?: ObligationCard[];
  projectVoiceSnapshot?: ProjectVoiceSnapshot | null;
}
