import type { ChatMessage } from "./llm.ts";

const SENTENCE_BOUNDARY_REGEX = /[。！？!?….]/gu;
const SENTENCE_ENDING_REGEX = /[。！？!?….](?:["'”’」』》】）)\]]+)?$/u;

export interface SentenceBoundaryContinuationPlan {
  stablePrefix: string;
  contextTail: string;
  lastCompleteSentence: string;
}

export function endsAtSentenceBoundary(text: string) {
  return SENTENCE_ENDING_REGEX.test(text.trimEnd());
}

function findLastSentenceBoundaryIndex(text: string) {
  let match: RegExpExecArray | null = null;
  let lastIndex = -1;
  SENTENCE_BOUNDARY_REGEX.lastIndex = 0;
  while ((match = SENTENCE_BOUNDARY_REGEX.exec(text))) {
    lastIndex = match.index + match[0].length;
  }
  return lastIndex;
}

function extractLastCompleteSentence(stablePrefix: string) {
  const boundaryIndex = findLastSentenceBoundaryIndex(stablePrefix);
  if (boundaryIndex <= 0) {
    return stablePrefix.trim();
  }

  const previous = stablePrefix.slice(0, Math.max(0, boundaryIndex - 1));
  const previousBoundaryIndex = findLastSentenceBoundaryIndex(previous);
  return stablePrefix.slice(previousBoundaryIndex >= 0 ? previousBoundaryIndex : 0).trim();
}

function stripDuplicatedOpeningSentence(input: string, duplicatedSentence: string) {
  const trimmed = input.trimStart();
  if (!duplicatedSentence) {
    return trimmed;
  }

  if (trimmed.startsWith(duplicatedSentence)) {
    return trimmed.slice(duplicatedSentence.length).trimStart();
  }

  const firstBoundary = findLastSentenceBoundaryIndex(trimmed);
  if (firstBoundary <= 0) {
    return trimmed;
  }

  const firstSentence = trimmed.slice(0, firstBoundary).trim();
  if (firstSentence === duplicatedSentence.trim()) {
    return trimmed.slice(firstBoundary).trimStart();
  }

  return trimmed;
}

export function prepareSentenceBoundaryContinuation(
  text: string,
  options?: {
    tailChars?: number;
  },
): SentenceBoundaryContinuationPlan {
  const trimmed = text.trimEnd();
  const boundaryIndex = findLastSentenceBoundaryIndex(trimmed);
  const stablePrefix = boundaryIndex > 0 ? trimmed.slice(0, boundaryIndex) : "";
  const tailChars = Math.min(200, Math.max(120, options?.tailChars ?? 180));
  const contextTail = trimmed.slice(Math.max(0, trimmed.length - tailChars));

  return {
    stablePrefix,
    contextTail,
    lastCompleteSentence: extractLastCompleteSentence(stablePrefix),
  };
}

export function mergeSentenceBoundaryContinuation(existingText: string, continuationText: string) {
  const plan = prepareSentenceBoundaryContinuation(existingText);
  const cleanedContinuation = stripDuplicatedOpeningSentence(
    continuationText,
    plan.lastCompleteSentence,
  );
  const trimmedExisting = existingText.trimEnd();

  if (!plan.stablePrefix) {
    if (!trimmedExisting) {
      return cleanedContinuation;
    }
    if (!cleanedContinuation) {
      return trimmedExisting;
    }
    return cleanedContinuation.startsWith(trimmedExisting)
      ? cleanedContinuation
      : `${trimmedExisting}${cleanedContinuation}`;
  }
  if (!cleanedContinuation) {
    return plan.stablePrefix;
  }

  return `${plan.stablePrefix}${cleanedContinuation}`;
}

export interface SentenceBoundaryContinuationPassResult {
  content: string;
  finishReason: string | null;
  policy: {
    hardCap: number;
  };
}

export type SentenceBoundaryContinuationPass =
  | { kind: "first" }
  | { kind: "continuation"; overrideMaxTokens: number };

export async function requestWithSentenceBoundaryContinuation<
  TResult extends SentenceBoundaryContinuationPassResult,
>(input: {
  messages: ChatMessage[];
  request: (messages: ChatMessage[], pass: SentenceBoundaryContinuationPass) => Promise<TResult>;
  onStillTruncated?: (finalPass: TResult) => void;
}): Promise<{ content: string; finishReason: string | null }> {
  const firstPass = await input.request(input.messages, { kind: "first" });
  let content = firstPass.content;
  let finishReason = firstPass.finishReason;

  if (firstPass.finishReason === "length") {
    const continuation = buildSentenceBoundaryContinuationMessages(input.messages, content);
    const secondPass = await input.request(continuation.messages, {
      kind: "continuation",
      overrideMaxTokens: firstPass.policy.hardCap,
    });
    content = mergeSentenceBoundaryContinuation(content, secondPass.content);
    finishReason = secondPass.finishReason;
    if (secondPass.finishReason === "length") {
      input.onStillTruncated?.(secondPass);
    }
  }

  return {
    content,
    finishReason,
  };
}

export function buildSentenceBoundaryContinuationMessages(
  baseMessages: ChatMessage[],
  existingText: string,
  options?: {
    reason?: "length" | "sentence_boundary";
  },
) {
  const plan = prepareSentenceBoundaryContinuation(existingText);
  const reason = options?.reason ?? "length";
  const leadInstruction = reason === "sentence_boundary"
    ? "上一个输出还没自然收束到完整句子。"
    : "上一个输出因为长度限制中断。";

  return {
    ...plan,
    messages: [
      ...baseMessages,
      {
        role: "assistant" as const,
        content: plan.contextTail,
      },
      {
        role: "user" as const,
        content: [
          leadInstruction,
          "请从最后一个完整句之后继续写。",
          "不要重复已有文本，不要加说明，不要重起标题。",
          "只输出续写后的正文新增部分。",
          `已有正文尾部上下文（仅供承接语气）：\n${plan.contextTail}`,
        ].join("\n\n"),
      },
    ],
  };
}
