import "../server-only.ts";

import {
  normalizeProjectStructureInput,
  type ChapterPlanningMode,
  type NarrativePerson,
  type PaceProfile,
  type SeriesMode,
  type StoryLength,
} from "../domain/project-structure.ts";
import { resolveReviewPolicy } from "../run/review-policy.ts";
import type { StyleFingerprint } from "../style-fingerprint.ts";
import { sanitizeProjectPremise } from "../foundation/foundation-summary-sanitizer.ts";
import { buildFallbackStyleProfile, createDefaultStyleProfile, normalizeStyleProfile } from "../style/style-steering.ts";
import { normalizeCardMeta } from "../story/story-lorebook.ts";
import type {
  AuthorCardRecord,
  AuthorBookCardRecord,
  AuthorBookImportPreviewRecord,
  AuthorCardVersionRecord,
  AuthorTextImportRecord,
  ChapterDeltaRecord,
  CardDraft,
  CardMessage,
  CardProgression,
  CardStatus,
  CardType,
  ChapterBlueprint,
  ChapterPlan,
  ChapterReviewState,
  ConflictRecord,
  FoundationPayload,
  FoundationStructuredSuggestions,
  FoundationWorkshopDraft,
  GenreFulfillmentAssessment,
  IdeaRecord,
  IdeaWorkshopMessage,
  IdeaWorkshopStateRecord,
  LoopRiskAssessment,
  PlannerQualitySummary,
  ProjectCard,
  QuickAuditVerdict,
  ReviewMode,
  ReviewPolicy,
  ReviewVerdict,
  RunProgressPayload,
  RunStageDetails,
  SteeringNote,
  StoryProgressionAssessment,
  StoryContract,
  HookSlot,
} from "../types.ts";
import { safeJsonParse } from "../utils.ts";

export type {
  AuthorCardRecord,
  AuthorBookCardRecord,
  AuthorBookImportPreviewRecord,
  AuthorCardVersionRecord,
  IdeaRecord,
  IdeaWorkshopMessage,
  IdeaWorkshopStateRecord,
  AuthorTextImportRecord,
} from "../types.ts";

export interface ProjectRecord {
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
  reviewPolicy: ReviewPolicy;
  hasVolumes: boolean;
  plannedVolumes: number | null;
  sourceIdeaId: string | null;
  storyContract: StoryContract | null;
  steeringNotes: SteeringNote[];
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterVersionRecord {
  id: string;
  projectId: string;
  chapterNo: number;
  versionNo: number;
  temperature: number;
  path: string;
  excerpt: string;
  selected: boolean;
  source: string;
  createdAt: string;
}

export interface ReviewReportRecord {
  id: string;
  projectId: string;
  chapterNo: number;
  submissionId: string | null;
  versionId: string | null;
  contentHash: string | null;
  reviewerProfileId: string | null;
  promptHash: string | null;
  reviewSchemaVersion: string | null;
  windowContentHash: string | null;
  stale: boolean;
  verdict: QuickAuditVerdict["verdict"] | ReviewVerdict["verdict"];
  confidence: number;
  reason: string;
  fixInstructions: string;
  issues: Array<{ type: string; location: string; severity: "minor" | "major"; evidence?: string }>;
  reviewMode: ReviewMode;
  triggerReasons: ReviewVerdict["triggerReasons"];
  styleChecklistHits: QuickAuditVerdict["styleChecklistHits"];
  charterViolations: QuickAuditVerdict["charterViolations"];
  storyProgression: StoryProgressionAssessment;
  genreFulfillment: GenreFulfillmentAssessment | null;
  loopRisk: LoopRiskAssessment;
  plannerQuality: PlannerQualitySummary | null;
  failureCategory?: QuickAuditVerdict["failureCategory"];
  repairStrategy?: QuickAuditVerdict["repairStrategy"];
  primaryDeltaDelivered: ChapterDeltaRecord["primaryDeltaDelivered"];
  stuckDimensions: string[];
  windowStartChapter: number | null;
  windowEndChapter: number | null;
  earliestAffectedChapter: number | null;
  path: string;
  createdAt: string;
}

export type ChapterPlanRecord = ChapterPlan;

export interface FoundationWorkshopStateRecord {
  projectId: string;
  draft: FoundationWorkshopDraft;
  structuredSuggestions?: FoundationStructuredSuggestions | null;
  readyToGenerate: boolean;
  updatedAt: string;
}

function synthesizeLegacyHookSlots(chapterNo: number, nextHook: string): HookSlot[] {
  const setupText = nextHook.trim();
  if (!setupText) {
    return [];
  }

  return [
    {
      setupText,
      payoffWindow: [chapterNo + 1, chapterNo + 3],
      priority: "medium",
      planIntent: "active",
    },
  ];
}

export interface RunStateRecord {
  projectId: string;
  status: RunProgressPayload["stage"];
  stage: RunProgressPayload["stage"];
  desiredState: "idle" | "running" | "paused" | "stopped";
  runSessionId: string | null;
  heartbeatAt: string | null;
  currentChapter: number;
  totalChapters: number;
  retryCount: number;
  confidence: number;
  lastError: string | null;
  draftFile: string | null;
  currentPosition: number;
  wordCount: number;
  stageDetails: RunStageDetails;
  startedAt: string;
  updatedAt: string;
}

export interface ChapterInvalidationRecord {
  id: string;
  projectId: string;
  chapterNo: number;
  rangeStartChapter: number;
  rangeEndChapter: number;
  reason: string;
  archivedPath: string;
  excerpt: string;
  reviewReason: string | null;
  operationKey: string | null;
  invalidatedAt: string;
}

export function toChapterBlueprint(row: Record<string, unknown>): ChapterBlueprint {
  return {
    chapterNo: Number(row.chapter_no),
    sceneGoal: String(row.scene_goal),
    characters: safeJsonParse(String(row.characters_json), []),
    locations: safeJsonParse(String(row.locations_json), []),
    conflicts: safeJsonParse(String(row.conflicts_json), []),
    foreshadows: safeJsonParse(String(row.foreshadows_json), []),
    hookGuidanceMode: String(row.hook_guidance_mode ?? "unguided") as ChapterBlueprint["hookGuidanceMode"],
    hookBindings: safeJsonParse(String(row.hook_bindings_json ?? "[]"), []),
    emotionalTone: String(row.emotional_tone),
    estimatedWords: Number(row.estimated_words),
    segmentId: row.segment_id ? String(row.segment_id) : null,
    segmentItemId: row.segment_item_id ? String(row.segment_item_id) : null,
    requiredProgressDelta: row.required_progress_delta ? String(row.required_progress_delta) as ChapterBlueprint["requiredProgressDelta"] : undefined,
    sourcePlanGenerationId:
      typeof row.source_plan_generation_id === "number"
        ? Number(row.source_plan_generation_id)
        : row.source_plan_generation_id
            ? Number(row.source_plan_generation_id)
            : null,
  };
}

export function toChapterPlan(row: Record<string, unknown>): ChapterPlanRecord {
  const nextHook = String(row.next_hook ?? "");
  const parsedHookSlots = safeJsonParse(String(row.hook_slots_json ?? "[]"), []) as HookSlot[];
  const hookSlots = Array.isArray(parsedHookSlots) && parsedHookSlots.length
    ? parsedHookSlots
    : synthesizeLegacyHookSlots(Number(row.chapter_no), nextHook);

  return {
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    purpose: String(row.purpose ?? ""),
    plotSummary: String(row.plot_summary ?? ""),
    requiredBeats: safeJsonParse(String(row.required_beats_json ?? "[]"), []),
    keyEvents: safeJsonParse(String(row.key_events_json ?? "[]"), []),
    characterFocus: safeJsonParse(String(row.character_focus_json ?? "[]"), []),
    relationshipShift: String(row.relationship_shift ?? ""),
    worldRuleUsage: safeJsonParse(String(row.world_rule_usage_json ?? "[]"), []),
    continuationAnchor: String(row.continuation_anchor ?? ""),
    nextHook,
    hookSlots,
    payoffTargets: safeJsonParse(String(row.payoff_targets_json ?? "[]"), []),
    riskFlags: safeJsonParse(String(row.risk_flags_json ?? "[]"), []),
    riskComment: row.risk_comment ? String(row.risk_comment) : null,
    status: String(row.status ?? "draft") as ChapterPlan["status"],
    source: String(row.source ?? "generated") as ChapterPlan["source"],
    foundationDigest: String(row.foundation_digest ?? ""),
    storyContractDigest: String(row.story_contract_digest ?? ""),
    inputDigest: String(row.input_digest ?? ""),
    generationId: Number(row.generation_id ?? 1),
    generationState: String(row.generation_state ?? "idle") as ChapterPlan["generationState"],
    generationToken: row.generation_token ? String(row.generation_token) : null,
    generationStartedAt: row.generation_started_at ? String(row.generation_started_at) : null,
    usedSegmentSummaryFallback: Boolean(row.used_segment_summary_fallback),
    segmentId: row.segment_id ? String(row.segment_id) : null,
    segmentItemId: row.segment_item_id ? String(row.segment_item_id) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function parseStoryContract(raw: unknown) {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { volumes?: unknown[] }).volumes)) {
    return null;
  }
  return raw as StoryContract;
}

export function parseSteeringNotes(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [] as SteeringNote[];
  }
  return raw
    .filter((entry): entry is SteeringNote =>
      Boolean(entry)
      && typeof entry === "object"
      && typeof (entry as SteeringNote).id === "string"
      && typeof (entry as SteeringNote).instruction === "string"
      && typeof (entry as SteeringNote).scope === "string",
    )
    .map((entry) => ({
      ...entry,
      active: Boolean(entry.active),
      applyUntilChapter:
        typeof entry.applyUntilChapter === "number"
          ? entry.applyUntilChapter
          : null,
    }));
}

export function toProjectRecord(row: Record<string, unknown>): ProjectRecord {
  const storyLength = String(
    row.story_length ??
      (Number(row.target_chapters) <= 1 ? "short" : Number(row.target_chapters) <= 12 ? "medium" : "long"),
  ) as StoryLength;
  const structure = normalizeProjectStructureInput({
    seriesMode: String(row.series_mode ?? "standalone") as SeriesMode,
    seriesTitle: row.series_title ? String(row.series_title) : null,
    seriesIndex: row.series_index ? Number(row.series_index) : null,
    storyLength,
    narrativePerson: row.narrative_person ? String(row.narrative_person) as NarrativePerson : null,
    hasVolumes: Boolean(row.has_volumes),
    plannedVolumes: row.planned_volumes ? Number(row.planned_volumes) : null,
    chapterPlanningMode: row.chapter_planning_mode ? String(row.chapter_planning_mode) as ChapterPlanningMode : null,
    paceProfile: row.pace_profile ? String(row.pace_profile) as PaceProfile : null,
    completionCriteria: row.completion_criteria ? String(row.completion_criteria) : null,
    chapterBudgetMin: row.chapter_budget_min ? Number(row.chapter_budget_min) : null,
    chapterBudgetTarget: row.chapter_budget_target ? Number(row.chapter_budget_target) : null,
    chapterBudgetMax: row.chapter_budget_max ? Number(row.chapter_budget_max) : null,
    hardChapterCap: row.hard_chapter_cap ? Number(row.hard_chapter_cap) : null,
    targetChapters: Number(row.target_chapters),
  });
  const storyContract = parseStoryContract(
    safeJsonParse(String(row.story_contract_json ?? "{}"), null),
  );
  const steeringNotes = parseSteeringNotes(
    safeJsonParse(String(row.steering_notes_json ?? "[]"), []),
  );

  return {
    id: String(row.id),
    title: String(row.title),
    genre: String(row.genre),
    style: String(row.style),
    targetChapters: structure.targetChapters,
    premise: String(row.premise),
    seriesMode: structure.seriesMode,
    seriesTitle: structure.seriesTitle,
    seriesIndex: structure.seriesIndex,
    storyLength: structure.storyLength,
    narrativePerson: structure.narrativePerson,
    chapterPlanningMode: structure.chapterPlanningMode,
    paceProfile: structure.paceProfile,
    completionCriteria: structure.completionCriteria,
    chapterBudgetMin: structure.chapterBudgetMin,
    chapterBudgetTarget: structure.chapterBudgetTarget,
    chapterBudgetMax: structure.chapterBudgetMax,
    hardChapterCap: structure.hardChapterCap,
    reviewPolicy: resolveReviewPolicy(
      storyLength,
      safeJsonParse(String(row.review_policy_json ?? "{}"), {}),
    ),
    hasVolumes: structure.hasVolumes,
    plannedVolumes: structure.plannedVolumes,
    sourceIdeaId: row.source_idea_id ? String(row.source_idea_id) : null,
    storyContract,
    steeringNotes,
    status: String(row.status),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getEmptyIdeaWorkshopDraft(): FoundationWorkshopDraft {
  return {
    premise: "",
    mainline: "",
    storyHook: "",
    desiredTone: "",
    characterIdeas: [],
    worldviewIdeas: [],
    relationshipIdeas: [],
    unresolvedQuestions: [],
    styleReferences: [],
    styleSamples: [],
    styleManualGuidance: "",
    styleAvoidances: "",
    styleSteeringCard: "",
    styleSnapshotId: null,
    styleSnapshotVersion: null,
    styleDigest: "",
    styleExemplars: [],
  };
}

export function toRunStateRecord(row: Record<string, unknown>): RunStateRecord {
  return {
    projectId: String(row.project_id),
    status: row.status as RunProgressPayload["stage"],
    stage: row.stage as RunProgressPayload["stage"],
    desiredState: String(row.desired_state ?? "idle") as RunStateRecord["desiredState"],
    runSessionId: row.run_session_id ? String(row.run_session_id) : null,
    heartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : null,
    currentChapter: Number(row.current_chapter),
    totalChapters: Number(row.total_chapters),
    retryCount: Number(row.retry_count),
    confidence: Number(row.confidence),
    lastError: row.last_error ? String(row.last_error) : null,
    draftFile: row.draft_file ? String(row.draft_file) : null,
    currentPosition: Number(row.current_position),
    wordCount: Number(row.word_count),
    stageDetails: safeJsonParse(String(row.stage_details_json ?? "{}"), {}),
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
  };
}

export function getDefaultWorkshopDraft(
  project: Pick<ProjectRecord, "title" | "genre" | "style" | "premise" | "storyLength">,
): FoundationWorkshopDraft {
  const lengthLabel =
    project.storyLength === "short" ? "短篇故事" : project.storyLength === "medium" ? "中篇故事" : "长篇故事";
  const stableProjectPremise = sanitizeProjectPremise(project.premise);
  return {
    premise: stableProjectPremise || `${project.genre} ${lengthLabel}，等待与作者共创细化。`,
    mainline: "",
    storyHook: "",
    desiredTone: project.style,
    characterIdeas: [],
    worldviewIdeas: [],
    relationshipIdeas: [],
    unresolvedQuestions: [],
    styleReferences: [],
    styleManualGuidance: "",
    styleAvoidances: "",
    styleSteeringCard: "",
    styleProfile: buildFallbackStyleProfile({
      references: [],
      worldContext: stableProjectPremise,
      draft: {
        mainline: "",
        desiredTone: project.style,
        storyHook: "",
      },
    }),
    styleSnapshotId: null,
    styleSnapshotVersion: null,
    styleDigest: "",
    styleExemplars: [],
  };
}

export function toConflictRecord(row: Record<string, unknown>): ConflictRecord & { chapterNo: number } {
  return {
    id: String(row.id),
    type: String(row.conflict_type),
    severity: row.severity as ConflictRecord["severity"],
    message: String(row.message),
    resolution: row.resolution ? (String(row.resolution) as "ignore" | "fix") : undefined,
    note: row.note ? String(row.note) : undefined,
    chapterNo: Number(row.chapter_no),
  };
}

export function toProjectCard(row: Record<string, unknown>): ProjectCard {
  const name = String(row.name);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    cardType: String(row.card_type) as CardType,
    name,
    draft: safeJsonParse(String(row.draft_json), {}) as CardDraft,
    meta: normalizeCardMeta(name, safeJsonParse(String(row.meta_json ?? "{}"), {})),
    status: String(row.status) as CardStatus,
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toCardMessage(row: Record<string, unknown>): CardMessage {
  return {
    id: String(row.id),
    cardId: String(row.card_id),
    projectId: String(row.project_id),
    role: String(row.role) as "user" | "assistant",
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

export function toCardProgression(row: Record<string, unknown>): CardProgression {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    cardId: String(row.card_id),
    chapterNo: Number(row.chapter_no),
    targetPath: String(row.target_path),
    mode: String(row.mode) as CardProgression["mode"],
    content: String(row.content),
    sourceFactIds: safeJsonParse(String(row.source_fact_ids_json ?? "[]"), []),
    status: String(row.status) as CardProgression["status"],
    reviewState: String(row.review_state ?? "provisional") as CardProgression["reviewState"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toChapterReviewState(row: Record<string, unknown>): ChapterReviewState {
  return {
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    status: String(row.status) as ChapterReviewState["status"],
    quickCheckedAt: row.quick_checked_at ? String(row.quick_checked_at) : null,
    deepCheckedAt: row.deep_checked_at ? String(row.deep_checked_at) : null,
    openWindowId: row.open_window_id ? String(row.open_window_id) : null,
    lastReviewMode: row.last_review_mode ? (String(row.last_review_mode) as ReviewMode) : null,
    latestConfidence: Number(row.latest_confidence ?? 0),
    earliestAffectedChapter: row.earliest_affected_chapter ? Number(row.earliest_affected_chapter) : null,
    updatedAt: String(row.updated_at),
  };
}

export function normalizeStoredFoundation(row: Record<string, unknown>): FoundationPayload {
  return {
    premise: String(row.premise_text),
    mainline: String(row.mainline_text ?? ""),
    storyHook: String(row.story_hook_text ?? ""),
    styleCard: String(row.style_card),
    styleProfile: normalizeStyleProfile(
      safeJsonParse(String(row.style_profile_json ?? "{}"), createDefaultStyleProfile()),
    ),
    styleSnapshotId: row.style_snapshot_id ? String(row.style_snapshot_id) : null,
    styleSnapshotVersion: row.style_snapshot_version !== undefined && row.style_snapshot_version !== null
      ? Number(row.style_snapshot_version)
      : null,
    styleDigest: String(row.style_digest ?? ""),
    styleExemplars: safeJsonParse(String(row.style_exemplars_json ?? "[]"), []),
    characters: safeJsonParse(String(row.characters_json), []),
    worldview: safeJsonParse(String(row.worldview_json), []),
    relationships: safeJsonParse(String(row.relationships_json), []),
  };
}

export function toIdeaRecord(row: Record<string, unknown>): IdeaRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toIdeaWorkshopStateRecord(row: Record<string, unknown>): IdeaWorkshopStateRecord {
  const parsedDraft = safeJsonParse(String(row.draft_json), getEmptyIdeaWorkshopDraft()) as FoundationWorkshopDraft;
  return {
    ideaId: String(row.idea_id),
    draft: {
      ...getEmptyIdeaWorkshopDraft(),
      ...parsedDraft,
      styleProfile: normalizeStyleProfile(parsedDraft.styleProfile),
      styleSnapshotId: parsedDraft.styleSnapshotId ?? null,
      styleSnapshotVersion:
        typeof parsedDraft.styleSnapshotVersion === "number" ? parsedDraft.styleSnapshotVersion : null,
      styleDigest: parsedDraft.styleDigest ?? "",
      styleExemplars: Array.isArray(parsedDraft.styleExemplars) ? parsedDraft.styleExemplars : [],
    },
    updatedAt: String(row.updated_at),
  };
}

export function toIdeaWorkshopMessage(row: Record<string, unknown>): IdeaWorkshopMessage {
  return {
    id: String(row.id),
    ideaId: String(row.idea_id),
    role: String(row.role) as IdeaWorkshopMessage["role"],
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

export function toAuthorCardRecord(row: Record<string, unknown>): AuthorCardRecord {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    normalizedName: String(row.normalized_name),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    latestVersion: row.latest_version === null || row.latest_version === undefined ? null : Number(row.latest_version),
    versionCount: Number(row.version_count ?? 0),
    latestConfidence: row.latest_confidence ? String(row.latest_confidence) as AuthorCardRecord["latestConfidence"] : null,
    latestCreatedAt: row.latest_created_at ? String(row.latest_created_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toAuthorCardVersionRecord(row: Record<string, unknown>): AuthorCardVersionRecord {
  return {
    id: String(row.id),
    authorCardId: String(row.author_card_id),
    version: Number(row.version),
    styleCard: String(row.style_card),
    styleProfile: normalizeStyleProfile(safeJsonParse(String(row.style_profile_json ?? "{}"), {})),
    styleDigest: String(row.style_digest ?? ""),
    styleExemplars: safeJsonParse(String(row.style_exemplars_json ?? "[]"), []),
    sampledExcerpts: safeJsonParse(String(row.sampled_excerpts_json ?? "[]"), []),
    confidence: String(row.confidence) as AuthorCardVersionRecord["confidence"],
    sourceWorks: safeJsonParse(String(row.source_works_json ?? "[]"), []),
    createdAt: String(row.created_at),
  };
}

export function toAuthorBookCardRecord(row: Record<string, unknown>): AuthorBookCardRecord {
  const fingerprint = safeJsonParse(String(row.fingerprint_json ?? "{}"), {}) as StyleFingerprint;
  const hasFingerprint = fingerprint && typeof fingerprint === "object" && Object.keys(fingerprint).length > 0;
  return {
    id: String(row.id),
    authorCardId: String(row.author_card_id),
    title: String(row.title),
    authorName: row.author_name ? String(row.author_name) : undefined,
    styleCard: String(row.style_card),
    styleProfile: normalizeStyleProfile(safeJsonParse(String(row.style_profile_json ?? "{}"), {})),
    styleDigest: String(row.style_digest ?? ""),
    styleExemplars: safeJsonParse(String(row.style_exemplars_json ?? "[]"), []),
    sampledExcerpts: safeJsonParse(String(row.sampled_excerpts_json ?? "[]"), []),
    confidence: String(row.confidence) as AuthorBookCardRecord["confidence"],
    fingerprint: hasFingerprint ? fingerprint : null,
    wordCount: Number(row.word_count ?? 0),
    chapterCount: Number(row.chapter_count ?? 0),
    sourceFileName: row.source_file_name ? String(row.source_file_name) : undefined,
    createdAt: String(row.created_at),
  };
}

export function toAuthorBookImportPreviewRecord(row: Record<string, unknown>): AuthorBookImportPreviewRecord {
  const rawParserMode = String(row.parser_mode ?? "heading_relaxed");
  const parserMode = rawParserMode === "heading"
    ? "heading_relaxed"
    : rawParserMode === "fallback"
      ? "window_fallback"
      : rawParserMode;

  return {
    id: String(row.id),
    authorCardId: String(row.author_card_id),
    title: String(row.title),
    authorName: row.author_name ? String(row.author_name) : undefined,
    originalFileName: String(row.original_file_name),
    mediaType: String(row.media_type),
    sourceHash: String(row.source_hash),
    wordCount: Number(row.word_count ?? 0),
    encoding: String(row.encoding),
    parseConfidence: String(row.parse_confidence ?? "medium") as AuthorBookImportPreviewRecord["parseConfidence"],
    parserMode: parserMode as AuthorBookImportPreviewRecord["parserMode"],
    chapterCount: Number(row.chapter_count ?? 0),
    warnings: safeJsonParse(String(row.warnings_json ?? "[]"), []),
    samplePlan: safeJsonParse(
      String(row.sample_plan_json ?? "{\"indexes\":[],\"skippedShort\":[],\"total\":0}"),
      { indexes: [], skippedShort: [], total: 0 },
    ),
    status: String(row.status ?? "active") as AuthorBookImportPreviewRecord["status"],
    applyStatus: String(row.apply_status ?? "pending") as AuthorBookImportPreviewRecord["applyStatus"],
    importId: row.import_id ? String(row.import_id) : null,
    bookCardId: row.book_card_id ? String(row.book_card_id) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    consumedAt: row.consumed_at ? String(row.consumed_at) : null,
  };
}

export function toAuthorTextImportRecord(row: Record<string, unknown>): AuthorTextImportRecord {
  return {
    id: String(row.id),
    authorCardId: String(row.author_card_id),
    title: String(row.title),
    authorName: row.author_name ? String(row.author_name) : undefined,
    originalFileName: String(row.original_file_name),
    mediaType: String(row.media_type),
    sourceHash: String(row.source_hash),
    wordCount: Number(row.word_count),
    encoding: String(row.encoding),
    confidence: String(row.confidence) as AuthorTextImportRecord["confidence"],
    chapterCount: Number(row.chapter_count),
    excerpts: safeJsonParse(String(row.excerpts_json ?? "[]"), []),
    sourceKind: String(row.source_kind ?? "plain_import") as AuthorTextImportRecord["sourceKind"],
    bookCardStatus: String(row.book_card_status ?? "idle") as AuthorTextImportRecord["bookCardStatus"],
    lastGenerationError: row.last_generation_error ? String(row.last_generation_error) : null,
    createdAt: String(row.created_at),
  };
}
