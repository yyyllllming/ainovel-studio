import "../server-only.ts";

import { notFound } from "../errors.ts";
import { nanoid } from "nanoid";
import { detectContextConflicts } from "../story/canon.ts";
import { readFinalChapter, readForeshadowLedgerStateMap, readLatestLogicStateSnapshot, selectContextCharacterSnapshots } from "../project-files.ts";
import { appendRunStatistic } from "../repositories/run.repository.ts";
import { buildContextKeywords } from "../repositories/project.repository.ts";
import { getChapterPlan, listChapterPlans } from "../repositories/chapter-plan.repository.ts";
import { getBlueprint, getFoundation } from "../repositories/foundation.repository.ts";
import { getProject, listActiveSteeringNotes } from "../repositories/project.repository.ts";
import { listCardProgressions, listCards } from "../repositories/card.repository.ts";
import { listStyleDeltaNotes, saveConflictRecords, searchCanonFacts, searchSummaries } from "../repositories/review.repository.ts";
import { saveContextPack } from "../repositories/review.repository.ts";
import type {
  CharacterCard,
  ChapterBlueprint,
  ChapterPlan,
  CharacterSnapshot,
  ContextBudgetBreakdown,
  ContextPack,
  FoundationPayload,
  LogicStateSnapshot,
  StoryContract,
  WorldRule,
} from "../types.ts";
import {
  buildActiveThreadEntries,
  buildCharacterStateEntries,
  buildSceneSteeringNotes,
} from "../story/story-memory.ts";
import { deriveObligationCards } from "../content/structure-engine.ts";
import { readProjectVoiceSnapshot } from "../content/project-voice-snapshot.service.ts";
import { buildStoryContractSummary, getCurrentMilestone, getCurrentVolumeGoal } from "../story/story-contract.ts";
import { buildLorebookPack } from "../story/story-lorebook.ts";
import {
  buildStructuredAvoidanceList,
  getSegmentSkeletonIntent,
  getSegmentSkeletonTitle,
  getSegmentDisplayIntent,
  getSegmentPlanItemForChapter,
} from "../story/story-progression.ts";
import {
  buildHookDiagnosticPlannerNotes,
  buildHookDiagnosticsSummaryLine,
} from "../story/hook-diagnostics.ts";
import { buildFallbackStyleProfile, normalizeStyleProfile } from "../style/style-steering.ts";
import { estimateModelTokens } from "../text-metrics.ts";
import { unique } from "../utils.ts";
import { buildIntegratedWritingDna } from "../writing/writing-dna.ts";

const TOTAL_BUDGET = 128_000;

export function getDefaultBudget(): ContextBudgetBreakdown {
  return {
    systemRules: Math.round(TOTAL_BUDGET * 0.05),
    styleCard: Math.round(TOTAL_BUDGET * 0.1),
    characterCards: Math.round(TOTAL_BUDGET * 0.15),
    dynamicFacts: Math.round(TOTAL_BUDGET * 0.1),
    historySummaries: Math.round(TOTAL_BUDGET * 0.2),
    currentDraft: Math.round(TOTAL_BUDGET * 0.2),
    outputReserve: Math.round(TOTAL_BUDGET * 0.2),
  };
}

function trimToBudget(entries: string[], budget: number) {
  const output: string[] = [];
  let total = 0;
  for (const entry of entries) {
    const cost = estimateModelTokens(entry);
    if (total + cost > budget) {
      break;
    }
    output.push(entry);
    total += cost;
  }
  return output;
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function buildCompactStoryLines(storyContract: StoryContract | null | undefined, chapterNo: number) {
  if (!storyContract) {
    return {
      currentMilestoneLine: null,
      currentSegmentIntentLine: null,
      nextHookLine: null,
    };
  }

  const currentMilestone = getCurrentMilestone(storyContract, chapterNo);
  const currentBinding = getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo);
  const currentMilestoneLine = currentMilestone
    ? `当前里程碑：${currentMilestone.goal || currentMilestone.label}`
    : null;
  const currentSegmentIntentLine = currentBinding
    ? `当前段落意图：${getSegmentDisplayIntent(currentBinding.item)}`
    : null;
  const nextHookLine = currentBinding?.item.nextHook?.trim()
    ? `下一扣钩子：${currentBinding.item.nextHook.trim()}`
    : null;

  return {
    currentMilestoneLine,
    currentSegmentIntentLine,
    nextHookLine,
  };
}

function mergeForeshadowRecallEntries(input: {
  ledgerStates: Map<string, {
    status: string;
    timestamp: string;
    chapterNo: number;
  }>;
  recalledFacts: Array<{
    id: string;
    chapterNo: number;
    content: string;
    metadata: Record<string, unknown>;
    timestamp: string;
  }>;
}) {
  return input.recalledFacts.map((fact) => {
    const ledger = input.ledgerStates.get(fact.content);
    return {
      id: fact.id,
      chapterNo: fact.chapterNo,
      content: fact.content,
      status: String(ledger?.status ?? fact.metadata.status ?? "active"),
      timestamp: String(ledger?.timestamp ?? fact.timestamp),
    };
  });
}

function pickCharacterCards(foundation: FoundationPayload, blueprint: ChapterBlueprint) {
  const primary = foundation.characters.filter((character) =>
    blueprint.characters.includes(character.name),
  );
  const byMention = foundation.characters.filter((character) =>
    blueprint.conflicts.some((item) => item.includes(character.name)) ||
    blueprint.foreshadows.some((item) => item.includes(character.name)),
  );
  const openingFallback = blueprint.chapterNo <= 3 ? foundation.characters.slice(0, 4) : [];
  return dedupeByName([...primary, ...byMention, ...openingFallback]).slice(0, 5);
}

function pickWorldCards(foundation: FoundationPayload, blueprint: ChapterBlueprint) {
  const direct = foundation.worldview.filter((rule) =>
    blueprint.locations.some((location) => rule.name.includes(location) || rule.description.includes(location)),
  );
  const topical = foundation.worldview.filter((rule) =>
    blueprint.sceneGoal.includes(rule.name) || blueprint.conflicts.some((item) => item.includes(rule.name)),
  );
  const coreRules = foundation.worldview.filter((rule) =>
    /灵纹|血脉|天赋|反噬|代价|追猎|部族|禁区|兽道/u.test(`${rule.name}${rule.description}`),
  );
  const openingFallback = blueprint.chapterNo <= 3 ? foundation.worldview.slice(0, 5) : [];
  return dedupeWorld([...direct, ...topical, ...coreRules, ...openingFallback]).slice(0, 5);
}

function dedupeByName(items: CharacterCard[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

function dedupeWorld(items: WorldRule[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

function summarizePreviousChapterState(snapshot: CharacterSnapshot | null, focusNames: string[]) {
  if (!snapshot) {
    return "上一章结束状态：暂无角色状态快照。";
  }

  const lines = focusNames
    .slice(0, 3)
    .map((name) => {
      const state = snapshot.characters[name];
      if (!state) {
        return "";
      }
      const parts = [
        state.location ? `位置=${state.location}` : "",
        state.currentGoal ? `目标=${state.currentGoal}` : "",
        state.currentPressure ? `压力=${state.currentPressure}` : "",
        state.emotion ? `情绪=${state.emotion}` : "",
        state.injuries?.length ? `伤势=${state.injuries.slice(0, 2).join("、")}` : "",
      ].filter(Boolean);
      return parts.length ? `${name}：${parts.join("；")}` : "";
    })
    .filter(Boolean);

  return lines.length ? `上一章结束状态：${lines.join(" | ")}` : "上一章结束状态：暂无核心角色状态更新。";
}

function buildAvoidanceList(storyContract: StoryContract | null | undefined) {
  if (!storyContract) {
    return { lines: [] as string[], structured: null };
  }

  const progress = storyContract.progressState;
  const structured = buildStructuredAvoidanceList(progress);
  const lines = structured.humanReadable.length
    ? structured.humanReadable
    : [];

  if (!lines.length) {
    const latestArena = progress.recentArenaKeys?.at(-1);
    if (latestArena) {
      lines.push(`若沿用「${latestArena}」，必须改写局面、目标或规则层级，不能只换措辞。`);
    }
  }

  return { lines: uniqueNonEmpty(lines), structured };
}

function buildHookDiagnosticWriterNotes(logicState: LogicStateSnapshot | null | undefined) {
  const diagnostics = logicState?.hookDiagnostics;
  if (!diagnostics) {
    return [] as string[];
  }

  return diagnostics.items
    .filter((item) => item.setupState === "missing" || item.overdue || item.dead || item.duplicateOfHookPlanId)
    .slice(0, 3)
    .map((item) => {
      if (item.setupState === "missing") {
        return `Hook核销提醒：第${item.setupChapter}章计划埋下「${item.setupText}」但当前没有稳定 setup evidence。`;
      }
      if (item.dead) {
        return `Hook生命周期提醒：第${item.setupChapter}章的「${item.setupText}」已经超窗且连续悬挂，需决定回收或取消追踪。`;
      }
      if (item.overdue) {
        return `Hook生命周期提醒：第${item.setupChapter}章的「${item.setupText}」已超过预计回收窗口。`;
      }
      if (item.duplicateOfHookPlanId) {
        return `Hook重复提醒：第${item.setupChapter}章的「${item.setupText}」与更早 hook 高度相似，避免重复设钩。`;
      }
      return "";
    })
    .filter(Boolean);
}

export function buildFutureContext(input: {
  storyContract: StoryContract | null | undefined;
  chapterNo: number;
}) {
  const storyContract = input.storyContract;
  if (!storyContract) {
    return { text: "【本章之后的叙事要求】暂无后续段落计划。", structured: null };
  }

  const current = getSegmentPlanItemForChapter(storyContract.segmentPlans, input.chapterNo);
  const next = getSegmentPlanItemForChapter(storyContract.segmentPlans, input.chapterNo + 1)?.item ?? null;
  const nextNext = getSegmentPlanItemForChapter(storyContract.segmentPlans, input.chapterNo + 2)?.item ?? null;
  const avoidance = buildAvoidanceList(storyContract);

  const sections: string[] = ["【本章之后的叙事要求】"];
  if (current) {
    sections.push(
      `当前段落：${current.segment.label} / ${getSegmentSkeletonTitle(current.item)}`,
      `本章必推：${current.item.requiredProgressDeltas?.join("、") ?? ""}`,
    );
  }
  if (next) {
    sections.push(
      `【下一章（第${next.chapterNo}章）】`,
      `标题：${getSegmentSkeletonTitle(next)}`,
      `意图：${getSegmentSkeletonIntent(next)}`,
      `必须推进：${next.requiredProgressDeltas?.join("、") ?? ""}`,
      next.focusCharacters?.length ? `聚焦角色：${next.focusCharacters?.join("、") ?? ""}` : "",
      next.arenaHints?.length ? `场景提示：${next.arenaHints?.join("、") ?? ""}` : "",
      next.requiredObligations?.length ? `题材义务：${next.requiredObligations?.join("、") ?? ""}` : "",
      next.nextHook?.trim() ? `下一扣：${next.nextHook.trim()}` : "",
    );
  }
  if (nextNext) {
    sections.push(
      `【下下章（第${nextNext.chapterNo}章）的伏笔要求】`,
      `后续意图：${getSegmentSkeletonIntent(nextNext)}`,
      `需要预埋：${nextNext.requiredProgressDeltas?.map((delta) => `与「${delta}」相关的线索或后患`).join("；") ?? ""}`,
    );
  }
  if (avoidance.lines.length) {
    sections.push("【本章不要做什么】", ...avoidance.lines.map((item) => `- ${item}`));
  }

  return { text: sections.filter(Boolean).join("\n"), structured: avoidance.structured };
}

export function buildObligationCardDeck(input: {
  storyContract: StoryContract | null | undefined;
  chapterNo: number;
  futureContextText: string;
}) {
  const current = input.storyContract
    ? getSegmentPlanItemForChapter(input.storyContract.segmentPlans, input.chapterNo)?.item ?? null
    : null;
  return deriveObligationCards({
    chapterNo: input.chapterNo,
    futureContext: input.futureContextText.split("\n").map((line) => line.trim()).filter(Boolean),
    nextSegmentIntent:
      (() => {
        const nextItem = getSegmentPlanItemForChapter(input.storyContract?.segmentPlans ?? [], input.chapterNo + 1)?.item ?? null;
        if (nextItem) {
          return getSegmentSkeletonIntent(nextItem);
        }
        return current ? getSegmentSkeletonIntent(current) : "";
      })(),
    requiredObligations: current?.requiredObligations ?? [],
  });
}

export function buildPlannerContextSummary(input: {
  foundation: FoundationPayload;
  storyContract: StoryContract | null | undefined;
  chapterNo: number;
  previousBriefSummary: string | null;
  previousDetailedSummary: string | null;
  latestSnapshot: CharacterSnapshot | null;
  logicState: LogicStateSnapshot | null;
  currentChapterPlan?: ChapterPlan | null;
  recentChapterPlansSummary?: string[];
  previousContinuationAnchor?: string | null;
}) {
  const activePacks = input.storyContract?.genreObligationPacks
    .filter((entry) => entry.active)
    .map((entry) => entry.id)
    .join("、") || "core-only";
  const currentBinding = input.storyContract
    ? getSegmentPlanItemForChapter(input.storyContract.segmentPlans, input.chapterNo)
    : null;
  const focusNames = uniqueNonEmpty([
    ...(currentBinding?.item?.focusCharacters ?? []),
    ...input.foundation.characters.slice(0, 3).map((item) => item.name),
  ]);
  const previousSummary = input.previousDetailedSummary || input.previousBriefSummary || "上一章实际发生：暂无摘要。";
  const pendingConsequences = input.logicState?.pendingConsequences?.slice(0, 2).join("；") || "无";
  const unresolvedPromises = input.logicState?.unresolvedPromises
    ?.filter((item) => item.status === "open")
    .slice(0, 2)
    .map((item) => item.description)
    .join("；") || "无";
  const hookSummary = buildHookDiagnosticsSummaryLine(input.logicState?.hookDiagnostics);
  const hookNotes = buildHookDiagnosticPlannerNotes({
    diagnostics: input.logicState?.hookDiagnostics,
    maxItems: 3,
  });
  const recentChapterPlansSummary = input.recentChapterPlansSummary?.filter(Boolean).slice(-3) ?? [];

  return [
    `当前章节：第 ${input.chapterNo} 章`,
    `激活题材包：${activePacks}`,
    input.currentChapterPlan ? `当前章主任务：${input.currentChapterPlan.purpose}` : "",
    currentBinding ? `当前段落意图：${getSegmentSkeletonIntent(currentBinding.item)}` : "当前段落意图：无",
    currentBinding ? `本章必推 delta：${currentBinding.item.requiredProgressDeltas?.join("、") ?? ""}` : "本章必推 delta：无",
    input.previousContinuationAnchor ? `上一章 continuationAnchor：${input.previousContinuationAnchor}` : "",
    `上一章实际发生：${previousSummary}`,
    summarizePreviousChapterState(input.latestSnapshot, focusNames),
    `待延续后果：${pendingConsequences}`,
    `未回收承诺：${unresolvedPromises}`,
    hookSummary,
    hookNotes.length ? `Hook关注项：${hookNotes.join(" || ")}` : "",
    input.currentChapterPlan ? `本章章末承接：${input.currentChapterPlan.continuationAnchor}` : "",
    recentChapterPlansSummary.length ? `最近章节规划摘要：${recentChapterPlansSummary.join(" || ")}` : "",
  ].join("\n");
}

export async function assembleContextPack(projectId: string, chapterNo: number) {
  const [project, foundation, blueprint] = [
    getProject(projectId),
    getFoundation(projectId),
    getBlueprint(projectId, chapterNo),
  ];

  if (!project) {
    throw notFound("项目不存在");
  }
  if (!foundation) {
    throw new Error("设定尚未生成");
  }
  if (!blueprint) {
    throw new Error("请先生成章节蓝图");
  }

  const breakdown = getDefaultBudget();
  const storyContract = project.storyContract ?? null;
  const chapterPlan = getChapterPlan(projectId, chapterNo);
  const previousChapterPlan = chapterNo > 1 ? getChapterPlan(projectId, chapterNo - 1) : null;
  const recentChapterPlans = listChapterPlans(projectId)
    .filter((plan) => plan.chapterNo < chapterNo && plan.status === "ready")
    .slice(-3)
    .map((plan) => `第${plan.chapterNo}章 | plot=${plan.plotSummary} | nextHook=${plan.nextHook}`);
  const currentSegmentBinding = storyContract
    ? getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo)
    : null;
  const compactStoryLines = buildCompactStoryLines(storyContract, chapterNo);
  const query = buildContextKeywords(project, blueprint, foundation, storyContract);
  const facts = searchCanonFacts(projectId, query, chapterNo, 10, {
    beforeChapter: chapterNo,
  });
  const foreshadowFacts = searchCanonFacts(projectId, query, chapterNo, 8, {
    beforeChapter: chapterNo,
    types: ["foreshadow"],
  });
  const summaries = searchSummaries(projectId, query, chapterNo);
  const [foreshadowLedgerStates, snapshots, previousChapter, cards, progressions, logicState] = await Promise.all([
    readForeshadowLedgerStateMap(projectId, foreshadowFacts.map((fact) => fact.content)),
    selectContextCharacterSnapshots({
      projectId,
      uptoChapterNo: chapterNo,
      focusCharacters: uniqueNonEmpty([
        ...blueprint.characters,
        ...(currentSegmentBinding?.item.focusCharacters ?? []),
      ]),
      recentWindow: 5,
    }),
    chapterNo > 1 ? readFinalChapter(projectId, chapterNo - 1) : Promise.resolve(null),
    Promise.resolve(listCards(projectId)),
    Promise.resolve(listCardProgressions(projectId, { uptoChapterNo: chapterNo })),
    readLatestLogicStateSnapshot(projectId, { uptoChapterNo: chapterNo }),
  ]);
  const recalledForeshadows = mergeForeshadowRecallEntries({
    ledgerStates: foreshadowLedgerStates,
    recalledFacts: foreshadowFacts,
  });
  const conflicts = detectContextConflicts({
    chapterNo,
    blueprint,
    facts,
    foreshadows: recalledForeshadows,
    segmentItem: currentSegmentBinding?.item ?? null,
  }).map((conflict) => ({
    ...conflict,
    id: conflict.id || nanoid(),
  }));
  appendRunStatistic(projectId, chapterNo, "conflict", {
    hardConflictCount: conflicts.filter((conflict) => conflict.severity === "hard").length,
    softConflictCount: conflicts.filter((conflict) => conflict.severity === "soft").length,
    conflictTypes: unique(conflicts.map((conflict) => conflict.type)),
  });

  const requiredCards = pickCharacterCards(foundation, blueprint);
  const worldviewCards = pickWorldCards(foundation, blueprint);
  const styleProfile = normalizeStyleProfile(
    foundation.styleProfile ?? buildFallbackStyleProfile({
      references: [],
      draft: {
        mainline: "",
        desiredTone: project.style,
        storyHook: "",
      },
      worldContext: foundation.worldview.map((item) => `${item.name}:${item.description}`).join("；"),
    }),
  );
  const characterStates = buildCharacterStateEntries({
    blueprint,
    foundation,
    snapshots,
    currentChapter: chapterNo,
  });
  const activeThreads = buildActiveThreadEntries({
    blueprint,
    foreshadows: recalledForeshadows,
    currentChapter: chapterNo,
  });
  const lorebook = buildLorebookPack({
    blueprint,
    cards,
    progressions,
    previousChapterExcerpt: previousChapter ? previousChapter.slice(-1800) : null,
    summaryTexts: summaries.map((entry) => entry.content),
    activeThreads,
  });
  const sceneSteeringNotes = buildSceneSteeringNotes({
    currentChapter: chapterNo,
    characterStates,
    activeThreads,
    conflicts,
  });
  const activeSteeringNotes = listActiveSteeringNotes(projectId, chapterNo).map((note) => `追加要求(${note.scope})：${note.instruction}`);
  const recentStyleDeltaNotes = listStyleDeltaNotes(projectId, { limit: 10, accepted: true })
    .flatMap((entry) => entry.notes.slice(0, 2).map((note) => `最近通过风格备注：${note}`));
  const writingDna = buildIntegratedWritingDna({
    genre: project.genre,
    premise: foundation.premise,
    styleProfile,
    foundation,
    blueprint,
  });
  const storyContractSummary = project.storyContract
    ? buildStoryContractSummary(project.storyContract)
    : "暂无 story contract，按当前设定保守推进。";
  const currentVolumeGoal = project.storyContract
    ? getCurrentVolumeGoal(project.storyContract)
    : project.completionCriteria;
  const completionProgress = project.storyContract
    ? `${Math.round(project.storyContract.forecast.completionProgress * 100)}%`
    : "0%";
  const previousBriefSummary = summaries.find((entry) => entry.chapterNo === chapterNo - 1 && entry.level === "brief")?.content ?? null;
  const previousDetailedSummary =
    summaries.find((entry) => entry.chapterNo === chapterNo - 1 && entry.level === "detailed")?.content ?? null;
  const plannerContextSummary = buildPlannerContextSummary({
    foundation,
    storyContract: project.storyContract,
    chapterNo,
    previousBriefSummary,
    previousDetailedSummary,
    latestSnapshot: snapshots[0] ?? null,
    logicState,
    currentChapterPlan: chapterPlan,
    recentChapterPlansSummary: recentChapterPlans,
    previousContinuationAnchor: previousChapterPlan?.continuationAnchor ?? null,
  });
  const futureResult = buildFutureContext({
    storyContract: project.storyContract,
    chapterNo,
  });
  const futureContext = futureResult.text;
  const structuredAvoidance = futureResult.structured;
  const obligationCards = buildObligationCardDeck({
    storyContract: project.storyContract,
    chapterNo,
    futureContextText: futureContext,
  });
  const projectVoiceSnapshot = await readProjectVoiceSnapshot(projectId).catch(() => null); // voice snapshot is optional enhancement

  const recentFullChapters = trimToBudget(
    summaries.filter((entry) => entry.level === "full").map((entry) => entry.content),
    Math.round(breakdown.historySummaries * 0.55),
  );
  const detailedSummaries = trimToBudget(
    summaries.filter((entry) => entry.level === "detailed").map((entry) => entry.content),
    Math.round(breakdown.historySummaries * 0.3),
  );
  const briefSummaries = trimToBudget(
    summaries.filter((entry) => entry.level === "brief").map((entry) => entry.content),
    Math.round(breakdown.historySummaries * 0.15),
  );

  const writerNotes = uniqueNonEmpty([
    compactStoryLines.currentMilestoneLine,
    compactStoryLines.currentSegmentIntentLine,
    compactStoryLines.nextHookLine,
  ])
    .concat(conflicts
      .filter((conflict) => conflict.severity === "soft")
      .map((conflict) => `软冲突提醒：${conflict.message}`))
    .concat(sceneSteeringNotes)
    .concat(buildHookDiagnosticWriterNotes(logicState))
    .concat(activeSteeringNotes)
    .concat(recentStyleDeltaNotes)
    .concat(logicState?.timeMarker ? [`当前时间标记：${logicState.timeMarker}`] : [])
    .concat((logicState?.pendingConsequences ?? []).map((item) => `待延续后果：${item}`))
    .concat((logicState?.unresolvedPromises ?? [])
      .filter((item) => item.status === "open")
      .map((item) => `未回收承诺：${item.description}`));

  const pack: ContextPack = {
    totalTokens: TOTAL_BUDGET,
    breakdown,
    blueprint,
    chapterPlan,
    recentChapterPlans,
    previousContinuationAnchor: previousChapterPlan?.continuationAnchor ?? null,
    styleCard: foundation.styleCard,
    styleProfile,
    writingDna,
    projectPremise: foundation.premise,
    previousChapterTail: previousChapter ? previousChapter.slice(-1600).trim() : null,
    storyContractSummary,
    currentVolumeGoal,
    completionProgress,
    activeSteeringNotes,
    requiredCards,
    worldviewCards,
    summaryWindow: {
      recentFullChapters,
      detailedSummaries,
      briefSummaries,
    },
    memory: {
      characterStates,
      activeThreads,
      sceneSteeringNotes,
      relationshipDeltas: logicState?.relationshipDeltas ?? [],
      timeMarker: logicState?.timeMarker ?? "",
      unresolvedPromises: logicState?.unresolvedPromises ?? [],
      pendingConsequences: logicState?.pendingConsequences ?? [],
      hookDiagnostics: logicState?.hookDiagnostics ?? null,
    },
    lorebook,
    facts,
    conflicts,
    writerNotes: writerNotes.concat(
      lorebook.entries.slice(0, 6).map((entry) => `Lorebook[${entry.title}] ${entry.content}`),
    ),
    currentMilestoneLine: compactStoryLines.currentMilestoneLine,
    currentSegmentIntentLine: compactStoryLines.currentSegmentIntentLine,
    nextHookLine: compactStoryLines.nextHookLine,
    plannerContextSummary,
    futureContext,
    structuredAvoidance: structuredAvoidance ?? undefined,
    obligationCards,
    projectVoiceSnapshot,
  };

  saveContextPack(projectId, chapterNo, pack);
  saveConflictRecords(projectId, chapterNo, conflicts);
  return pack;
}
