import "../server-only.ts";

import { z } from "zod";
import { buildProjectPromptSummary } from "../domain/project-structure.ts";
import { normalizeBlueprintCharacterReferences } from "../character/character-name-normalization.ts";
import { type ChatMessage } from "../llm.ts";
import { requestChatJsonForWorkflow } from "../llm-workflows.ts";
import { writePlannerTraceFile } from "../project-files.ts";
import { getProject, listActiveSteeringNotes, saveStoryContract } from "../repositories/project.repository.ts";
import { listChapterDeltaRecords } from "../repositories/review.repository.ts";
import { buildProjectWritingDnaPrompt } from "../services/foundation-generate.service.ts";
import type { ProjectExecutionContext } from "../services/project-execution-context.ts";
import { ensureRunSessionActive } from "../run/session-activation.ts";
import {
  buildPlannerAvoidanceDirectives,
  buildDiversityRequirements,
  buildPlannerQualitySummary,
  buildRecoveryBlueprint,
  verifyBlueprintCandidate,
} from "./blueprint-planner.ts";
import { applyHookGuidanceToBlueprint } from "./hook-plan.ts";
import { repairOpeningBlueprintPlaceholders } from "./chapter-steering.ts";
import { buildStoryContractSummary } from "./story-contract.ts";
import { readProjectSeedPatchFile, resolveSegmentRuntimeMetadata } from "./story-seed-patch.ts";
import { buildStructuredAvoidanceList, getSegmentPlanItemForChapter } from "./story-progression.ts";
import type {
  BlueprintCandidateAttempt,
  BlueprintVerification,
  ChapterBlueprint,
  ChapterPlan,
  DiversityRequirements,
  FoundationPayload,
  HookPlan,
  PlannerTraceArtifact,
  SegmentPlanItem,
  StoryContract,
} from "../types.ts";
import { clamp, nowIso } from "../utils.ts";

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

function buildAuthorHabitDirectives(context: ProjectExecutionContext) {
  const { styleProfile, chapterWordTarget } = context;
  const writingCharter = styleProfile.writingCharter;
  return uniqueNonEmpty([
    `章长锚点：参考 ${chapterWordTarget.sourceLabel}，正文尽量控制在 ${chapterWordTarget.min}-${chapterWordTarget.max} 字，优先贴近 ${chapterWordTarget.target} 字，不要明显短于 ${chapterWordTarget.min} 字。`,
    writingCharter?.openingMoveRule ? `开篇策略必须执行：${writingCharter.openingMoveRule}` : styleProfile.openingStrategy ? `开篇策略必须执行：${styleProfile.openingStrategy}` : "",
    writingCharter?.mechanismRevealRule ? `机制类信息露出必须执行：${writingCharter.mechanismRevealRule}` : "",
    writingCharter?.mechanismRevealRedlines?.length ? `机制类信息露出禁区：${writingCharter.mechanismRevealRedlines.join("；")}` : "",
    writingCharter?.infoRevealRule ? `设定露出必须执行：${writingCharter.infoRevealRule}` : styleProfile.infoRevealRule ? `设定露出必须执行：${styleProfile.infoRevealRule}` : "",
    writingCharter?.emotionLandingRule ? `情绪落法必须执行：${writingCharter.emotionLandingRule}` : styleProfile.emotionRenderingRule ? `情绪落法必须执行：${styleProfile.emotionRenderingRule}` : "",
    writingCharter?.chapterClosureRule ? `章末收束必须执行：${writingCharter.chapterClosureRule}` : styleProfile.chapterClosureRule ? `章末收束必须执行：${styleProfile.chapterClosureRule}` : "",
    writingCharter?.transitionRule ? `转场和转折必须执行：${writingCharter.transitionRule}` : styleProfile.sentenceRhythm.transitionRule ? `转场和转折必须执行：${styleProfile.sentenceRhythm.transitionRule}` : "",
    writingCharter?.pauseRule ? `停顿和留白必须执行：${writingCharter.pauseRule}` : styleProfile.sentenceRhythm.pauseRule ? `停顿和留白必须执行：${styleProfile.sentenceRhythm.pauseRule}` : "",
    writingCharter?.aiFlavorAvoidance?.length ? `优先规避这些 AI 味：${writingCharter.aiFlavorAvoidance.join("、")}` : styleProfile.aiSmellPatterns.length ? `优先规避这些 AI 味：${styleProfile.aiSmellPatterns.join("、")}` : "",
    writingCharter?.tabooReminders?.length ? `风格禁忌：${writingCharter.tabooReminders.join("、")}` : styleProfile.styleTaboos.length ? `风格禁忌：${styleProfile.styleTaboos.join("、")}` : "",
  ]);
}

function alignBlueprintEstimatedWords(
  blueprint: ChapterBlueprint,
  chapterWordTarget: ProjectExecutionContext["chapterWordTarget"],
): ChapterBlueprint {
  const estimatedWords = Number.isFinite(blueprint.estimatedWords)
    ? clamp(Math.round(blueprint.estimatedWords), chapterWordTarget.min, chapterWordTarget.max)
    : chapterWordTarget.target;

  if (estimatedWords === blueprint.estimatedWords) {
    return blueprint;
  }

  return {
    ...blueprint,
    estimatedWords,
  };
}

function getRecentDeltaRecords(projectId: string, chapterNo: number) {
  return listChapterDeltaRecords(projectId, { uptoChapter: Math.max(0, chapterNo - 1) }).slice(-4);
}

const hookBindingSchema = z.object({
  hookPlanId: z.string().min(1),
  foreshadowText: z.string().min(1).optional(),
  bindingText: z.string().min(1).optional(),
  setupText: z.string().min(1).optional(),
  payoffText: z.string().min(1).optional(),
}).transform((value) => ({
  hookPlanId: value.hookPlanId,
  foreshadowText: value.foreshadowText ?? value.bindingText ?? value.payoffText ?? value.setupText ?? "",
}));

const blueprintSchema = z.object({
  chapterNo: z.number().int().positive(),
  sceneGoal: z.string().min(1),
  characters: z.array(z.string()).min(1),
  locations: z.array(z.string()).min(1),
  conflicts: z.array(z.string()).min(1),
  foreshadows: z.array(z.string()).default([]),
  hookBindings: z.array(hookBindingSchema).optional(),
  emotionalTone: z.string().min(1),
  estimatedWords: z.number().int().positive(),
  segmentId: z.string().nullable().optional(),
  segmentItemId: z.string().nullable().optional(),
  requiredProgressDelta: z.enum([
    "situation_shift",
    "objective_shift",
    "information_shift",
    "relationship_shift",
    "power_shift",
    "world_shift",
    "cost_shift",
  ]).optional(),
});

const blueprintCandidateSchema = z.object({
  reason: z.string().default(""),
  blueprint: blueprintSchema,
});

function rankBlueprintAttempt(
  attempts: Array<{
    candidate: ChapterBlueprint;
    verification: BlueprintVerification;
    index: number;
  }>,
) {
  return [...attempts].sort((left, right) =>
    (Number(right.verification.pass) - Number(left.verification.pass))
    || (right.verification.score - left.verification.score)
    || (right.verification.futureHookCompleteness - left.verification.futureHookCompleteness)
    || (right.verification.loopRiskScore - left.verification.loopRiskScore)
    || (right.verification.obligationScore - left.verification.obligationScore)
    || (left.index - right.index))[0] ?? null;
}

export async function planChapterBlueprint(input: {
  projectId: string;
  chapterNo: number;
  project: NonNullable<ReturnType<typeof getProject>>;
  foundation: FoundationPayload;
  context: ProjectExecutionContext;
  chapterPlan: ChapterPlan;
  hookPlans: HookPlan[];
  storyContract: StoryContract;
  segmentBinding: ReturnType<typeof getSegmentPlanItemForChapter>;
  leadCharacterName: string;
  currentVolumeGoal: string;
  mustAdvance: StoryContract["activeProgressionAxes"];
  plannerContextSummary: string;
  futureContext: string;
  plannerExemplars: string[];
  activeNotes: ReturnType<typeof listActiveSteeringNotes>;
  reason?: string;
  sessionId?: string;
}) {
  const projectSeedPatch = await readProjectSeedPatchFile(input.projectId);
  const consumedFutureBeats = new Set(input.storyContract.progressState.consumedFutureBeats ?? []);
  const hydrateRuntimeItem = (item: SegmentPlanItem | null) =>
    item
      ? {
        ...item,
        ...resolveSegmentRuntimeMetadata({
          item,
          patch: projectSeedPatch,
          storyContract: input.storyContract,
        }),
      }
      : null;
  const runtimeSegmentBinding = input.segmentBinding
    ? {
      ...input.segmentBinding,
      item: hydrateRuntimeItem(input.segmentBinding.item)!,
    }
    : null;
  const resolveSegmentBinding = (targetChapterNo: number) => {
    const direct = getSegmentPlanItemForChapter(input.storyContract.segmentPlans, targetChapterNo);
    const binding = direct?.item && !consumedFutureBeats.has(direct.item.id)
      ? direct
      : (() => {
        const nextCandidate = input.storyContract.segmentPlans
          .flatMap((segment) => segment.items.map((item) => ({ segment, item })))
          .filter((entry) => entry.item.chapterNo >= targetChapterNo && !consumedFutureBeats.has(entry.item.id))
          .sort((left, right) => left.item.chapterNo - right.item.chapterNo)[0];
        return nextCandidate ?? null;
      })();
    return binding
      ? { ...binding, item: hydrateRuntimeItem(binding.item)! }
      : null;
  };
  const resolveRequiredProgressDelta = (targetChapterNo: number, fallbackIndex = 0) =>
    resolveSegmentBinding(targetChapterNo)?.item?.requiredProgressDeltas?.[0]
    ?? input.mustAdvance[fallbackIndex % Math.max(input.mustAdvance.length, 1)]
    ?? "information_shift";
  const nextItem = resolveSegmentBinding(input.chapterNo + 1)?.item ?? null;
  const nextNextItem = resolveSegmentBinding(input.chapterNo + 2)?.item ?? null;
  const recentDeltaRecords = getRecentDeltaRecords(input.projectId, input.chapterNo);
  const structuredAvoidance = buildStructuredAvoidanceList(input.storyContract.progressState);
  const plannerAvoidance = buildPlannerAvoidanceDirectives({
    progressState: input.storyContract.progressState,
    patch: projectSeedPatch,
    storyContract: input.storyContract,
    recentDeltaRecords,
  });
  const activePackIds = input.storyContract.genreObligationPacks.filter((entry) => entry.active).map((entry) => entry.id);
  const plannerTrace: PlannerTraceArtifact = {
    chapterNo: input.chapterNo,
    plannerContextSummary: input.plannerContextSummary,
    futureContext: input.futureContext,
    promptSummaries: [],
    candidateAttempts: [],
    selectedCandidateIndex: null,
    selectedReason: "",
    selectedScore: null,
    repairUsed: false,
    repairRawContent: null,
    repairCandidate: null,
    repairVerification: null,
    repairError: null,
    fallbackUsed: false,
    fallbackReason: null,
    usedRecoveryBlueprint: false,
    recoveryShifts: [],
    finalBlueprint: null,
    plannerQuality: null,
    recordedAt: nowIso(),
  };

  const concretizeOpeningBlueprint = (blueprint: ChapterBlueprint) =>
    repairOpeningBlueprintPlaceholders({
      blueprint,
      protagonistName: input.leadCharacterName,
      currentVolumeGoal: input.currentVolumeGoal,
      projectPremise: input.foundation.premise,
      foundationCharacters: input.foundation.characters,
      foundationWorldview: input.foundation.worldview,
    });
  const normalizeCandidateBlueprint = (blueprint: ChapterBlueprint) =>
    applyHookGuidanceToBlueprint(
      concretizeOpeningBlueprint(
        alignBlueprintEstimatedWords(
          normalizeBlueprintCharacterReferences(
            {
              ...blueprint,
              chapterNo: input.chapterNo,
              segmentId: blueprint.segmentId ?? runtimeSegmentBinding?.segment.id ?? null,
              segmentItemId: blueprint.segmentItemId ?? runtimeSegmentBinding?.item.id ?? null,
              requiredProgressDelta: blueprint.requiredProgressDelta ?? resolveRequiredProgressDelta(input.chapterNo, 0),
              sourcePlanGenerationId: input.chapterPlan.generationId,
            },
            input.foundation,
          ),
          input.context.chapterWordTarget,
        ),
      ),
      input.hookPlans,
    );

  const buildCandidateMessages = (attemptNo: number, diversityRequirements: DiversityRequirements | null): ChatMessage[] => {
    const promptSummary = [
      `attempt=${attemptNo}`,
      `mustAdvance=${runtimeSegmentBinding?.item?.requiredProgressDeltas?.join("/") || input.mustAdvance.join("/")}`,
      `packs=${activePackIds.join("/") || "core-only"}`,
      diversityRequirements?.promptLines.length ? `diversity=${diversityRequirements.promptLines.join(" | ")}` : "diversity=none",
      plannerAvoidance.promptLines.length ? `avoidance=${plannerAvoidance.promptLines.join(" | ")}` : "avoidance=none",
    ].join(" ; ");
    plannerTrace.promptSummaries.push(promptSummary);

    return [
      {
        role: "system",
        content: `${input.context.prompts.planner}

你现在负责当前章的内部剧情规划，只输出一个当前章候选蓝图。
必须输出严格 JSON：reason, blueprint。
blueprint 必须包含 chapterNo, sceneGoal, characters, locations, conflicts, foreshadows, emotionalTone, estimatedWords, requiredProgressDelta。
如果本轮提供了 hook slots，则 blueprint 还必须返回 hookBindings，且每条 hookBindings 都要引用给定的 hookPlanId。
hookBindings 的唯一合法字段形状是：[{\"hookPlanId\":\"...\",\"foreshadowText\":\"...\"}]。不要返回 setupText、bindingText、payoffText 这类替代字段。
不允许输出连续多章，不允许输出 batch。`,
      },
      {
        role: "user",
        content: [
          `项目：${input.project.title}`,
          buildProjectPromptSummary(input.project),
          `项目 premise：${input.foundation.premise}`,
          `story contract：\n${buildStoryContractSummary(input.storyContract)}`,
          `当前章 ChapterPlan：\n${JSON.stringify(input.chapterPlan, null, 2)}`,
          input.hookPlans.length ? `当前章 hook slots：\n${JSON.stringify(input.hookPlans, null, 2)}` : "",
          input.plannerContextSummary,
          input.futureContext,
          runtimeSegmentBinding
            ? `当前段落计划：\n${JSON.stringify({
              segment: {
                id: runtimeSegmentBinding.segment.id,
                label: runtimeSegmentBinding.segment.label,
                startChapter: runtimeSegmentBinding.segment.startChapter,
                endChapter: runtimeSegmentBinding.segment.endChapter,
              },
              item: runtimeSegmentBinding.item,
              mustAdvance: input.storyContract.progressState.mustAdvance,
              activePacks: activePackIds,
            }, null, 2)}`
            : "",
          `角色：${JSON.stringify(input.foundation.characters, null, 2)}`,
          `世界观：${JSON.stringify(input.foundation.worldview, null, 2)}`,
          `内置写作 DNA：\n${buildProjectWritingDnaPrompt({
            project: input.project,
            foundation: input.foundation,
            styleProfile: input.context.styleProfile,
          })}`,
          input.plannerExemplars.length ? `planner exemplars：\n${input.plannerExemplars.join("\n\n---\n\n")}` : "",
          input.activeNotes.length ? `追加 steering：\n${input.activeNotes.map((item) => `[${item.scope}] ${item.instruction}`).join("\n")}` : "",
          `作者章长参考：${input.context.chapterWordTarget.sourceLabel}；均章约 ${input.context.chapterWordTarget.sourceAverage ?? input.context.chapterWordTarget.target} 字，本章 estimatedWords 请尽量落在 ${input.context.chapterWordTarget.min}-${input.context.chapterWordTarget.max} 字，优先贴近 ${input.context.chapterWordTarget.target} 字。`,
          `作者写法硬约束：\n- ${buildAuthorHabitDirectives(input.context).slice(0, 6).join("\n- ")}`,
          input.reason ? `本次补充说明：${input.reason}` : "本次补充说明：无",
          plannerAvoidance.promptLines.length
            ? `本章反重复约束：\n- ${plannerAvoidance.promptLines.join("\n- ")}`
            : "",
          diversityRequirements?.promptLines.length
            ? `本轮差异要求：\n- ${diversityRequirements.promptLines.join("\n- ")}`
            : "本轮差异要求：首个候选，先给出最具体、最可直接开写的场景方案。",
          "硬性规则：characters 字段与 sceneGoal / conflicts / foreshadows 中涉及角色时，统一使用正式设定里的真实姓名，不要写“主角 / 男主 / 女主 / 反派 / 配角”这类占位称呼。",
          input.hookPlans.length
            ? "硬性规则：本章已有 hook slots。请把 foreshadows 明确映射到 hookBindings；每条 binding 只返回 hookPlanId 和 foreshadowText；若无法稳定映射，请不要编造新的 hookPlanId。"
            : "",
        ].filter(Boolean).join("\n\n"),
      },
    ];
  };

  const candidateEntries: Array<{
    candidate: ChapterBlueprint;
    verification: BlueprintVerification;
    index: number;
  }> = [];

  for (let attemptNo = 1; attemptNo <= 3; attemptNo += 1) {
    if (input.sessionId) {
      ensureRunSessionActive(input.projectId, input.sessionId, {
        allowPaused: true,
      });
    }
    const diversityRequirements =
      attemptNo === 1
        ? null
        : buildDiversityRequirements(
          candidateEntries.map((entry) => entry.candidate),
          candidateEntries.map((entry) => entry.verification),
          runtimeSegmentBinding?.item ?? null,
          structuredAvoidance,
        );
    const messages = buildCandidateMessages(attemptNo, diversityRequirements);
    let rawContent = "";
    let candidate: ChapterBlueprint | null = null;
    let verification: BlueprintVerification | null = null;

    try {
      let traced = await requestChatJsonForWorkflow(
        {
          workflow: "blueprint_candidate",
          profile: input.context.agents.planner.profile,
          model: input.context.agents.planner.assignment.model,
          messages,
          assignmentMaxTokens: input.context.agents.planner.assignment.maxTokens,
          temperature: Math.min(0.7, Math.max(0.35, input.context.agents.planner.assignment.temperature + (attemptNo === 1 ? 0 : 0.1))),
        },
        blueprintCandidateSchema,
      );
      if (traced.finishReason === "length" && traced.maxTokensUsed < traced.policy.hardCap) {
        traced = await requestChatJsonForWorkflow(
          {
            workflow: "blueprint_candidate",
            profile: input.context.agents.planner.profile,
            model: input.context.agents.planner.assignment.model,
            messages,
            assignmentMaxTokens: input.context.agents.planner.assignment.maxTokens,
            temperature: Math.min(0.7, Math.max(0.35, input.context.agents.planner.assignment.temperature + (attemptNo === 1 ? 0 : 0.1))),
          },
          blueprintCandidateSchema,
          traced.policy.hardCap,
        );
      }
      rawContent = traced.attempts.at(-1)?.content ?? "";
      candidate = normalizeCandidateBlueprint(traced.value.blueprint);
      verification = verifyBlueprintCandidate({
        blueprint: candidate,
        segmentBinding: runtimeSegmentBinding,
        nextItem,
        nextNextItem,
        mustAdvance: input.mustAdvance,
        activations: input.storyContract.genreObligationPacks,
        recentDeltaRecords,
      });
      candidateEntries.push({
        candidate,
        verification,
        index: attemptNo - 1,
      });
    } catch (error) {
      const tracedAttempts = (error as Error & { attempts?: Array<{ content: string }> }).attempts;
      rawContent = tracedAttempts?.at(-1)?.content ?? "";
    }

    plannerTrace.candidateAttempts.push({
      attemptNo,
      promptSummary: plannerTrace.promptSummaries.at(-1) ?? `attempt=${attemptNo}`,
      rawContent,
      candidate,
      verification,
      diversityRequirements,
    } satisfies BlueprintCandidateAttempt);
  }

  const bestCandidate = rankBlueprintAttempt(candidateEntries);
  let selectedBlueprint = bestCandidate?.candidate ?? null;
  let selectedVerification = bestCandidate?.verification ?? null;
  if (bestCandidate) {
    plannerTrace.selectedCandidateIndex = bestCandidate.index;
    plannerTrace.selectedScore = bestCandidate.verification.score;
    plannerTrace.selectedReason = [
      `candidate=${bestCandidate.index + 1}`,
      `score=${bestCandidate.verification.score}`,
      `futureHook=${bestCandidate.verification.futureHookCompleteness}`,
      `loop=${bestCandidate.verification.loopRiskScore}`,
      `obligation=${bestCandidate.verification.obligationScore}`,
    ].join(" / ");
  }

  if (bestCandidate && !bestCandidate.verification.pass) {
    plannerTrace.repairUsed = true;
    const repairMessages: ChatMessage[] = [
      {
        role: "system",
        content: `${input.context.prompts.planner}

你现在执行“当前章候选蓝图”的高具体性修补。
只修补这一版候选，不另起炉灶。
必须输出严格 JSON：reason, blueprint。
如果输入里有 hook slots，修补后的 blueprint 仍要返回合法的 hookBindings。`,
      },
      {
        role: "user",
        content: [
          `项目：${input.project.title}`,
          `当前章 ChapterPlan：\n${JSON.stringify(input.chapterPlan, null, 2)}`,
          input.hookPlans.length ? `当前章 hook slots：\n${JSON.stringify(input.hookPlans, null, 2)}` : "",
          input.plannerContextSummary,
          input.futureContext,
          `当前候选：\n${JSON.stringify(bestCandidate.candidate, null, 2)}`,
          `必须修补的问题：\n- ${bestCandidate.verification.reasons.join("\n- ")}`,
          plannerAvoidance.promptLines.length
            ? `仍须遵守的反重复约束：\n- ${plannerAvoidance.promptLines.join("\n- ")}`
            : "",
          "要求：把 sceneGoal 收束到具体动作链、具体阻力、具体代价和单一主疑问；必须承接下一章，并为下下章留出明确伏笔位。若有 hookBindings，只返回 hookPlanId 和 foreshadowText。",
        ].join("\n\n"),
      },
    ];
    try {
      let repairResult = await requestChatJsonForWorkflow(
        {
          workflow: "blueprint_repair",
          profile: input.context.agents.planner.profile,
          model: input.context.agents.planner.assignment.model,
          messages: repairMessages,
          assignmentMaxTokens: input.context.agents.planner.assignment.maxTokens,
          temperature: Math.min(input.context.agents.planner.assignment.temperature, 0.4),
        },
        blueprintCandidateSchema,
      );
      if (repairResult.finishReason === "length" && repairResult.maxTokensUsed < repairResult.policy.hardCap) {
        repairResult = await requestChatJsonForWorkflow(
          {
            workflow: "blueprint_repair",
            profile: input.context.agents.planner.profile,
            model: input.context.agents.planner.assignment.model,
            messages: repairMessages,
            assignmentMaxTokens: input.context.agents.planner.assignment.maxTokens,
            temperature: Math.min(input.context.agents.planner.assignment.temperature, 0.4),
          },
          blueprintCandidateSchema,
          repairResult.policy.hardCap,
        );
      }
      plannerTrace.repairRawContent = repairResult.attempts.at(-1)?.content ?? "";
      plannerTrace.repairCandidate = normalizeCandidateBlueprint(repairResult.value.blueprint);
      plannerTrace.repairVerification = verifyBlueprintCandidate({
        blueprint: plannerTrace.repairCandidate,
        segmentBinding: runtimeSegmentBinding,
        nextItem,
        nextNextItem,
        mustAdvance: input.mustAdvance,
        activations: input.storyContract.genreObligationPacks,
        recentDeltaRecords,
      });

      if (
        plannerTrace.repairVerification.pass
        || plannerTrace.repairVerification.score > (selectedVerification?.score ?? -1)
      ) {
        selectedBlueprint = plannerTrace.repairCandidate;
        selectedVerification = plannerTrace.repairVerification;
        plannerTrace.selectedReason = `repair_after_candidate_${bestCandidate.index + 1} / score=${plannerTrace.repairVerification.score}`;
        plannerTrace.selectedScore = plannerTrace.repairVerification.score;
      }
    } catch (error) {
      const tracedAttempts = (error as Error & { attempts?: Array<{ content: string }> }).attempts;
      plannerTrace.repairRawContent = tracedAttempts?.at(-1)?.content ?? null;
      plannerTrace.repairError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!selectedBlueprint || (!selectedVerification?.pass && (selectedVerification?.score ?? 0) < 4)) {
    if (selectedBlueprint && (selectedVerification?.score ?? 0) >= 4) {
      // 本不该进入 fallback：高分候选被 score < 4 门槛拦截说明逻辑异常，记录但不替换
    }
    plannerTrace.fallbackUsed = true;
    plannerTrace.fallbackReason = selectedVerification?.reasons.join("；")
      || "规划器没有给出通过 verifier 的候选蓝图。";
    const recoveryBlueprint = buildRecoveryBlueprint({
      chapterNo: input.chapterNo,
      foundation: input.foundation,
      segmentBinding: runtimeSegmentBinding,
      nextItem,
      nextNextItem,
      leadCharacterName: input.leadCharacterName,
      currentVolumeGoal: input.currentVolumeGoal,
      estimatedWords: input.context.chapterWordTarget.target,
      defaultProgressDelta: resolveRequiredProgressDelta(input.chapterNo, 0),
      progressState: input.storyContract.progressState,
      recentDeltaRecords,
      plannerAvoidance,
      seedPatch: projectSeedPatch,
      storyContract: input.storyContract,
    });
    selectedBlueprint = normalizeCandidateBlueprint(recoveryBlueprint.blueprint);
    selectedVerification = verifyBlueprintCandidate({
      blueprint: selectedBlueprint,
      segmentBinding: runtimeSegmentBinding,
      nextItem,
      nextNextItem,
      mustAdvance: input.mustAdvance,
      activations: input.storyContract.genreObligationPacks,
      recentDeltaRecords,
    });
    plannerTrace.selectedReason = plannerTrace.selectedReason || "recovery blueprint";
    plannerTrace.selectedScore = selectedVerification.score;
    plannerTrace.usedRecoveryBlueprint = true;
    const recoveryShifts = [...recoveryBlueprint.recoveryShifts];
    if (selectedBlueprint.segmentItemId && selectedBlueprint.segmentItemId !== runtimeSegmentBinding?.item?.id) {
      consumedFutureBeats.add(selectedBlueprint.segmentItemId);
      input.storyContract.progressState = {
        ...input.storyContract.progressState,
        consumedFutureBeats: [...consumedFutureBeats],
      };
      saveStoryContract(input.projectId, {
        ...input.storyContract,
        progressState: input.storyContract.progressState,
        updatedAt: nowIso(),
      });
    }
    plannerTrace.recoveryShifts = recoveryShifts;
  }

  const plannerQuality = buildPlannerQualitySummary({
    candidateAttempts: plannerTrace.candidateAttempts,
    selectedScore: plannerTrace.selectedScore,
    selectedReason: plannerTrace.selectedReason,
    repairUsed: plannerTrace.repairUsed,
    fallbackUsed: plannerTrace.fallbackUsed,
    usedRecoveryBlueprint: plannerTrace.usedRecoveryBlueprint,
  });
  plannerTrace.finalBlueprint = selectedBlueprint;
  plannerTrace.plannerQuality = plannerQuality;
  plannerTrace.recordedAt = nowIso();
  await writePlannerTraceFile(input.projectId, input.chapterNo, plannerTrace);

  return {
    blueprint: selectedBlueprint,
    verification: selectedVerification,
    trace: plannerTrace,
    plannerQuality,
  };
}
