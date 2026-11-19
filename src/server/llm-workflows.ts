import { z } from "zod";

import {
  chatCompletionWithMeta,
  chatJsonWithTrace,
  streamChatCompletionWithMeta,
  type ChatJsonAttempt,
  type ChatMessage,
  type ChatOptions,
} from "./llm.ts";
import {
  estimatePromptTokensFromMessages,
  isRetryableOutputTokenError,
  resolveOutputPolicy,
  runWithTokenCandidates,
  type OutputWorkflow,
  type ResolvedOutputPolicy,
} from "./llm-token-policy.ts";
import {
  buildSentenceBoundaryContinuationMessages,
  endsAtSentenceBoundary,
  mergeSentenceBoundaryContinuation,
} from "./long-form-continuation.ts";
import type { LlmProfile } from "./types.ts";

interface WorkflowExecutionInput {
  workflow: OutputWorkflow;
  profile: LlmProfile;
  model: string;
  messages: ChatMessage[];
  assignmentMaxTokens: number;
  targetWords?: number;
  temperature?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface WorkflowChatCompletionResult {
  content: string;
  finishReason: string | null;
  maxTokensUsed: number;
  policy: ResolvedOutputPolicy;
}

export interface WorkflowChatJsonResult<T> {
  value: T;
  finishReason: string | null;
  attempts: ChatJsonAttempt[];
  maxTokensUsed: number;
  policy: ResolvedOutputPolicy;
}

export interface WorkflowVisibleLongStreamResult extends WorkflowChatCompletionResult {
  continuationCount: number;
  endedAtSentenceBoundary: boolean;
}

const MAX_VISIBLE_LONG_CONTINUATIONS = 2;

function buildChatOptions(input: WorkflowExecutionInput, maxTokens: number): ChatOptions {
  return {
    temperature: input.temperature,
    timeoutMs: input.timeoutMs,
    maxAttempts: input.maxAttempts,
    maxTokens,
  };
}

function resolvePolicy(input: WorkflowExecutionInput, overrideMaxTokens?: number) {
  const policy = resolveOutputPolicy({
    workflow: input.workflow,
    promptTokens: estimatePromptTokensFromMessages(input.messages),
    assignmentMaxTokens: input.assignmentMaxTokens,
    targetWords: input.targetWords,
  });

  const candidates = overrideMaxTokens ? [overrideMaxTokens] : policy.candidateLadder;
  return {
    policy,
    candidates,
  };
}

export async function requestChatCompletionForWorkflow(
  input: WorkflowExecutionInput,
  overrideMaxTokens?: number,
): Promise<WorkflowChatCompletionResult> {
  const { policy, candidates } = resolvePolicy(input, overrideMaxTokens);
  const result = await runWithTokenCandidates(
    candidates,
    async (maxTokens) => {
      const meta = await chatCompletionWithMeta(
        input.profile,
        input.model,
        input.messages,
        buildChatOptions(input, maxTokens),
      );
      return {
        ...meta,
        maxTokensUsed: maxTokens,
      };
    },
    isRetryableOutputTokenError,
  );

  return {
    ...result,
    policy,
  };
}

export async function chatCompletionWithWorkflowPolicy(
  input: WorkflowExecutionInput,
) {
  const firstPass = await requestChatCompletionForWorkflow(input);
  if (firstPass.finishReason !== "length" || firstPass.maxTokensUsed >= firstPass.policy.hardCap) {
    return firstPass;
  }

  if (firstPass.policy.continuationMode === "visible_long_stream") {
    return firstPass;
  }

  return requestChatCompletionForWorkflow(input, firstPass.policy.hardCap);
}

export async function requestStreamChatCompletionForWorkflow(
  input: WorkflowExecutionInput,
  onDelta: (delta: string) => Promise<void> | void,
  overrideMaxTokens?: number,
): Promise<WorkflowChatCompletionResult> {
  const { policy, candidates } = resolvePolicy(input, overrideMaxTokens);
  const result = await runWithTokenCandidates(
    candidates,
    async (maxTokens) => {
      const meta = await streamChatCompletionWithMeta(
        input.profile,
        input.model,
        input.messages,
        onDelta,
        buildChatOptions(input, maxTokens),
      );
      return {
        ...meta,
        maxTokensUsed: maxTokens,
      };
    },
    isRetryableOutputTokenError,
  );

  return {
    ...result,
    policy,
  };
}

export async function streamVisibleLongCompletionWithContinuation(
  input: WorkflowExecutionInput & {
    maxContinuations?: number;
  },
  emit: (event: {
    delta: string;
    replace?: boolean;
    mergedContent: string;
    attemptIndex: number;
  }) => Promise<void> | void,
): Promise<WorkflowVisibleLongStreamResult> {
  let mergedContent = "";
  let attemptMessages = input.messages;
  let attemptIndex = 0;
  let finalResult: WorkflowChatCompletionResult | null = null;
  const maxContinuations = Math.max(0, input.maxContinuations ?? MAX_VISIBLE_LONG_CONTINUATIONS);

  while (true) {
    let attemptContent = "";
    const attemptResult = await requestStreamChatCompletionForWorkflow(
      {
        ...input,
        messages: attemptMessages,
      },
      async (delta) => {
        attemptContent += delta;
        if (attemptIndex === 0) {
          await emit({
            delta,
            mergedContent: attemptContent,
            attemptIndex,
          });
        }
      },
    );

    mergedContent = mergedContent
      ? mergeSentenceBoundaryContinuation(mergedContent, attemptResult.content)
      : attemptResult.content.trim();

    if (attemptIndex > 0) {
      await emit({
        delta: mergedContent,
        replace: true,
        mergedContent,
        attemptIndex,
      });
    }

    const endedAtSentenceBoundary = endsAtSentenceBoundary(mergedContent);
    finalResult = {
      ...attemptResult,
      content: mergedContent,
    };
    const shouldContinueForLength = attemptResult.finishReason === "length";
    const shouldContinueForSentence = attemptResult.policy.alwaysContinueToSentence && !endedAtSentenceBoundary;
    if ((!shouldContinueForLength && !shouldContinueForSentence) || attemptIndex >= maxContinuations) {
      return {
        ...finalResult,
        continuationCount: attemptIndex,
        endedAtSentenceBoundary,
      };
    }

    attemptIndex += 1;
    attemptMessages = buildSentenceBoundaryContinuationMessages(
      input.messages,
      mergedContent,
      {
        reason: shouldContinueForLength ? "length" : "sentence_boundary",
      },
    ).messages;
  }
}

export async function requestChatJsonForWorkflow<T>(
  input: WorkflowExecutionInput,
  schema: z.ZodSchema<T>,
  overrideMaxTokens?: number,
): Promise<WorkflowChatJsonResult<T>> {
  const { policy, candidates } = resolvePolicy(input, overrideMaxTokens);
  const result = await runWithTokenCandidates(
    candidates,
    async (maxTokens) => {
      const traced = await chatJsonWithTrace(
        input.profile,
        input.model,
        input.messages,
        schema,
        buildChatOptions(input, maxTokens),
      );
      return {
        ...traced,
        maxTokensUsed: maxTokens,
      };
    },
    isRetryableOutputTokenError,
  );

  return {
    ...result,
    policy,
  };
}

export async function chatJsonWithWorkflowPolicyTrace<T>(
  input: WorkflowExecutionInput,
  schema: z.ZodSchema<T>,
) {
  let firstPass: WorkflowChatJsonResult<T>;
  try {
    firstPass = await requestChatJsonForWorkflow(input, schema);
  } catch (error) {
    // 截断导致解析失败时 chatJsonWithTrace 会快速失败并带 finishReason=length 标记，
    // 这里接住并按 hardCap 重发一次，补全 token 上限升级闭环。
    const finishReason = (error as Error & { finishReason?: string })?.finishReason;
    if (finishReason !== "length") {
      throw error;
    }
    const policy = resolvePolicy(input).policy;
    const escalated = await requestChatJsonForWorkflow(input, schema, policy.hardCap);
    return escalated;
  }
  if (firstPass.finishReason !== "length" || firstPass.maxTokensUsed >= firstPass.policy.hardCap) {
    return firstPass;
  }

  const escalated = await requestChatJsonForWorkflow(
    input,
    schema,
    firstPass.policy.hardCap,
  );
  return escalated;
}

export async function chatJsonWithWorkflowPolicy<T>(
  input: WorkflowExecutionInput,
  schema: z.ZodSchema<T>,
) {
  return (await chatJsonWithWorkflowPolicyTrace(input, schema)).value;
}
