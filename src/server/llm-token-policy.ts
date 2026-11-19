import "./server-only.ts";

import { estimateModelTokens } from "./text-metrics.ts";

/**
 * Token policy guide:
 * - `assignment.maxTokens` is the per-role ceiling configured by the project.
 * - `WORKFLOW_TOKEN_CAPS` stays as the workflow hard-cap registry.
 * - `resolveOutputPolicy()` decides the actual request budget per workflow.
 * - `candidateLadder` only handles request-stage token budget failures.
 * - `continuationMode` only handles response-stage truncation (`finish_reason=length`).
 */

export type OutputContinuationMode =
  | "visible_short"
  | "visible_long_stream"
  | "visible_long_nonstream"
  | "structured_json";

export type OutputWorkflow =
  | "foundation_workshop_reply"
  | "foundation_workshop_stream_reply"
  | "foundation_workshop_fallback_reply"
  | "foundation_style_search_structured"
  | "foundation_style_search_line_fallback"
  | "foundation_style_steering"
  | "idea_workshop_stream_reply"
  | "idea_workshop_natural_reply"
  | "card_workshop_reply"
  | "continuation_decision"
  | "foundation_draft_sync"
  | "foundation_generate"
  | "foundation_character_rename"
  | "foundation_expansion"
  | "story_contract"
  | "chapter_plan"
  | "segment_rewrite"
  | "blueprint_candidate"
  | "blueprint_repair"
  | "chapter_draft_stream"
  | "rewrite_from_review"
  | "chapter_style_pass"
  | "chapter_version_generate"
  | "quick_audit"
  | "deep_review"
  | "manual_review_pick"
  | "chapter_optimize_patch"
  | "canon_summary"
  | "canon_facts"
  | "canon_snapshot";

export interface ResolveOutputPolicyInput {
  workflow: OutputWorkflow;
  promptTokens: number;
  assignmentMaxTokens: number;
  targetWords?: number;
}

export interface ResolvedOutputPolicy {
  workflowMin: number;
  softTarget: number;
  hardCap: number;
  candidateLadder: number[];
  continuationMode: OutputContinuationMode;
  alwaysContinueToSentence: boolean;
}

interface WorkflowOutputPolicyConfig {
  workflowMin: number;
  workflowCap: number;
  continuationMode: OutputContinuationMode;
  alwaysContinueToSentence?: boolean;
  resolveSoftTarget: (input: Pick<ResolveOutputPolicyInput, "promptTokens" | "targetWords">) => number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fixedSoftTarget(softTarget: number) {
  return () => softTarget;
}

function dynamicSoftTarget(
  resolver: WorkflowOutputPolicyConfig["resolveSoftTarget"],
): WorkflowOutputPolicyConfig["resolveSoftTarget"] {
  return resolver;
}

function uniqueNumbers(values: number[]) {
  return Array.from(
    new Set(
      values
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.max(1, Math.round(value))),
    ),
  );
}

function buildCandidateLadder(softTarget: number, workflowMin: number, hardCap: number) {
  const ladder = uniqueNumbers([
    softTarget,
    Math.max(workflowMin, softTarget - 300),
    Math.max(workflowMin, softTarget - 600),
  ]).filter((value) => value <= hardCap);

  return ladder.length ? ladder : [Math.max(1, Math.round(hardCap))];
}

const WORKFLOW_OUTPUT_CONFIG: Record<OutputWorkflow, WorkflowOutputPolicyConfig> = {
  foundation_workshop_reply: {
    workflowMin: 1200,
    workflowCap: 2200,
    continuationMode: "structured_json",
    resolveSoftTarget: fixedSoftTarget(1500),
  },
  foundation_workshop_stream_reply: {
    workflowMin: 1800,
    workflowCap: 4200,
    continuationMode: "visible_long_stream",
    alwaysContinueToSentence: true,
    resolveSoftTarget: fixedSoftTarget(2500),
  },
  foundation_workshop_fallback_reply: {
    workflowMin: 900,
    workflowCap: 2200,
    continuationMode: "visible_short",
    resolveSoftTarget: fixedSoftTarget(1200),
  },
  foundation_style_search_structured: {
    workflowMin: 900,
    workflowCap: 1400,
    continuationMode: "structured_json",
    resolveSoftTarget: fixedSoftTarget(1200),
  },
  foundation_style_search_line_fallback: {
    workflowMin: 600,
    workflowCap: 900,
    continuationMode: "visible_short",
    resolveSoftTarget: fixedSoftTarget(900),
  },
  foundation_style_steering: {
    workflowMin: 1200,
    workflowCap: 1600,
    continuationMode: "structured_json",
    resolveSoftTarget: fixedSoftTarget(1400),
  },
  idea_workshop_stream_reply: {
    workflowMin: 1800,
    workflowCap: 4200,
    continuationMode: "visible_long_stream",
    alwaysContinueToSentence: true,
    resolveSoftTarget: fixedSoftTarget(2500),
  },
  idea_workshop_natural_reply: {
    workflowMin: 900,
    workflowCap: 2200,
    continuationMode: "visible_long_nonstream",
    resolveSoftTarget: fixedSoftTarget(1600),
  },
  card_workshop_reply: {
    workflowMin: 1200,
    workflowCap: 2200,
    continuationMode: "structured_json",
    resolveSoftTarget: fixedSoftTarget(1500),
  },
  continuation_decision: {
    workflowMin: 900,
    workflowCap: 1600,
    continuationMode: "structured_json",
    resolveSoftTarget: fixedSoftTarget(1200),
  },
  foundation_draft_sync: {
    workflowMin: 1200,
    workflowCap: 2200,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 700),
  },
  foundation_generate: {
    workflowMin: 1800,
    workflowCap: 4200,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.2 + 1200),
  },
  foundation_character_rename: {
    workflowMin: 1200,
    workflowCap: 2600,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 700),
  },
  foundation_expansion: {
    workflowMin: 1800,
    workflowCap: 3600,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.2 + 1200),
  },
  story_contract: {
    workflowMin: 1200,
    workflowCap: 2200,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 700),
  },
  chapter_plan: {
    workflowMin: 1400,
    workflowCap: 2600,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.2 + 800),
  },
  segment_rewrite: {
    workflowMin: 1200,
    workflowCap: 2400,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 700),
  },
  blueprint_candidate: {
    workflowMin: 1400,
    workflowCap: 2600,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.2 + 800),
  },
  blueprint_repair: {
    workflowMin: 1200,
    workflowCap: 2200,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 700),
  },
  chapter_draft_stream: {
    workflowMin: 2200,
    workflowCap: 6000,
    continuationMode: "visible_long_stream",
    alwaysContinueToSentence: true,
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens, targetWords }) =>
      Math.max((targetWords ?? 0) * 1.4, promptTokens * 0.2 + 1600)
    ),
  },
  rewrite_from_review: {
    workflowMin: 1500,
    workflowCap: 4200,
    continuationMode: "visible_long_nonstream",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.3 + 1000),
  },
  chapter_style_pass: {
    workflowMin: 1500,
    workflowCap: 3800,
    continuationMode: "visible_long_nonstream",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.28 + 900),
  },
  chapter_version_generate: {
    workflowMin: 1500,
    workflowCap: 4200,
    continuationMode: "visible_long_nonstream",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.3 + 1000),
  },
  quick_audit: {
    workflowMin: 900,
    workflowCap: 1400,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.15 + 500),
  },
  deep_review: {
    workflowMin: 1200,
    workflowCap: 2400,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 700),
  },
  manual_review_pick: {
    workflowMin: 900,
    workflowCap: 1600,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.15 + 500),
  },
  chapter_optimize_patch: {
    workflowMin: 1200,
    workflowCap: 1800,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 700),
  },
  canon_summary: {
    workflowMin: 1400,
    workflowCap: 2200,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.16 + 700),
  },
  canon_facts: {
    workflowMin: 1600,
    workflowCap: 2600,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.18 + 800),
  },
  canon_snapshot: {
    workflowMin: 1200,
    workflowCap: 1800,
    continuationMode: "structured_json",
    resolveSoftTarget: dynamicSoftTarget(({ promptTokens }) => promptTokens * 0.15 + 600),
  },
};

export function capByAssignment(assignmentMaxTokens: number, workflowCap: number) {
  return Math.min(assignmentMaxTokens, workflowCap);
}

export function estimatePromptTokensFromMessages(messages: Array<{ content: string }>) {
  return estimateModelTokens(messages.map((message) => message.content).join("\n\n"));
}

export function resolveOutputPolicy(input: ResolveOutputPolicyInput): ResolvedOutputPolicy {
  const config = WORKFLOW_OUTPUT_CONFIG[input.workflow];
  const hardCap = capByAssignment(input.assignmentMaxTokens, config.workflowCap);
  const softTarget = clamp(
    Math.round(config.resolveSoftTarget({
      promptTokens: input.promptTokens,
      targetWords: input.targetWords,
    })),
    config.workflowMin,
    config.workflowCap,
  );

  return {
    workflowMin: config.workflowMin,
    softTarget,
    hardCap,
    candidateLadder: buildCandidateLadder(softTarget, config.workflowMin, hardCap),
    continuationMode: config.continuationMode,
    alwaysContinueToSentence: config.alwaysContinueToSentence ?? config.continuationMode === "visible_long_stream",
  };
}

const TOKEN_BUDGET_RETRY_PATTERN =
  /max_tokens|max_completion_tokens|maximum context length|reduce the length|context.*remaining|remaining.*context|上下文.*(剩余|不足)|token.*不足/i;

export function isRetryableOutputTokenError(error: unknown) {
  return error instanceof Error
    && /\(400\)/.test(error.message)
    && TOKEN_BUDGET_RETRY_PATTERN.test(error.message);
}

export async function runWithTokenCandidates<T>(
  candidates: number[],
  execute: (maxTokens: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
): Promise<T> {
  const normalizedCandidates = uniqueNumbers(candidates);
  if (!normalizedCandidates.length) {
    throw new Error("至少需要一个 token candidate");
  }

  let lastError: unknown = null;
  for (const [index, maxTokens] of normalizedCandidates.entries()) {
    try {
      return await execute(maxTokens);
    } catch (error) {
      lastError = error;
      const canRetry = index < normalizedCandidates.length - 1 && isRetryable(error);
      if (!canRetry) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("LLM token candidate 执行失败");
}

export const AUTHOR_CARD_MAX_TOKEN_CANDIDATES = [5120, 4096, 3072] as const;

export const WORKFLOW_TOKEN_CAPS = {
  ideaWorkshop: {
    structuredReply: 2200,
    naturalReply: 2200,
    streamReply: 4200,
  },
  foundationWorkshop: {
    styleSearchStructured: 1400,
    styleSearchLineFallback: 900,
    workshopReply: 2200,
    naturalReply: 2200,
    streamReply: 4200,
    streamFallbackReply: 2200,
    draftSync: 2200,
    styleSteering: 1600,
  },
  characterCardWorkshop: {
    reply: 2200,
  },
  foundationStyle: {
    snapshotGeneration: 2200,
  },
  chapterDraft: {
    foundationExpansion: 3600,
    continuationDecision: 1600,
    stream: 6000,
  },
  chapterAudit: {
    quickAudit: 1400,
  },
  chapterReview: {
    deepReview: 2400,
    rewriteFromReview: 4200,
  },
  chapterStylePass: {
    rewrite: 3800,
  },
  chapterVersionGenerate: {
    version: 4200,
  },
  manualReview: {
    autoPickVersion: 1600,
  },
  chapterOptimize: {
    editorPatch: 1800,
  },
  storyContract: {
    plan: 2200,
  },
  blueprintPlanner: {
    candidate: 2600,
    repair: 2200,
  },
  foundationGenerate: {
    generate: 4200,
    rename: 2600,
  },
  segmentPlanner: {
    rewrite: 2400,
  },
  canon: {
    summary: 2200,
    facts: 2600,
    snapshot: 1800,
  },
} as const;
