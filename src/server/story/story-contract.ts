import { nowIso } from "../utils.ts";
import type {
  FoundationPayload,
  Milestone,
  MilestoneStatus,
  StoryContract,
  StoryContractVolume,
  StoryContinuationDecision,
} from "../types.ts";
import type { ChapterPlanningMode, StoryLength } from "../domain/project-structure.ts";
import {
  buildDefaultStoryPromises,
  buildDefaultArenaClusters,
  buildDefaultOpponentClusters,
  buildDefaultRelationshipProgressions,
  buildDefaultRewardTypes,
  buildInitialStoryProgressState,
  normalizeSegmentPlanItem,
  resolveActiveProgressionAxes,
  suggestGenreObligationPacks,
  syncSegmentPlanStatuses,
} from "./story-progression.ts";

interface StoryContractSeedInput {
  title: string;
  genre: string;
  premise: string;
  chapterPlanningMode: ChapterPlanningMode;
  storyLength: StoryLength;
  plannedVolumes: number | null;
  chapterBudgetMin: number;
  chapterBudgetTarget: number;
  chapterBudgetMax: number;
  hardChapterCap: number;
  completionCriteria: string;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function distributeBudget(total: number, count: number) {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function normalizeMilestoneStatus(status: unknown): MilestoneStatus {
  return status === "active" || status === "completed" ? status : "planned";
}

function normalizeVolumeMilestones(volume: StoryContractVolume) {
  return (volume.milestones ?? []).map((milestone, index) => ({
    id: milestone.id?.trim() || `${volume.volumeNo}-milestone-${index + 1}`,
    label: milestone.label?.trim() || `第 ${index + 1} 个里程碑`,
    goal: milestone.goal?.trim() || milestone.label?.trim() || `推进${volume.label}`,
    expectedChapterStart:
      typeof milestone.expectedChapterStart === "number" && Number.isFinite(milestone.expectedChapterStart)
        ? milestone.expectedChapterStart
        : null,
    expectedChapterEnd:
      typeof milestone.expectedChapterEnd === "number" && Number.isFinite(milestone.expectedChapterEnd)
        ? milestone.expectedChapterEnd
        : null,
    status: normalizeMilestoneStatus(milestone.status),
    notes: milestone.notes?.trim() ?? "",
  } satisfies Milestone));
}

function buildVolumeGoal(index: number, total: number, completionCriteria: string) {
  if (total === 1) {
    return completionCriteria;
  }
  if (index === 0) {
    return "建立人物关系、核心规则与第一层主线冲突。";
  }
  if (index === total - 1) {
    return `回收关键伏笔并兑现完结承诺：${completionCriteria}`;
  }
  return "升级矛盾、扩张代价，并把主线推向下一层转折。";
}

function normalizeProgressState(contract: StoryContract) {
  const base = contract.progressState ?? buildInitialStoryProgressState();
  return {
    ...buildInitialStoryProgressState(base.updatedAt),
    ...base,
    consumedFutureBeats: base.consumedFutureBeats ?? [],
  };
}

function normalizeSegmentPlans(contract: StoryContract, latestChapter: number) {
  const plans = (contract.segmentPlans ?? []).map((segment) => ({
    ...segment,
    items: (segment.items ?? []).map((item) => normalizeSegmentPlanItem(item)),
  }));
  return syncSegmentPlanStatuses(plans, latestChapter);
}

function normalizeVolumes(contract: StoryContract) {
  return (contract.volumes ?? []).map((volume) => ({
    ...volume,
    milestones: normalizeVolumeMilestones(volume),
  }));
}

export function calculateCompletionProgress(currentChapter: number, contract: StoryContract, hardChapterCap: number) {
  if (currentChapter >= hardChapterCap) {
    return 1;
  }

  const target = Math.max(1, contract.forecast.target);
  const base = clamp01(currentChapter / target);
  const adjusted = contract.forecast.finalRunReady ? Math.max(base, 0.92) : Math.max(base, 0.05);
  return Math.min(1, Math.round(adjusted * 100) / 100);
}

export function buildFallbackStoryContract(input: StoryContractSeedInput): StoryContract {
  const genreObligationPacks = suggestGenreObligationPacks({
    genre: input.genre,
    premise: input.premise,
  });
  const volumeCount = input.chapterPlanningMode === "fixed" ? 1 : Math.max(1, input.plannedVolumes ?? 1);
  const minBudgets = distributeBudget(input.chapterBudgetMin, volumeCount);
  const targetBudgets = distributeBudget(input.chapterBudgetTarget, volumeCount);
  const maxBudgets = distributeBudget(input.chapterBudgetMax, volumeCount);

  let nextStart = 1;
  const volumes = Array.from({ length: volumeCount }, (_, index) => {
    const targetBudget = targetBudgets[index] ?? 1;
    const chapterStart = nextStart;
    nextStart += targetBudget;
    return {
      volumeNo: index + 1,
      label: `第 ${index + 1} 卷`,
      goal: buildVolumeGoal(index, volumeCount, input.completionCriteria),
      status: index === 0 ? "active" : "planned",
      chapterStart,
      chapterEnd: null,
      chapterBudgetMin: minBudgets[index] ?? targetBudget,
      chapterBudgetTarget: targetBudget,
      chapterBudgetMax: maxBudgets[index] ?? targetBudget,
      milestones: [],
    } satisfies StoryContractVolume;
  });

  return {
    volumes,
    currentVolume: 1,
    globalArc: input.premise || `${input.genre}主线逐步抬升并最终完成闭环。`,
    endingPromise: input.completionCriteria,
    completionChecks: Array.from(
      new Set([
        input.completionCriteria,
        "主线冲突完成闭环",
        "关键伏笔得到交代",
      ]),
    ),
    storyPromises: buildDefaultStoryPromises({
      genre: input.genre,
      premise: input.premise,
      completionCriteria: input.completionCriteria,
      activations: genreObligationPacks,
    }),
    activeProgressionAxes: resolveActiveProgressionAxes(genreObligationPacks),
    genreObligationPacks,
    arenaClusters: [],
    opponentClusters: [],
    rewardTypes: [],
    relationshipProgressions: [],
    segmentPlans: [],
    progressState: buildInitialStoryProgressState(),
    forecast: {
      min: input.chapterBudgetMin,
      target: input.chapterBudgetTarget,
      max: Math.min(input.chapterBudgetMax, input.hardChapterCap),
      finalRunReady: false,
      completionProgress: 0,
      nextMilestone: `优先完成${volumes[0]?.label ?? "当前卷"}的核心目标`,
    },
    recentPlan: [],
    updatedAt: nowIso(),
  };
}

export function hydrateStoryContract(
  contract: StoryContract,
  input: {
    genre: string;
    premise: string;
    completionCriteria: string;
    latestChapter?: number;
    foundation?: FoundationPayload | null;
  },
) {
  const suggested = suggestGenreObligationPacks({
    genre: input.genre,
    premise: input.premise,
    foundation: input.foundation,
  });
  const genreObligationPacks =
    contract.genreObligationPacks?.length
      ? contract.genreObligationPacks
      : suggested;
  const progressState = normalizeProgressState(contract);

  return {
    ...contract,
    volumes: normalizeVolumes(contract),
    storyPromises: contract.storyPromises?.length
      ? contract.storyPromises
      : buildDefaultStoryPromises({
        genre: input.genre,
        premise: input.premise,
        completionCriteria: input.completionCriteria,
        activations: genreObligationPacks,
      }),
    activeProgressionAxes: contract.activeProgressionAxes?.length
      ? contract.activeProgressionAxes
      : resolveActiveProgressionAxes(genreObligationPacks),
    genreObligationPacks,
    arenaClusters: contract.arenaClusters?.length
      ? contract.arenaClusters
      : input.foundation
        ? buildDefaultArenaClusters(input.foundation)
        : [],
    opponentClusters: contract.opponentClusters?.length
      ? contract.opponentClusters
      : input.foundation
        ? buildDefaultOpponentClusters(input.foundation)
        : [],
    rewardTypes: contract.rewardTypes?.length
      ? contract.rewardTypes
      : buildDefaultRewardTypes(),
    relationshipProgressions: contract.relationshipProgressions?.length
      ? contract.relationshipProgressions
      : input.foundation
        ? buildDefaultRelationshipProgressions(input.foundation)
        : [],
    segmentPlans: normalizeSegmentPlans(contract, input.latestChapter ?? progressState.latestChapter ?? 0),
    progressState,
    updatedAt: contract.updatedAt || nowIso(),
  } satisfies StoryContract;
}

export function buildStoryContractSummary(contract: StoryContract) {
  const currentVolume = contract.volumes.find((volume) => volume.volumeNo === contract.currentVolume) ?? contract.volumes[0];
  return [
    `当前卷：${currentVolume?.label ?? "未定"}`,
    currentVolume ? `当前卷目标：${currentVolume.goal}` : "",
    `整体主线：${contract.globalArc}`,
    `完结承诺：${contract.endingPromise}`,
    `章节预测：${contract.forecast.min}-${contract.forecast.max}（目标 ${contract.forecast.target}）`,
    `完结进度：${Math.round(contract.forecast.completionProgress * 100)}%`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getCurrentMilestone(contract: StoryContract, chapterNo = (contract.progressState.latestChapter ?? 0) + 1) {
  const currentVolume = contract.volumes.find((volume) => volume.volumeNo === contract.currentVolume) ?? contract.volumes[0];
  if (!currentVolume?.milestones?.length) {
    return null;
  }

  const currentChapter = Math.max(1, chapterNo);
  const activeMilestone = currentVolume.milestones.find((milestone) => milestone.status === "active");
  if (activeMilestone) {
    return activeMilestone;
  }

  const rangedMilestone = currentVolume.milestones.find((milestone) => {
    const start = milestone.expectedChapterStart ?? Number.MIN_SAFE_INTEGER;
    const end = milestone.expectedChapterEnd ?? Number.MAX_SAFE_INTEGER;
    return currentChapter >= start && currentChapter <= end;
  });
  if (rangedMilestone) {
    return rangedMilestone;
  }

  return currentVolume.milestones.find((milestone) => milestone.status !== "completed")
    ?? currentVolume.milestones.at(-1)
    ?? null;
}

export function getCurrentVolumeGoal(contract: StoryContract) {
  return contract.volumes.find((volume) => volume.volumeNo === contract.currentVolume)?.goal ?? contract.endingPromise;
}

export function applyContinuationDecision(contract: StoryContract, input: StoryContinuationDecision): StoryContract {
  const volumes = contract.volumes.map((volume) => ({ ...volume }));
  const currentVolume = volumes.find((volume) => volume.volumeNo === contract.currentVolume) ?? volumes[0];
  const nextVolume = currentVolume
    ? volumes.find((volume) => volume.volumeNo === currentVolume.volumeNo + 1)
    : null;

  if (currentVolume && input.decision === "end_volume") {
    currentVolume.status = "completed";
    currentVolume.chapterEnd = input.chapterNo;
    if (nextVolume) {
      nextVolume.status = "active";
      nextVolume.chapterStart = Math.max(nextVolume.chapterStart, input.chapterNo + 1);
    }
  }

  if (currentVolume && input.decision === "complete_story") {
    currentVolume.status = "completed";
    currentVolume.chapterEnd = input.chapterNo;
  }

  const nextCurrentVolume =
    input.decision === "end_volume" && nextVolume
      ? nextVolume.volumeNo
      : contract.currentVolume;

  const finalRunReady = input.decision === "enter_final_run" || input.decision === "complete_story"
    ? true
    : contract.forecast.finalRunReady;

  const nextTarget =
    input.decision === "continue_chaptering" && input.chapterNo >= contract.forecast.target && contract.forecast.target < contract.forecast.max
      ? Math.min(contract.forecast.max, input.chapterNo + 2)
      : contract.forecast.target;

  const nextContract: StoryContract = {
    ...contract,
    volumes,
    currentVolume: nextCurrentVolume,
    forecast: {
      ...contract.forecast,
      target: nextTarget,
      finalRunReady,
      completionProgress:
        input.decision === "complete_story"
          ? 1
          : input.decision === "enter_final_run"
            ? 0.92
            : calculateCompletionProgress(input.chapterNo, {
                ...contract,
                forecast: {
                  ...contract.forecast,
                  target: nextTarget,
                  finalRunReady,
                },
              }, Math.max(contract.forecast.max, nextTarget)),
      nextMilestone:
        input.decision === "complete_story"
          ? "已满足完结条件"
          : input.summary || contract.forecast.nextMilestone,
    },
    recentPlan: input.nextPlan,
    updatedAt: nowIso(),
  };

  return nextContract;
}
