import "../server-only.ts";

import { buildOpeningChapterSteering } from "../story/chapter-steering.ts";
import { notFound } from "../errors.ts";
import { buildFutureContext, buildPlannerContextSummary } from "../run/context-engine.ts";
import {
  readCharacterSnapshot,
  readLatestLogicStateSnapshot,
  writeBlueprintFile,
} from "../project-files.ts";
import { getBlueprint, getFoundation, isFoundationLocked, saveBlueprint } from "../repositories/foundation.repository.ts";
import { getProject, listActiveSteeringNotes } from "../repositories/project.repository.ts";
import { getSummaryEntries } from "../repositories/review.repository.ts";
import { appendRunLog, appendRunStatistic } from "../repositories/run.repository.ts";
import { ensureRunSessionActive } from "../run/session-activation.ts";
import { assertNoRawBookText, buildStylePromptBundle } from "../writing/style-prompt-guard.ts";
import { type AgentStage } from "../style/style-steering.ts";
import { planChapterBlueprint } from "../story/blueprint-plan-engine.ts";
import { ensureChapterPlan } from "../story/chapter-plan-engine.ts";
import { deriveHookPlansFromChapterPlan } from "../story/hook-plan.ts";
import { getSegmentPlanItemForChapter } from "../story/story-progression.ts";
import { buildDynamicPlannerExemplars, buildStaticPlannerExemplars } from "../story/planner-exemplars.ts";
import { ensureSegmentPlans } from "../story/segment-plan-engine.ts";
import { ensureStoryContract } from "../story/story-contract-engine.ts";
import { replaceHookPlansForChapter } from "../repositories/hook-plan.repository.ts";
import type { ChapterBlueprint, ChapterPlan, StoryContract } from "../types.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "./project-execution-context.ts";
import { getFoundationDriftReport } from "./foundation-truth-source.service.ts";

export function buildRuntimeStyleSections(input: {
  stage: AgentStage;
  context: ProjectExecutionContext;
  includeDigest?: boolean;
  includeExemplars?: boolean;
}) {
  const bundle = buildStylePromptBundle(input.stage, input.context.activeStyle);
  const includeDigest = input.includeDigest ?? true;
  const includeExemplars = input.includeExemplars ?? input.stage !== "reviewer";
  const sections = [
    `风格画像：\n${bundle.formattedStyleProfile}`,
    includeDigest && bundle.styleDigest ? `风格摘要：\n${bundle.styleDigest}` : "",
    includeExemplars && bundle.styleExemplars.length
      ? `风格示例（只借节奏与组织，不复刻原句）：\n${bundle.styleExemplars.map((entry, index) => `${index + 1}. [${entry.label} | ${entry.tags.join("/") || "narrative"}]\n${entry.content.trim()}`).join("\n\n")}`
      : "",
  ].filter(Boolean);

  assertNoRawBookText({
    stage: input.stage,
    activeStyle: input.context.activeStyle,
    formattedStyleProfile: bundle.formattedStyleProfile,
    styleDigest: bundle.styleDigest,
    styleExemplars: bundle.styleExemplars,
    extraSections: sections,
  });

  return {
    ...bundle,
    sections,
  };
}

export async function generateBlueprint(
  projectId: string,
  chapterNo: number,
  reason?: string,
  sessionId?: string,
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  if (!project || !foundation) {
    throw new Error("缺少项目或设定数据");
  }
  const drift = getFoundationDriftReport(projectId);
  if (drift.coreDrift) {
    throw new Error(drift.blockingReason ?? "请先整理正式设定，再生成章节蓝图");
  }

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const baseStoryContract = project.storyContract ?? await ensureStoryContract(projectId, context);
  const storyContract = await ensureSegmentPlans(projectId, chapterNo, project, foundation, baseStoryContract, context);
  const chapterPlan = await ensureChapterPlan(projectId, chapterNo, context);
  const hookPlans = deriveHookPlansFromChapterPlan(chapterPlan);
  replaceHookPlansForChapter(projectId, chapterNo, hookPlans);
  const activeNotes = listActiveSteeringNotes(projectId, chapterNo);
  const leadCharacterName = foundation.characters[0]?.name?.trim() || "主角";
  const currentVolumeGoal =
    storyContract.volumes.find((item) => item.volumeNo === storyContract.currentVolume)?.goal
    ?? storyContract.endingPromise;
  const segmentBinding = getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo);
  const mustAdvance = storyContract.progressState.mustAdvance.length
    ? storyContract.progressState.mustAdvance
    : storyContract.activeProgressionAxes;
  const resolveSegmentBinding = (targetChapterNo: number) =>
    getSegmentPlanItemForChapter(storyContract.segmentPlans, targetChapterNo);
  const resolveRequiredProgressDelta = (targetChapterNo: number, fallbackIndex = 0) =>
    resolveSegmentBinding(targetChapterNo)?.item?.requiredProgressDeltas?.[0]
    ?? mustAdvance[fallbackIndex % Math.max(mustAdvance.length, 1)]
    ?? "information_shift";

  const openingPlannerGuidance = buildOpeningChapterSteering({
    chapterNo,
    protagonistName: leadCharacterName,
    currentVolumeGoal,
    projectPremise: foundation.premise,
  });
  const previousSummaryEntries = chapterNo > 1
    ? getSummaryEntries(projectId).filter((entry) => Number(entry.chapter_no ?? 0) === chapterNo - 1)
    : [];
  const previousBriefSummary = previousSummaryEntries.find((entry) => String(entry.level) === "brief")?.content
    ? String(previousSummaryEntries.find((entry) => String(entry.level) === "brief")?.content)
    : null;
  const previousDetailedSummary = previousSummaryEntries.find((entry) => String(entry.level) === "detailed")?.content
    ? String(previousSummaryEntries.find((entry) => String(entry.level) === "detailed")?.content)
    : null;
  const previousSnapshot = chapterNo > 1 ? await readCharacterSnapshot(projectId, chapterNo - 1) : null;
  const previousLogicState = chapterNo > 1
    ? await readLatestLogicStateSnapshot(projectId, { uptoChapterNo: chapterNo })
    : null;
  const futureContext = buildFutureContext({
    storyContract,
    chapterNo,
  }).text;
  const plannerContextSummary = buildPlannerContextSummary({
    foundation,
    storyContract,
    chapterNo,
    previousBriefSummary,
    previousDetailedSummary,
    latestSnapshot: previousSnapshot,
    logicState: previousLogicState,
  });
  const activePackIds = storyContract.genreObligationPacks.filter((entry) => entry.active).map((entry) => entry.id);
  const staticPlannerExemplars = buildStaticPlannerExemplars({
    activePackIds,
    requiredDelta: resolveRequiredProgressDelta(chapterNo, 0),
  });
  const dynamicPlannerExemplars = await buildDynamicPlannerExemplars(projectId, chapterNo);
  const plannerExemplars =
    chapterNo <= 3 || !dynamicPlannerExemplars.length
      ? staticPlannerExemplars
      : [...staticPlannerExemplars.slice(0, 1), ...dynamicPlannerExemplars];
  const planned = await planChapterBlueprint({
    projectId,
    chapterNo,
    project,
    foundation,
    context,
    chapterPlan,
    hookPlans,
    storyContract,
    segmentBinding,
    leadCharacterName,
    currentVolumeGoal,
    mustAdvance: mustAdvance as StoryContract["activeProgressionAxes"],
    plannerContextSummary,
    futureContext,
    plannerExemplars,
    activeNotes,
    reason: [reason, openingPlannerGuidance.length ? `开篇强约束：${openingPlannerGuidance.join("；")}` : ""]
      .filter(Boolean)
      .join("\n"),
    sessionId,
  });
  if (planned.trace.fallbackUsed) {
    appendRunLog(
      projectId,
      "warning",
      `第 ${chapterNo} 章蓝图未通过前置 verifier，已回退为 recovery blueprint。`,
    );
  }
  if (hookPlans.length && planned.blueprint.hookGuidanceMode !== "guided") {
    appendRunLog(
      projectId,
      "warning",
      `第 ${chapterNo} 章存在 ${hookPlans.length} 个 hook slot，但蓝图未稳定命中，已降级为 unguided。`,
    );
  }
  appendRunLog(
    projectId,
    planned.trace.fallbackUsed ? "warning" : "info",
    `第 ${chapterNo} 章蓝图规划完成：${planned.plannerQuality.selectedReason}；候选 ${planned.plannerQuality.candidateAttempts} 个；fallback=${planned.plannerQuality.fallbackUsed ? "yes" : "no"}`,
  );
  appendRunStatistic(projectId, chapterNo, "blueprint", {
    candidateCount: planned.trace.candidateAttempts.length,
    selectedCandidateIndex: planned.trace.selectedCandidateIndex,
    verificationScore: planned.verification?.score ?? planned.trace.selectedScore ?? 0,
    repairUsed: planned.trace.repairUsed,
    fallbackUsed: planned.trace.fallbackUsed,
    usedRecoveryBlueprint: Boolean(planned.trace.usedRecoveryBlueprint),
    hookGuidanceMode: planned.blueprint.hookGuidanceMode ?? "unguided",
    plannedHookCount: hookPlans.length,
    boundHookCount: planned.blueprint.hookBindings?.length ?? 0,
  });
  if (sessionId) {
    ensureRunSessionActive(projectId, sessionId, {
      allowPaused: true,
    });
  }
  const savedBlueprint = saveBlueprint(projectId, planned.blueprint);
  await writeBlueprintFile(projectId, savedBlueprint);

  appendRunLog(projectId, "info", `已完成第 ${chapterNo} 章的内部剧情规划`);
  return planned.blueprint;
}

export function isBlueprintFreshForPlan(
  blueprint: Pick<ChapterBlueprint, "sourcePlanGenerationId">,
  chapterPlan: Pick<ChapterPlan, "generationId">,
) {
  return (blueprint.sourcePlanGenerationId ?? null) === chapterPlan.generationId;
}

export interface BlueprintGenerateServiceDependencies {
  ensureBlueprintGenerated: (projectId: string, chapterNo: number) => Promise<unknown>;
}

export function createBlueprintGenerateService(input?: Partial<BlueprintGenerateServiceDependencies>) {
  const deps = { ...input };

  return {
    async ensureBlueprintGenerated(projectId: string, chapterNo: number) {
      const run = deps.ensureBlueprintGenerated ?? ensureBlueprintGenerated;
      return run(projectId, chapterNo);
    },
  };
}

export async function ensureBlueprintGenerated(projectId: string, chapterNo: number) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  if (!getFoundation(projectId) || !isFoundationLocked(projectId)) {
    throw new Error("请先整理并锁定正式设定，再生成章节蓝图");
  }
  const drift = getFoundationDriftReport(projectId);
  if (drift.coreDrift) {
    throw new Error(drift.blockingReason ?? "请先整理正式设定，再生成章节蓝图");
  }
  const executionContext = await getProjectExecutionContext(projectId, project.style);
  const chapterPlan = await ensureChapterPlan(projectId, chapterNo, executionContext);
  const hookPlans = deriveHookPlansFromChapterPlan(chapterPlan);
  replaceHookPlansForChapter(projectId, chapterNo, hookPlans);
  const existing = getBlueprint(projectId, chapterNo);
  if (existing && isBlueprintFreshForPlan(existing, chapterPlan)) {
    return existing;
  }
  return generateBlueprint(projectId, chapterNo, undefined, undefined, executionContext);
}

export function getBlueprintForChapter(projectId: string, chapterNo: number) {
  return getBlueprint(projectId, chapterNo);
}

export async function saveBlueprintAndSyncCards(projectId: string, blueprint: ChapterBlueprint) {
  const savedBlueprint = saveBlueprint(projectId, blueprint);
  await writeBlueprintFile(projectId, savedBlueprint);
  return savedBlueprint;
}
