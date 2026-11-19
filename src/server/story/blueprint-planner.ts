import { assessBlueprintFocusRisk } from "./chapter-steering.ts";
export { buildPlannerAvoidanceDirectives } from "./story-seed-patch.ts";
import { resolveSegmentRuntimeMetadata } from "./story-seed-patch.ts";
import { assessBlueprintProgressRisk, buildStructuredAvoidanceList, normalizeArenaKey } from "./story-progression.ts";
import type {
  ActionPattern,
  BlueprintCandidateAttempt,
  BlueprintVerification,
  ChapterBlueprint,
  ChapterDeltaRecord,
  CoreProgressDeltaType,
  DiversityRequirements,
  FoundationPayload,
  GenreObligationPackActivation,
  PlannerAvoidanceDirectives,
  PlannerQualitySummary,
  ProjectStorySeedPatch,
  SegmentPlan,
  SegmentPlanItem,
  StoryContract,
  StoryProgressState,
  StructuredAvoidanceList,
} from "../types.ts";
import { unique } from "../utils.ts";

const GENERIC_SCENE_GOAL_PATTERN = /^(推进|发展|继续|进行|展开|围绕)|活下来|带出去|撑住/u;
const GENERIC_SCENE_TOKENS = ["推进", "发展", "继续", "进行", "活下来", "带出去", "逃命", "追逃", "打斗", "机缘"];
const PATTERN_LABELS = ["打斗拖长", "同地追逃", "机缘空壳", "sceneGoal 太泛", "同一目标打转"] as const;
const CONCRETE_MYTHIC_SIGNAL_PATTERN = /异兽|巨兽|古地|禁区|祭痕|祭台|遗迹|药精|灵药|禁忌|部族|山海|夔|鼋|鲲|鹏|蛟|龙|怪地|活藤|活植/u;
const CONCRETE_ROMANCE_SIGNAL_PATTERN = /对视|试探|疏离|靠拢|婚约|误会|承诺|心软|信任|背叛|立场|关系/u;

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function collectSceneGoalTerms(sceneGoal: string) {
  const goal = normalizeText(sceneGoal);
  return GENERIC_SCENE_TOKENS.filter((token) => goal.includes(token));
}

function detectPrimaryConflictType(conflicts: string[]) {
  const merged = conflicts.join(" ");
  if (/打|扑|杀|追兵|正面/u.test(merged)) {
    return "正面打斗";
  }
  if (/逃|脱身|躲|夺路/u.test(merged)) {
    return "追逃拖长";
  }
  if (/试探|判断|犹豫|抉择|决定/u.test(merged)) {
    return "内在取舍";
  }
  if (/关系|信任|立场|对视|谈判/u.test(merged)) {
    return "关系对抗";
  }
  if (/禁忌|规则|异动|回响|遗迹|古地/u.test(merged)) {
    return "规则/世界阻力";
  }
  return "未分类冲突";
}

function futureHookCompleteness(input: {
  blueprint: ChapterBlueprint;
  nextItem: SegmentPlanItem | null;
  nextNextItem: SegmentPlanItem | null;
}) {
  const merged = [
    input.blueprint.sceneGoal,
    ...input.blueprint.conflicts,
    ...input.blueprint.foreshadows,
    ...input.blueprint.locations,
    ...input.blueprint.characters,
  ].join(" ");
  let score = 0;

  if (input.nextItem) {
    const nextSignals = [
      input.nextItem.intent,
      ...(input.nextItem.focusCharacters ?? []),
      ...(input.nextItem.arenaHints ?? []),
      ...(input.nextItem.requiredProgressDeltas ?? []),
    ].filter(Boolean);
    if (nextSignals.some((signal) => merged.includes(signal))) {
      score += 1;
    }
  }

  if (input.nextNextItem) {
    const futureSignals = [
      ...(input.nextNextItem.requiredProgressDeltas ?? []),
      ...(input.nextNextItem.requiredObligations ?? []),
      ...(input.nextNextItem.focusCharacters ?? []),
    ].filter(Boolean);
    if (futureSignals.some((signal) => merged.includes(signal))) {
      score += 1;
    }
  }

  return score;
}

function hasConcretePackSignal(input: {
  blueprint: ChapterBlueprint;
  activations: GenreObligationPackActivation[];
}) {
  const merged = [
    input.blueprint.sceneGoal,
    ...input.blueprint.characters,
    ...input.blueprint.locations,
    ...input.blueprint.conflicts,
    ...input.blueprint.foreshadows,
  ].join(" ");

  const activePackIds = input.activations.filter((entry) => entry.active).map((entry) => entry.id);
  const needsMythic = activePackIds.includes("mythic_beastiary");
  const needsRomance = activePackIds.includes("romance");

  return {
    mythic: !needsMythic || CONCRETE_MYTHIC_SIGNAL_PATTERN.test(merged) || input.blueprint.requiredProgressDelta === "world_shift",
    romance: !needsRomance || CONCRETE_ROMANCE_SIGNAL_PATTERN.test(merged) || input.blueprint.requiredProgressDelta === "relationship_shift",
  };
}

export function verifyBlueprintCandidate(input: {
  blueprint: ChapterBlueprint;
  segmentBinding: { segment: SegmentPlan; item: SegmentPlanItem } | null;
  nextItem: SegmentPlanItem | null;
  nextNextItem: SegmentPlanItem | null;
  mustAdvance: CoreProgressDeltaType[];
  activations: GenreObligationPackActivation[];
  recentDeltaRecords: ChapterDeltaRecord[];
}) {
  const hardReasons: string[] = [];
  const softReasons: string[] = [];
  let score = 0;

  // --- 硬性检查：这些不过会直接导致 AI 味 ---

  const sceneGoal = normalizeText(input.blueprint.sceneGoal);
  if (sceneGoal.length < 15 || GENERIC_SCENE_GOAL_PATTERN.test(sceneGoal)) {
    hardReasons.push("sceneGoal 太泛，不像可直接开写的具体场景目标。");
  } else {
    score += 1;
  }

  if (!input.blueprint.requiredProgressDelta) {
    hardReasons.push("缺少 requiredProgressDelta。");
  } else if (
    input.mustAdvance.length
    && !input.mustAdvance.includes(input.blueprint.requiredProgressDelta)
    && input.blueprint.requiredProgressDelta === "cost_shift"
  ) {
    hardReasons.push("requiredProgressDelta 仍落在 cost_shift，不能单独作为主推进。");
  } else {
    score += 1;
  }

  if (!input.blueprint.conflicts.length || input.blueprint.conflicts.every((entry) => normalizeText(entry).length < 8)) {
    hardReasons.push("conflicts 为空或过空。");
  } else {
    score += 1;
  }

  const focusRisk = assessBlueprintFocusRisk(input.blueprint);
  const progressionRisk = assessBlueprintProgressRisk({
    blueprint: input.blueprint,
    recentDeltaRecords: input.recentDeltaRecords,
    activations: input.activations,
    mustAdvance: input.mustAdvance,
  });

  // focusRisk: fail 级是硬拒（sceneGoal 占位、地点占位等直接导致 AI 味），warn 级降为软性
  if (focusRisk.severity === "fail") {
    hardReasons.push(...focusRisk.notes.slice(0, 2));
  } else if (focusRisk.shouldRepair) {
    softReasons.push(...focusRisk.notes.slice(0, 2));
    score += 1; // warn 级仍给分，不一票否决
  } else {
    score += 1;
  }

  // progressionRisk: loop risk 是硬性拦截
  if (progressionRisk.shouldRepair) {
    hardReasons.push(...progressionRisk.notes.slice(0, 2));
  } else {
    score += 1;
  }

  // --- 软性检查：记录但不阻断 pass ---

  const hookScore = futureHookCompleteness({
    blueprint: input.blueprint,
    nextItem: input.nextItem,
    nextNextItem: input.nextNextItem,
  });
  if (hookScore === 0 && (input.nextItem || input.nextNextItem)) {
    softReasons.push("缺少对下一章或下下章的明确承接钩子。");
  } else if (hookScore > 0) {
    score += 1;
  }

  const concretePackSignals = hasConcretePackSignal({
    blueprint: input.blueprint,
    activations: input.activations,
  });

  if (
    input.activations.some((entry) => entry.active && entry.id !== "core-only")
    && progressionRisk.genreFulfillment?.risk === "risk"
  ) {
    softReasons.push(
      input.segmentBinding?.item?.requiredObligations?.length
        ? "未兑现当前段落要求的题材义务。"
        : "当前激活题材包没有被兑现，题材义务仍然落空。",
    );
  }
  if (!concretePackSignals.mythic) {
    softReasons.push("题材义务仍然偏空：缺少新的异兽、怪地、禁忌生态或更高山海层级。");
  }
  if (!concretePackSignals.romance) {
    softReasons.push("题材义务仍然偏空：关系状态、立场或情感目标没有出现实质变化。");
  }

  // pass 条件：零硬性 reason + score >= 3（原来是 reasons===0 + score>=4）
  const reasons = [...hardReasons, ...softReasons];

  return {
    pass: hardReasons.length === 0 && score >= 3,
    score,
    reasons: unique(reasons),
    futureHookCompleteness: hookScore,
    loopRiskScore:
      progressionRisk.loopRisk.risk === "pass"
        ? 2
        : progressionRisk.loopRisk.risk === "watch"
          ? 1
          : 0,
    obligationScore:
      progressionRisk.genreFulfillment?.risk === "pass"
        ? 2
        : progressionRisk.genreFulfillment?.risk === "watch"
          ? 1
          : progressionRisk.genreFulfillment
            ? 0
            : 1,
  } satisfies BlueprintVerification;
}

export function buildDiversityRequirements(
  existingCandidates: ChapterBlueprint[],
  verifierResults: BlueprintVerification[],
  segmentItem: SegmentPlanItem | null,
  structuredAvoidance?: StructuredAvoidanceList | null,
) {
  const bannedConflictTypes = unique(existingCandidates.map((candidate) => detectPrimaryConflictType(candidate.conflicts)));
  const bannedSceneGoalTerms = unique(existingCandidates.flatMap((candidate) => collectSceneGoalTerms(candidate.sceneGoal)));
  const bannedLocations = unique(existingCandidates.flatMap((candidate) => candidate.locations.map((location) => normalizeText(location))));
  const avoidPatterns = unique(
    verifierResults.flatMap((result) =>
      PATTERN_LABELS.filter((label) => result.reasons.some((reason) => reason.includes(label))),
    ),
  );

  const dominantFocus = unique(existingCandidates.map((candidate) => normalizeText(candidate.characters[0])));
  const requiredFocusCharacter =
    segmentItem?.focusCharacters?.find((name) => !dominantFocus.includes(normalizeText(name)))
    ?? segmentItem?.focusCharacters?.[0]
    ?? null;

  const promptLines = [
    bannedConflictTypes.length ? `主冲突类型不能再重复：${bannedConflictTypes.join("、")}` : "",
    bannedSceneGoalTerms.length ? `sceneGoal 不能再复用这些空词或核心词：${bannedSceneGoalTerms.join("、")}` : "",
    bannedLocations.length ? `arena 不能再落回这些地点：${bannedLocations.join("、")}` : "",
    requiredFocusCharacter ? `必须突出「${requiredFocusCharacter}」的视角或主受压位置。` : "",
    avoidPatterns.length ? `必须避开这些已判空壳模式：${avoidPatterns.join("、")}` : "",
  ].filter(Boolean);

  if (structuredAvoidance) {
    if (structuredAvoidance.avoidActionPatterns.length) {
      promptLines.push(`行动模式不能再重复：${structuredAvoidance.avoidActionPatterns.join("、")}`);
    }
    if (structuredAvoidance.avoidAntagonistKeys.length) {
      promptLines.push(`对手不能继续由「${structuredAvoidance.avoidAntagonistKeys.join("、")}」独占。`);
    }
    if (structuredAvoidance.avoidEndingMoves.length) {
      promptLines.push(`章末收束不能再用：${structuredAvoidance.avoidEndingMoves.join("、")}`);
    }
    if (structuredAvoidance.avoidMechanismModes.length) {
      promptLines.push(`机制揭示模式不能再用：${structuredAvoidance.avoidMechanismModes.join("、")}`);
    }
    if (structuredAvoidance.avoidMotifTokens.length) {
      promptLines.push(`避免反复使用意象词：${structuredAvoidance.avoidMotifTokens.join("、")}`);
    }
  }

  return {
    bannedConflictTypes,
    bannedSceneGoalTerms,
    bannedLocations,
    avoidPatterns,
    requiredFocusCharacter,
    promptLines,
  } satisfies DiversityRequirements;
}

export function buildRecoveryBlueprint(input: {
  chapterNo: number;
  foundation: FoundationPayload;
  segmentBinding: { segment: SegmentPlan; item: SegmentPlanItem } | null;
  nextItem?: SegmentPlanItem | null;
  nextNextItem?: SegmentPlanItem | null;
  leadCharacterName: string;
  currentVolumeGoal: string;
  estimatedWords: number;
  defaultProgressDelta: CoreProgressDeltaType;
  progressState?: StoryProgressState | null;
  recentDeltaRecords?: ChapterDeltaRecord[];
  plannerAvoidance?: PlannerAvoidanceDirectives | null;
  seedPatch?: ProjectStorySeedPatch | null;
  storyContract?: StoryContract | null;
}) {
  const item = input.segmentBinding?.item ?? null;
  const currentRuntimeMetadata = item
    ? resolveSegmentRuntimeMetadata({
      item,
      patch: input.seedPatch,
      storyContract: input.storyContract,
    })
    : null;
  const nextRuntimeMetadata = input.nextItem
    ? resolveSegmentRuntimeMetadata({
      item: input.nextItem,
      patch: input.seedPatch,
      storyContract: input.storyContract,
    })
    : null;
  const nextNextRuntimeMetadata = input.nextNextItem
    ? resolveSegmentRuntimeMetadata({
      item: input.nextNextItem,
      patch: input.seedPatch,
      storyContract: input.storyContract,
    })
    : null;
  const progressState = input.progressState;
  const stuckDims = progressState?.stuckDimensions ?? [];
  const lastArena = progressState?.recentArenaKeys.at(-1);
  const lastAction = progressState?.recentActionPatterns.at(-1);
  const lastAntagonist = progressState?.recentAntagonistKeys.at(-1);
  const shouldBorrowFutureBeat = (
    candidateItem: SegmentPlanItem | null | undefined,
    candidateMetadata: typeof currentRuntimeMetadata,
  ) => {
    if (!item || !candidateItem || !candidateMetadata || !currentRuntimeMetadata) {
      return false;
    }
    let changedAxes = 0;
    if (candidateMetadata.arenaClusterId && candidateMetadata.arenaClusterId !== currentRuntimeMetadata.arenaClusterId) {
      changedAxes += 1;
    }
    if (candidateMetadata.opponentClusterId && candidateMetadata.opponentClusterId !== currentRuntimeMetadata.opponentClusterId) {
      changedAxes += 1;
    }
    if (candidateMetadata.rewardType && candidateMetadata.rewardType !== currentRuntimeMetadata.rewardType) {
      changedAxes += 1;
    }
    return changedAxes >= 2 && (stuckDims.includes("arena_loop") || stuckDims.includes("antagonist_loop") || stuckDims.includes("objective_loop"));
  };
  const recoveryItem = shouldBorrowFutureBeat(input.nextItem, nextRuntimeMetadata)
    ? input.nextItem!
    : shouldBorrowFutureBeat(input.nextNextItem, nextNextRuntimeMetadata)
      ? input.nextNextItem!
      : item;
  const runtimeMetadata = recoveryItem
    ? resolveSegmentRuntimeMetadata({
      item: recoveryItem,
      patch: input.seedPatch,
      storyContract: input.storyContract,
    })
    : null;

  let anchorLocation =
    recoveryItem?.arenaHints?.[0]
    ?? input.foundation.worldview.find((entry) => /山|谷|海|泽|渊|禁区|遗迹|古地/u.test(entry.name))?.name
    ?? "当前主场域";
  // 无论 stuckDims 如何，只要最近场域相同就尝试更换
  if (lastArena && normalizeArenaKey(anchorLocation) === normalizeArenaKey(lastArena)) {
    anchorLocation =
      input.foundation.worldview.find((entry) =>
        /山|谷|海|泽|渊|禁区|遗迹|古地/u.test(entry.name) && normalizeArenaKey(entry.name) !== normalizeArenaKey(lastArena)
      )?.name ?? `${anchorLocation}深处`;
  }

  let requiredDelta = recoveryItem?.requiredProgressDeltas?.[0] ?? input.defaultProgressDelta;
  if (stuckDims.includes("combat_loop") && requiredDelta === "power_shift") {
    requiredDelta = progressState?.mustAdvance[0] ?? "objective_shift";
  }
  if (progressState?.mustAdvance.length && !progressState.mustAdvance.includes(requiredDelta)) {
    requiredDelta = progressState.mustAdvance[0]!;
  }

  let actionPattern: ActionPattern | undefined;
  if (recoveryItem?.suggestedActionPattern) {
    actionPattern = recoveryItem.suggestedActionPattern;
  }
  if (stuckDims.includes("action_loop") || stuckDims.includes("combat_loop")) {
    if (lastAction && actionPattern === lastAction) {
      actionPattern = lastAction === "combat" ? "investigation" : "discovery";
    }
    if (!actionPattern && lastAction) {
      actionPattern = lastAction === "combat" ? "investigation" : "discovery";
    }
  }

  let antagonistHint: string | undefined;
  if (recoveryItem?.antagonistHint) {
    antagonistHint = recoveryItem.antagonistHint;
  }
  // 无论 stuckDims 如何，只要和最近对手相同就清除
  if (lastAntagonist && antagonistHint === lastAntagonist) {
    antagonistHint = undefined;
  }

  const characters = unique([
    input.leadCharacterName,
    ...(recoveryItem?.focusCharacters ?? []),
    ...input.foundation.characters.slice(1, 3).map((character) => character.name),
  ]).filter(Boolean);
  const obligations = recoveryItem?.requiredObligations?.length
    ? recoveryItem.requiredObligations?.join("、") ?? ""
    : "本章核心阻力";

  // 无论 stuckDimensions 是否为空，都从 recentDeltaRecords 提取回避信息
  const recentRecords = input.recentDeltaRecords ?? [];
  const recentArenas: string[] = [];
  const recentAntagonists: string[] = [];
  for (const rec of recentRecords.slice(-2)) {
    if (rec.arenaKey) recentArenas.push(normalizeArenaKey(rec.arenaKey));
    if (rec.antagonistKey) recentAntagonists.push(rec.antagonistKey.trim());
  }

  // 构建 avoidance 人类可读指令
  const avoidanceLines: string[] = [];
  if (progressState) {
    const structuredAvoidance = buildStructuredAvoidanceList(progressState);
    avoidanceLines.push(...structuredAvoidance.humanReadable);
  }
  if (input.plannerAvoidance?.promptLines?.length) {
    avoidanceLines.push(...input.plannerAvoidance.promptLines);
  }
  if (recentArenas.length && !avoidanceLines.some((l) => l.includes("场域"))) {
    avoidanceLines.push(`【建议回避】最近 2 章场域为「${[...new Set(recentArenas)].join("、")}」，本章应更换场景。`);
  }
  if (recentAntagonists.length && !avoidanceLines.some((l) => l.includes("对手"))) {
    avoidanceLines.push(`【建议回避】最近 2 章对手为「${[...new Set(recentAntagonists)].join("、")}」，本章应更换对手。`);
  }

  // sceneGoal 追加 avoidance 指令
  const avoidanceSuffix = avoidanceLines.length
    ? `\n回避要求：${avoidanceLines.join("；")}`
    : "";
  const repeatedAxisLabel = stuckDims.length ? stuckDims.join("、") : "旧循环轴";
  const rewardLabel = runtimeMetadata?.rewardType
    ?? (requiredDelta === "information_shift"
      ? "线索"
      : requiredDelta === "objective_shift"
        ? "通行权"
        : requiredDelta === "world_shift"
          ? "规则认知"
          : requiredDelta === "relationship_shift"
            ? "关系变化"
            : requiredDelta === "power_shift"
              ? "资源"
              : "新债务");
  const concreteIntent = recoveryItem?.intent
    ? recoveryItem.intent.replace(/^让[^，。；]*?/u, "").replace(/[。！；]+$/u, "")
    : input.currentVolumeGoal.replace(/[。！；]+$/u, "");

  // 提取最近冲突模式摘要
  const recentConflictSummary = recentRecords.slice(-2)
    .map((rec) => rec.summary ?? "")
    .filter(Boolean)
    .join("；");

  const recoveryShifts: string[] = [];
  if (runtimeMetadata?.arenaClusterId && runtimeMetadata.arenaClusterId !== currentRuntimeMetadata?.arenaClusterId) {
    recoveryShifts.push(`arena:${currentRuntimeMetadata?.arenaClusterId ?? "none"}->${runtimeMetadata.arenaClusterId}`);
  }
  if (runtimeMetadata?.opponentClusterId && runtimeMetadata.opponentClusterId !== currentRuntimeMetadata?.opponentClusterId) {
    recoveryShifts.push(`opponent:${currentRuntimeMetadata?.opponentClusterId ?? "none"}->${runtimeMetadata.opponentClusterId}`);
  }
  if (runtimeMetadata?.rewardType && runtimeMetadata.rewardType !== currentRuntimeMetadata?.rewardType) {
    recoveryShifts.push(`reward:${currentRuntimeMetadata?.rewardType ?? "none"}->${runtimeMetadata.rewardType}`);
  }
  if (recoveryItem?.id && recoveryItem.id !== item?.id) {
    recoveryShifts.push(`consume:${recoveryItem.id}`);
  }

  const blueprint = {
    chapterNo: input.chapterNo,
    sceneGoal: `${input.leadCharacterName}要在${anchorLocation}先撬开新的${rewardLabel}入口，具体兑现「${concreteIntent || input.currentVolumeGoal}」，并立刻打破最近卡住的${repeatedAxisLabel}。${avoidanceSuffix}`,
    characters,
    locations: [anchorLocation],
    conflicts: [
      recoveryItem
        ? `这章的阻力必须逼着${input.leadCharacterName}为「${concreteIntent || recoveryItem.intent}」付出立即代价，并兑现 ${obligations}。`
        : `这章的阻力必须逼着${input.leadCharacterName}为「${input.currentVolumeGoal}」付出立即代价，不能只把旧冲突拖长。`,
      `本章必须直接打破旧循环轴：${repeatedAxisLabel}。`,
      ...(recentConflictSummary
        ? [`不许重复最近 2 章的同一冲突模式：${recentConflictSummary}`]
        : []),
    ],
    foreshadows: [
      recoveryItem?.requiredProgressDeltas?.length
        ? `章末只留一个后患：把下一章会被迫兑现的「${recoveryItem.requiredProgressDeltas?.join("、") ?? ""}」压出来。`
        : `章末只留一个后患：让"${input.currentVolumeGoal}"的下一层压力显形。`,
    ],
    emotionalTone: "压低声势，逐步绷紧",
    estimatedWords: input.estimatedWords,
    segmentId: input.segmentBinding?.segment.id ?? null,
    segmentItemId: recoveryItem?.id ?? null,
    requiredProgressDelta: requiredDelta,
    actionPattern,
    antagonistHint,
    arenaClusterId: runtimeMetadata?.arenaClusterId ?? null,
    opponentClusterId: runtimeMetadata?.opponentClusterId ?? null,
    rewardType: runtimeMetadata?.rewardType ?? null,
    relationshipBeatId: runtimeMetadata?.relationshipBeatId ?? null,
  } satisfies ChapterBlueprint;

  return {
    blueprint,
    recoveryShifts,
  };
}

export function buildPlannerQualitySummary(input: {
  candidateAttempts: BlueprintCandidateAttempt[];
  selectedScore: number | null;
  selectedReason: string;
  repairUsed: boolean;
  fallbackUsed: boolean;
  usedRecoveryBlueprint?: boolean;
}) {
  return {
    candidateAttempts: input.candidateAttempts.length,
    selectedScore: input.selectedScore,
    selectedReason: input.selectedReason,
    repairUsed: input.repairUsed,
    fallbackUsed: input.fallbackUsed,
    usedRecoveryBlueprint: input.usedRecoveryBlueprint ?? input.fallbackUsed,
    failureReasons: unique(
      input.candidateAttempts.flatMap((attempt) => attempt.verification?.reasons ?? []),
    ),
  } satisfies PlannerQualitySummary;
}
