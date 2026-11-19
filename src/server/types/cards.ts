export type CardType = "character" | "world";
export type CardStatus = "draft" | "confirmed";
export type CardPinnedScope = "none" | "global" | "chapter";
export type CardOrigin = "manual" | "foundation" | "auto_blueprint" | "auto_recurring";
export type CardImportance = "important" | "super_key";
export type CardDiscoveryStage = "first_seen" | "repeated_blueprint" | "auto_confirmed" | "recurring_candidate";
export type CardEvidenceSource =
  | "blueprint.characters"
  | "blueprint.sceneGoal"
  | "blueprint.conflicts"
  | "blueprint.foreshadows"
  | "chapter.facts"
  | "chapter.snapshot"
  | "chapter.facts.character_state"
  | "chapter.facts.relationship"
  | "chapter.summary.full";
export type CardProgressionMode = "add" | "replace" | "remove" | "resolve";
export type CardProgressionStatus = "active" | "resolved" | "superseded";
export type ProgressionReviewState = "provisional" | "confirmed";

export interface CardEvidence {
  chapterNo: number;
  source: CardEvidenceSource;
  reason: string;
  snippet: string;
}

export interface CardMeta {
  aliases: string[];
  keywords: string[];
  priority: number;
  pinnedScope: CardPinnedScope;
  linkedCardIds: string[];
  enabled: boolean;
  origin?: CardOrigin;
  importance?: CardImportance;
  discoveryStage?: CardDiscoveryStage;
  evidence?: CardEvidence[];
}

export interface CharacterCardDraft {
  name: string;
  role: string;
  goal: string;
  traits: string[];
  secrets?: string[];
  background?: string;
  notes?: string;
  state?: Record<string, unknown>;
}

export interface WorldCardDraft {
  name: string;
  description: string;
  category?: string;
  notes?: string;
  state?: Record<string, unknown>;
}

export type CardDraft = CharacterCardDraft | WorldCardDraft;

export interface ProjectCard {
  id: string;
  projectId: string;
  cardType: CardType;
  name: string;
  draft: CardDraft;
  meta: CardMeta;
  status: CardStatus;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CardProgression {
  id: string;
  projectId: string;
  cardId: string;
  chapterNo: number;
  targetPath: string;
  mode: CardProgressionMode;
  content: string;
  sourceFactIds: string[];
  status: CardProgressionStatus;
  reviewState: ProgressionReviewState;
  createdAt: string;
  updatedAt: string;
}

export interface CardMessage {
  id: string;
  cardId: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface FoundationWorkshopMessage {
  id: string;
  projectId: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
}

export type FoundationWorkshopSessionStatus = "running" | "failed";

export interface FoundationWorkshopSession {
  projectId: string;
  sessionId: string;
  status: FoundationWorkshopSessionStatus;
  stage: string;
  progress: number;
  statusMessage: string;
  userMessage: string;
  assistantMessage: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
