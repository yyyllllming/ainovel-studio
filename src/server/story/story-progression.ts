import type {
  ActionPattern,
  ChapterBlueprint,
  ChapterDeltaRecord,
  CoreProgressDeltaType,
  EndingMove,
  FoundationPayload,
  GenreFulfillmentAssessment,
  GenreObligationPackActivation,
  GenreObligationPackId,
  LoopRiskAssessment,
  MechanismRevealMode,
  SegmentPlan,
  SegmentPlanItem,
  StoryArenaCluster,
  StoryOpponentCluster,
  StoryProgressState,
  StoryRelationshipProgression,
  StoryRewardType,
  StoryProgressionAssessment,
  StoryPromise,
  StructuredAvoidanceList,
} from "../types.ts";
import { nowIso, unique } from "../utils.ts";

const MYTHIC_PATTERN = /山海|洪荒|大荒|神兽|异兽|妖兽|灵药|山川有灵|古地|禁区|遗种|部族|祭痕|奇花|怪木/u;
const ROMANCE_PATTERN = /言情|恋爱|爱情|婚约|情感|心动|暗恋|暧昧|夫妻|前任|白月光|追妻|青梅竹马/u;
const MYTHIC_SIGNAL_PATTERN = /兽|禽|鸟|蛟|龙|夔|鼋|鲲|鹏|猿|芝|藤|山|海|泽|渊|谷|崖|禁区|遗迹|古地|祭|部族|骨|药/u;
const ROMANCE_SIGNAL_PATTERN = /她|他|对视|牵手|靠近|试探|误会|婚约|吃醋|心跳|心软|沉默|疏离|靠拢|信任|关系/u;
const CORE_ONLY_PACK: GenreObligationPackActivation = {
  id: "core-only",
  source: "auto",
  active: true,
  notes: ["未命中特定题材包，默认只启用通用推进层。"],
};

const CORE_DELTA_DESCRIPTIONS: Record<CoreProgressDeltaType, string> = {
  situation_shift: "局面发生实质切换",
  objective_shift: "当前目标被改写或替换",
  information_shift: "拿到会改变后续行动的新线索/新认知",
  relationship_shift: "人物关系、立场或情感张力发生变化",
  power_shift: "能力、资源、控制权或地位发生变化",
  world_shift: "世界层级、外部格局或规则边界被抬高",
  cost_shift: "角色新增明确代价或损失",
};

function trimKey(input: string | null | undefined) {
  return input?.trim() ?? "";
}

const ARENA_MODIFIER_PATTERN = /外围|深处|地底通道|高处|边缘|旁|井边|旧道|入口|后山|上游|下游|尽头|腹地/gu;

/** 去掉方位词，只保留核心地名 */
export function normalizeArenaKey(key: string | null | undefined): string {
  if (!key) return "";
  return key.trim().replace(ARENA_MODIFIER_PATTERN, "").trim() || key.trim();
}

const ACTION_PATTERN_INFERENCE: Array<{ pattern: RegExp; action: ActionPattern }> = [
  { pattern: /打|杀|扑|劈|撕|斩|撞|爪|咬|斗/u, action: "combat" },
  { pattern: /追|逃|夺路|脱身|奔|逐/u, action: "pursuit" },
  { pattern: /潜|藏|隐|暗/u, action: "stealth" },
  { pattern: /行|赶路|穿越|跨|迁/u, action: "travel" },
  { pattern: /查|探|调查|推断|分析|线索/u, action: "investigation" },
  { pattern: /谈|判|说服|交涉|协商|劝/u, action: "negotiation" },
  { pattern: /撑|熬|硬扛|耗|守|活/u, action: "survival" },
  { pattern: /养|复|愈|歇|恢/u, action: "recovery" },
  { pattern: /发现|揭|现身|显形|遗迹|秘/u, action: "discovery" },
];

const ENDING_MOVE_INFERENCE: Array<{ pattern: RegExp; move: EndingMove }> = [
  { pattern: /新的危险|新隐患|新威胁|后患|伏笔/u, move: "new_risk" },
  { pattern: /新发现|新线索|揭开|揭示|真相/u, move: "new_discovery" },
  { pattern: /地位|控制权|占据|位置变化/u, move: "position_shift" },
  { pattern: /关系|信任|疏离|靠拢|立场/u, move: "relation_shift" },
  { pattern: /情感|心境|情绪收束|沉默/u, move: "emotional_close" },
  { pattern: /总结|回顾|盘点|明确指出|交代/u, move: "explicit_summary" },
];

const MECHANISM_INFERENCE: Array<{ pattern: RegExp; mode: MechanismRevealMode }> = [
  { pattern: /先感受|效果先行|不知为何/u, mode: "effect_first" },
  { pattern: /意识到|认出|明白了|原来/u, mode: "recognition_line" },
  { pattern: /总结|交代|明确说明|解释/u, mode: "explicit_summary" },
  { pattern: /三段|渐进|层层/u, mode: "triad" },
];

const ACTION_PATTERN_ROTATION: ActionPattern[] = [
  "investigation", "combat", "discovery", "negotiation",
  "pursuit", "stealth", "travel", "survival", "recovery",
];

const DEFAULT_REWARD_TYPES: StoryRewardType[] = [
  { id: "clue", label: "线索", description: "拿到会改写下一步的新认知。" },
  { id: "access", label: "通行权", description: "获得通路、位置或门槛上的松动。" },
  { id: "resource", label: "资源", description: "拿到器物、助力、筹码或控制权。" },
  { id: "rule_insight", label: "规则认知", description: "确认会改变后续判断的规则层信息。" },
  { id: "relation_shift", label: "关系变化", description: "关键关系的站位、信任或绑定状态发生变化。" },
  { id: "debt_mark", label: "新债务/新标记", description: "留下会追着角色走的新代价或记号。" },
];

function defaultArenaClusterId(arena: string) {
  if (/外围|边缘|高处/u.test(arena)) return "outer_rim";
  if (/深处|地底通道|腹地|尽头/u.test(arena)) return "deep_core";
  const normalized = normalizeArenaKey(arena).replace(/[^\p{Script=Han}A-Za-z0-9]+/gu, "");
  return normalized ? `arena_${normalized.slice(0, 12)}` : "rule_layer";
}

export function buildDefaultArenaClusters(foundation: FoundationPayload): StoryArenaCluster[] {
  const arenas = getPhysicalArenaHints(foundation);
  const buckets = new Map<string, string[]>();
  for (const arena of arenas) {
    const id = defaultArenaClusterId(arena);
    const hints = buckets.get(id) ?? [];
    hints.push(arena);
    buckets.set(id, hints);
  }

  const labels: Record<string, { label: string; summary: string }> = {
    outer_rim: { label: "外围猎场", summary: "场域外沿、边缘、上层与入口一带。" },
    deep_core: { label: "深层腹地", summary: "更深、更窄、更逼迫的内部通道和腹地。" },
    rule_layer: { label: "规则层", summary: "会主动变化、反馈或吞没人的环境规则层。" },
  };

  return [...buckets.entries()].map(([id, hints]) => ({
    id,
    label: labels[id]?.label ?? hints[0] ?? id,
    summary: labels[id]?.summary ?? "当前场域簇。",
    hints: unique(hints),
  }));
}

export function buildDefaultOpponentClusters(foundation: FoundationPayload): StoryOpponentCluster[] {
  const namedOpponents = foundation.characters.slice(1).map((entry) => entry.name?.trim()).filter(Boolean) as string[];
  const clusters: StoryOpponentCluster[] = [];
  if (namedOpponents.length) {
    clusters.push({
      id: "named_opponents",
      label: "在场对手",
      summary: "当前卷持续追压或争夺的角色/异兽。",
      hints: namedOpponents,
    });
  }
  clusters.push({
    id: "environment_rule",
    label: "规则本身",
    summary: "怪地、旧门、古禁、地形与规则直接施压。",
    hints: ["规则", "禁则", "古禁", "怪地", "旧门"],
  });
  return clusters;
}

export function buildDefaultRelationshipProgressions(foundation: FoundationPayload): StoryRelationshipProgression[] {
  return foundation.relationships.map((edge, index) => ({
    id: `relationship-beat-${index + 1}`,
    relationshipKey: `${edge.source}-${edge.target}`,
    label: edge.label,
    description: edge.label,
  }));
}

export function inferRewardTypeIdForDelta(delta: CoreProgressDeltaType) {
  switch (delta) {
    case "information_shift":
      return "clue";
    case "objective_shift":
    case "situation_shift":
      return "access";
    case "power_shift":
      return "resource";
    case "world_shift":
      return "rule_insight";
    case "relationship_shift":
      return "relation_shift";
    case "cost_shift":
      return "debt_mark";
    default:
      return "clue";
  }
}

function avoidConsecutiveRewardType(candidate: string, previous: string | null) {
  if (!previous || candidate !== previous) {
    return candidate;
  }
  const index = DEFAULT_REWARD_TYPES.findIndex((entry) => entry.id === candidate);
  if (index === -1) {
    return candidate;
  }
  return DEFAULT_REWARD_TYPES[(index + 1) % DEFAULT_REWARD_TYPES.length]!.id;
}

export function buildDefaultRewardTypes() {
  return DEFAULT_REWARD_TYPES.map((entry) => ({ ...entry }));
}

export function normalizeSegmentPlanItem(item: SegmentPlanItem): SegmentPlanItem {
  const narrativeTitle = item.narrativeTitle?.trim() || null;
  const narrativeIntent = item.narrativeIntent?.trim() || null;
  const narrativeSummary = item.narrativeSummary?.trim() || null;
  const arcConnection = item.arcConnection?.trim() || null;
  const nextHook = item.nextHook?.trim() || null;
  const rewriteStatus = item.rewriteStatus === "failed" || item.rewriteStatus === "ready" || item.rewriteStatus === "pending"
    ? item.rewriteStatus
    : (narrativeTitle || narrativeIntent || narrativeSummary || arcConnection || nextHook)
      ? "ready"
      : "pending";

  return {
    ...item,
    narrativeTitle,
    narrativeIntent,
    narrativeSummary,
    arcConnection,
    nextHook,
    rewriteStatus,
    userOverridden: Boolean(item.userOverridden),
    requiredProgressDeltas: item.requiredProgressDeltas ?? [],
    requiredObligations: item.requiredObligations ?? [],
    focusCharacters: item.focusCharacters ?? [],
    arenaHints: item.arenaHints ?? [],
    suggestedActionPattern: item.suggestedActionPattern ?? null,
    antagonistHint: item.antagonistHint ?? null,
    forbiddenRecentAxes: item.forbiddenRecentAxes ?? [],
    arenaClusterId: item.arenaClusterId ?? null,
    opponentClusterId: item.opponentClusterId ?? null,
    rewardType: item.rewardType ?? null,
    relationshipBeatId: item.relationshipBeatId ?? null,
  };
}

export function getSegmentDisplayTitle(item: SegmentPlanItem) {
  return item.narrativeTitle?.trim() || item.title;
}

export function getSegmentDisplayIntent(item: SegmentPlanItem) {
  return item.narrativeIntent?.trim() || item.intent;
}

export function getSegmentSkeletonTitle(item: SegmentPlanItem) {
  return item.title;
}

export function getSegmentSkeletonIntent(item: SegmentPlanItem) {
  return item.intent;
}

export function inferActionPattern(
  blueprint: Pick<ChapterBlueprint, "sceneGoal"> & { conflicts?: string[] | null },
): ActionPattern | null {
  const merged = [blueprint.sceneGoal, ...(blueprint.conflicts ?? [])].join(" ");
  for (const entry of ACTION_PATTERN_INFERENCE) {
    if (entry.pattern.test(merged)) {
      return entry.action;
    }
  }
  return null;
}

export function inferEndingMove(
  blueprint: Pick<ChapterBlueprint, "foreshadows" | "sceneGoal">,
): EndingMove | null {
  const merged = [blueprint.sceneGoal, ...(blueprint.foreshadows ?? [])].join(" ");
  for (const entry of ENDING_MOVE_INFERENCE) {
    if (entry.pattern.test(merged)) {
      return entry.move;
    }
  }
  return null;
}

export function inferMechanismRevealMode(
  blueprint: Pick<ChapterBlueprint, "sceneGoal">,
): MechanismRevealMode | null {
  for (const entry of MECHANISM_INFERENCE) {
    if (entry.pattern.test(blueprint.sceneGoal)) {
      return entry.mode;
    }
  }
  return null;
}

export function extractMotifTokens(text: string, maxTokens = 6): string[] {
  const stopWords = new Set([
    "的", "了", "是", "在", "和", "也", "都", "而", "又", "不", "他", "她", "它", "这", "那", "就",
    "但", "把", "被", "让", "对", "向", "从", "一个", "一种", "已经", "没有", "可以", "还是",
    "出来", "进去", "回来", "立刻", "下来", "上来", "过去", "气息", "目光", "身形",
  ]);
  const normalized = text.replace(/[^\p{Script=Han}]/gu, "");
  const freq = new Map<string, number>();

  for (let length = 2; length <= 4; length += 1) {
    for (let index = 0; index <= normalized.length - length; index += 1) {
      const token = normalized.slice(index, index + length);
      if (!token || stopWords.has(token) || token.length < 2) continue;
      if ([...stopWords].some((stopWord) => token.includes(stopWord))) continue;
      if (new Set(token).size <= 1) continue;
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, maxTokens)
    .map(([token]) => token);
}

function sanitizeText(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeSceneGoalKey(sceneGoal: string) {
  return sanitizeText(sceneGoal)
    .replace(/[，。！？、,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

function buildArenaKey(blueprint: Pick<ChapterBlueprint, "locations">) {
  return normalizeArenaKey(blueprint.locations[0]) || null;
}

function buildObjectiveKey(
  blueprint: Pick<ChapterBlueprint, "sceneGoal"> & {
    conflicts?: string[] | null;
  },
) {
  return normalizeSceneGoalKey(blueprint.conflicts?.[0] ?? blueprint.sceneGoal) || null;
}

function hasPack(
  activations: GenreObligationPackActivation[] | GenreObligationPackId[] | undefined,
  packId: GenreObligationPackId,
) {
  if (!activations?.length) {
    return false;
  }
  return activations.some((entry) => (typeof entry === "string" ? entry : entry.id) === packId);
}

export function suggestGenreObligationPacks(input: {
  genre: string;
  premise: string;
  foundation?: FoundationPayload | null;
}) {
  const worldText = input.foundation?.worldview.map((item) => `${item.name} ${item.description}`).join("；") ?? "";
  const merged = `${input.genre} ${input.premise} ${worldText}`;
  const packs: GenreObligationPackActivation[] = [];

  if (MYTHIC_PATTERN.test(merged)) {
    packs.push({
      id: "mythic_beastiary",
      source: "auto",
      active: true,
      notes: ["命中山海/洪荒/异兽相关语义，启用异兽与怪地履约约束。"],
    });
  }

  if (ROMANCE_PATTERN.test(merged)) {
    packs.push({
      id: "romance",
      source: "auto",
      active: true,
      notes: ["命中言情/关系驱动语义，启用关系推进履约约束。"],
    });
  }

  if (!packs.length) {
    return [CORE_ONLY_PACK];
  }

  return [CORE_ONLY_PACK, ...packs];
}

export function resolveActiveProgressionAxes(activations: GenreObligationPackActivation[]) {
  if (hasPack(activations, "romance")) {
    return [
      "relationship_shift",
      "information_shift",
      "objective_shift",
      "situation_shift",
      "power_shift",
      "world_shift",
    ] satisfies CoreProgressDeltaType[];
  }

  if (hasPack(activations, "mythic_beastiary")) {
    return [
      "situation_shift",
      "information_shift",
      "world_shift",
      "power_shift",
      "objective_shift",
      "relationship_shift",
    ] satisfies CoreProgressDeltaType[];
  }

  return [
    "situation_shift",
    "objective_shift",
    "information_shift",
    "relationship_shift",
    "power_shift",
    "world_shift",
  ] satisfies CoreProgressDeltaType[];
}

export function buildDefaultStoryPromises(input: {
  genre: string;
  premise: string;
  completionCriteria: string;
  activations: GenreObligationPackActivation[];
}) {
  const promises: StoryPromise[] = [
    {
      id: "mainline",
      label: "主线承诺",
      type: "mainline",
      description: sanitizeText(input.premise || `${input.genre}主线逐步抬升并最终完成闭环。`),
    },
    {
      id: "ending",
      label: "完结承诺",
      type: "ending",
      description: sanitizeText(input.completionCriteria || "主线闭环并完成主要人物关系收束。"),
    },
  ];

  if (hasPack(input.activations, "mythic_beastiary")) {
    promises.push({
      id: "mythic_scope",
      label: "题材承诺",
      type: "world",
      description: "不断兑现新的异兽、怪地、禁忌生态与更高山海层级，而不是把同一追逃打斗拖长。",
    });
  }

  if (hasPack(input.activations, "romance")) {
    promises.push({
      id: "romance_arc",
      label: "关系承诺",
      type: "relationship",
      description: "关系线必须持续变化，不能只靠情绪复读或表面拉扯维持篇幅。",
    });
  }

  return promises;
}

export function buildInitialStoryProgressState(now = nowIso()): StoryProgressState {
  return {
    latestChapter: 0,
    recentPrimaryDeltas: [],
    recentArenaKeys: [],
    recentObjectiveKeys: [],
    stuckDimensions: [],
    mustAdvance: ["situation_shift", "information_shift", "objective_shift"],
    recentAntagonistKeys: [],
    recentActionPatterns: [],
    recentEndingMoves: [],
    recentMechanismRevealModes: [],
    recentMotifWindows: [],
    consumedFutureBeats: [],
    updatedAt: now,
  };
}

function getPhysicalArenaHints(foundation: FoundationPayload) {
  const matches = foundation.worldview
    .map((item) => item.name.trim())
    .filter((item) => item && /山|林|谷|泽|渊|海|洞|崖|岭|原|墟|古地|遗迹|禁区|部族/u.test(item));

  // 从角色信息中提取额外地点关键词
  const charLocationPattern = /(?:在|于|来自|居住|镇守|把守|出没)([^\s，。、！？,.\n]{2,6}(?:山|林|谷|泽|渊|海|洞|崖|岭|原|墟|地|迹|区|寨|城|村|塔|殿|宫|阁))/gu;
  const extraLocations: string[] = [];
  for (const char of foundation.characters) {
    const text = [char.role, char.goal, ...(char.traits ?? [])].join(" ");
    for (const m of text.matchAll(charLocationPattern)) {
      if (m[1] && !matches.includes(m[1])) extraLocations.push(m[1]);
    }
  }
  const allMatches = unique([...matches, ...extraLocations]);

  if (allMatches.length >= 3) return allMatches;

  // 不足 3 个时，为每个 base 生成 5 个变体
  const base = allMatches[0] ?? "当前主场域";
  const variants = [
    `${base}外围`,
    `${base}深处`,
    `${base}地底通道`,
    `${base}高处`,
    `${base}边缘`,
  ];
  return unique([...allMatches, ...variants]);
}

function buildItemIntent(input: {
  chapterNo: number;
  delta: CoreProgressDeltaType;
  currentVolumeGoal: string;
  arena: string;
  protagonist: string;
  activations: GenreObligationPackActivation[];
}) {
  const mythic = hasPack(input.activations, "mythic_beastiary");
  const romance = hasPack(input.activations, "romance");

  switch (input.delta) {
    case "situation_shift":
      return mythic
        ? `让${input.protagonist}进入${input.arena}的新层面或新危险，不能继续停留在旧追逃循环里。`
        : `让${input.protagonist}在${input.arena}遭遇足以改写局面的新变化。`;
    case "objective_shift":
      return romance
        ? `让${input.protagonist}的关系目标发生偏转，新的选择必须影响后续行动。`
        : `让${input.protagonist}在${input.arena}被迫改写当前目标，不再只是把旧任务拖长。`;
    case "information_shift":
      return mythic
        ? `让${input.protagonist}在${input.arena}拿到会改写山海主线的新线索或新禁忌。`
        : `让${input.protagonist}获得会改变下一章行动的新信息。`;
    case "relationship_shift":
      return romance
        ? `让核心关系在这一章里发生实质变化，而不是只有情绪复读。`
        : `让${input.protagonist}与关键角色的立场或牵引关系发生变化。`;
    case "power_shift":
      return `让${input.protagonist}的资源、能力或控制权发生变化，并立刻带来新后果。`;
    case "world_shift":
      return mythic
        ? `让${input.arena}背后的更高层世界规则、古遗迹或巨兽生态真正往前显形。`
        : `让外部格局或世界规则往前抬一层。`;
    case "cost_shift":
      return `让${input.protagonist}付出明确代价，但不能只靠代价充当本章推进。`;
    default:
      return `围绕"${input.currentVolumeGoal}"继续推进本章。`;
  }
}

export function buildSegmentPlans(input: {
  startingChapter: number;
  segmentLength?: number;
  precomputeSegments?: number;
  currentVolumeGoal: string;
  endingPromise: string;
  foundation: FoundationPayload;
  activations: GenreObligationPackActivation[];
  existingPlans?: SegmentPlan[];
  trigger?: "seed" | "refresh";
  now?: string;
}) {
  const segmentLength = input.segmentLength ?? 6;
  const precomputeSegments = input.precomputeSegments ?? 2;
  const now = input.now ?? nowIso();
  const protagonist = input.foundation.characters[0]?.name?.trim() || "主角";
  const focusCharacters = input.foundation.characters.map((item) => item.name.trim()).filter(Boolean);
  const arenas = getPhysicalArenaHints(input.foundation);
  const arenaClusters = buildDefaultArenaClusters(input.foundation);
  const opponentClusters = buildDefaultOpponentClusters(input.foundation);
  const relationshipProgressions = buildDefaultRelationshipProgressions(input.foundation);
  const deltaSequence = resolveActiveProgressionAxes(input.activations);
  const nextPlans: SegmentPlan[] = [];
  const recentEffectiveItems = (input.existingPlans ?? [])
    .flatMap((segment) => segment.items ?? [])
    .map((item) => normalizeSegmentPlanItem(item))
    .sort((left, right) => left.chapterNo - right.chapterNo);

  for (let segmentIndex = 0; segmentIndex < precomputeSegments; segmentIndex += 1) {
    const startChapter = input.startingChapter + segmentIndex * segmentLength;
    const endChapter = startChapter + segmentLength - 1;
    const items: SegmentPlanItem[] = [];
    for (let offset = 0; offset < segmentLength; offset += 1) {
      const chapterNo = startChapter + offset;
      const delta = deltaSequence[offset % deltaSequence.length]!;
      const arenaIndex = (segmentIndex * segmentLength + offset) % arenas.length;
      let arena = arenas[arenaIndex]!;
      if (offset >= 3) {
        const prev1 = arenas[((segmentIndex * segmentLength + offset - 1) % arenas.length)]!;
        const prev2 = arenas[((segmentIndex * segmentLength + offset - 2) % arenas.length)]!;
        if (prev1 === arena && prev2 === arena) {
          arena = arenas[(arenaIndex + 1) % arenas.length]!;
        }
      }
      let arenaClusterId = defaultArenaClusterId(arena);
      if (offset >= 1) {
        const prevClusterId = defaultArenaClusterId(arenas[((segmentIndex * segmentLength + offset - 1) % arenas.length)]!);
        if (prevClusterId === arenaClusterId && arenaClusters.length > 1) {
          arenaClusterId = arenaClusters.find((entry) => entry.id !== prevClusterId)?.id ?? arenaClusterId;
          arena = arenaClusters.find((entry) => entry.id === arenaClusterId)?.hints[0] ?? arena;
        }
      }
      const actionIdx = (segmentIndex * segmentLength + offset) % ACTION_PATTERN_ROTATION.length;
      let suggestedAction = ACTION_PATTERN_ROTATION[actionIdx]!;
      if (offset > 0) {
        const prevAction = ACTION_PATTERN_ROTATION[((segmentIndex * segmentLength + offset - 1) % ACTION_PATTERN_ROTATION.length)]!;
        if (prevAction === suggestedAction) {
          suggestedAction = ACTION_PATTERN_ROTATION[(actionIdx + 1) % ACTION_PATTERN_ROTATION.length]!;
        }
      }
      const requiredObligations: string[] = [];
      if (hasPack(input.activations, "mythic_beastiary") && offset % 2 === 0) {
        requiredObligations.push("introduce_new_mythic_novelty");
      }
      if (hasPack(input.activations, "romance") && offset % 2 === 0) {
        requiredObligations.push("relationship_state_change");
      }

      // 从非主角角色中提取 antagonist 候选，按 offset 轮转分配
      const nonProtagonistCharacters = input.foundation.characters
        .slice(1)
        .map((c) => c.name?.trim())
        .filter(Boolean);
      let antagonistHint = nonProtagonistCharacters.length > 0
        ? nonProtagonistCharacters[offset % nonProtagonistCharacters.length]!
        : null;
      const currentAntagonistHint = antagonistHint ?? "";
      let opponentClusterId = antagonistHint
        ? opponentClusters.find((entry) => entry.hints.includes(currentAntagonistHint))?.id ?? "named_opponents"
        : "environment_rule";
      if (items.length >= 2) {
        const previousOpponentClusterIds = items.slice(-2).map((entry) => entry.opponentClusterId ?? "environment_rule");
        if (previousOpponentClusterIds.every((entry) => entry === opponentClusterId)) {
          opponentClusterId = opponentClusters.find((entry) => entry.id !== previousOpponentClusterIds[0])?.id ?? opponentClusterId;
          antagonistHint = opponentClusterId === "environment_rule" ? null : antagonistHint;
        }
      }
      const previousRewardType = items.at(-1)?.rewardType ?? null;
      const rewardType = avoidConsecutiveRewardType(inferRewardTypeIdForDelta(delta), previousRewardType);
      const relationshipBeatId = delta === "relationship_shift"
        ? relationshipProgressions[offset % Math.max(relationshipProgressions.length, 1)]?.id ?? null
        : null;

      // 从 existingPlans 的最后一个 segment 提取最近 3 章的 requiredProgressDeltas
      const forbiddenRecentAxes: CoreProgressDeltaType[] = [];
      if (recentEffectiveItems.length) {
        for (const prev of recentEffectiveItems.slice(-3)) {
          for (const d of (prev.requiredProgressDeltas ?? [])) {
            if (!forbiddenRecentAxes.includes(d)) forbiddenRecentAxes.push(d);
          }
        }
      }

      items.push({
        id: `segment-item-${chapterNo}`,
        chapterNo,
        title: `第 ${chapterNo} 章推进位`,
        intent: buildItemIntent({
          chapterNo,
          delta,
          currentVolumeGoal: input.currentVolumeGoal || input.endingPromise,
          arena,
          protagonist,
          activations: input.activations,
        }),
        narrativeTitle: null,
        narrativeIntent: null,
        narrativeSummary: null,
        arcConnection: null,
        nextHook: null,
        rewriteStatus: "pending",
        userOverridden: false,
        requiredProgressDeltas: [delta],
        requiredObligations,
        focusCharacters: unique([protagonist, focusCharacters[(offset + 1) % Math.max(focusCharacters.length, 1)]].filter(Boolean)),
        arenaHints: [arena],
        suggestedActionPattern: suggestedAction,
        antagonistHint,
        forbiddenRecentAxes,
        arenaClusterId,
        opponentClusterId,
        rewardType,
        relationshipBeatId,
      });
    }

    nextPlans.push({
      id: `segment-${startChapter}-${endChapter}`,
      label: `第 ${startChapter}-${endChapter} 章段落计划`,
      startChapter,
      endChapter,
      status: segmentIndex === 0 ? "active" : "queued",
      trigger: input.trigger ?? "seed",
      generatedAt: now,
      items,
    });
  }

  return nextPlans;
}

export function syncSegmentPlanStatuses(segmentPlans: SegmentPlan[], latestChapter: number) {
  return segmentPlans.map((segment) => {
    if (latestChapter >= segment.endChapter) {
      return { ...segment, status: "completed" as const };
    }
    if (latestChapter + 1 >= segment.startChapter && latestChapter < segment.endChapter) {
      return { ...segment, status: "active" as const };
    }
    return { ...segment, status: "queued" as const };
  });
}

export function getSegmentPlanItemForChapter(segmentPlans: SegmentPlan[], chapterNo: number) {
  for (const segment of segmentPlans) {
    const item = segment.items.find((entry) => entry.chapterNo === chapterNo);
    if (item) {
      return {
        segment,
        item: normalizeSegmentPlanItem(item),
      };
    }
  }
  return null;
}

export function deriveStoryProgressState(deltaRecords: ChapterDeltaRecord[], now = nowIso()): StoryProgressState {
  const ordered = [...deltaRecords].sort((left, right) => left.chapterNo - right.chapterNo);
  const recent = ordered.slice(-4);
  const recentArenas = ordered
    .slice(-3)
    .map((entry) => trimKey(entry.arenaKey))
    .filter(Boolean);
  const recentObjectives = ordered
    .slice(-3)
    .map((entry) => trimKey(entry.objectiveKey))
    .filter(Boolean);
  const recentAntagonistKeys = ordered
    .slice(-3)
    .map((entry) => trimKey(entry.antagonistKey))
    .filter(Boolean);
  const recentActionPatterns = ordered
    .slice(-3)
    .map((entry) => entry.actionPattern)
    .filter(Boolean) as ActionPattern[];
  const recentEndingMoves = ordered
    .slice(-3)
    .map((entry) => entry.endingMove)
    .filter(Boolean) as EndingMove[];
  const recentMechanismRevealModes = ordered
    .slice(-3)
    .map((entry) => entry.mechanismRevealMode)
    .filter(Boolean) as MechanismRevealMode[];
  const recentMotifWindows = ordered
    .slice(-3)
    .map((entry) => entry.motifTokens ?? []);
  const stuckDimensions = Array.from(new Set(recent.flatMap((entry) => entry.stuckDimensions ?? [])));
  const lastPrimary = recent.map((entry) => entry.primaryDeltaDelivered).filter(Boolean) as CoreProgressDeltaType[];

  let mustAdvance: CoreProgressDeltaType[];
  if (stuckDimensions.includes("combat_loop")) {
    mustAdvance = ["objective_shift", "world_shift", "information_shift"];
  } else if (stuckDimensions.includes("antagonist_loop")) {
    mustAdvance = ["relationship_shift", "objective_shift", "information_shift"];
  } else if (stuckDimensions.includes("action_loop")) {
    mustAdvance = ["situation_shift", "relationship_shift", "world_shift"];
  } else if (stuckDimensions.includes("arena_loop")) {
    mustAdvance = ["world_shift", "information_shift", "objective_shift"];
  } else if (stuckDimensions.includes("objective_loop")) {
    mustAdvance = ["objective_shift", "relationship_shift", "information_shift"];
  } else {
    mustAdvance = ["situation_shift", "information_shift", "objective_shift"];
  }

  return {
    latestChapter: ordered[ordered.length - 1]?.chapterNo ?? 0,
    recentPrimaryDeltas: lastPrimary,
    recentArenaKeys: recentArenas,
    recentObjectiveKeys: recentObjectives,
    stuckDimensions,
    mustAdvance,
    recentAntagonistKeys,
    recentActionPatterns,
    recentEndingMoves,
    recentMechanismRevealModes,
    recentMotifWindows,
    consumedFutureBeats: [],
    updatedAt: now,
  };
}

export function buildLoopRiskAssessment(input: {
  blueprint: Pick<ChapterBlueprint, "locations" | "sceneGoal" | "requiredProgressDelta"> & {
    conflicts?: string[] | null;
    actionPattern?: ActionPattern | null;
    antagonistHint?: string | null;
  };
  recentDeltaRecords: ChapterDeltaRecord[];
}) {
  const repetitionAxes: string[] = [];
  const stuckDimensions: string[] = [];
  const currentArena = buildArenaKey(input.blueprint);
  const currentObjective = buildObjectiveKey(input.blueprint);
  const currentAction = input.blueprint.actionPattern ?? inferActionPattern(input.blueprint);
  const currentAntagonist = input.blueprint.antagonistHint?.trim() || null;
  const recent = [...input.recentDeltaRecords].sort((left, right) => left.chapterNo - right.chapterNo).slice(-2);
  const recent3 = [...input.recentDeltaRecords].sort((left, right) => left.chapterNo - right.chapterNo).slice(-3);

  if (currentArena && recent.length >= 1 && normalizeArenaKey(recent.at(-1)?.arenaKey) === currentArena) {
    repetitionAxes.push("same_arena");
    stuckDimensions.push("arena_loop");
  }

  // arena_cluster_loop: 最近 4 章中有 3 章落在同一核心地名
  if (currentArena && recent3.length >= 2) {
    const allArenas = [...recent3.map((entry) => normalizeArenaKey(entry.arenaKey)), currentArena].filter(Boolean);
    const freq = new Map<string, number>();
    for (const a of allArenas) freq.set(a, (freq.get(a) ?? 0) + 1);
    for (const [, count] of freq) {
      if (count >= 3 && !stuckDimensions.includes("arena_loop")) {
        stuckDimensions.push("arena_loop");
        if (!repetitionAxes.includes("same_arena")) repetitionAxes.push("same_arena");
        repetitionAxes.push("arena_cluster");
        break;
      }
    }
  }

  if (currentObjective && recent.length === 2 && recent.every((entry) => trimKey(entry.objectiveKey) === currentObjective)) {
    repetitionAxes.push("same_objective");
    stuckDimensions.push("objective_loop");
  }

  if (input.blueprint.requiredProgressDelta === "cost_shift") {
    repetitionAxes.push("cost_only_progression");
    stuckDimensions.push("cost_only_progression");
  }

  if (
    currentAction
    && recent.length === 2
    && recent.every((entry) => (entry.actionPattern ?? null) === currentAction)
    && repetitionAxes.includes("same_arena")
    && repetitionAxes.includes("same_objective")
  ) {
    repetitionAxes.push("same_action_pattern");
    stuckDimensions.push("action_loop");
  }

  if (
    currentAntagonist
    && recent3.length >= 2
    && recent3.slice(-2).every((entry) => trimKey(entry.antagonistKey) === currentAntagonist)
  ) {
    repetitionAxes.push("same_antagonist");
    stuckDimensions.push("antagonist_loop");
  }

  if (
    currentAction
    && (currentAction === "combat" || currentAction === "pursuit")
    && repetitionAxes.includes("same_arena")
    && currentAntagonist
    && recent.some((entry) => trimKey(entry.antagonistKey) === currentAntagonist || normalizeArenaKey(entry.arenaKey) === currentArena)
    && input.blueprint.requiredProgressDelta === "power_shift"
  ) {
    if (!stuckDimensions.includes("combat_loop")) {
      stuckDimensions.push("combat_loop");
    }
  }

  const recentEndingMoves = recent
    .map((entry) => entry.endingMove)
    .filter(Boolean) as EndingMove[];
  if (
    recentEndingMoves.length === 2
    && recentEndingMoves.every((m) => m === "explicit_summary" || m === "emotional_close")
  ) {
    repetitionAxes.push("ending_summary_loop");
    stuckDimensions.push("ending_summary_loop");
  }

  const recentMechanisms = recent
    .map((entry) => entry.mechanismRevealMode)
    .filter(Boolean) as MechanismRevealMode[];
  if (
    recentMechanisms.length === 2
    && recentMechanisms.every((m) => m === "explicit_summary" || m === "triad")
  ) {
    repetitionAxes.push("mechanism_summary_loop");
    stuckDimensions.push("mechanism_summary_loop");
  }

  const risk: LoopRiskAssessment["risk"] =
    stuckDimensions.includes("antagonist_loop")
      ? "risk"
      : stuckDimensions.length >= 2 || stuckDimensions.includes("cost_only_progression") || stuckDimensions.includes("combat_loop")
        ? "risk"
        : stuckDimensions.length
          ? "watch"
          : "pass";
  const score = risk === "pass" ? 85 : risk === "watch" ? 58 : 28;

  return {
    risk,
    score,
    summary:
      risk === "pass"
        ? "最近章节没有明显重复轴。"
        : risk === "watch"
          ? "最近章节开始重复同一场域或同一目标，需要强制改线。"
          : "最近章节已经形成明显的拖长循环，必须强制改线。",
    repetitionAxes,
    stuckDimensions,
  } satisfies LoopRiskAssessment;
}

export function buildDefaultRuntimeReviewSignals(primaryDelta: CoreProgressDeltaType | null = null) {
  const loopRisk = {
    risk: "pass",
    score: 85,
    summary: "最近章节没有明显重复轴。",
    repetitionAxes: [],
    stuckDimensions: [],
  } satisfies LoopRiskAssessment;

  const storyProgression = {
    risk: primaryDelta && primaryDelta !== "cost_shift" ? "pass" : "watch",
    score: primaryDelta && primaryDelta !== "cost_shift" ? 80 : 60,
    summary:
      primaryDelta && primaryDelta !== "cost_shift"
        ? "当前章节已绑定主推进位。"
        : "当前章节尚未绑定明确主推进位，默认按观察项记录。",
    advancements: primaryDelta ? [CORE_DELTA_DESCRIPTIONS[primaryDelta]] : [],
    stallSignals: primaryDelta ? [] : ["missing_primary_delta"],
    primaryDelta,
    deliveredDeltas: primaryDelta ? [primaryDelta] : [],
  } satisfies StoryProgressionAssessment;

  return {
    storyProgression,
    genreFulfillment: null,
    loopRisk,
    primaryDeltaDelivered: primaryDelta,
    stuckDimensions: loopRisk.stuckDimensions,
  };
}

export function buildGenreFulfillmentAssessment(input: {
  blueprint: Pick<ChapterBlueprint, "sceneGoal" | "characters" | "locations" | "conflicts" | "foreshadows" | "requiredProgressDelta">;
  activations: GenreObligationPackActivation[];
}) {
  const activePackIds = input.activations.filter((entry) => entry.active).map((entry) => entry.id);
  if (!activePackIds.length || (activePackIds.length === 1 && activePackIds[0] === "core-only")) {
    return null;
  }

  const merged = [
    input.blueprint.sceneGoal,
    ...input.blueprint.characters,
    ...input.blueprint.locations,
    ...input.blueprint.conflicts,
    ...input.blueprint.foreshadows,
  ].join(" ");
  const present: string[] = [];
  const missing: string[] = [];

  if (activePackIds.includes("mythic_beastiary")) {
    if (MYTHIC_SIGNAL_PATTERN.test(merged) || input.blueprint.requiredProgressDelta === "world_shift") {
      present.push("出现新的异兽/怪地/禁忌生态或更高山海层级");
    } else {
      missing.push("缺少新的异兽、怪地、禁忌生态或山海层级抬升");
    }
  }

  if (activePackIds.includes("romance")) {
    if (ROMANCE_SIGNAL_PATTERN.test(merged) || input.blueprint.requiredProgressDelta === "relationship_shift") {
      present.push("关系张力或情感立场出现实质变化");
    } else {
      missing.push("缺少关系变化，只像在重复情绪或互动表面");
    }
  }

  const risk: GenreFulfillmentAssessment["risk"] =
    missing.length === 0 ? "pass" : present.length ? "watch" : "risk";
  const score = risk === "pass" ? 82 : risk === "watch" ? 60 : 30;

  return {
    risk,
    score,
    summary:
      risk === "pass"
        ? "本章题材履约明确。"
        : risk === "watch"
          ? "本章题材履约有痕迹，但还不够实。"
          : "本章题材履约缺失，容易退回通用打斗或空转。",
    present,
    missing,
    activePacks: activePackIds,
  } satisfies GenreFulfillmentAssessment;
}

export function buildStoryProgressionAssessment(input: {
  blueprint: Pick<ChapterBlueprint, "requiredProgressDelta">;
  loopRisk: LoopRiskAssessment;
}) {
  const deliveredDeltas = input.blueprint.requiredProgressDelta ? [input.blueprint.requiredProgressDelta] : [];
  const stallSignals = [...input.loopRisk.stuckDimensions];
  if (!input.blueprint.requiredProgressDelta) {
    stallSignals.push("missing_primary_delta");
  }
  if (input.blueprint.requiredProgressDelta === "cost_shift") {
    stallSignals.push("cost_only_progression");
  }

  const risk: StoryProgressionAssessment["risk"] =
    !input.blueprint.requiredProgressDelta || input.blueprint.requiredProgressDelta === "cost_shift" || input.loopRisk.risk === "risk"
      ? "risk"
      : input.loopRisk.risk === "watch"
        ? "watch"
        : "pass";
  const score = risk === "pass" ? 84 : risk === "watch" ? 61 : 26;
  const advancements = input.blueprint.requiredProgressDelta
    ? [CORE_DELTA_DESCRIPTIONS[input.blueprint.requiredProgressDelta]]
    : [];

  return {
    risk,
    score,
    summary:
      risk === "pass"
        ? "本章具备明确主推进位。"
        : risk === "watch"
          ? "本章有推进位，但最近重复轴开始累积。"
          : "本章缺少有效主推进位，或仍在拖长旧冲突。",
    advancements,
    stallSignals,
    primaryDelta: input.blueprint.requiredProgressDelta ?? null,
    deliveredDeltas,
  } satisfies StoryProgressionAssessment;
}

export function assessBlueprintProgressRisk(input: {
  blueprint: ChapterBlueprint;
  recentDeltaRecords: ChapterDeltaRecord[];
  activations: GenreObligationPackActivation[];
  mustAdvance: CoreProgressDeltaType[];
}) {
  const notes: string[] = [];
  let score = 0;

  if (!input.blueprint.requiredProgressDelta) {
    score += 4;
    notes.push("蓝图缺少 requiredProgressDelta，说明本章没有被显式绑定到主推进位。");
  } else if (input.blueprint.requiredProgressDelta === "cost_shift") {
    score += 4;
    notes.push("requiredProgressDelta 不能只写 cost_shift；代价只能附带，不能单独充当主推进。");
  } else if (input.mustAdvance.length && !input.mustAdvance.includes(input.blueprint.requiredProgressDelta)) {
    score += 2;
    notes.push(`最近章节已经卡在 ${input.mustAdvance.join(" / ")} 维度，本章应优先改推这些维度之一。`);
  }

  const loopRisk = buildLoopRiskAssessment({
    blueprint: input.blueprint,
    recentDeltaRecords: input.recentDeltaRecords,
  });
  if (loopRisk.risk === "watch") {
    score += 2;
    notes.push("当前蓝图与最近章节重复同一场域或同一目标，已经出现循环迹象。");
  } else if (loopRisk.risk === "risk") {
    score += 4;
    notes.push("当前蓝图仍在延续已形成的循环轴，必须改线。");
  }

  const genreFulfillment = buildGenreFulfillmentAssessment({
    blueprint: input.blueprint,
    activations: input.activations,
  });
  if (genreFulfillment?.risk === "watch") {
    score += 1;
    notes.push("当前蓝图的题材履约还不够实，容易退回通用冲突模板。");
  } else if (genreFulfillment?.risk === "risk") {
    score += 3;
    notes.push("当前蓝图没有兑现激活中的题材包义务。");
  }

  const severity: "ok" | "warn" | "fail" = score >= 5 ? "fail" : score >= 2 ? "warn" : "ok";
  return {
    severity,
    score,
    notes,
    shouldRepair: severity !== "ok",
    loopRisk,
    genreFulfillment,
    storyProgression: buildStoryProgressionAssessment({
      blueprint: input.blueprint,
      loopRisk,
    }),
  };
}

export function buildChapterDeltaRecord(input: {
  projectId: string;
  chapterNo: number;
  blueprint: ChapterBlueprint;
  activations: GenreObligationPackActivation[];
  recentDeltaRecords: ChapterDeltaRecord[];
  chapterContent?: string | null;
  createdAt?: string;
}) {
  const loopRisk = buildLoopRiskAssessment({
    blueprint: input.blueprint,
    recentDeltaRecords: input.recentDeltaRecords,
  });
  const storyProgression = buildStoryProgressionAssessment({
    blueprint: input.blueprint,
    loopRisk,
  });
  const genreFulfillment = buildGenreFulfillmentAssessment({
    blueprint: input.blueprint,
    activations: input.activations,
  });

  return {
    id: `delta-${input.projectId}-${input.chapterNo}`,
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    segmentId: input.blueprint.segmentId ?? null,
    segmentItemId: input.blueprint.segmentItemId ?? null,
    primaryDeltaDelivered: input.blueprint.requiredProgressDelta ?? null,
    deliveredDeltas: storyProgression.deliveredDeltas,
    storyProgression,
    genreFulfillment,
    loopRisk,
    stuckDimensions: loopRisk.stuckDimensions,
    arenaKey: buildArenaKey(input.blueprint),
    arenaClusterId: input.blueprint.arenaClusterId ?? buildArenaKey(input.blueprint),
    objectiveKey: buildObjectiveKey(input.blueprint),
    antagonistKey: input.blueprint.antagonistHint?.trim() || null,
    opponentClusterId: input.blueprint.opponentClusterId ?? (input.blueprint.antagonistHint?.trim() || null),
    rewardType: input.blueprint.rewardType ?? (input.blueprint.requiredProgressDelta ? inferRewardTypeIdForDelta(input.blueprint.requiredProgressDelta) : null),
    actionPattern: input.blueprint.actionPattern ?? inferActionPattern(input.blueprint),
    endingMove: inferEndingMove(input.blueprint),
    mechanismRevealMode: inferMechanismRevealMode(input.blueprint),
    motifTokens: extractMotifTokens(
      input.chapterContent?.trim()
        ? input.chapterContent
        : [
          input.blueprint.sceneGoal,
          ...input.blueprint.conflicts,
          ...input.blueprint.foreshadows,
          ...input.blueprint.locations,
        ].join(" "),
    ),
    obligationHits: genreFulfillment?.present ?? [],
    summary: storyProgression.summary,
    createdAt: input.createdAt ?? nowIso(),
  } satisfies ChapterDeltaRecord;
}

export function buildStructuredAvoidanceList(progress: StoryProgressState): StructuredAvoidanceList {
  const humanReadable: string[] = [];
  const stuckDimensions = progress.stuckDimensions ?? [];
  const recentArenaKeys = progress.recentArenaKeys ?? [];
  const recentObjectiveKeys = progress.recentObjectiveKeys ?? [];
  const recentAntagonistKeys = progress.recentAntagonistKeys ?? [];
  const recentActionPatterns = progress.recentActionPatterns ?? [];
  const recentEndingMoves = progress.recentEndingMoves ?? [];
  const recentMechanismRevealModes = progress.recentMechanismRevealModes ?? [];
  const recentMotifWindows = progress.recentMotifWindows ?? [];

  // arena: 无条件下发，分级
  const avoidArenaKeys = [...new Set(recentArenaKeys)];
  const avoidArenaClusters = [...new Set(avoidArenaKeys.map((entry) => normalizeArenaKey(entry)).filter(Boolean))];
  const arenaIsHard = stuckDimensions.includes("arena_loop");

  // objective: 保持门控（objective 重复通常需要 detector 确认）
  const avoidObjectiveKeys = stuckDimensions.includes("objective_loop")
    ? [...new Set(recentObjectiveKeys)]
    : [];

  // antagonist: 无条件下发，分级
  const avoidAntagonistKeys = [...new Set(recentAntagonistKeys)];
  const avoidOpponentClusters = [...new Set(avoidAntagonistKeys)];
  const antagonistIsHard = stuckDimensions.includes("antagonist_loop");
  const avoidRewardTypes: string[] = [];

  // action: 无条件下发最近连续同值，分级
  const avoidActionPatterns: ActionPattern[] = [...new Set(recentActionPatterns)];
  const actionIsHard = stuckDimensions.includes("action_loop") || stuckDimensions.includes("combat_loop");

  // 判断最近 2 项是否连续同值（用于建议级回避）
  const hasConsecutiveArena = recentArenaKeys.length >= 2
    && normalizeArenaKey(recentArenaKeys.at(-1)) === normalizeArenaKey(recentArenaKeys.at(-2));
  const hasConsecutiveAntagonist = recentAntagonistKeys.length >= 2
    && recentAntagonistKeys.at(-1) === recentAntagonistKeys.at(-2);
  const hasConsecutiveAction = recentActionPatterns.length >= 2
    && recentActionPatterns.at(-1) === recentActionPatterns.at(-2);

  const avoidEndingMoves: EndingMove[] = stuckDimensions.includes("ending_summary_loop")
    ? [...new Set(recentEndingMoves)]
    : [];
  const avoidMechanismModes: MechanismRevealMode[] = stuckDimensions.includes("mechanism_summary_loop")
    ? [...new Set(recentMechanismRevealModes)]
    : [];
  const avoidMotifTokens: string[] = [];
  if (recentMotifWindows.length >= 2) {
    const flat = recentMotifWindows.flat();
    const freq = new Map<string, number>();
    for (const t of flat) freq.set(t, (freq.get(t) ?? 0) + 1);
    for (const [token, count] of freq) {
      if (count >= 2) avoidMotifTokens.push(token);
    }
  }

  if (avoidArenaKeys.length) {
    const prefix = arenaIsHard ? "【硬性禁止】" : hasConsecutiveArena ? "【建议回避】" : "";
    if (prefix) humanReadable.push(`${prefix}不要再把本章主场景压回「${avoidArenaKeys.join("、")}」同一场域。`);
  }
  if (avoidObjectiveKeys.length) humanReadable.push(`【硬性禁止】不要继续围着「${avoidObjectiveKeys.join("、")}」同一目标打转。`);
  if (avoidAntagonistKeys.length) {
    const prefix = antagonistIsHard ? "【硬性禁止】" : hasConsecutiveAntagonist ? "【建议回避】" : "";
    if (prefix) humanReadable.push(`${prefix}不要让「${avoidAntagonistKeys.join("、")}」继续充当唯一对手。`);
  }
  if (avoidActionPatterns.length) {
    const prefix = actionIsHard ? "【硬性禁止】" : hasConsecutiveAction ? "【建议回避】" : "";
    if (prefix) humanReadable.push(`${prefix}不要再重复 ${avoidActionPatterns.join("、")} 类行动模式。`);
  }
  if (avoidEndingMoves.length) humanReadable.push(`章末不能再用 ${avoidEndingMoves.join("、")} 收尾。`);
  if (avoidMechanismModes.length) humanReadable.push(`机制揭示不能再用 ${avoidMechanismModes.join("、")} 模式。`);
  if (avoidMotifTokens.length) humanReadable.push(`避免反复使用意象词：${avoidMotifTokens.join("、")}。`);
  if (stuckDimensions.includes("combat_loop")) {
    humanReadable.push("不能继续在同地进行 combat/pursuit + power_shift 循环。");
  }
  if (stuckDimensions.includes("cost_only_progression")) {
    humanReadable.push("不要只靠受伤、硬撑、逃命或付代价来充当本章推进。");
  }

  return {
    avoidArenaKeys,
    avoidArenaClusters,
    avoidObjectiveKeys,
    avoidAntagonistKeys,
    avoidOpponentClusters,
    avoidRewardTypes,
    avoidActionPatterns,
    avoidEndingMoves,
    avoidMechanismModes,
    avoidMotifTokens,
    humanReadable,
  };
}
