import type {
  ActiveStylePackage,
  CharacterCard,
  FoundationPayload,
  FoundationWorkshopDraft,
  ProjectCard,
  WorldRule,
} from "../types.ts";
import { validateCharacterName } from "../../lib/character-name-policy.ts";
import {
  resolveTranscriptCharacters,
  resolveTranscriptWorldRules,
} from "./foundation-entity-resolution.ts";
import {
  extractCharacterMentionCandidates,
  extractWorldMentionCandidates,
} from "./foundation-mention-extraction.ts";
import {
  sanitizeFoundationPayload,
  sanitizeFoundationWorkshopDraft,
  isPlaceholderWorldRuleValue,
  sanitizeProjectPremise,
  shouldDiscardPollutedSummary,
} from "./foundation-summary-sanitizer.ts";

const PLACEHOLDER_CHARACTER_NAMES = new Set([
  "主角",
  "男主",
  "女主",
  "反派",
  "配角",
  "protagonist",
  "boss",
]);

const TRIVIAL_USER_MESSAGES = new Set([
  "继续",
  "继续完善",
  "继续补充",
  "展开",
  "展开说说",
  "嗯",
  "好的",
]);

const META_DIRECTIVE_PATTERNS = [
  /^(别|不要|先|再|继续|完善|拓展)/u,
  /你(应该|可以|必须|得)/u,
  /(参考山海经|风格|章节|描写|宝物|兵器|炼丹|练器)/u,
];

export interface DerivedFoundationMeta {
  source: "derived_preview";
  staleComparedToPersisted: boolean;
  coverage: {
    premiseFilled: boolean;
    mainlineFilled: boolean;
    storyHookFilled: boolean;
    characterCount: number;
    worldviewCount: number;
    relationshipCount: number;
  };
}

function normalizeText(input: string | null | undefined) {
  return input?.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() ?? "";
}

function trimClause(input: string | null | undefined) {
  return normalizeText(input).replace(/[。！？!?,，；;]+$/u, "").trim();
}

function trimSentence(input: string | null | undefined) {
  const text = normalizeText(input);
  if (!text) {
    return "";
  }
  return /[。！？!?]$/u.test(text) ? text : `${text}。`;
}

function isMetaDirectiveMessage(input: string | null | undefined) {
  const text = normalizeText(input);
  return META_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function isConcreteCharacterName(name: string | null | undefined) {
  const trimmed = trimClause(name);
  if (!trimmed) {
    return false;
  }
  if (PLACEHOLDER_CHARACTER_NAMES.has(trimmed.toLowerCase())) {
    return false;
  }
  return validateCharacterName(trimmed).accepted;
}

function isPlaceholderWorldRule(rule: WorldRule | null | undefined) {
  return isPlaceholderWorldRuleValue(rule);
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

function pickRicherCharacter(current: CharacterCard | undefined, next: CharacterCard) {
  if (!current) {
    return next;
  }
  return scoreCharacter(next) > scoreCharacter(current) ? next : current;
}

function pickRicherWorldRule(current: WorldRule | undefined, next: WorldRule) {
  if (!current) {
    return next;
  }
  return scoreWorldRule(next) > scoreWorldRule(current) ? next : current;
}

function mergeCharacters(...groups: CharacterCard[][]) {
  const merged = new Map<string, CharacterCard>();

  for (const group of groups) {
    for (const entry of group) {
      if (!isConcreteCharacterName(entry.name)) {
        continue;
      }
      const key = trimClause(entry.name);
      merged.set(key, pickRicherCharacter(merged.get(key), entry));
    }
  }

  return Array.from(merged.values());
}

function mergeWorldRules(...groups: WorldRule[][]) {
  const merged = new Map<string, WorldRule>();

  for (const group of groups) {
    for (const entry of group) {
      if (isPlaceholderWorldRule(entry)) {
        continue;
      }
      const key = trimClause(entry.name);
      if (!key) {
        continue;
      }
      merged.set(key, pickRicherWorldRule(merged.get(key), entry));
    }
  }

  return Array.from(merged.values());
}

function listSubstantiveUserMessages(messages: Array<{ role: "user" | "assistant"; content: string }>) {
  return [...messages]
    .reverse()
    .filter((message) => message.role === "user")
    .map((message) => normalizeText(message.content))
    .filter((content) => content.length >= 8 && !TRIVIAL_USER_MESSAGES.has(content) && !isMetaDirectiveMessage(content));
}

function buildNarrativeAnchors(input: {
  character: CharacterCard | null;
  worldview: WorldRule | null;
}) {
  const anchors = new Set<string>();

  if (input.character && isConcreteCharacterName(input.character.name)) {
    anchors.add(trimClause(input.character.name));
  }

  if (input.worldview) {
    const worldviewName = trimClause(input.worldview.name);
    if (worldviewName) {
      anchors.add(worldviewName);
      const simplifiedWorldviewName = worldviewName.replace(/(体系|规则|秩序|制度|法则)$/u, "").trim();
      if (simplifiedWorldviewName.length >= 2) {
        anchors.add(simplifiedWorldviewName);
      }
    }
  }

  return Array.from(anchors).filter((anchor) => anchor.length >= 2);
}

function buildRecentEntityAnchors(messages: Array<{ role: "user" | "assistant"; content: string }>) {
  const anchors = new Set<string>();
  const recentMessages = [...messages].reverse().slice(0, 6);

  for (const message of recentMessages) {
    const content = normalizeText(message.content);
    const explicitTerms = content.match(/[“"《]?([\p{sc=Han}A-Za-z]{2,12}(?:体系|山神|万灵|白泽|骨书|灵债|地纹|剥纹))/gu) ?? [];
    for (const term of explicitTerms) {
      const normalized = trimClause(term.replace(/^[“"《]|[”"》]$/gu, ""));
      if (normalized.length >= 2) {
        anchors.add(normalized);
      }
    }
  }

  for (const worldview of buildTranscriptWorldviewFallback(messages, 3)) {
    const worldviewName = trimClause(worldview.name);
    if (!worldviewName) {
      continue;
    }
    anchors.add(worldviewName);
    const simplified = worldviewName.replace(/(体系|规则|秩序|制度|法则)$/u, "").trim();
    if (simplified.length >= 2) {
      anchors.add(simplified);
    }
  }

  return Array.from(anchors);
}

function hasCorrectiveIntent(messages: string[]) {
  return messages.slice(0, 4).some((message) => /(不是|不再|别.*第一章|改成|方向是|方向改成|核心还是|核心应是|主线改成)/u.test(message));
}

function shouldPreferRecomposedSummary(input: {
  existing: string;
  recomposed: string;
  userMessages: string[];
  recentEntityAnchors: string[];
}) {
  const existing = trimClause(input.existing);
  const recomposed = trimClause(input.recomposed);
  if (!existing) {
    return true;
  }
  if (!recomposed || existing === recomposed) {
    return false;
  }
  if (shouldDiscardPollutedSummary(existing)) {
    return true;
  }
  if (!hasCorrectiveIntent(input.userMessages)) {
    return false;
  }

  const recomposedHitsRecentAnchor = input.recentEntityAnchors.some((anchor) => recomposed.includes(anchor));
  const existingHitsRecentAnchor = input.recentEntityAnchors.some((anchor) => existing.includes(anchor));
  if (recomposedHitsRecentAnchor && !existingHitsRecentAnchor) {
    return true;
  }

  if (/(被捡到|异兽夫妇|小兽)/u.test(existing) && /(骨纹|剥纹|骨书|灵债|白泽)/u.test(recomposed)) {
    return true;
  }

  return /山神体系/u.test(existing) && /(山海经万灵|骨书|灵债|剥纹|白泽)/u.test(recomposed);
}

function findLatestMessage(
  messages: string[],
  pattern: RegExp,
  input: {
    primaryAnchors?: string[];
    recentEntityAnchors?: string[];
  } = {},
) {
  const matched = messages.filter((message) => pattern.test(message));
  const latestMatched = matched[0] ?? "";
  if (!input.primaryAnchors?.length && !input.recentEntityAnchors?.length) {
    return latestMatched;
  }

  if (latestMatched && input.recentEntityAnchors?.some((anchor) => latestMatched.includes(anchor))) {
    return latestMatched;
  }

  const primaryMatch = matched.find((message) => input.primaryAnchors?.some((anchor) => message.includes(anchor)));
  if (primaryMatch) {
    return primaryMatch;
  }

  const recentEntityMatch = matched.find((message) =>
    input.recentEntityAnchors?.some((anchor) => message.includes(anchor))
  );
  if (recentEntityMatch) {
    return recentEntityMatch;
  }

  return input.recentEntityAnchors?.length ? latestMatched : "";
}

function firstConcreteCharacter(draft: FoundationWorkshopDraft | null | undefined) {
  return draft?.characterIdeas.find((entry) => isConcreteCharacterName(entry.name)) ?? null;
}

function firstConcreteWorldRule(draft: FoundationWorkshopDraft | null | undefined) {
  return draft?.worldviewIdeas.find((entry) => !isPlaceholderWorldRule(entry)) ?? null;
}

function composePremise(input: {
  projectPremise: string;
  character: CharacterCard | null;
  worldview: WorldRule | null;
  mainline: string;
  storyHook: string;
}) {
  const clauses = [
    trimClause(input.projectPremise),
    input.character ? `主角${input.character.name}` : "",
    input.worldview ? `卷入${trimClause(input.worldview.name)}` : "",
    trimClause(input.mainline),
    !trimClause(input.mainline) ? trimClause(input.storyHook) : "",
  ].filter(Boolean);

  return trimSentence(clauses.join("，"));
}

function shouldUpgradeSeedPremise(input: {
  existingPremise: string | null | undefined;
  projectPremise: string;
  composedPremise: string;
  character: CharacterCard | null;
  worldview: WorldRule | null;
  mainline: string;
  storyHook: string;
}) {
  const existingPremise = trimClause(input.existingPremise);
  if (!existingPremise) {
    return true;
  }

  if (existingPremise !== trimClause(input.projectPremise)) {
    return false;
  }

  const composedPremise = trimClause(input.composedPremise);
  if (!composedPremise || composedPremise === existingPremise) {
    return false;
  }

  return Boolean(
    input.character
    || input.worldview
    || trimClause(input.mainline)
    || trimClause(input.storyHook),
  );
}

function composeMainline(input: {
  character: CharacterCard | null;
  worldview: WorldRule | null;
  userMessages: string[];
  storyHook: string;
  primaryAnchors: string[];
  recentEntityAnchors: string[];
}) {
  const explicit = findLatestMessage(
    input.userMessages,
    /(为了|必须|要去|要在|寻找|追查|盗取|潜入|逃离|复仇|阻止|求生|猎|守护|方向是|方向改成|主线改成|核心还是|还债|问白泽)/u,
    {
      primaryAnchors: input.primaryAnchors,
      recentEntityAnchors: input.recentEntityAnchors,
    },
  );
  if (explicit) {
    return trimSentence(explicit);
  }

  if (input.character?.goal) {
    const pieces = [
      input.character.name,
      trimClause(input.character.goal),
      input.worldview ? `并在${trimClause(input.worldview.name)}中求生` : "",
    ].filter(Boolean);
    return trimSentence(pieces.join("，"));
  }

  if (input.storyHook) {
    return trimSentence(input.storyHook);
  }

  if (input.worldview) {
    return trimSentence(`故事围绕${trimClause(input.worldview.name)}展开`);
  }

  return "";
}

function composeStoryHook(input: {
  character: CharacterCard | null;
  worldview: WorldRule | null;
  userMessages: string[];
  primaryAnchors: string[];
  recentEntityAnchors: string[];
}) {
  const explicit = findLatestMessage(
    input.userMessages,
    /(开篇|第一章|第一次|一开始|起手|初次|差点|险些|当场|那一刻)/u,
    {
      primaryAnchors: input.primaryAnchors,
      recentEntityAnchors: input.recentEntityAnchors,
    },
  );
  if (explicit) {
    return trimSentence(
      explicit.replace(/^(开篇|第一章)?不是[^，。！？!?]+[，,]\s*是/u, "$1"),
    );
  }

  if (input.character && input.worldview) {
    return trimSentence(`开篇${input.character.name}第一次触犯${trimClause(input.worldview.name)}时，立刻付出惨重代价`);
  }

  if (input.worldview) {
    return trimSentence(`开篇有人第一次触犯${trimClause(input.worldview.name)}时，立刻付出惨重代价`);
  }

  return "";
}

export function deriveDraftCoreSummaries(input: {
  project: { premise: string };
  draft: FoundationWorkshopDraft | null | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const draft = sanitizeFoundationWorkshopDraft(input.draft);
  const safeProjectPremise = sanitizeProjectPremise(input.project.premise);
  const safeDraftPremise = draft?.premise ?? "";
  const safeDraftMainline = draft?.mainline ?? "";
  const safeDraftStoryHook = draft?.storyHook ?? "";
  const userMessages = listSubstantiveUserMessages(input.messages);
  const transcriptCharacters = buildTranscriptCharacterFallback(input.messages);
  const character = firstConcreteCharacter(draft) ?? transcriptCharacters[0] ?? null;
  const worldview = firstConcreteWorldRule(draft)
    ?? buildTranscriptWorldviewFallback(input.messages, 1)[0]
    ?? null;
  const primaryAnchors = buildNarrativeAnchors({
    character,
    worldview,
  });
  const recentEntityAnchors = buildRecentEntityAnchors(input.messages);
  const recomposedStoryHook = trimSentence(
    composeStoryHook({
      character,
      worldview,
      userMessages,
      primaryAnchors,
      recentEntityAnchors,
    }),
  );
  const storyHook = trimSentence(
    shouldPreferRecomposedSummary({
      existing: safeDraftStoryHook,
      recomposed: recomposedStoryHook,
      userMessages,
      recentEntityAnchors,
    })
      ? recomposedStoryHook
      : safeDraftStoryHook || recomposedStoryHook,
  );

  const recomposedMainline = trimSentence(
    composeMainline({
      character,
      worldview,
      userMessages,
      storyHook,
      primaryAnchors,
      recentEntityAnchors,
    }),
  );
  const mainline = trimSentence(
    shouldPreferRecomposedSummary({
      existing: safeDraftMainline,
      recomposed: recomposedMainline,
      userMessages,
      recentEntityAnchors,
    })
      ? recomposedMainline
      : safeDraftMainline || recomposedMainline,
  );

  const composedPremise = composePremise({
    projectPremise: safeProjectPremise,
    character,
    worldview,
    mainline,
    storyHook,
  });

  const premise = trimSentence(
    shouldUpgradeSeedPremise({
      existingPremise: safeDraftPremise,
      projectPremise: safeProjectPremise,
      composedPremise,
      character,
      worldview,
      mainline,
      storyHook,
    })
      ? composedPremise
      : safeDraftPremise
        || composedPremise
        || safeProjectPremise
        || input.project.premise,
  );

  return {
    premise,
    mainline,
    storyHook,
  };
}

export function buildTranscriptWorldviewFallback(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  limit = 6,
) {
  return resolveTranscriptWorldRules(extractWorldMentionCandidates(messages, limit * 2), limit).worldview;
}

export function buildTranscriptCharacterFallback(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  limit = 4,
) {
  const worldviewNames = new Set(
    buildTranscriptWorldviewFallback(messages, limit * 2)
      .map((rule) => trimClause(rule.name))
      .filter(Boolean),
  );
  const { characters } = resolveTranscriptCharacters(extractCharacterMentionCandidates(messages, limit * 4), limit * 2);
  return characters.filter((entry) => !worldviewNames.has(trimClause(entry.name))).slice(0, limit);
}

function resolveFoundationStyleState(input: {
  workshopDraft: FoundationWorkshopDraft | undefined;
  existing: FoundationPayload | null;
  activeStyle: ActiveStylePackage;
}) {
  return {
    styleSnapshotId:
      input.workshopDraft?.styleSnapshotId
      ?? input.existing?.styleSnapshotId
      ?? input.activeStyle.styleSnapshotId
      ?? null,
    styleSnapshotVersion:
      input.workshopDraft?.styleSnapshotVersion
      ?? input.existing?.styleSnapshotVersion
      ?? input.activeStyle.styleSnapshotVersion
      ?? null,
    styleDigest:
      input.workshopDraft?.styleDigest?.trim()
      || input.existing?.styleDigest?.trim()
      || input.activeStyle.styleDigest
      || "",
    styleExemplars:
      input.workshopDraft?.styleExemplars?.length
        ? input.workshopDraft.styleExemplars
        : input.existing?.styleExemplars?.length
          ? input.existing.styleExemplars
          : input.activeStyle.styleExemplars,
    styleProfile:
      input.workshopDraft?.styleProfile
      ?? input.existing?.styleProfile
      ?? input.activeStyle.styleProfile,
    styleCard:
      input.activeStyle.styleCard
      || input.existing?.styleCard
      || input.workshopDraft?.styleSteeringCard
      || "",
  };
}

function confirmedCharacterCards(cards: Array<Pick<ProjectCard, "cardType" | "status" | "draft">>) {
  return cards
    .filter((card) => card.status === "confirmed" && card.cardType === "character")
    .map((card) => card.draft as CharacterCard)
    .filter((entry) => isConcreteCharacterName(entry.name));
}

function confirmedWorldCards(cards: Array<Pick<ProjectCard, "cardType" | "status" | "draft">>) {
  return cards
    .filter((card) => card.status === "confirmed" && card.cardType === "world")
    .map((card) => card.draft as WorldRule)
    .filter((entry) => !isPlaceholderWorldRule(entry));
}

export function deriveFoundationCandidate(input: {
  project: { genre: string; premise: string; style: string };
  workshopDraft: FoundationWorkshopDraft | undefined;
  workshopMessages: Array<{ role: "user" | "assistant"; content: string }>;
  activeStyle: ActiveStylePackage;
  confirmedCards?: Array<Pick<ProjectCard, "cardType" | "status" | "draft">>;
  existing: FoundationPayload | null;
}): FoundationPayload {
  const sanitizedExisting = sanitizeFoundationPayload(input.existing);
  const sanitizedWorkshopDraft = sanitizeFoundationWorkshopDraft(input.workshopDraft);
  const safeProjectPremise = sanitizeProjectPremise(input.project.premise);
  const enrichedDraft = sanitizedWorkshopDraft
    ? {
      ...sanitizedWorkshopDraft,
      ...deriveDraftCoreSummaries({
        project: {
          ...input.project,
          premise: safeProjectPremise,
        },
        draft: sanitizedWorkshopDraft,
        messages: input.workshopMessages,
      }),
    }
    : undefined;
  const styleState = resolveFoundationStyleState({
    workshopDraft: enrichedDraft,
    existing: sanitizedExisting,
    activeStyle: input.activeStyle,
  });
  const transcriptCharacters = buildTranscriptCharacterFallback(input.workshopMessages);
  const transcriptWorldview = buildTranscriptWorldviewFallback(input.workshopMessages);
  const cards = input.confirmedCards ?? [];

  // 草稿里已有具名实体时，草稿就是权威集合：existing / 卡片 / transcript 只能富化同名条目，
  // 不能把已被草稿移除（FoundationDeltaV1 remove）的旧实体重新并回来，否则 coreDrift 永远无法消除。
  const draftCharacterKeys = new Set(
    (enrichedDraft?.characterIdeas ?? [])
      .filter((entry) => isConcreteCharacterName(entry.name))
      .map((entry) => trimClause(entry.name)),
  );
  const draftWorldviewKeys = new Set(
    (enrichedDraft?.worldviewIdeas ?? [])
      .filter((entry) => !isPlaceholderWorldRule(entry))
      .map((entry) => trimClause(entry.name))
      .filter(Boolean),
  );
  const keepDraftCharacters = (entries: CharacterCard[]) =>
    draftCharacterKeys.size ? entries.filter((entry) => draftCharacterKeys.has(trimClause(entry.name))) : entries;
  const keepDraftWorldRules = (entries: WorldRule[]) =>
    draftWorldviewKeys.size ? entries.filter((entry) => draftWorldviewKeys.has(trimClause(entry.name))) : entries;

  const characters = mergeCharacters(
    enrichedDraft?.characterIdeas ?? [],
    keepDraftCharacters(confirmedCharacterCards(cards)),
    keepDraftCharacters(transcriptCharacters),
    keepDraftCharacters(sanitizedExisting?.characters ?? []),
  );
  const worldview = mergeWorldRules(
    enrichedDraft?.worldviewIdeas?.length ? enrichedDraft.worldviewIdeas : transcriptWorldview,
    keepDraftWorldRules(confirmedWorldCards(cards)),
    keepDraftWorldRules(sanitizedExisting?.worldview ?? []),
  );

  return {
    premise:
      enrichedDraft?.premise
      || sanitizedExisting?.premise
      || safeProjectPremise
      || `${input.project.genre} 长篇故事`,
    mainline: enrichedDraft?.mainline || sanitizedExisting?.mainline || "",
    storyHook: enrichedDraft?.storyHook || sanitizedExisting?.storyHook || "",
    styleCard: styleState.styleCard,
    styleProfile: styleState.styleProfile,
    styleSnapshotId: styleState.styleSnapshotId,
    styleSnapshotVersion: styleState.styleSnapshotVersion,
    styleDigest: styleState.styleDigest,
    styleExemplars: styleState.styleExemplars,
    characters: characters.length
      ? characters
      : [
        {
          name: "主角",
          role: "protagonist",
          goal: "推动主线完成",
          traits: ["主动", "敏感", "有成长空间"],
        },
      ],
    worldview: worldview.length
      ? worldview
      : [
        {
          name: "世界基调",
          description: `${input.project.genre} 类型故事，保持 ${input.project.style} 风格`,
        },
      ],
    relationships:
      enrichedDraft?.relationshipIdeas?.length
        ? enrichedDraft.relationshipIdeas
        : sanitizedExisting?.relationships ?? [],
  };
}

function foundationFactsSignature(foundation: FoundationPayload | null | undefined) {
  if (!foundation) {
    return "";
  }
  return JSON.stringify({
    premise: trimClause(foundation.premise),
    mainline: trimClause(foundation.mainline),
    storyHook: trimClause(foundation.storyHook),
    characters: foundation.characters,
    worldview: foundation.worldview,
    relationships: foundation.relationships,
  });
}

export function selectFoundationFromCandidate(input: {
  candidate: FoundationPayload;
  proposed: FoundationPayload;
}) {
  const proposedHasPlaceholders = input.proposed.characters.some((entry) => !isConcreteCharacterName(entry.name))
    || input.proposed.worldview.some((entry) => isPlaceholderWorldRule(entry));
  const thinnerThanCandidate = input.proposed.characters.length < input.candidate.characters.length
    || input.proposed.worldview.length < input.candidate.worldview.length
    || trimClause(input.proposed.premise).length < trimClause(input.candidate.premise).length;

  return proposedHasPlaceholders || thinnerThanCandidate ? input.candidate : input.proposed;
}

export function buildDerivedFoundationMeta(input: {
  draft: FoundationWorkshopDraft | undefined;
  derivedFoundation: FoundationPayload | null;
  persistedFoundation: FoundationPayload | null;
}): DerivedFoundationMeta | null {
  if (!input.derivedFoundation) {
    return null;
  }

  return {
    source: "derived_preview",
    staleComparedToPersisted:
      foundationFactsSignature(input.derivedFoundation) !== foundationFactsSignature(input.persistedFoundation),
    coverage: {
      premiseFilled: Boolean(trimClause(input.draft?.premise ?? input.derivedFoundation.premise)),
      mainlineFilled: Boolean(trimClause(input.draft?.mainline)),
      storyHookFilled: Boolean(trimClause(input.draft?.storyHook)),
      characterCount: input.derivedFoundation.characters.length,
      worldviewCount: input.derivedFoundation.worldview.length,
      relationshipCount: input.derivedFoundation.relationships.length,
    },
  };
}
