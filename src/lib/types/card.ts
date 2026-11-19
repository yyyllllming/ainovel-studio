export interface CardDraft {
  [key: string]: unknown;
}

export type CardType = "character" | "world";
export type CardStatus = "draft" | "confirmed";
export type CardPinnedScope = "none" | "global" | "chapter";
export type CardImportance = "important" | "super_key";
export type CardOrigin = "manual" | "foundation" | "auto_blueprint" | "auto_recurring";
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

export interface ProjectCardSummary {
  id: string;
  cardType: CardType;
  name: string;
  status: CardStatus;
}

export interface CardProgression {
  id: string;
  chapterNo: number;
  targetPath: string;
  mode: "add" | "replace" | "remove" | "resolve";
  content: string;
  reviewState: "provisional" | "confirmed";
  status: "active" | "resolved" | "superseded";
  createdAt: string;
}

export interface CardMessage {
  id: string;
  cardId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export type CardTab = CardType;

export interface CardEditorState {
  name: string;
  role: string;
  goal: string;
  traits: string;
  secrets: string;
  background: string;
  notes: string;
  description: string;
  category: string;
  aliases: string;
  keywords: string;
  priority: string;
  pinnedScope: CardPinnedScope;
  linkedCardIds: string;
  enabled: boolean;
}
