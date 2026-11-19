import type {
  CardDraft,
  CardEditorState,
  CardMeta,
  CardTab,
  ProjectCard,
} from "@/lib/types";

export const emptyCardEditorState: CardEditorState = {
  name: "",
  role: "",
  goal: "",
  traits: "",
  secrets: "",
  background: "",
  notes: "",
  description: "",
  category: "",
  aliases: "",
  keywords: "",
  priority: "50",
  pinnedScope: "none",
  linkedCardIds: "",
  enabled: true,
};

export function normalizeText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function normalizeList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function serializeList(value: unknown) {
  return normalizeList(value).join("\n");
}

export function parseList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function autoMetaLabel(meta: CardMeta) {
  return {
    origin:
      meta.origin === "auto_recurring"
        ? "连续章节候选"
        : meta.origin === "auto_blueprint"
          ? "旧自动发现"
        : meta.origin === "foundation"
          ? "正式设定"
          : meta.origin === "manual"
            ? "手动创建"
            : "",
    importance:
      meta.importance === "super_key"
        ? "超关键"
        : meta.importance === "important"
          ? "普通重要"
          : "",
    stage:
      meta.discoveryStage === "recurring_candidate"
        ? "连续章节候选"
        : meta.discoveryStage === "auto_confirmed"
        ? "已自动确认"
        : meta.discoveryStage === "repeated_blueprint"
          ? "跨章重复提及"
          : meta.discoveryStage === "first_seen"
            ? "首次发现"
            : "",
  };
}

export function toCardEditorState(card: ProjectCard): CardEditorState {
  const draft = card.draft as Record<string, unknown>;
  return {
    name: normalizeText(draft.name) || card.name,
    role: normalizeText(draft.role),
    goal: normalizeText(draft.goal),
    traits: serializeList(draft.traits),
    secrets: serializeList(draft.secrets),
    background: normalizeText(draft.background),
    notes: normalizeText(draft.notes),
    description: normalizeText(draft.description),
    category: normalizeText(draft.category),
    aliases: serializeList(card.meta.aliases),
    keywords: serializeList(card.meta.keywords),
    priority: String(card.meta.priority ?? 50),
    pinnedScope: card.meta.pinnedScope ?? "none",
    linkedCardIds: serializeList(card.meta.linkedCardIds),
    enabled: card.meta.enabled ?? true,
  };
}

export function buildCardDraft(cardType: CardTab, editor: CardEditorState): CardDraft {
  if (cardType === "character") {
    const characterDraft: CardDraft = {
      name: editor.name.trim(),
      role: editor.role.trim(),
      goal: editor.goal.trim(),
      traits: parseList(editor.traits),
    };

    const secrets = parseList(editor.secrets);
    if (secrets.length) {
      characterDraft.secrets = secrets;
    }
    if (editor.background.trim()) {
      characterDraft.background = editor.background.trim();
    }
    if (editor.notes.trim()) {
      characterDraft.notes = editor.notes.trim();
    }
    return characterDraft;
  }

  const worldDraft: CardDraft = {
    name: editor.name.trim(),
    description: editor.description.trim(),
  };
  if (editor.category.trim()) {
    worldDraft.category = editor.category.trim();
  }
  if (editor.notes.trim()) {
    worldDraft.notes = editor.notes.trim();
  }
  return worldDraft;
}
