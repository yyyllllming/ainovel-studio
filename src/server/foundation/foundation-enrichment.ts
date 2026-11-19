import type { CharacterCard, FoundationPayload, RelationshipEdge, WorldRule } from "../types.ts";

const GENERIC_WORLD_NAME_PATTERN = /世界基调|当前主场景|当前地点|默认场景|风格设定|默认风格|某地|某处/u;
const GENERIC_WORLD_DESCRIPTION_PATTERN = /类型故事|保持.+风格|活动于此世间|默认风格|作为核心角色活动/u;
const GENERIC_CHARACTER_GOAL_PATTERN = /推动主线完成|活下去|变强|寻找真相|获得力量|继续成长/u;
const CORE_RULE_PATTERN = /灵纹|血脉|天赋|反噬|代价|追猎|祖术|兽道|异兽|部族|禁区|传承/u;
const OPENING_ANCHOR_PATTERN = /山|林|谷|涧|崖|洞|部族|村|巢|石缝|湿地|荒原|遗迹|古地/u;
const MYTHIC_SUPPORT_NAME_POOLS = {
  hunter: ["逐息狰", "伏纹獠", "断角狞兽", "食痕魈影", "巡山罴影", "噬雾玄兽"],
  rival: ["拾骨玄禽", "裂幕鸷影", "啄火异禽", "攫光妖鹫", "窥骨夜隼", "翻风怪鸟"],
};
const GENERIC_SUPPORT_NAME_POOLS = {
  hunter: ["追迹者", "巡夜人", "逼债者", "守关人", "盯梢者", "围猎者"],
  rival: ["旁观者", "守夜人", "截胡者", "尾随者", "捡漏人", "窥伺者"],
};
const MYTHIC_FOUNDATION_PATTERN = /(山海|洪荒|大荒|异兽|神兽|灵药|修仙|玄幻|禁区|古地|部族)/u;

function normalizeKey(input: string) {
  return input.trim().toLocaleLowerCase();
}

function hashSeed(input: string) {
  return Array.from(input).reduce((sum, char, index) => sum + char.codePointAt(0)! * (index + 1), 0);
}

function pickBySeed<T>(items: T[], seed: string) {
  if (!items.length) {
    throw new Error("候选列表不能为空");
  }
  return items[Math.abs(hashSeed(seed)) % items.length]!;
}

function looksLikeMythicFoundation(input: { title: string; genre: string; premise: string }) {
  return MYTHIC_FOUNDATION_PATTERN.test(`${input.title} ${input.genre} ${input.premise}`);
}

function buildFallbackSupportName(input: {
  title: string;
  genre: string;
  premise: string;
  role: "hunter" | "rival";
}) {
  const mythic = looksLikeMythicFoundation(input);
  const pool = mythic ? MYTHIC_SUPPORT_NAME_POOLS[input.role] : GENERIC_SUPPORT_NAME_POOLS[input.role];
  return pickBySeed(pool, `${input.title}:${input.genre}:${input.premise}:${input.role}`);
}

function resolveExplicitSupportName(input: {
  foundation: FoundationPayload;
  role: "hunter" | "rival";
}) {
  if (input.role !== "hunter") {
    return "";
  }

  const haystack = [
    input.foundation.premise,
    ...input.foundation.worldview.map((rule) => `${rule.name} ${rule.description}`),
    ...input.foundation.relationships.map((edge) => `${edge.source} ${edge.target} ${edge.label}`),
  ].join(" ");

  const patterns = [
    /((?:[\p{sc=Han}A-Za-z]{1,6})?巡猎使)/u,
    /((?:[\p{sc=Han}A-Za-z]{1,6})?追猎者)/u,
    /((?:[\p{sc=Han}A-Za-z]{1,6})?守夜人)/u,
  ];

  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function isGenericWorldRule(rule: Pick<WorldRule, "name" | "description">) {
  return GENERIC_WORLD_NAME_PATTERN.test(rule.name) || GENERIC_WORLD_DESCRIPTION_PATTERN.test(rule.description);
}

function isGenericCharacterGoal(goal: string) {
  return GENERIC_CHARACTER_GOAL_PATTERN.test(goal.trim()) && goal.trim().length <= 16;
}

function characterRichnessScore(card: CharacterCard) {
  return [
    card.goal.trim().length,
    card.traits.length * 8,
    (card.secrets?.length ?? 0) * 10,
    isGenericCharacterGoal(card.goal) ? -18 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function worldRichnessScore(rule: WorldRule) {
  return [
    rule.name.trim().length * 2,
    rule.description.trim().length,
    CORE_RULE_PATTERN.test(`${rule.name}${rule.description}`) ? 18 : 0,
    OPENING_ANCHOR_PATTERN.test(`${rule.name}${rule.description}`) ? 12 : 0,
    isGenericWorldRule(rule) ? -30 : 0,
  ].reduce((sum, value) => sum + value, 0);
}

function mergeCharacterCards(base: CharacterCard[], incoming: CharacterCard[]) {
  const order: string[] = [];
  const merged = new Map<string, CharacterCard>();

  for (const card of [...base, ...incoming]) {
    const key = normalizeKey(card.name);
    if (!key) {
      continue;
    }
    if (!merged.has(key)) {
      order.push(key);
      merged.set(key, card);
      continue;
    }
    const current = merged.get(key)!;
    merged.set(key, characterRichnessScore(card) >= characterRichnessScore(current) ? card : current);
  }

  return order.map((key) => merged.get(key)!).filter(Boolean);
}

function pruneWeakWorldRules(items: WorldRule[]) {
  const concrete = items.filter((rule) => !isGenericWorldRule(rule));
  if (concrete.length >= 3) {
    return concrete;
  }
  return items;
}

function mergeWorldRules(base: WorldRule[], incoming: WorldRule[]) {
  const order: string[] = [];
  const merged = new Map<string, WorldRule>();

  for (const rule of [...base, ...incoming]) {
    const key = normalizeKey(rule.name);
    if (!key) {
      continue;
    }
    if (!merged.has(key)) {
      order.push(key);
      merged.set(key, rule);
      continue;
    }
    const current = merged.get(key)!;
    merged.set(key, worldRichnessScore(rule) >= worldRichnessScore(current) ? rule : current);
  }

  return pruneWeakWorldRules(order.map((key) => merged.get(key)!).filter(Boolean));
}

function dedupeRelationships(items: RelationshipEdge[]) {
  const seen = new Set<string>();
  const output: RelationshipEdge[] = [];

  for (const item of items) {
    const key = `${normalizeKey(item.source)}|${normalizeKey(item.target)}|${normalizeKey(item.label)}`;
    if (!item.source.trim() || !item.target.trim() || !item.label.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }

  return output;
}

export function assessFoundationCoverage(foundation: FoundationPayload) {
  const notes: string[] = [];
  let score = 0;
  const supportingCharacters = foundation.characters.slice(1).filter((card) => card.name.trim());
  const genericWorldRules = foundation.worldview.filter((rule) => isGenericWorldRule(rule));
  const coreRuleCount = foundation.worldview.filter((rule) =>
    CORE_RULE_PATTERN.test(`${rule.name}${rule.description}`),
  ).length;
  const openingAnchorCount = foundation.worldview.filter((rule) =>
    OPENING_ANCHOR_PATTERN.test(`${rule.name}${rule.description}`),
  ).length;

  if (foundation.characters.length < 3) {
    score += 2;
    notes.push(`正式设定角色过少（${foundation.characters.length} 人），前几章缺少稳定对手、牵引者或追压力源。`);
  }

  if (supportingCharacters.length < 2) {
    score += 1;
    notes.push("除主角外的支撑角色不足，开篇容易只剩独角戏和抽象危险。");
  }

  if (foundation.characters[0] && isGenericCharacterGoal(foundation.characters[0].goal)) {
    score += 1;
    notes.push("主角当前阶段目标仍然偏空，需要落到即时欲望、压力或疑问上。");
  }

  if (foundation.worldview.length < 4) {
    score += 2;
    notes.push(`世界规则偏薄（${foundation.worldview.length} 条），不足以支撑前几章稳定注入。`);
  }

  if (genericWorldRules.length > 0) {
    score += 2;
    notes.push(`世界规则里还有 ${genericWorldRules.length} 条占位内容，像“世界基调 / 当前主场景”这种词不该直接进蓝图。`);
  }

  if (foundation.relationships.length < Math.min(2, Math.max(1, foundation.characters.length - 1))) {
    score += 1;
    notes.push("角色关系过少，人物之间的牵引与冲突还没立住。");
  }

  if (coreRuleCount === 0) {
    score += 1;
    notes.push("世界规则没有明确写出灵纹/血脉/代价/追猎这些核心机制。");
  }

  if (openingAnchorCount === 0) {
    score += 1;
    notes.push("世界规则没有锚住开篇活动区域，首章容易退回“当前地点”这类空词。");
  }

  const severity: "ok" | "warn" | "fail" = score >= 5 ? "fail" : score >= 2 ? "warn" : "ok";

  return {
    severity,
    score,
    notes,
    shouldExpand: severity !== "ok",
  };
}

export function mergeFoundationPayload(base: FoundationPayload, incoming: FoundationPayload): FoundationPayload {
  const mergedCharacters = mergeCharacterCards(base.characters, incoming.characters);
  const mergedWorldview = mergeWorldRules(base.worldview, incoming.worldview);
  const mergedRelationships = dedupeRelationships([...base.relationships, ...incoming.relationships]);

  return {
    premise: incoming.premise.trim().length >= base.premise.trim().length ? incoming.premise : base.premise,
    mainline:
      incoming.mainline?.trim().length
        ? incoming.mainline
        : base.mainline ?? "",
    storyHook:
      incoming.storyHook?.trim().length
        ? incoming.storyHook
        : base.storyHook ?? "",
    styleCard: incoming.styleCard.trim().length >= base.styleCard.trim().length ? incoming.styleCard : base.styleCard,
    styleProfile: incoming.styleProfile ?? base.styleProfile,
    styleSnapshotId: incoming.styleSnapshotId ?? base.styleSnapshotId ?? null,
    styleSnapshotVersion: incoming.styleSnapshotVersion ?? base.styleSnapshotVersion ?? null,
    styleDigest: incoming.styleDigest?.trim() || (base.styleDigest ?? ""),
    styleExemplars:
      incoming.styleExemplars?.length
        ? incoming.styleExemplars
        : base.styleExemplars ?? [],
    characters: mergedCharacters,
    worldview: mergedWorldview,
    relationships: mergedRelationships,
  };
}

function buildMythicFallbackExpansionContent(input: {
  protagonist: CharacterCard;
  openingArea: string;
  hunterName: string;
  rivalName: string;
}) {
  const { protagonist, openingArea, hunterName, rivalName } = input;
  return {
    characters: [
      {
        ...protagonist,
        goal: isGenericCharacterGoal(protagonist.goal)
          ? `${protagonist.name}必须先带着偷学来的第一道灵纹活着逃出${openingArea}，再查清这份能力为何会留下追踪痕迹。`
          : protagonist.goal,
      },
      {
        name: hunterName,
        role: "hunter",
        goal: `追回被${protagonist.name}窥走的灵纹气息，顺着残留痕迹追到${openingArea}外沿。`,
        traits: ["凶悍", "谨慎", "善追踪"],
      },
      {
        name: rivalName,
        role: "rival",
        goal: `趁${hunterName}与${protagonist.name}缠斗时夺走${openingArea}里最值钱的异兽遗留。`,
        traits: ["贪心", "机警", "擅长捡漏"],
      },
    ],
    worldview: [
      {
        name: openingArea,
        description: `开篇活动区域多断崖、石涧与伏伤异兽，夜里血腥味重，弱小生灵只能贴着阴影求生。`,
      },
      {
        name: "灵纹偷学",
        description: `${protagonist.name}只有在异兽天赋灵纹暴露、且自己近距离承受灵压与杀机时，才可能偷学到残缺能力。`,
      },
      {
        name: "偷学代价",
        description: `每次强行刻印灵纹，都会带来刺痛、失血、失控或被原主气息反咬，不能当成无代价外挂。`,
      },
      {
        name: "气息追猎",
        description: `一旦偷学成功，原主或同族可能沿着残留灵纹反向追踪，让${protagonist.name}很快暴露行迹。`,
      },
    ],
    relationships: [
      {
        source: protagonist.name,
        target: hunterName,
        label: "偷学后被追猎",
      },
      {
        source: rivalName,
        target: protagonist.name,
        label: "盯上其偷来的灵纹与残留机缘",
      },
    ],
  };
}

function buildGenericFallbackExpansionContent(input: {
  protagonist: CharacterCard;
  openingArea: string;
  hunterName: string;
  rivalName: string;
}) {
  const { protagonist, openingArea, hunterName, rivalName } = input;
  return {
    characters: [
      {
        ...protagonist,
        goal: isGenericCharacterGoal(protagonist.goal)
          ? `${protagonist.name}必须先带着刚到手的关键优势撑过${openingArea}里迫在眉睫的盘查，再查清这份优势为何会引来盯梢。`
          : protagonist.goal,
      },
      {
        name: hunterName,
        role: "hunter",
        goal: `盯住${protagonist.name}暴露出的异常，顺着线索一路查到${openingArea}附近。`,
        traits: ["执拗", "谨慎", "善于盯梢"],
      },
      {
        name: rivalName,
        role: "rival",
        goal: `趁${hunterName}与${protagonist.name}周旋时，抢先拿走${openingArea}里最值钱的机会。`,
        traits: ["贪心", "机警", "擅长捡漏"],
      },
    ],
    worldview: [
      {
        name: openingArea,
        description: `开篇活动区域出入受人注视，${protagonist.name}的一举一动都可能被记下并传出去。`,
      },
      {
        name: "优势触发条件",
        description: `${protagonist.name}的核心优势只有在特定条件具备时才能动用，每次动用都需要事前准备与事后收尾。`,
      },
      {
        name: "动用代价",
        description: `每次动用核心优势都要付出可感的代价——时间、信任、健康或退路，不能当成无代价外挂。`,
      },
      {
        name: "暴露压力",
        description: `优势一旦暴露，就会有人顺着痕迹查到${protagonist.name}头上，让处境迅速恶化。`,
      },
    ],
    relationships: [
      {
        source: protagonist.name,
        target: hunterName,
        label: "暴露后被盯上",
      },
      {
        source: rivalName,
        target: protagonist.name,
        label: "觊觎其手中的机会",
      },
    ],
  };
}

export function buildFallbackFoundationExpansion(input: {
  title: string;
  genre: string;
  premise: string;
  foundation: FoundationPayload;
}) {
  const mythic = looksLikeMythicFoundation(input);
  const protagonist = input.foundation.characters[0] ?? {
    name: "主角",
    role: "protagonist",
    goal: "先活下来，再查清自己身上的异常。",
    traits: ["敏锐", "敢赌"],
  };
  const openingArea = input.foundation.worldview.find((rule) => !isGenericWorldRule(rule))?.name
    || (mythic ? "断崖山场" : "开篇核心场地");
  const hunterName = input.foundation.characters[1]?.name || resolveExplicitSupportName({
    foundation: input.foundation,
    role: "hunter",
  }) || buildFallbackSupportName({
    title: input.title,
    genre: input.genre,
    premise: input.premise,
    role: "hunter",
  });
  const rivalName = input.foundation.characters[2]?.name || buildFallbackSupportName({
    title: input.title,
    genre: input.genre,
    premise: input.premise,
    role: "rival",
  });

  // 兜底文案按题材分池：玄幻判定不成立时只注入中性占位规则，避免污染都市/言情等项目。
  const content = (mythic ? buildMythicFallbackExpansionContent : buildGenericFallbackExpansionContent)({
    protagonist,
    openingArea,
    hunterName,
    rivalName,
  });

  return mergeFoundationPayload(input.foundation, {
    premise: input.foundation.premise || input.premise,
    styleCard: input.foundation.styleCard,
    styleProfile: input.foundation.styleProfile,
    ...content,
  });
}
