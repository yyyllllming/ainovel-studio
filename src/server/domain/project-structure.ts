export const seriesModeValues = ["standalone", "series"] as const;
export type SeriesMode = (typeof seriesModeValues)[number];

export const storyLengthValues = ["short", "medium", "long"] as const;
export type StoryLength = (typeof storyLengthValues)[number];

export const chapterPlanningModeValues = ["dynamic", "fixed"] as const;
export type ChapterPlanningMode = (typeof chapterPlanningModeValues)[number];

export const paceProfileValues = ["fast", "medium", "slow"] as const;
export type PaceProfile = (typeof paceProfileValues)[number];

export const narrativePersonValues = ["first", "third"] as const;
export type NarrativePerson = (typeof narrativePersonValues)[number];

export interface ProjectStructureFields {
  seriesMode: SeriesMode;
  seriesTitle: string | null;
  seriesIndex: number | null;
  storyLength: StoryLength;
  narrativePerson: NarrativePerson;
  hasVolumes: boolean;
  plannedVolumes: number | null;
  chapterPlanningMode: ChapterPlanningMode;
  paceProfile: PaceProfile;
  completionCriteria: string;
  chapterBudgetMin: number;
  chapterBudgetTarget: number;
  chapterBudgetMax: number;
  hardChapterCap: number;
  targetChapters: number;
}

export interface ProjectStructureInput {
  seriesMode: SeriesMode;
  seriesTitle?: string | null;
  seriesIndex?: number | null;
  storyLength: StoryLength;
  narrativePerson?: NarrativePerson | null;
  hasVolumes?: boolean;
  plannedVolumes?: number | null;
  chapterPlanningMode?: ChapterPlanningMode | null;
  paceProfile?: PaceProfile | null;
  completionCriteria?: string | null;
  chapterBudgetMin?: number | null;
  chapterBudgetTarget?: number | null;
  chapterBudgetMax?: number | null;
  hardChapterCap?: number | null;
  targetChapters?: number | null;
}

const DEFAULT_MEDIUM_CHAPTERS = 8;
const DEFAULT_LONG_CHAPTERS = 16;
const MIN_CHAPTERS = 1;
const MAX_CHAPTERS = 200;
const DEFAULT_VOLUME_COUNT = 2;

const DYNAMIC_VOLUME_BUDGETS: Record<Exclude<StoryLength, "short">, Record<PaceProfile, [number, number, number]>> = {
  medium: {
    fast: [3, 4, 6],
    medium: [4, 6, 8],
    slow: [5, 8, 10],
  },
  long: {
    fast: [5, 7, 10],
    medium: [7, 10, 14],
    slow: [9, 13, 18],
  },
};

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function cleanText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function buildDefaultCompletionCriteria(storyLength: StoryLength) {
  if (storyLength === "short") {
    return "单次冲突闭环，情绪落点清晰，不额外外扩支线。";
  }
  if (storyLength === "medium") {
    return "主线冲突闭环，关键伏笔有交代，主要人物关系落到稳定结局。";
  }
  return "主线承诺兑现，关键伏笔回收，主要人物命运落定，并自然完成终局收束。";
}

function deriveLegacyTargetChapters(storyLength: StoryLength, plannedVolumes: number | null) {
  if (storyLength === "short") {
    return 1;
  }
  return clampInteger(
    storyLength === "medium"
      ? (plannedVolumes ? plannedVolumes * 4 : DEFAULT_MEDIUM_CHAPTERS)
      : (plannedVolumes ? plannedVolumes * 8 : DEFAULT_LONG_CHAPTERS),
    MIN_CHAPTERS,
    MAX_CHAPTERS,
  );
}

function estimateDynamicBudget(
  storyLength: Exclude<StoryLength, "short">,
  paceProfile: PaceProfile,
  plannedVolumes: number,
) {
  const [minPerVolume, targetPerVolume, maxPerVolume] = DYNAMIC_VOLUME_BUDGETS[storyLength][paceProfile];
  return {
    chapterBudgetMin: clampInteger(minPerVolume * plannedVolumes, MIN_CHAPTERS, MAX_CHAPTERS),
    chapterBudgetTarget: clampInteger(targetPerVolume * plannedVolumes, MIN_CHAPTERS, MAX_CHAPTERS),
    chapterBudgetMax: clampInteger(maxPerVolume * plannedVolumes, MIN_CHAPTERS, MAX_CHAPTERS),
  };
}

function clampBudgetToCap(min: number, target: number, max: number, hardCap: number) {
  const cappedMax = clampInteger(Math.min(max, hardCap), MIN_CHAPTERS, MAX_CHAPTERS);
  const cappedTarget = clampInteger(Math.min(target, cappedMax), MIN_CHAPTERS, cappedMax);
  const cappedMin = clampInteger(Math.min(min, cappedTarget), MIN_CHAPTERS, cappedTarget);
  return {
    chapterBudgetMin: cappedMin,
    chapterBudgetTarget: cappedTarget,
    chapterBudgetMax: cappedMax,
  };
}

export function normalizeProjectStructureInput(input: ProjectStructureInput): ProjectStructureFields {
  const storyLength = input.storyLength;
  const seriesMode = input.seriesMode;
  const paceProfile = input.paceProfile ?? "medium";
  const narrativePerson = input.narrativePerson ?? "third";
  const completionCriteria = cleanText(input.completionCriteria) ?? buildDefaultCompletionCriteria(storyLength);

  if (storyLength === "short") {
    return {
      seriesMode,
      seriesTitle: seriesMode === "series" ? cleanText(input.seriesTitle) : null,
      seriesIndex:
        seriesMode === "series" && input.seriesIndex && input.seriesIndex > 0
          ? clampInteger(input.seriesIndex, 1, 999)
          : null,
      storyLength,
      narrativePerson,
      hasVolumes: false,
      plannedVolumes: null,
      chapterPlanningMode: "fixed",
      paceProfile,
      completionCriteria,
      chapterBudgetMin: 1,
      chapterBudgetTarget: 1,
      chapterBudgetMax: 1,
      hardChapterCap: 1,
      targetChapters: 1,
    };
  }

  const rawPlannedVolumes = input.plannedVolumes ?? (input.hasVolumes ? DEFAULT_VOLUME_COUNT : undefined) ?? DEFAULT_VOLUME_COUNT;
  const plannedVolumes = clampInteger(rawPlannedVolumes, 1, 24);
  const hasVolumes = plannedVolumes > 1 || Boolean(input.hasVolumes);
  const chapterPlanningMode = input.chapterPlanningMode ?? (input.targetChapters ? "fixed" : "dynamic");

  const fixedTarget = clampInteger(
    input.targetChapters ?? deriveLegacyTargetChapters(storyLength, hasVolumes ? plannedVolumes : null),
    MIN_CHAPTERS,
    MAX_CHAPTERS,
  );

  if (chapterPlanningMode === "fixed") {
    return {
      seriesMode,
      seriesTitle: seriesMode === "series" ? cleanText(input.seriesTitle) : null,
      seriesIndex:
        seriesMode === "series" && input.seriesIndex && input.seriesIndex > 0
          ? clampInteger(input.seriesIndex, 1, 999)
          : null,
      storyLength,
      narrativePerson,
      hasVolumes,
      plannedVolumes,
      chapterPlanningMode,
      paceProfile,
      completionCriteria,
      chapterBudgetMin: fixedTarget,
      chapterBudgetTarget: fixedTarget,
      chapterBudgetMax: fixedTarget,
      hardChapterCap: fixedTarget,
      targetChapters: fixedTarget,
    };
  }

  const explicitBudgetMin = input.chapterBudgetMin ? clampInteger(input.chapterBudgetMin, MIN_CHAPTERS, MAX_CHAPTERS) : null;
  const explicitBudgetTarget = input.chapterBudgetTarget
    ? clampInteger(input.chapterBudgetTarget, MIN_CHAPTERS, MAX_CHAPTERS)
    : null;
  const explicitBudgetMax = input.chapterBudgetMax ? clampInteger(input.chapterBudgetMax, MIN_CHAPTERS, MAX_CHAPTERS) : null;
  const estimatedBudget = estimateDynamicBudget(storyLength, paceProfile, plannedVolumes);
  const hardChapterCap = clampInteger(
    input.hardChapterCap ?? explicitBudgetMax ?? estimatedBudget.chapterBudgetMax,
    MIN_CHAPTERS,
    MAX_CHAPTERS,
  );
  const clampedBudget = clampBudgetToCap(
    explicitBudgetMin ?? estimatedBudget.chapterBudgetMin,
    explicitBudgetTarget ?? estimatedBudget.chapterBudgetTarget,
    explicitBudgetMax ?? estimatedBudget.chapterBudgetMax,
    hardChapterCap,
  );

  return {
    seriesMode,
    seriesTitle: seriesMode === "series" ? cleanText(input.seriesTitle) : null,
    seriesIndex:
      seriesMode === "series" && input.seriesIndex && input.seriesIndex > 0
        ? clampInteger(input.seriesIndex, 1, 999)
        : null,
    storyLength,
    narrativePerson,
    hasVolumes,
    plannedVolumes,
    chapterPlanningMode,
    paceProfile,
    completionCriteria,
    chapterBudgetMin: clampedBudget.chapterBudgetMin,
    chapterBudgetTarget: clampedBudget.chapterBudgetTarget,
    chapterBudgetMax: clampedBudget.chapterBudgetMax,
    hardChapterCap,
    targetChapters: hardChapterCap,
  };
}

export function getStoryLengthLabel(storyLength: StoryLength) {
  if (storyLength === "short") {
    return "短篇";
  }
  if (storyLength === "medium") {
    return "中篇";
  }
  return "长篇";
}

export function getNarrativePersonLabel(narrativePerson: NarrativePerson) {
  return narrativePerson === "first" ? "第一人称" : "第三人称";
}

export function getProjectUnitLabel(input: Pick<ProjectStructureFields, "storyLength">) {
  return input.storyLength === "short" ? "正文单元" : "章节";
}

function buildBudgetLabel(
  input: Pick<ProjectStructureFields, "chapterPlanningMode" | "chapterBudgetMin" | "chapterBudgetTarget" | "chapterBudgetMax" | "targetChapters">,
) {
  if (input.chapterPlanningMode === "fixed") {
    return `固定 ${input.targetChapters} 章`;
  }
  if (input.chapterBudgetMin === input.chapterBudgetMax) {
    return `预计 ${input.chapterBudgetMax} 章`;
  }
  return `预计 ${input.chapterBudgetMin}-${input.chapterBudgetMax} 章`;
}

export function buildProjectStructureSummary(input: ProjectStructureFields) {
  const parts = [
    input.seriesMode === "series" && input.seriesTitle
      ? `系列《${input.seriesTitle}》${input.seriesIndex ? ` #${String(input.seriesIndex).padStart(2, "0")}` : ""}`
      : "单作",
    getStoryLengthLabel(input.storyLength),
    getNarrativePersonLabel(input.narrativePerson),
  ];

  if (input.plannedVolumes) {
    parts.push(`${input.plannedVolumes} 卷`);
  }

  if (input.storyLength !== "short") {
    parts.push(buildBudgetLabel(input));
  }

  if (input.chapterPlanningMode === "dynamic") {
    parts.push(`${input.paceProfile === "fast" ? "快节奏" : input.paceProfile === "slow" ? "慢节奏" : "中节奏"}`);
  }

  return parts.join(" · ");
}

export function buildProjectPromptSummary(input: ProjectStructureFields) {
  return [
    `归属：${input.seriesMode === "series" ? `系列作品（${input.seriesTitle ?? "未命名系列"}）` : "单作"}`,
    `篇幅：${getStoryLengthLabel(input.storyLength)}`,
    `叙事人称：${getNarrativePersonLabel(input.narrativePerson)}`,
    `结构：${input.plannedVolumes ? `计划 ${input.plannedVolumes} 卷` : "单卷/不分卷"}`,
    `章节规划模式：${input.chapterPlanningMode === "dynamic" ? "动态估算与滚动修正" : "固定章节数"}`,
    `默认写作单元：${getProjectUnitLabel(input)}`,
    input.storyLength === "short"
      ? "预计章节数：1（短篇兼容模式）"
      : input.chapterPlanningMode === "dynamic"
        ? `章节预算：${input.chapterBudgetMin}-${input.chapterBudgetMax} 章（目标 ${input.chapterBudgetTarget}，安全上限 ${input.hardChapterCap}）`
        : `固定章节数：${input.targetChapters}`,
    `节奏：${input.paceProfile}`,
    `完结标准：${input.completionCriteria}`,
  ].join("\n");
}
