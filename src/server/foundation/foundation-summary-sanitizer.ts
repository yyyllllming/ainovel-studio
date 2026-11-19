import { validateCharacterName } from "../../lib/character-name-policy.ts";
import type { FoundationPayload, FoundationWorkshopDraft, WorldRule } from "../types.ts";
import { trimFoundationMentionClause } from "./foundation-mention-extraction.ts";

const SUMMARY_ARTIFACT_PATTERNS = [
  /[父母兄姐弟妹叔伯婶姨姑舅]的[\p{sc=Han}]{1,6}/u,
  /[父母兄姐弟妹叔伯婶姨姑舅][严禁警捡分告收抱带说看听用拿给走跑哭笑来去扑缩蹲站盯望猎杀缠][\p{sc=Han}]{0,4}/u,
  /卷入第[一二三四五六七八九十百千万0-9]+/u,
  /触犯第[一二三四五六七八九十百千万0-9]+/u,
  /在第[一二三四五六七八九十百千万0-9]+中求生/u,
] as const;

function normalizeText(input: string | null | undefined) {
  return input?.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() ?? "";
}

function scoreCharacter(entry: FoundationWorkshopDraft["characterIdeas"][number]) {
  return [
    entry.name,
    entry.role,
    entry.goal,
    ...(entry.traits ?? []),
  ].join("").length;
}

function scoreWorldview(entry: WorldRule) {
  return `${entry.name}${entry.description}`.length;
}

const WORLDVIEW_META_NAME_PATTERNS = [
  /^第[一二三四五六七八九十百千万0-9]+(?:[、，,:：]|$)/u,
  /^第[一二三四五六七八九十百千万0-9]+$/u,
  /^(请|继续|补充|完善|展开|你希望|你提到|关于)/u,
] as const;

const WORLDVIEW_META_DESCRIPTION_PATTERNS = [
  /^(请|继续|补充|完善|展开|你希望|你提到|关于)/u,
  /你提到/u,
  /请补充/u,
  /继续补充/u,
  /固定编号/u,
] as const;

export function shouldDiscardPollutedSummary(input: string | null | undefined) {
  const text = normalizeText(input);
  if (!text) {
    return false;
  }
  return SUMMARY_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text));
}

export function isPlaceholderWorldRuleValue(rule: Pick<WorldRule, "name" | "description"> | null | undefined) {
  const name = trimFoundationMentionClause(rule?.name);
  const description = normalizeText(rule?.description);
  if (!name) {
    return true;
  }
  if (name === "世界基调") {
    return true;
  }
  if (/类型故事.*保持 .*风格/u.test(description)) {
    return true;
  }
  if (WORLDVIEW_META_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return true;
  }
  if (!description) {
    return true;
  }
  return WORLDVIEW_META_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description));
}

function sanitizeCharacterIdeas(characterIdeas: FoundationWorkshopDraft["characterIdeas"]): FoundationWorkshopDraft["characterIdeas"] {
  const merged = new Map<string, FoundationWorkshopDraft["characterIdeas"][number]>();

  for (const entry of characterIdeas) {
    const validation = validateCharacterName(entry.name);
    if (!validation.accepted || !validation.canonical) {
      continue;
    }
    const normalized = {
      ...entry,
      name: validation.canonical,
    };
    const current = merged.get(validation.canonical);
    if (!current || scoreCharacter(normalized) > scoreCharacter(current)) {
      merged.set(validation.canonical, normalized);
    }
  }

  return [...merged.values()];
}

function sanitizeWorldviewIdeas(worldviewIdeas: WorldRule[]): WorldRule[] {
  const merged = new Map<string, WorldRule>();

  for (const entry of worldviewIdeas) {
    if (isPlaceholderWorldRuleValue(entry)) {
      continue;
    }
    const key = trimFoundationMentionClause(entry.name);
    if (!key) {
      continue;
    }
    const normalized = {
      ...entry,
      name: key,
      description: normalizeText(entry.description),
    };
    const current = merged.get(key);
    if (!current || scoreWorldview(normalized) > scoreWorldview(current)) {
      merged.set(key, normalized);
    }
  }

  return [...merged.values()];
}

export function sanitizeFoundationWorkshopDraft(
  draft: FoundationWorkshopDraft | null | undefined,
): FoundationWorkshopDraft | undefined {
  if (!draft) {
    return undefined;
  }

  const sanitized: FoundationWorkshopDraft = {
    premise: shouldDiscardPollutedSummary(draft.premise) ? "" : draft.premise,
    mainline: shouldDiscardPollutedSummary(draft.mainline) ? "" : draft.mainline,
    storyHook: shouldDiscardPollutedSummary(draft.storyHook) ? "" : draft.storyHook,
    desiredTone: draft.desiredTone,
    characterIdeas: sanitizeCharacterIdeas(draft.characterIdeas ?? []),
    worldviewIdeas: sanitizeWorldviewIdeas(draft.worldviewIdeas ?? []),
    relationshipIdeas: draft.relationshipIdeas ?? [],
    unresolvedQuestions: draft.unresolvedQuestions ?? [],
    styleReferences: draft.styleReferences ?? [],
    styleSamples: draft.styleSamples ?? [],
    styleManualGuidance: draft.styleManualGuidance ?? "",
    styleAvoidances: draft.styleAvoidances ?? "",
    styleSteeringCard: draft.styleSteeringCard ?? "",
    styleProfile: draft.styleProfile,
    styleSnapshotId: draft.styleSnapshotId ?? null,
    styleSnapshotVersion: draft.styleSnapshotVersion ?? null,
    styleDigest: draft.styleDigest ?? "",
    styleExemplars: draft.styleExemplars ?? [],
  };
  return sanitized;
}

export function sanitizeFoundationPayload(
  foundation: FoundationPayload | null | undefined,
): FoundationPayload | null {
  if (!foundation) {
    return null;
  }

  const sanitizedCharacters = sanitizeCharacterIdeas(foundation.characters);
  const sanitizedWorldview = sanitizeWorldviewIdeas(foundation.worldview);

  const sanitized: FoundationPayload = {
    ...foundation,
    premise: shouldDiscardPollutedSummary(foundation.premise) ? "" : foundation.premise,
    mainline: shouldDiscardPollutedSummary(foundation.mainline) ? "" : (foundation.mainline ?? ""),
    storyHook: shouldDiscardPollutedSummary(foundation.storyHook) ? "" : (foundation.storyHook ?? ""),
    characters: sanitizedCharacters,
    worldview: sanitizedWorldview,
  };
  return sanitized;
}

export function sanitizeProjectPremise(input: string | null | undefined) {
  return shouldDiscardPollutedSummary(input) ? "" : (input ?? "");
}
