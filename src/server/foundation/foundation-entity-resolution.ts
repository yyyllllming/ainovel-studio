import { validateCharacterName, type CharacterNameRejectReason } from "../../lib/character-name-policy.ts";
import type { CharacterCard, WorldRule } from "../types.ts";
import type {
  FoundationMentionSourceKind,
  RawFoundationCharacterMentionCandidate,
  RawFoundationMentionCandidate,
  RawFoundationWorldMentionCandidate,
} from "./foundation-mention-extraction.ts";
import { trimFoundationMentionClause } from "./foundation-mention-extraction.ts";

type WorldviewRejectReason =
  | "empty"
  | "invalid_name"
  | "ordinal_heading"
  | "meta_heading"
  | "invalid_description";

export interface ResolvedFoundationMentionCandidate extends RawFoundationMentionCandidate {
  canonical: string | null;
  accepted: boolean;
  reason: string | null;
}

const WORLDVIEW_META_NAMES = new Set([
  "世界基调",
  "当前主场景",
  "当前地点",
  "下一步",
  "补充说明",
  "待补充",
]);

const WORLDVIEW_META_NAME_PATTERNS = [
  /^第[一二三四五六七八九十百千万0-9]+(?:[、，,:：]|$)/u,
  /^第[一二三四五六七八九十百千万0-9]+$/u,
  /^(请|继续|补充|完善|展开|你希望|你提到|关于)/u,
];

const WORLDVIEW_META_DESCRIPTION_PATTERNS = [
  /^(请|继续|补充|完善|展开|你希望|你提到|关于)/u,
  /你提到/u,
  /请补充/u,
  /继续补充/u,
  /固定编号/u,
];

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

function scoreCharacter(card: CharacterCard) {
  return [
    card.name,
    card.role,
    card.goal,
    ...(card.traits ?? []),
    ...(card.secrets ?? []),
  ].join("").length;
}

function scoreWorldRule(rule: WorldRule) {
  return `${rule.name}${rule.description}`.length;
}

export function formatCharacterRejectReason(reason: CharacterNameRejectReason | null) {
  switch (reason) {
    case "contains_forbidden_token":
      return "命中称谓/动作/半句黑名单";
    case "invalid_prefix":
      return "称谓剥离后为空";
    case "invalid_characters":
      return "包含名字以外的字符";
    case "invalid_length":
      return "长度不符合实名规则";
    case "invalid_pattern":
      return "不符合实名白名单模式";
    case "empty":
    default:
      return "名称为空";
  }
}

function formatWorldviewRejectReason(reason: WorldviewRejectReason) {
  switch (reason) {
    case "ordinal_heading":
      return "命中序号/提纲式 heading";
    case "meta_heading":
      return "命中指导语/占位 heading";
    case "invalid_description":
      return "描述过短或仍是提问/指令";
    case "invalid_name":
      return "世界观名称不够具体";
    case "empty":
    default:
      return "名称为空";
  }
}

function validateWorldviewCandidate(rawName: string, description: string): {
  accepted: boolean;
  canonical: string | null;
  reason: WorldviewRejectReason | null;
} {
  const name = trimFoundationMentionClause(
    rawName.split(/[（(：:，,]/u)[0] ?? rawName,
  );
  const normalizedDescription = description.replace(/\s+/g, " ").trim();

  if (!name) {
    return { accepted: false, canonical: null, reason: "empty" };
  }
  if (WORLDVIEW_META_NAMES.has(name)) {
    return { accepted: false, canonical: null, reason: "meta_heading" };
  }
  if (WORLDVIEW_META_NAME_PATTERNS.some((pattern) => pattern.test(name))) {
    return { accepted: false, canonical: null, reason: "ordinal_heading" };
  }
  if (name.length < 2 || name.length > 16) {
    return { accepted: false, canonical: null, reason: "invalid_name" };
  }
  if (!normalizedDescription || normalizedDescription.length < 24) {
    return { accepted: false, canonical: null, reason: "invalid_description" };
  }
  if (WORLDVIEW_META_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalizedDescription))) {
    return { accepted: false, canonical: null, reason: "invalid_description" };
  }
  return {
    accepted: true,
    canonical: name,
    reason: null,
  };
}

export function resolveCharacterMentionCandidate(candidate: RawFoundationCharacterMentionCandidate): ResolvedFoundationMentionCandidate {
  const validation = validateCharacterName(candidate.raw);
  return {
    ...candidate,
    canonical: validation.accepted ? validation.canonical : null,
    accepted: validation.accepted,
    reason: validation.accepted ? null : formatCharacterRejectReason(validation.reason),
  };
}

export function resolveWorldMentionCandidate(candidate: RawFoundationWorldMentionCandidate): ResolvedFoundationMentionCandidate {
  const validation = validateWorldviewCandidate(candidate.raw, candidate.descriptionHint);
  return {
    ...candidate,
    canonical: validation.accepted ? validation.canonical : null,
    accepted: validation.accepted,
    reason: validation.reason ? formatWorldviewRejectReason(validation.reason) : null,
  };
}

function toCharacterCard(candidate: RawFoundationCharacterMentionCandidate, canonical: string): CharacterCard {
  return {
    name: canonical,
    role: candidate.roleHint,
    goal: candidate.goalHint,
    traits: candidate.traitsHint,
  } satisfies CharacterCard;
}

function toWorldRule(candidate: RawFoundationWorldMentionCandidate, canonical: string): WorldRule {
  return {
    name: canonical,
    description: candidate.descriptionHint,
  };
}

export function resolveTranscriptCharacters(
  candidates: RawFoundationCharacterMentionCandidate[],
  limit = 4,
) {
  const accepted = new Map<string, CharacterCard>();
  const rejections: ResolvedFoundationMentionCandidate[] = [];

  for (const candidate of candidates) {
    const resolved = resolveCharacterMentionCandidate(candidate);
    if (!resolved.accepted || !resolved.canonical) {
      rejections.push(resolved);
      continue;
    }

    const nextCard = toCharacterCard(candidate, resolved.canonical);
    const current = accepted.get(resolved.canonical);
    if (!current || scoreCharacter(nextCard) > scoreCharacter(current)) {
      accepted.set(resolved.canonical, nextCard);
    }
  }

  const characters = [...accepted.values()]
    .sort((left, right) => {
      const leftScore = left.role === "protagonist" ? 1 : 0;
      const rightScore = right.role === "protagonist" ? 1 : 0;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return 0;
    })
    .slice(0, limit);

  return {
    characters,
    rejections,
  };
}

export function resolveTranscriptWorldRules(
  candidates: RawFoundationWorldMentionCandidate[],
  limit = 6,
) {
  const accepted = new Map<string, WorldRule>();
  const rejections: ResolvedFoundationMentionCandidate[] = [];

  for (const candidate of candidates) {
    const resolved = resolveWorldMentionCandidate(candidate);
    if (!resolved.accepted || !resolved.canonical) {
      rejections.push(resolved);
      continue;
    }
    const nextRule = toWorldRule(candidate, resolved.canonical);
    const current = accepted.get(resolved.canonical);
    if (!current || scoreWorldRule(nextRule) > scoreWorldRule(current)) {
      accepted.set(resolved.canonical, nextRule);
    }
  }

  return {
    worldview: [...accepted.values()].slice(0, limit),
    rejections,
  };
}

export function resolveWorkshopCharacterGovernance(input: {
  authoritativeNames: Iterable<string>;
  mentionCandidates: RawFoundationCharacterMentionCandidate[];
}) {
  const authoritative = new Set(
    [...input.authoritativeNames]
      .map((name) => validateCharacterName(name))
      .filter((validation) => validation.accepted && validation.canonical)
      .map((validation) => validation.canonical as string),
  );
  const suggestions: Array<{
    rawName: string;
    canonicalName: string;
    role: CharacterCard["role"];
    goal: string;
    traits: string[];
    sourceKind: FoundationMentionSourceKind;
    evidenceSnippet: string;
  }> = [];
  const rejections = uniqObjects(
    input.mentionCandidates
      .map(resolveCharacterMentionCandidate)
      .filter((candidate) => !candidate.accepted || !candidate.canonical),
    (candidate) => `${candidate.raw}:${candidate.reason}:${candidate.sourceKind}:${candidate.evidenceSnippet}`,
  );
  const seenSuggestions = new Set<string>();

  for (const mention of input.mentionCandidates) {
    const candidate = resolveCharacterMentionCandidate(mention);
    if (!candidate.accepted || !candidate.canonical) {
      continue;
    }
    if (authoritative.has(candidate.canonical) || seenSuggestions.has(candidate.canonical)) {
      continue;
    }
    seenSuggestions.add(candidate.canonical);
    suggestions.push({
      rawName: candidate.raw,
      canonicalName: candidate.canonical,
      role: mention.roleHint,
      goal: mention.goalHint,
      traits: mention.traitsHint,
      sourceKind: candidate.sourceKind,
      evidenceSnippet: candidate.evidenceSnippet,
    });
  }

  return {
    aiCharacterSuggestions: suggestions,
    recentRejections: rejections.slice(-10).map((candidate) => ({
      rawName: candidate.raw,
      reason: candidate.reason ?? "名称为空",
      sourceKind: candidate.sourceKind,
      evidenceSnippet: candidate.evidenceSnippet,
    })),
    rejectionStats: {
      total: rejections.length,
    },
  };
}
