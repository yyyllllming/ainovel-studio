import "../server-only.ts";

import { createHash } from "node:crypto";
import { z } from "zod";

import { buildProjectPromptSummary } from "../domain/project-structure.ts";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { appendRunLog, appendRunStatistic } from "../repositories/run.repository.ts";
import { getChapterPlan, upsertReadyChapterPlan } from "../repositories/chapter-plan.repository.ts";
import { getFoundation, isFoundationLocked } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { getSummaryEntries } from "../repositories/review.repository.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { getFoundationDriftReport } from "../services/foundation-truth-source.service.ts";
import { buildStoryContractSummary, getCurrentVolumeGoal } from "./story-contract.ts";
import { ensureStoryContract } from "./story-contract-engine.ts";
import { ensureSegmentPlans } from "./segment-plan-engine.ts";
import { getSegmentPlanItemForChapter } from "./story-progression.ts";
import { createChapterPlanRepository } from "../repositories/chapter-plan.repository.ts";
import type {
  ChapterPlan,
  ChapterPlanRiskFlag,
  FoundationPayload,
  StoryContract,
} from "../types.ts";
import { nowIso } from "../utils.ts";

export const CHAPTER_PLAN_CONTEXT_WINDOW = 10;
export const CHAPTER_PLAN_LOOKBACK_GENERATE_LIMIT = 3;
export const CHAPTER_PLAN_LEASE_TIMEOUT_MS = 120_000;

export interface EnsureChapterPlanOptions {
  forceRegenerate?: boolean;
  allowDegradedFallback?: boolean;
  repairPrompt?: string | null;
}

const hookSlotSchema = z.object({
  setupText: z.string().min(1),
  payoffWindow: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  planIntent: z.enum(["active", "deferred", "cancelled"]).default("active"),
  deferredUntilChapter: z.number().int().positive().optional(),
});

const chapterPlanRiskFlagAliasMap: Record<string, ChapterPlanRiskFlag> = {
  scene_loop: "scene_loop",
  loop_risk: "scene_loop",
  loop: "scene_loop",
  scene_repeat: "scene_loop",
  hook_debt: "hook_debt",
  hook_risk: "hook_debt",
  hook_setup_miss: "hook_debt",
  relationship_drop: "relationship_drop",
  relation_drop: "relationship_drop",
  relationship_loss: "relationship_drop",
  progression_stall: "progression_stall",
  progress_stall: "progression_stall",
  progression_drift: "progression_stall",
  payoff_miss: "payoff_miss",
  payoff_delay: "payoff_miss",
  continuation_blur: "continuation_blur",
  anchor_blur: "continuation_blur",
  continuation_miss: "continuation_blur",
  world_rule_weak: "world_rule_weak",
  world_rule_blur: "world_rule_weak",
  focus_scatter: "focus_scatter",
  focus_loss: "focus_scatter",
};

const chapterPlanSchema = z.object({
  purpose: z.string().min(1),
  plotSummary: z.string().min(1),
  requiredBeats: z.array(z.string().min(1)).min(3).max(6),
  keyEvents: z.array(z.string().min(1)).min(2).max(5),
  characterFocus: z.array(z.string().min(1)).min(1).max(4),
  relationshipShift: z.string().default(""),
  worldRuleUsage: z.array(z.string().min(1)).max(4).default([]),
  continuationAnchor: z.string().min(1),
  nextHook: z.string().default(""),
  hookSlots: z.array(hookSlotSchema).default([]),
  payoffTargets: z.array(z.string().min(1)).max(4).default([]),
  riskFlags: z.array(z.string().min(1)).max(4).default([]),
  riskComment: z.string().default(""),
});

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

function trimText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function deriveNextHookFromHookSlots(hookSlots: ChapterPlan["hookSlots"]) {
  return hookSlots.find((slot) => slot.planIntent === "active")?.setupText?.trim() ?? "";
}

function normalizeChapterPlanRiskFlags(values: string[]) {
  const normalized: ChapterPlanRiskFlag[] = [];
  const seen = new Set<ChapterPlanRiskFlag>();

  for (const value of values) {
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const mapped =
      chapterPlanRiskFlagAliasMap[key]
      ?? (key.includes("loop")
        ? "scene_loop"
        : key.includes("hook")
          ? "hook_debt"
          : key.includes("relation")
            ? "relationship_drop"
            : key.includes("progress") || key.includes("drift")
              ? "progression_stall"
              : key.includes("payoff")
                ? "payoff_miss"
                : key.includes("anchor") || key.includes("continuation")
                  ? "continuation_blur"
                  : key.includes("world") || key.includes("rule")
                    ? "world_rule_weak"
                    : key.includes("focus")
                      ? "focus_scatter"
                      : null);
    if (!mapped || seen.has(mapped)) {
      continue;
    }
    seen.add(mapped);
    normalized.push(mapped);
  }

  return normalized.slice(0, 4);
}

function hashJson(value: unknown) {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function buildChapterPlanFoundationDigest(foundation: FoundationPayload) {
  return hashJson({
    premise: trimText(foundation.premise),
    characters: foundation.characters
      .map((item) => ({
        name: trimText(item.name),
        role: trimText(item.role),
        goal: trimText(item.goal),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
    worldview: foundation.worldview
      .map((item) => ({
        name: trimText(item.name),
        description: trimText(item.description),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
    relationships: foundation.relationships
      .map((item) => ({
        source: trimText(item.source),
        target: trimText(item.target),
        label: trimText(item.label),
      }))
      .sort((left, right) =>
        `${left.source}|${left.label}|${left.target}`.localeCompare(
          `${right.source}|${right.label}|${right.target}`,
          "zh-Hans-CN",
        )),
  });
}

function buildSegmentSkeletonSnapshot(storyContract: StoryContract, chapterNo: number) {
  const binding = getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo);
  if (!binding) {
    return null;
  }

  return {
    segmentId: binding.segment.id,
    segmentStatus: binding.segment.status,
    chapterNo: binding.item.chapterNo,
    title: trimText(binding.item.title),
    intent: trimText(binding.item.intent),
    requiredProgressDeltas: [...binding.item.requiredProgressDeltas],
    requiredObligations: [...binding.item.requiredObligations].sort(),
    focusCharacters: [...binding.item.focusCharacters].sort(),
    arenaHints: [...binding.item.arenaHints].sort(),
    antagonistHint: trimText(binding.item.antagonistHint),
    nextHook: trimText(binding.item.nextHook),
    arenaClusterId: trimText(binding.item.arenaClusterId),
    opponentClusterId: trimText(binding.item.opponentClusterId),
    rewardType: trimText(binding.item.rewardType),
    relationshipBeatId: trimText(binding.item.relationshipBeatId),
  };
}

export function buildChapterPlanStoryDigest(input: {
  storyContract: StoryContract;
  chapterNo: number;
}) {
  const currentVolumeGoal = getCurrentVolumeGoal(input.storyContract);
  return hashJson({
    currentVolume: input.storyContract.currentVolume,
    currentVolumeGoal,
    endingPromise: trimText(input.storyContract.endingPromise),
    activeProgressionAxes: [...input.storyContract.activeProgressionAxes].sort(),
    mustAdvance: [...input.storyContract.progressState.mustAdvance].sort(),
    activePacks: input.storyContract.genreObligationPacks
      .filter((entry) => entry.active)
      .map((entry) => entry.id)
      .sort(),
    storyPromises: input.storyContract.storyPromises
      .map((entry) => ({
        id: trimText(entry.id),
        label: trimText(entry.label),
        type: entry.type,
        description: trimText(entry.description),
      }))
      .sort((left, right) => left.id.localeCompare(right.id, "zh-Hans-CN")),
    currentSegmentSkeleton: buildSegmentSkeletonSnapshot(input.storyContract, input.chapterNo),
  });
}

export function buildChapterPlanInputDigest(input: {
  chapterNo: number;
  foundationDigest: string;
  storyContractDigest: string;
  previousContinuationAnchor: string | null;
}) {
  return hashJson({
    chapterNo: input.chapterNo,
    foundationDigest: input.foundationDigest,
    storyContractDigest: input.storyContractDigest,
    previousContinuationAnchor: trimText(input.previousContinuationAnchor),
  });
}

function buildRecentChapterPlanSummaries(projectId: string, chapterNo: number) {
  const repository = createChapterPlanRepository();
  const plans = repository
    .list(projectId)
    .filter((plan) => plan.chapterNo < chapterNo && plan.status === "ready")
    .slice(-CHAPTER_PLAN_CONTEXT_WINDOW);

  return plans.map((plan) => [
    `第${plan.chapterNo}章`,
    `plot=${plan.plotSummary}`,
    plan.keyEvents.length ? `events=${plan.keyEvents.slice(0, 2).join(" / ")}` : "",
    plan.nextHook ? `nextHook=${plan.nextHook}` : "",
  ].filter(Boolean).join(" | "));
}

function getPreviousSummary(projectId: string, chapterNo: number) {
  if (chapterNo <= 1) {
    return null;
  }

  const previousChapterNo = chapterNo - 1;
  const previousEntries = getSummaryEntries(projectId)
    .filter((entry) => Number(entry.chapter_no ?? 0) === previousChapterNo);

  const brief = previousEntries.find((entry) => String(entry.level) === "brief")?.content;
  if (typeof brief === "string" && brief.trim()) {
    return brief;
  }

  const detailed = previousEntries.find((entry) => String(entry.level) === "detailed")?.content;
  if (typeof detailed === "string" && detailed.trim()) {
    return detailed;
  }

  return null;
}

function buildDegradedChapterPlan(input: {
  projectId: string;
  chapterNo: number;
  storyContract: StoryContract;
  foundation: FoundationPayload;
  foundationDigest: string;
  storyContractDigest: string;
  inputDigest: string;
  generationId: number;
  previousContinuationAnchor: string | null;
}) {
  const binding = getSegmentPlanItemForChapter(input.storyContract.segmentPlans, input.chapterNo);
  const currentVolumeGoal = getCurrentVolumeGoal(input.storyContract);
  const focusCharacters = uniqueNonEmpty([
    ...(binding?.item.focusCharacters ?? []),
    ...input.foundation.characters.slice(0, 2).map((item) => item.name),
  ]).slice(0, 4);
  const requiredBeats = uniqueNonEmpty([
    input.previousContinuationAnchor ? `先承接上章锚点：${input.previousContinuationAnchor}` : "",
    binding?.item.intent ? `本章必须落实：${binding.item.intent}` : "",
    binding?.item.requiredObligations?.[0] ? `保持卷内义务：${binding.item.requiredObligations[0]}` : "",
    `至少把当前卷目标往前推一格：${currentVolumeGoal}`,
  ]).slice(0, 4);
  const keyEvents = uniqueNonEmpty([
    binding?.item.title ? `事件 1：${binding.item.title}` : "",
    binding?.item.antagonistHint ? `事件 2：与${binding.item.antagonistHint}发生正面摩擦` : "",
    binding?.item.nextHook ? `事件 3：把“${binding.item.nextHook}”留成章末单钩子` : "",
  ]).slice(0, 4);
  const payoffTargets = uniqueNonEmpty([
    binding?.item.nextHook ? `尽快兑现：${binding.item.nextHook}` : "",
    binding?.item.requiredProgressDeltas?.[0] ? `确认本章推进是否真正交付 ${binding.item.requiredProgressDeltas[0]}` : "",
  ]).slice(0, 3);

  return {
    projectId: input.projectId,
    chapterNo: input.chapterNo,
    purpose: binding?.item.intent?.trim() || `推进当前卷目标：${currentVolumeGoal}`,
    plotSummary: uniqueNonEmpty([
      binding?.item.intent,
      binding?.item.antagonistHint ? `主要阻力来自${binding.item.antagonistHint}` : "",
      binding?.item.nextHook ? `章末必须留下${binding.item.nextHook}` : "",
    ]).join("；"),
    requiredBeats,
    keyEvents,
    characterFocus: focusCharacters,
    relationshipShift: binding?.item.relationshipBeatId ? `推进关系节拍：${binding.item.relationshipBeatId}` : "",
    worldRuleUsage: uniqueNonEmpty([
      ...(binding?.item.arenaHints ?? []),
      ...input.foundation.worldview.slice(0, 2).map((item) => item.name),
    ]).slice(0, 3),
    continuationAnchor: binding?.item.nextHook?.trim() || `${focusCharacters[0] ?? "主角"}带着新的线索继续推进。`,
    nextHook: binding?.item.nextHook?.trim() || `下一章要立即接住${currentVolumeGoal}的新压力。`,
    hookSlots: [
      {
        setupText: binding?.item.nextHook?.trim() || `下一章要立即接住${currentVolumeGoal}的新压力。`,
        payoffWindow: [input.chapterNo + 1, input.chapterNo + 3],
        priority: "medium",
        planIntent: "active",
      },
    ],
    payoffTargets,
    riskFlags: uniqueNonEmpty([
      binding?.item.nextHook ? "hook_debt" : "",
      focusCharacters.length >= 3 ? "focus_scatter" : "",
    ]) as ChapterPlanRiskFlag[],
    riskComment: "本计划由降级回填生成，后续应自动升级为完整 ChapterPlan。",
    status: "ready" as const,
    source: "degraded_backfill" as const,
    foundationDigest: input.foundationDigest,
    storyContractDigest: input.storyContractDigest,
    inputDigest: input.inputDigest,
    generationId: input.generationId,
    generationState: "ready" as const,
    generationToken: null,
    generationStartedAt: null,
    usedSegmentSummaryFallback: true,
    segmentId: binding?.segment.id ?? null,
    segmentItemId: binding?.item.id ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } satisfies ChapterPlan;
}

async function generateFullChapterPlan(input: {
  projectId: string;
  chapterNo: number;
  project: NonNullable<ReturnType<typeof getProject>>;
  foundation: FoundationPayload;
  storyContract: StoryContract;
  executionContext: ProjectExecutionContext;
  previousContinuationAnchor: string | null;
  previousSummary: string | null;
  recentPlanSummaries: string[];
  repairPrompt?: string | null;
}) {
  const currentBinding = getSegmentPlanItemForChapter(input.storyContract.segmentPlans, input.chapterNo);
  const currentVolumeGoal = getCurrentVolumeGoal(input.storyContract);
  const storyContractSummary = buildStoryContractSummary(input.storyContract);

  const plan = await chatJsonWithWorkflowPolicy(
    {
      workflow: "chapter_plan",
      profile: input.executionContext.agents.planner.profile,
      model: input.executionContext.agents.planner.assignment.model,
      messages: [
        {
          role: "system",
          content: `${input.executionContext.prompts.planner}

你现在负责生成章节级 ChapterPlan。必须先规划，再写蓝图。输出 JSON，不要输出解释。
要求：
1. purpose 只写本章唯一主任务，不要写泛泛情绪。
2. plotSummary 必须说明本章如何推进主线、人物与章末承接。
3. requiredBeats 写 3-6 条必须发生的推进动作。
4. keyEvents 写 2-5 个明确事件，不要写“展开描写”这种空话。
5. characterFocus 只保留真正改变局势的角色。
6. continuationAnchor 必须具体，可直接被下一章接住。
7. hookSlots 必须输出 0-N 个结构化钩子，字段只允许：setupText, payoffWindow, priority, planIntent, deferredUntilChapter。
8. 不要输出 nextHook，由系统从 hookSlots 自动回填兼容摘要。
9. riskFlags 只能从给定枚举里选。`,
        },
        {
          role: "user",
          content: [
            `项目：${input.project.title}`,
            buildProjectPromptSummary(input.project),
            `premise：${input.foundation.premise}`,
            `story contract：\n${storyContractSummary}`,
            `当前卷目标：${currentVolumeGoal}`,
            currentBinding?.item
              ? `当前章 skeleton：\n${JSON.stringify({
                chapterNo: currentBinding.item.chapterNo,
                title: currentBinding.item.title,
                intent: currentBinding.item.intent,
                requiredProgressDeltas: currentBinding.item.requiredProgressDeltas,
                requiredObligations: currentBinding.item.requiredObligations,
                focusCharacters: currentBinding.item.focusCharacters,
                arenaHints: currentBinding.item.arenaHints,
                antagonistHint: currentBinding.item.antagonistHint,
                nextHook: currentBinding.item.nextHook,
              }, null, 2)}`
              : "当前章 skeleton：暂无，需你补出最小可执行主线。",
            input.previousContinuationAnchor ? `上一章 continuationAnchor：${input.previousContinuationAnchor}` : "上一章 continuationAnchor：无",
            input.previousSummary ? `上一章摘要：${input.previousSummary}` : "",
            input.recentPlanSummaries.length
              ? `最近章节规划摘要：\n${input.recentPlanSummaries.join("\n")}`
              : "最近章节规划摘要：暂无",
            input.repairPrompt ? `本轮规划修复提示：\n${input.repairPrompt}` : "",
            `角色卡：\n${JSON.stringify(input.foundation.characters.slice(0, 6), null, 2)}`,
            `世界规则：\n${JSON.stringify(input.foundation.worldview.slice(0, 6), null, 2)}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
      assignmentMaxTokens: input.executionContext.agents.planner.assignment.maxTokens,
      temperature: Math.min(0.45, input.executionContext.agents.planner.assignment.temperature),
    },
    chapterPlanSchema,
  );

  return {
    ...plan,
    hookSlots: plan.hookSlots.map((slot) => ({
      ...slot,
      setupText: trimText(slot.setupText),
      deferredUntilChapter: slot.deferredUntilChapter ?? null,
    })),
    nextHook: deriveNextHookFromHookSlots(plan.hookSlots),
    relationshipShift: trimText(plan.relationshipShift),
    riskFlags: normalizeChapterPlanRiskFlags(plan.riskFlags),
    riskComment: trimText(plan.riskComment),
  };
}

export async function ensureChapterPlan(
  projectId: string,
  chapterNo: number,
  executionContext?: ProjectExecutionContext,
  options: EnsureChapterPlanOptions = {},
) {
  const startedAtMs = Date.now();
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  if (!project || !foundation) {
    throw new Error("缺少项目或设定数据，无法生成章节计划");
  }
  if (!isFoundationLocked(projectId)) {
    throw new Error("请先锁定正式设定，再生成章节计划");
  }

  const drift = getFoundationDriftReport(projectId);
  if (drift.coreDrift) {
    throw new Error(drift.blockingReason ?? "请先整理正式设定，再生成章节计划");
  }

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const baseStoryContract = project.storyContract ?? await ensureStoryContract(projectId, context);
  const storyContract = await ensureSegmentPlans(projectId, chapterNo, project, foundation, baseStoryContract, context);
  const previousPlan = chapterNo > 1 ? getChapterPlan(projectId, chapterNo - 1) : null;
  const foundationDigest = buildChapterPlanFoundationDigest(foundation);
  const storyContractDigest = buildChapterPlanStoryDigest({ storyContract, chapterNo });
  const inputDigest = buildChapterPlanInputDigest({
    chapterNo,
    foundationDigest,
    storyContractDigest,
    previousContinuationAnchor: previousPlan?.continuationAnchor ?? null,
  });
  const repository = createChapterPlanRepository();
  const existing = repository.get(projectId, chapterNo);

  const shouldUpgradeDegraded = existing?.status === "ready" && existing.source === "degraded_backfill";
  const isFreshReady = existing?.status === "ready"
    && existing.inputDigest === inputDigest
    && !shouldUpgradeDegraded
    && !options.forceRegenerate;
  if (isFreshReady) {
    return existing;
  }

  const claimToken = `chapter-plan:${projectId}:${chapterNo}:${Date.now()}`;
  const claim = repository.claimGeneration({
    projectId,
    chapterNo,
    foundationDigest,
    storyContractDigest,
    inputDigest,
    generationToken: claimToken,
    leaseTimeoutMs: CHAPTER_PLAN_LEASE_TIMEOUT_MS,
    source: shouldUpgradeDegraded ? "generated" : existing?.source ?? "generated",
    segmentId: getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo)?.segment.id ?? null,
    segmentItemId: getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo)?.item.id ?? null,
  });

  if (!claim.claimed) {
    if (claim.plan?.status === "ready" && claim.plan.inputDigest === inputDigest) {
      return claim.plan;
    }
    if (claim.plan?.status === "ready" && claim.plan.source === "degraded_backfill") {
      return claim.plan;
    }
    throw new Error(`第 ${chapterNo} 章 ChapterPlan 正在由其他流程生成，请稍后重试`);
  }

  try {
    const generated = await generateFullChapterPlan({
      projectId,
      chapterNo,
      project,
      foundation,
      storyContract,
      executionContext: context,
      previousContinuationAnchor: previousPlan?.continuationAnchor ?? null,
      previousSummary: getPreviousSummary(projectId, chapterNo),
      recentPlanSummaries: buildRecentChapterPlanSummaries(projectId, chapterNo),
      repairPrompt: options.repairPrompt,
    });

    const saved = upsertReadyChapterPlan({
      projectId,
      chapterNo,
      purpose: generated.purpose,
      plotSummary: generated.plotSummary,
      requiredBeats: generated.requiredBeats,
      keyEvents: generated.keyEvents,
      characterFocus: generated.characterFocus,
      relationshipShift: generated.relationshipShift,
      worldRuleUsage: generated.worldRuleUsage,
      continuationAnchor: generated.continuationAnchor,
      nextHook: generated.nextHook,
      hookSlots: generated.hookSlots,
      payoffTargets: generated.payoffTargets,
      riskFlags: generated.riskFlags,
      riskComment: generated.riskComment,
      status: "ready",
      source: "generated",
      foundationDigest,
      storyContractDigest,
      inputDigest,
      generationId: claim.plan?.generationId ?? (existing?.generationId ?? 0) + 1,
      generationState: "ready",
      generationToken: null,
      generationStartedAt: null,
      usedSegmentSummaryFallback: false,
      segmentId: getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo)?.segment.id ?? null,
      segmentItemId: getSegmentPlanItemForChapter(storyContract.segmentPlans, chapterNo)?.item.id ?? null,
    });
    appendRunStatistic(projectId, chapterNo, "chapter_plan", {
      source: "generated",
      generationId: saved.generationId,
      latencyMs: Date.now() - startedAtMs,
      usedSegmentSummaryFallback: false,
      upgradedFromDegraded: existing?.source === "degraded_backfill",
    });
    appendRunLog(projectId, "info", `第 ${chapterNo} 章 ChapterPlan 已生成，generationId=${saved.generationId}`);
    return saved;
  } catch (error) {
    if (options.allowDegradedFallback === false) {
      throw error;
    }
    if (existing?.status === "ready" && existing.source === "degraded_backfill") {
      const restored = upsertReadyChapterPlan({
        ...existing,
        updatedAt: nowIso(),
      });
      appendRunStatistic(projectId, chapterNo, "chapter_plan", {
        source: restored.source,
        generationId: restored.generationId,
        latencyMs: Date.now() - startedAtMs,
        usedSegmentSummaryFallback: restored.usedSegmentSummaryFallback,
        upgradedFromDegraded: false,
        restoredAfterUpgradeFailure: true,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      appendRunLog(
        projectId,
        "warning",
        `第 ${chapterNo} 章完整 ChapterPlan 升级失败，继续复用 degraded_backfill：${error instanceof Error ? error.message : "未知错误"}`,
      );
      return restored;
    }

    const degraded = upsertReadyChapterPlan(
      buildDegradedChapterPlan({
        projectId,
        chapterNo,
        storyContract,
        foundation,
        foundationDigest,
        storyContractDigest,
        inputDigest,
        generationId: claim.plan?.generationId ?? (existing?.generationId ?? 0) + 1,
        previousContinuationAnchor: previousPlan?.continuationAnchor ?? null,
      }),
    );
    appendRunStatistic(projectId, chapterNo, "chapter_plan", {
      source: "degraded_backfill",
      generationId: degraded.generationId,
      latencyMs: Date.now() - startedAtMs,
      usedSegmentSummaryFallback: true,
      upgradedFromDegraded: false,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    appendRunLog(
      projectId,
      "warning",
      `第 ${chapterNo} 章 ChapterPlan 使用 degraded_backfill 回填：${error instanceof Error ? error.message : "未知错误"}`,
    );
    return degraded;
  }
}
