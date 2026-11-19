import type { CardType } from "./cards.ts";

export interface PatchOperation {
  type: "replace" | "insert" | "delete";
  range?: {
    start: number;
    end: number;
  };
  text?: string;
}

export interface EditorPatch {
  operations: PatchOperation[];
  summary: string;
}

export type CanonFactType =
  | "character_state"
  | "location_change"
  | "item_acquired"
  | "plot_event"
  | "foreshadow"
  | "world_rule"
  | "relationship"
  | "timeline_marker";

export interface CanonFact {
  id: string;
  type: CanonFactType;
  chapterNo: number;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: string;
  keywords: string[];
}

export interface CharacterSnapshot {
  chapterNo: number;
  characters: Record<
    string,
    {
      location?: string;
      emotion?: string;
      relationships?: Record<string, string>;
      items?: string[];
      notes?: string[];
      currentGoal?: string;
      currentPressure?: string;
      hiddenIntent?: string;
      injuries?: string[];
      evidence?: Array<{
        field: string;
        quote: string;
      }>;
    }
  >;
}

export interface RelationshipDelta {
  source: string;
  target: string;
  change: string;
  chapterNo: number;
}

export interface CausalPromise {
  description: string;
  plantedChapter: number;
  status: "open" | "resolved" | "abandoned";
}

export type HookSetupState = "bound" | "matched" | "missing";
export type HookPayoffState = "none" | "candidate" | "resolved";
export type HookEvidenceKind =
  | "binding"
  | "foreshadow_fact"
  | "foreshadow_ledger"
  | "canon_fact"
  | "resolved_ledger";

export interface HookDiagnosticItem {
  hookPlanId: string;
  setupChapter: number;
  setupText: string;
  priority: "high" | "medium" | "low";
  payoffWindowStartChapter: number;
  payoffWindowEndChapter: number;
  setupState: HookSetupState;
  setupEvidenceChapter: number | null;
  setupEvidenceText: string | null;
  setupEvidenceKind: HookEvidenceKind | null;
  payoffState: HookPayoffState;
  payoffEvidenceChapter: number | null;
  payoffEvidenceText: string | null;
  payoffEvidenceKind: HookEvidenceKind | null;
  duplicateOfHookPlanId: string | null;
  duplicateEvidenceText: string | null;
  overdue: boolean;
  dead: boolean;
}

export interface HookDiagnosticsSnapshot {
  chapterNo: number;
  plannedCount: number;
  boundCount: number;
  missingSetupCount: number;
  duplicateCount: number;
  overdueCount: number;
  deadCount: number;
  items: HookDiagnosticItem[];
}

export interface LogicStateSnapshot {
  chapterNo: number;
  relationshipDeltas: RelationshipDelta[];
  timeMarker: string;
  unresolvedPromises: CausalPromise[];
  pendingConsequences: string[];
  hookDiagnostics?: HookDiagnosticsSnapshot | null;
}

export interface CharacterStateMemoryEntry {
  name: string;
  source: "snapshot" | "foundation";
  lastUpdatedChapter: number | null;
  stale: boolean;
  summary: string;
}

export interface StoryThreadMemoryEntry {
  id: string;
  content: string;
  openedChapter: number;
  lastUpdatedChapter: number;
  age: number;
  status: "active" | "resolved" | "dormant";
  priority: "critical" | "high" | "normal";
  score: number;
}

export interface StoryMemory {
  characterStates: CharacterStateMemoryEntry[];
  activeThreads: StoryThreadMemoryEntry[];
  sceneSteeringNotes: string[];
  relationshipDeltas: RelationshipDelta[];
  timeMarker: string;
  unresolvedPromises: CausalPromise[];
  pendingConsequences: string[];
  hookDiagnostics: HookDiagnosticsSnapshot | null;
}

export interface RenderedCardState {
  cardId: string;
  cardType: CardType;
  name: string;
  content: string;
  score: number;
  pinned: boolean;
  matchedBy: string[];
  appliedProgressionIds: string[];
}

export interface LorebookEntry {
  title: string;
  source: "card" | "progression" | "memory";
  content: string;
  score: number;
  pinned: boolean;
  cardId?: string;
  matchedBy: string[];
}

export interface LorebookPack {
  entries: LorebookEntry[];
  renderedCards: RenderedCardState[];
  debug: {
    matchedCardIds: string[];
    triggeredBy: string[];
    progressionCount: number;
  };
}
