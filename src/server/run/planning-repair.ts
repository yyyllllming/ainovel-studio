import { appendRunLog, appendRunStatistic, upsertRunState } from "../repositories/run.repository.ts";
import { generateBlueprint } from "../services/blueprint-generate.service.ts";
import { type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { readLatestLogicStateSnapshot } from "../project-files.ts";
import { ensureChapterPlan } from "../story/chapter-plan-engine.ts";
import {
  buildHookDiagnosticPlannerNotes,
  buildHookDiagnosticsSummaryLine,
} from "../story/hook-diagnostics.ts";
import type { ChapterBlueprint, ReviewVerdict } from "../types.ts";
import { nowIso } from "../utils.ts";

export const MAX_PLANNING_REPAIR_ATTEMPTS = 2;

export function shouldEscalatePlanningRepairToManualReview(input: {
  attemptsUsed: number;
  maxAttempts?: number;
}) {
  const maxAttempts = input.maxAttempts ?? MAX_PLANNING_REPAIR_ATTEMPTS;
  return input.attemptsUsed >= maxAttempts;
}

export function buildPlanningRepairPrompt(
  review: Pick<ReviewVerdict, "reason" | "fixInstructions" | "issues" | "failureCategory" | "repairStrategy">,
  options?: {
    hookSummary?: string;
    hookNotes?: string[];
  },
) {
  const issueLines = review.issues
    .map((issue) => `${issue.type}@${issue.location}:${issue.severity}`)
    .join("；");

  return [
    `失败分类：${review.failureCategory ?? "planning_failure"}`,
    `修复策略：${review.repairStrategy ?? "planning_repair"}`,
    `审稿原因：${review.reason}`,
    review.fixInstructions ? `修订要求：${review.fixInstructions}` : "",
    issueLines ? `关键问题：${issueLines}` : "",
    options?.hookSummary || "",
    options?.hookNotes?.length ? `Hook修复重点：${options.hookNotes.join("；")}` : "",
    "要求：优先修正 ChapterPlan 的主任务、推进节拍、人物推进与章末承接，再交给 blueprint 执行，不要只做文案润色。",
  ].filter(Boolean).join("\n");
}

export function buildPlanningRepairBlueprintReason(input: {
  review: Pick<ReviewVerdict, "reason" | "fixInstructions">;
  repairAttempt: number;
  hookSummary?: string;
  hookNotes?: string[];
}) {
  return [
    `第 ${input.repairAttempt} 次 planning_repair：深审判定当前上游规划失效。`,
    `问题摘要：${input.review.reason}`,
    input.review.fixInstructions ? `必须落实：${input.review.fixInstructions}` : "",
    input.hookSummary || "",
    input.hookNotes?.length ? `Hook重规划提醒：${input.hookNotes.join("；")}` : "",
    "请严格以最新 ChapterPlan 为唯一章节主计划，重做 blueprint，不要沿用旧的 scene goal 或弱 segment 兜底。",
  ].filter(Boolean).join("\n");
}

export interface PlanningRepairDependencies {
  regenerateChapterPlan?: typeof ensureChapterPlan;
  regenerateBlueprint?: (
    projectId: string,
    chapterNo: number,
    reason: string | undefined,
    sessionId: string | undefined,
    executionContext: ProjectExecutionContext,
  ) => Promise<ChapterBlueprint>;
}

export async function executePlanningRepair(input: {
  projectId: string;
  chapterNo: number;
  retryCount: number;
  repairAttempt: number;
  review: Pick<ReviewVerdict, "reason" | "fixInstructions" | "issues" | "failureCategory" | "repairStrategy">;
  executionContext: ProjectExecutionContext;
}, deps: PlanningRepairDependencies = {}) {
  const regenerateChapterPlan = deps.regenerateChapterPlan ?? ensureChapterPlan;
  const regenerateBlueprint = deps.regenerateBlueprint ?? generateBlueprint;
  const latestLogicState = await readLatestLogicStateSnapshot(input.projectId, { uptoChapterNo: input.chapterNo });
  const hookSummary = buildHookDiagnosticsSummaryLine(latestLogicState?.hookDiagnostics);
  const hookNotes = buildHookDiagnosticPlannerNotes({
    diagnostics: latestLogicState?.hookDiagnostics,
    maxItems: 3,
  });
  const repairPrompt = buildPlanningRepairPrompt(input.review, {
    hookSummary,
    hookNotes,
  });
  upsertRunState(input.projectId, {
    stage: "planning_repair",
    status: "planning_repair",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: input.chapterNo,
    retryCount: input.retryCount,
    lastError: null,
    stageDetails: {
      planningRepair: {
        applied: true,
        strategy: "planning_repair",
        regeneratedChapterPlan: false,
        regeneratedBlueprint: false,
        completed: false,
        nextAction: "rewrite_with_fresh_blueprint",
      },
    },
  });
  appendRunLog(
    input.projectId,
    "warning",
    `第 ${input.chapterNo} 章进入 planning_repair，第 ${input.repairAttempt} 次重建章节主计划。`,
  );

  const chapterPlan = await regenerateChapterPlan(
    input.projectId,
    input.chapterNo,
    input.executionContext,
    {
      forceRegenerate: true,
      allowDegradedFallback: false,
      repairPrompt,
    },
  );
  if (!Array.isArray((chapterPlan as { hookSlots?: unknown }).hookSlots)) {
    throw new Error("planning_repair 要求 ChapterPlan 输出合法 hookSlots。");
  }

  const blueprintReason = buildPlanningRepairBlueprintReason({
    review: input.review,
    repairAttempt: input.repairAttempt,
    hookSummary,
    hookNotes,
  });

  upsertRunState(input.projectId, {
    stage: "planning_repair",
    status: "planning_repair",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: input.chapterNo,
    retryCount: input.retryCount,
    lastError: null,
    stageDetails: {
      planningRepair: {
        applied: true,
        strategy: "planning_repair",
        regeneratedChapterPlan: true,
        regeneratedBlueprint: false,
        completed: false,
        nextAction: "rewrite_with_fresh_blueprint",
        chapterPlanGenerationId: chapterPlan.generationId,
      },
    },
  });

  const blueprint = await regenerateBlueprint(
    input.projectId,
    input.chapterNo,
    blueprintReason,
    undefined,
    input.executionContext,
  );

  appendRunStatistic(input.projectId, input.chapterNo, "planning_repair", {
    strategy: "planning_repair",
    repairAttempt: input.repairAttempt,
    failureCategory: input.review.failureCategory ?? "planning_failure",
    regeneratedChapterPlan: true,
    chapterPlanGenerationId: chapterPlan.generationId,
    regeneratedBlueprint: true,
    blueprintSourcePlanGenerationId: blueprint.sourcePlanGenerationId ?? chapterPlan.generationId,
    hookGuidanceMode: blueprint.hookGuidanceMode ?? "unguided",
    boundHookCount: blueprint.hookBindings?.length ?? 0,
  });

  upsertRunState(input.projectId, {
    stage: "planning_repair",
    status: "planning_repair",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: input.chapterNo,
    retryCount: input.retryCount,
    lastError: null,
    stageDetails: {
      planningRepair: {
        applied: true,
        strategy: "planning_repair",
        regeneratedChapterPlan: true,
        regeneratedBlueprint: true,
        completed: true,
        nextAction: "rewrite_with_fresh_blueprint",
        chapterPlanGenerationId: chapterPlan.generationId,
        blueprintSourcePlanGenerationId: blueprint.sourcePlanGenerationId ?? chapterPlan.generationId,
      },
    },
  });

  appendRunLog(
    input.projectId,
    "info",
    `第 ${input.chapterNo} 章 planning_repair 已完成：ChapterPlan(generationId=${chapterPlan.generationId}) 与 blueprint 已重建，下一步直接按新蓝图重写正文。`,
  );

  return {
    chapterPlanGenerationId: chapterPlan.generationId,
    blueprintSourcePlanGenerationId: blueprint.sourcePlanGenerationId ?? chapterPlan.generationId,
    hookGuidanceMode: blueprint.hookGuidanceMode ?? "unguided",
  };
}
