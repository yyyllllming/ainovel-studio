import type {
  CardDraft,
  CardEvidence,
  CardMeta,
  CardProgression,
  ChapterBlueprint,
  LorebookEntry,
  LorebookPack,
  ProjectCard,
  RenderedCardState,
  StoryThreadMemoryEntry,
} from "../types.ts";
import { safeParseJson } from "../utils/safe-json.ts";

const SPLIT_REGEX = /[^\p{L}\p{N}_]+/u;

function uniq<T>(items: T[]) {
  return Array.from(new Set(items));
}

function uniqObjects<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  const next: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }
  return next;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeEvidence(value: unknown): CardEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqObjects(
    value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({
        chapterNo: Number(item.chapterNo ?? 0),
        source: String(item.source ?? "") as CardEvidence["source"],
        reason: String(item.reason ?? "").trim(),
        snippet: String(item.snippet ?? "").trim(),
      }))
      .filter((item) => Number.isFinite(item.chapterNo) && item.chapterNo > 0 && item.source && item.reason && item.snippet),
    (item) => `${item.chapterNo}:${item.source}:${item.reason}:${item.snippet}`,
  );
}

function parseProgressionValue(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return safeParseJson<unknown>(trimmed, trimmed);
  }
  return trimmed;
}

function deepCloneDraft<T extends CardDraft>(draft: T): T {
  return structuredClone(draft);
}

function ensureContainer(target: Record<string, unknown>, path: string[]) {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const current = cursor[segment];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  return cursor;
}

function setByPath(target: Record<string, unknown>, targetPath: string, value: unknown, mode: CardProgression["mode"]) {
  const path = targetPath.split(".").filter(Boolean);
  if (!path.length) {
    return;
  }
  const container = ensureContainer(target, path);
  const leaf = path[path.length - 1]!;
  const current = container[leaf];

  if (mode === "resolve") {
    delete container[leaf];
    return;
  }

  if (mode === "remove") {
    if (Array.isArray(current)) {
      const next = current.filter((entry) => entry !== value);
      if (next.length) {
        container[leaf] = next;
      } else {
        delete container[leaf];
      }
      return;
    }
    delete container[leaf];
    return;
  }

  if (mode === "replace") {
    container[leaf] = value;
    return;
  }

  if (Array.isArray(current)) {
    container[leaf] = uniq([...current.map(String), ...(Array.isArray(value) ? value.map(String) : [String(value)])]);
    return;
  }

  if (current === undefined || current === null || current === "") {
    container[leaf] = value;
    return;
  }

  if (typeof current === "string") {
    container[leaf] = uniq([current, ...(Array.isArray(value) ? value.map(String) : [String(value)])]).join("；");
    return;
  }

  if (typeof current === "object" && current) {
    container[leaf] = {
      ...(current as Record<string, unknown>),
      ...(typeof value === "object" && value ? (value as Record<string, unknown>) : { value }),
    };
    return;
  }

  container[leaf] = value;
}

function renderDraft(card: ProjectCard, draft: CardDraft) {
  const data = draft as unknown as Record<string, unknown>;
  const state = (data.state as Record<string, unknown> | undefined) ?? {};
  const parts = [`名称=${card.name}`];

  if (typeof data.role === "string" && data.role.trim()) {
    parts.push(`身份=${data.role.trim()}`);
  }
  if (typeof data.goal === "string" && data.goal.trim()) {
    parts.push(`目标=${data.goal.trim()}`);
  }
  const traits = safeArray(data.traits);
  if (traits.length) {
    parts.push(`特质=${traits.join("、")}`);
  }
  if (typeof data.description === "string" && data.description.trim()) {
    parts.push(`描述=${data.description.trim()}`);
  }
  if (typeof data.category === "string" && data.category.trim()) {
    parts.push(`类别=${data.category.trim()}`);
  }
  if (typeof data.background === "string" && data.background.trim()) {
    parts.push(`背景=${data.background.trim()}`);
  }
  if (typeof state.location === "string" && state.location.trim()) {
    parts.push(`当前位置=${state.location.trim()}`);
  }
  if (typeof state.emotion === "string" && state.emotion.trim()) {
    parts.push(`情绪=${state.emotion.trim()}`);
  }
  const items = safeArray(state.items);
  if (items.length) {
    parts.push(`持有=${items.join("、")}`);
  }
  if (state.relationships && typeof state.relationships === "object" && !Array.isArray(state.relationships)) {
    const relationships = Object.entries(state.relationships as Record<string, unknown>)
      .map(([name, value]) => `${name}=${String(value)}`)
      .slice(0, 4);
    if (relationships.length) {
      parts.push(`关系=${relationships.join("，")}`);
    }
  }

  const notes = uniq([...safeArray(data.notes), ...safeArray(state.notes)]);
  if (notes.length) {
    parts.push(`备注=${notes.slice(0, 4).join("；")}`);
  }

  const recentEvidence = normalizeEvidence(card.meta.evidence)
    .sort((left, right) => right.chapterNo - left.chapterNo || right.snippet.localeCompare(left.snippet, "zh-CN"))
    .slice(0, 2);
  for (const evidence of recentEvidence) {
    parts.push(`最近事实：第${evidence.chapterNo}章：${evidence.snippet}`);
  }

  return parts.join("；");
}

export function buildDefaultCardMeta(name: string): CardMeta {
  return {
    aliases: uniq([name]).filter(Boolean),
    keywords: [],
    priority: 50,
    pinnedScope: "none",
    linkedCardIds: [],
    enabled: true,
  };
}

export function normalizeCardMeta(name: string, meta?: Partial<CardMeta> | null): CardMeta {
  const fallback = buildDefaultCardMeta(name);
  return {
    aliases: uniq([name, ...(meta?.aliases ?? fallback.aliases)].map((item) => item.trim()).filter(Boolean)),
    keywords: uniq((meta?.keywords ?? fallback.keywords).map((item) => item.trim()).filter(Boolean)),
    priority: Number.isFinite(meta?.priority) ? Math.max(0, Math.trunc(meta?.priority ?? fallback.priority)) : fallback.priority,
    pinnedScope: meta?.pinnedScope ?? fallback.pinnedScope,
    linkedCardIds: uniq((meta?.linkedCardIds ?? fallback.linkedCardIds).map((item) => item.trim()).filter(Boolean)),
    enabled: meta?.enabled ?? fallback.enabled,
    origin: meta?.origin,
    importance: meta?.importance,
    discoveryStage: meta?.discoveryStage,
    evidence: normalizeEvidence(meta?.evidence),
  };
}

export function renderCardState(card: ProjectCard, progressions: CardProgression[]): RenderedCardState {
  const draft = deepCloneDraft(card.draft);
  const appliedProgressionIds: string[] = [];
  const activeProgressions = [...progressions]
    .filter((progression) => progression.status === "active")
    .sort((left, right) => left.chapterNo - right.chapterNo || left.createdAt.localeCompare(right.createdAt));

  for (const progression of activeProgressions) {
    setByPath(
      draft as unknown as Record<string, unknown>,
      progression.targetPath,
      parseProgressionValue(progression.content),
      progression.mode,
    );
    appliedProgressionIds.push(progression.id);
  }

  return {
    cardId: card.id,
    cardType: card.cardType,
    name: card.name,
    content: renderDraft(card, draft),
    score: 0,
    pinned: card.meta.pinnedScope !== "none",
    matchedBy: [],
    appliedProgressionIds,
  };
}

function collectNeedles(input: {
  blueprint: ChapterBlueprint;
  previousChapterExcerpt?: string | null;
  summaryTexts?: string[];
  activeThreads?: StoryThreadMemoryEntry[];
}) {
  return uniq(
    [
      input.blueprint.sceneGoal,
      ...input.blueprint.characters,
      ...input.blueprint.locations,
      ...input.blueprint.conflicts,
      ...input.blueprint.foreshadows,
      input.previousChapterExcerpt ?? "",
      ...(input.summaryTexts ?? []),
      ...(input.activeThreads ?? []).map((thread) => thread.content),
    ]
      .flatMap((entry) => entry.split(SPLIT_REGEX))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 2),
  );
}

function getMatchData(card: ProjectCard, needles: string[]) {
  const aliases = uniq([card.name, ...card.meta.aliases]).map(normalizeText);
  const keywords = card.meta.keywords.map(normalizeText);
  const matchedBy = uniq(
    needles.filter((needle) => {
      const normalizedNeedle = normalizeText(needle);
      return aliases.some((alias) => normalizedNeedle.includes(alias) || alias.includes(normalizedNeedle)) ||
        keywords.some((keyword) => normalizedNeedle.includes(keyword) || keyword.includes(normalizedNeedle));
    }),
  );

  const aliasMatches = matchedBy.filter((entry) =>
    aliases.some((alias) => normalizeText(entry).includes(alias) || alias.includes(normalizeText(entry))),
  ).length;
  const keywordMatches = matchedBy.length - aliasMatches;
  const pinned = card.meta.pinnedScope === "global" || card.meta.pinnedScope === "chapter";
  const score = (pinned ? 100 : 0) + card.meta.priority + aliasMatches * 24 + keywordMatches * 12;

  return {
    matchedBy,
    score,
    pinned,
  };
}

export function hasMajorProgressionChange(progressions: CardProgression[]) {
  const keyPathPattern = /^state\.(location|emotion|items|relationships)/u;
  return progressions.some(
    (progression) =>
      progression.status === "active" &&
      (progression.mode === "replace" || progression.mode === "resolve" || keyPathPattern.test(progression.targetPath)),
  );
}

export function buildLorebookPack(input: {
  blueprint: ChapterBlueprint;
  cards: ProjectCard[];
  progressions: CardProgression[];
  previousChapterExcerpt?: string | null;
  summaryTexts?: string[];
  activeThreads?: StoryThreadMemoryEntry[];
}): LorebookPack {
  const needles = collectNeedles(input);
  const cardById = new Map(input.cards.filter((card) => card.status === "confirmed" && card.meta.enabled).map((card) => [card.id, card]));
  const included = new Map<string, { score: number; matchedBy: string[]; pinned: boolean }>();

  for (const card of cardById.values()) {
    const match = getMatchData(card, needles);
    if (match.pinned || match.matchedBy.length) {
      included.set(card.id, match);
    }
  }

  for (const [cardId, data] of [...included.entries()]) {
    const card = cardById.get(cardId);
    if (!card) {
      continue;
    }
    for (const linkedId of card.meta.linkedCardIds) {
      if (!cardById.has(linkedId) || included.has(linkedId)) {
        continue;
      }
      included.set(linkedId, {
        score: Math.max(1, data.score - 15),
        matchedBy: [...data.matchedBy, `linked:${card.name}`],
        pinned: false,
      });
    }
  }

  const renderedCards = [...included.entries()]
    .map(([cardId, match]) => {
      const card = cardById.get(cardId)!;
      const rendered = renderCardState(
        card,
        input.progressions.filter((progression) => progression.cardId === card.id),
      );
      rendered.score = match.score;
      rendered.matchedBy = match.matchedBy;
      rendered.pinned = match.pinned;
      return rendered;
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name, "zh-CN"));

  const entries: LorebookEntry[] = renderedCards.map((card) => ({
    title: card.name,
    source: card.appliedProgressionIds.length ? "progression" : "card",
    content: card.content,
    score: card.score,
    pinned: card.pinned,
    cardId: card.cardId,
    matchedBy: card.matchedBy,
  }));

  return {
    entries,
    renderedCards,
    debug: {
      matchedCardIds: renderedCards.map((card) => card.cardId),
      triggeredBy: needles.slice(0, 24),
      progressionCount: input.progressions.length,
    },
  };
}
