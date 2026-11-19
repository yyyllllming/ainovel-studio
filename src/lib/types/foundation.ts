export type StyleReferenceKind = "book" | "author";
export type StyleReferenceSource = "network" | "ai_fallback";
export type StyleReferenceRelation = "primary" | "secondary";

export interface CharacterIdea {
  name: string;
  role: string;
  goal: string;
  traits: string[];
}

export interface WorldviewIdea {
  name: string;
  description: string;
}

export interface RelationshipIdea {
  source: string;
  target: string;
  label: string;
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

export interface FoundationDraft {
  premise: string;
  mainline: string;
  storyHook: string;
  desiredTone: string;
  characterIdeas: CharacterIdea[];
  worldviewIdeas: WorldviewIdea[];
  relationshipIdeas: RelationshipIdea[];
  unresolvedQuestions: string[];
  styleReferences: StyleReferenceSelection[];
  styleSamples?: string[];
  styleManualGuidance: string;
  styleAvoidances: string;
  styleSteeringCard: string;
  styleSnapshotId?: string | null;
}

export interface StyleReferenceCandidate {
  id: string;
  kind: StyleReferenceKind;
  label: string;
  author?: string;
  source: StyleReferenceSource;
  hint: string;
  origin?: string;
}

export interface StyleReferenceSelection {
  kind: StyleReferenceKind;
  label: string;
  author?: string;
  source: StyleReferenceSource;
  relation: StyleReferenceRelation;
}

export interface WorkshopSnapshot {
  state: {
    readyToGenerate: boolean;
    updatedAt: string;
    draft: FoundationDraft;
    coreDrift?: boolean;
    blockingReason?: string | null;
  } | null;
  activeSession: WorkshopActiveSession | null;
  canGenerateFoundation: boolean;
  stylePanelUnlocked: boolean;
  readinessHint: string;
  derivedFoundation: FoundationPayload | null;
  derivedFoundationMeta: DerivedFoundationMeta | null;
  messages: WorkshopMessage[];
  aiCharacterSuggestions?: FoundationCharacterSuggestion[];
  rejectionStats?: {
    total: number;
  };
  recentRejections?: FoundationCharacterRejection[];
  structuredSuggestions?: FoundationStructuredSuggestions | null;
}

export interface WorkshopMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
  pending?: boolean;
}

export interface WorkshopActiveSession {
  projectId: string;
  sessionId: string;
  status: "running" | "failed";
  stage: string;
  progress: number;
  statusMessage: string;
  userMessage: string;
  assistantMessage: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceIdeaSummary {
  id: string;
  title: string;
  deletedAt: string | null;
  updatedAt: string;
  draft: {
    premise: string;
    mainline: string;
    storyHook: string;
    desiredTone: string;
    characterIdeas: CharacterIdea[];
    worldviewIdeas: WorldviewIdea[];
    relationshipIdeas: RelationshipIdea[];
    unresolvedQuestions: string[];
  } | null;
}

export interface AuthorCardSummary {
  id: string;
  displayName: string;
  normalizedName?: string;
  archivedAt?: string | null;
  latestVersion: number | null;
  versionCount: number;
  latestConfidence: "low" | "medium" | "high" | null;
  latestCreatedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthorCardVersionDetail {
  id: string;
  authorCardId: string;
  version: number;
  styleCard: string;
  styleDigest: string;
  confidence: "low" | "medium" | "high";
  sourceWorks: Array<{ title: string; author: string }>;
  createdAt: string;
}

export interface AuthorBookCardDetail {
  id: string;
  authorCardId: string;
  title: string;
  authorName?: string;
  styleCard: string;
  styleDigest: string;
  confidence: "low" | "medium" | "high";
  wordCount: number;
  chapterCount: number;
  sourceFileName?: string;
  createdAt: string;
}

export interface AuthorTextImportDetail {
  id: string;
  authorCardId: string;
  title: string;
  authorName?: string;
  originalFileName: string;
  mediaType: string;
  wordCount: number;
  encoding: string;
  confidence: "low" | "medium" | "high";
  chapterCount: number;
  sourceKind: "plain_import" | "book_import";
  bookCardStatus: "idle" | "pending" | "failed" | "completed";
  lastGenerationError?: string | null;
  createdAt: string;
}

export interface AuthorBookImportWarning {
  code: string;
  message: string;
  level: "info" | "warning";
}

export interface AuthorBookImportSamplePlan {
  indexes: number[];
  skippedShort: number[];
  total: number;
}

export interface AuthorBookImportChapterPreview {
  chapterNumber: number;
  title: string;
  summary: string;
  wordCount: number;
}

export interface AuthorBookImportPreview {
  previewId: string;
  title: string;
  authorName: string;
  originalFileName: string;
  encoding: string;
  parseConfidence: "low" | "medium" | "high";
  parserMode: "heading_strict" | "heading_relaxed" | "marker" | "window_fallback";
  chapterCount: number;
  warnings: AuthorBookImportWarning[];
  samplePlan: AuthorBookImportSamplePlan;
  chapters: AuthorBookImportChapterPreview[];
}

export interface AuthorCardDetail {
  card: AuthorCardSummary;
  versions: AuthorCardVersionDetail[];
  bookCards: AuthorBookCardDetail[];
  imports: AuthorTextImportDetail[];
  authorProfile?: {
    profileMode: "single-book inferred" | "multi-book stable";
    authorProfileSummary: string;
    stableTraits: string[];
    bookSpecificTraits: Array<{ title: string; traits: string[] }>;
    coverageReport: {
      bookCount: number;
      withStyleProfileCount: number;
      withFingerprintCount: number;
    };
  } | null;
}

export interface FoundationPayload {
  premise: string;
  mainline?: string;
  storyHook?: string;
  styleCard?: string;
  styleSnapshotId?: string | null;
  styleSnapshotVersion?: number | null;
  styleDigest?: string;
  characters: CharacterIdea[];
  worldview: WorldviewIdea[];
  relationships?: RelationshipIdea[];
}

export interface DerivedFoundationMeta {
  source: "derived_preview";
  staleComparedToPersisted: boolean;
  coreDrift?: boolean;
  blockingReason?: string | null;
  coverage: {
    premiseFilled: boolean;
    mainlineFilled: boolean;
    storyHookFilled: boolean;
    characterCount: number;
    worldviewCount: number;
    relationshipCount: number;
  };
}

export type ConversationMessage = WorkshopMessage;

export interface StreamProgressState {
  stage: string;
  progress: number;
  message: string;
}

export interface StyleStreamProgressState extends StreamProgressState {
  preview: string;
}

export interface WorkshopStreamEvent {
  type: "status" | "assistant_delta" | "final" | "error";
  stage?: string;
  progress?: number;
  message?: string;
  delta?: string;
  replace?: boolean;
  nextFocus?: string;
  error?: string;
}

export interface StyleStreamEvent {
  type: "status" | "style_delta" | "final" | "error";
  stage?: string;
  progress?: number;
  message?: string;
  delta?: string;
  replace?: boolean;
  error?: string;
}
