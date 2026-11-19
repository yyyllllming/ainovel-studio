import { z } from "zod";
import { getProject, getStoryContract } from "../repositories/project.repository.ts";
import { listChapterDeltaRecords } from "../repositories/review.repository.ts";
import type { ProjectExecutionContext } from "../services/project-execution-context.ts";
import { ensureStoryContract } from "../story/story-contract-engine.ts";
import { hydrateStoryContract } from "../story/story-contract.ts";
import {
  buildGenreFulfillmentAssessment,
  buildLoopRiskAssessment,
  buildStoryProgressionAssessment,
} from "../story/story-progression.ts";
import { assessProseStyleRisk } from "../writing/prose-normalizer.ts";
import type {
  ChapterBlueprint,
  FoundationPayload,
  StoryContract,
  WritingCharter,
  WritingCharterBudgetViolation,
} from "../types.ts";

export function uniqueNonEmpty(values: Array<string | null | undefined>) {
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


export function buildAuthorHabitDirectives(context: ProjectExecutionContext) {
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

export function buildWriterBudgetSteeringLines(writingCharter?: WritingCharter | null) {
  if (!writingCharter) {
    return [];
  }

  return [
    "超预算项不是提醒，而是删改配额；一旦某项超过阈值，先删到预算内，再谈润色。",
    `连续 ${writingCharter.subjectLeadBudget.windowSize} 句叙述里，同一主体名词或代词起句不要超过 ${writingCharter.subjectLeadBudget.maxSameLeadInWindow} 次。`,
    `显性比喻（像/仿佛/如同/宛如/似乎）全章尽量压在 ${writingCharter.simileBudget.maxPerChapter} 处以内，单段不超过 ${writingCharter.simileBudget.maxPerParagraph} 处。`,
    `章末结论句压在 ${writingCharter.endingPolicy.maxConclusionSentences} 句以内，只钉一个新后患或新动作，不要反复回钉同一风险。`,
    `机制类信息显性总结句压在 ${writingCharter.mechanismRevealPolicy.maxExplicitSummarySentences} 句以内，解释 -> 验证 -> 总结三段式压在 ${writingCharter.mechanismRevealPolicy.maxTriadPatterns} 次以内。`,
    `同一意象或词块尽量不要反复回钉；单一母题全章不超过 ${writingCharter.motifReuseBudget.maxPerMotif} 次，至少跨 ${writingCharter.motifReuseBudget.minParagraphSpan} 段才算重复。`,
  ];
}

export function mergeCharterViolations(...groups: WritingCharterBudgetViolation[][]) {
  const merged: WritingCharterBudgetViolation[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const violation of group) {
      const key = `${violation.key}::${violation.actual}::${violation.limit}::${violation.detail}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(violation);
    }
  }

  return merged;
}

export function getRecentDeltaRecords(projectId: string, chapterNo: number) {
  return listChapterDeltaRecords(projectId, { uptoChapter: Math.max(0, chapterNo - 1) }).slice(-4);
}

export function buildRuntimeReviewAssessments(projectId: string, chapterNo: number, blueprint: ChapterBlueprint, contract: StoryContract) {
  const recentDeltaRecords = getRecentDeltaRecords(projectId, chapterNo);
  const loopRisk = buildLoopRiskAssessment({
    blueprint,
    recentDeltaRecords,
  });
  const storyProgression = buildStoryProgressionAssessment({
    blueprint,
    loopRisk,
  });
  const genreFulfillment = buildGenreFulfillmentAssessment({
    blueprint,
    activations: contract.genreObligationPacks,
  });

  return {
    storyProgression,
    genreFulfillment,
    loopRisk,
    primaryDeltaDelivered: storyProgression.primaryDelta,
    stuckDimensions: loopRisk.stuckDimensions,
  };
}

export async function resolveActiveStoryContract(
  projectId: string,
  project: NonNullable<ReturnType<typeof getProject>>,
  foundation: FoundationPayload,
  executionContext?: ProjectExecutionContext,
) {
  return hydrateStoryContract(
    project.storyContract ?? getStoryContract(projectId) ?? await ensureStoryContract(projectId, executionContext),
    {
      genre: project.genre,
      premise: foundation.premise,
      completionCriteria: project.completionCriteria,
      latestChapter: Math.max(
        project.storyContract?.progressState?.latestChapter
          ?? getStoryContract(projectId)?.progressState?.latestChapter
          ?? 0,
        0,
      ),
      foundation,
    },
  );
}

export const continuationDecisionSchema = z.object({
  decision: z.enum(["continue_chaptering", "end_volume", "enter_final_run", "complete_story"]),
  summary: z.string().min(1),
  nextPlan: z.array(z.string().min(1)).max(3).default([]),
});

const reviewIssueSchema = z.object({
  type: z.string(),
  location: z.string(),
  severity: z.enum(["minor", "major"]),
  evidence: z.string().optional(),
});

export function persistCrossChapterIssues(
  issues: Array<{ type: string; location: string; severity: "minor" | "major"; evidence?: string }>,
) {
  return issues.map((issue) => reviewIssueSchema.parse(issue));
}

const styleChecklistHitSchema = z.object({
  dimension: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["minor", "major"]),
});

const charterViolationSchema = z.object({
  key: z.enum([
    "ending_conclusion_sentence",
    "mechanism_explicit_summary",
    "mechanism_triad_pattern",
    "transition_contrast_template",
    "transition_abrupt_turn",
    "transition_hard_marker",
    "simile_per_chapter",
    "simile_per_paragraph",
    "rhetoric_density",
    "sensory_density",
    "subject_pronoun_lead",
    "subject_dominant_lead",
    "subject_window_repeat",
    "motif_reuse",
  ]),
  scope: z.enum(["ending", "mechanism", "transition", "simile", "rhetoric", "sensory", "subject_lead", "motif_reuse"]),
  label: z.string().min(1),
  actual: z.number(),
  limit: z.number(),
  detail: z.string().min(1),
  evidence: z.array(z.string()).default([]),
  severity: z.enum(["minor", "major"]),
});

const storyProgressionAssessmentSchema = z.object({
  risk: z.enum(["pass", "watch", "risk"]),
  score: z.number().min(0).max(100),
  summary: z.string().default(""),
  advancements: z.array(z.string()).default([]),
  stallSignals: z.array(z.string()).default([]),
  primaryDelta: z.enum([
    "situation_shift",
    "objective_shift",
    "information_shift",
    "relationship_shift",
    "power_shift",
    "world_shift",
    "cost_shift",
  ]).nullable().default(null),
  deliveredDeltas: z.array(z.enum([
    "situation_shift",
    "objective_shift",
    "information_shift",
    "relationship_shift",
    "power_shift",
    "world_shift",
    "cost_shift",
  ])).default([]),
});

const genreFulfillmentAssessmentSchema = z.object({
  risk: z.enum(["pass", "watch", "risk"]),
  score: z.number().min(0).max(100),
  summary: z.string().default(""),
  present: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
  activePacks: z.array(z.enum(["core-only", "mythic_beastiary", "romance"])).default([]),
});

const loopRiskAssessmentSchema = z.object({
  risk: z.enum(["pass", "watch", "risk"]),
  score: z.number().min(0).max(100),
  summary: z.string().default(""),
  repetitionAxes: z.array(z.string()).default([]),
  stuckDimensions: z.array(z.string()).default([]),
});

export const quickAuditSchema = z.object({
  verdict: z.enum(["pass", "escalate"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  fixInstructions: z.string().min(1),
  issues: z.array(reviewIssueSchema).default([]),
  triggerReasons: z
    .array(z.enum(["opening_window", "mid_window", "cadence", "final_chapter", "manual_checkpoint", "hard_conflict", "low_confidence", "major_progression"]))
    .default([]),
  styleChecklistHits: z.array(styleChecklistHitSchema).default([]),
  charterViolations: z.array(charterViolationSchema).default([]),
  storyProgression: storyProgressionAssessmentSchema.optional(),
  genreFulfillment: genreFulfillmentAssessmentSchema.nullable().optional(),
  loopRisk: loopRiskAssessmentSchema.optional(),
  primaryDeltaDelivered: z.enum([
    "situation_shift",
    "objective_shift",
    "information_shift",
    "relationship_shift",
    "power_shift",
    "world_shift",
    "cost_shift",
  ]).nullable().optional(),
  stuckDimensions: z.array(z.string()).default([]),
});

// 供审查类 prompt 使用的输出契约说明：把 schema 的枚举白名单直接告诉模型，
// 否则 openai_compatible 模型只能猜字段值，Zod 校验失败后整次深审会静默降级。
export const REVIEW_JSON_CONTRACT = [
  "JSON 字段取值硬约束（枚举值必须逐字使用，不得自造）：",
  '- verdict: 深审用 "pass"|"rewrite_current"|"manual_review_window"；极简检查用 "pass"|"escalate"',
  "- confidence: 0~1 数字",
  '- issues[]: {type: 字符串, location: 字符串, severity: "minor"|"major", evidence?: 字符串}',
  '- triggerReasons[]: "opening_window"|"mid_window"|"cadence"|"final_chapter"|"manual_checkpoint"|"hard_conflict"|"low_confidence"|"major_progression"',
  '- styleChecklistHits[]: {dimension, description, severity:"minor"|"major"}',
  "- charterViolations: 一律输出空数组 []（预算违规由本地规则门自动补充，不要自行填写）",
  '- storyProgression: {risk:"pass"|"watch"|"risk", score:0~100, summary, advancements[], stallSignals[], primaryDelta:"situation_shift"|"objective_shift"|"information_shift"|"relationship_shift"|"power_shift"|"world_shift"|"cost_shift"|null, deliveredDeltas[]: 同 primaryDelta 枚举}',
  '- genreFulfillment: {risk:"pass"|"watch"|"risk", score:0~100, summary, present[], missing[], activePacks[]: "core-only"|"mythic_beastiary"|"romance"}',
  '- loopRisk: {risk:"pass"|"watch"|"risk", score:0~100, summary, repetitionAxes[], stuckDimensions[]}',
  "- primaryDeltaDelivered: 同 primaryDelta 枚举或 null",
  "- windowStartChapter/windowEndChapter/earliestAffectedChapter（深审必填）: 数字",
].join("\n");

export const deepReviewSchema = z.object({
  verdict: z.enum(["pass", "rewrite_current", "manual_review_window"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  fixInstructions: z.string().min(1),
  issues: z.array(reviewIssueSchema).default([]),
  triggerReasons: z
    .array(z.enum(["opening_window", "mid_window", "cadence", "final_chapter", "manual_checkpoint", "hard_conflict", "low_confidence", "major_progression"]))
    .default([]),
  styleChecklistHits: z.array(styleChecklistHitSchema).default([]),
  charterViolations: z.array(charterViolationSchema).default([]),
  storyProgression: storyProgressionAssessmentSchema.optional(),
  genreFulfillment: genreFulfillmentAssessmentSchema.nullable().optional(),
  loopRisk: loopRiskAssessmentSchema.optional(),
  primaryDeltaDelivered: z.enum([
    "situation_shift",
    "objective_shift",
    "information_shift",
    "relationship_shift",
    "power_shift",
    "world_shift",
    "cost_shift",
  ]).nullable().optional(),
  stuckDimensions: z.array(z.string()).default([]),
  windowStartChapter: z.number().int().positive(),
  windowEndChapter: z.number().int().positive(),
  earliestAffectedChapter: z.number().int().positive().nullable(),
});

export const LONG_FORM_REWRITE_TIMEOUT_MS = 8 * 60_000;
export const BEST_EFFORT_REWRITE_TIMEOUT_MS = 90_000;

export function getProseRiskWeight(input: ReturnType<typeof assessProseStyleRisk>) {
  const simileRatio = input.sentenceCount ? input.simileCount / input.sentenceCount : 0;

  return input.score * 1000
    + input.warnings.length * 120
    + input.notes.length * 120
    + Math.round(input.pronounLeadRatio * 1000)
    + Math.round(simileRatio * 900)
    + input.contrastTemplateCount * 45
    + input.abruptTurnCount * 35
    + (input.dominantLead?.count ?? 0) * 25;
}

export function isBetterProseCandidate(
  candidate: ReturnType<typeof assessProseStyleRisk>,
  baseline: ReturnType<typeof assessProseStyleRisk>,
) {
  return getProseRiskWeight(candidate) < getProseRiskWeight(baseline);
}
