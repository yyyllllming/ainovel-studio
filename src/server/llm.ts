import { createHash } from "node:crypto";
import { z } from "zod";
import type { LlmProfile } from "./types.ts";
import { extractJsonBlock } from "./utils.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** External AbortSignal — typically request.signal from a Next.js route handler. */
  signal?: AbortSignal;
  /** Per-chunk idle timeout for streaming responses (ms). Defaults to 60s. */
  streamIdleTimeoutMs?: number;
}

export interface ChatCompletionMeta {
  content: string;
  finishReason: string | null;
}

export interface ChatJsonAttempt {
  attempt: number;
  messagesHash: string;
  content: string;
  parsed: unknown | null;
  error: string | null;
  finishReason?: string | null;
}

const MAX_REQUEST_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 120_000;
const STREAM_HEADER_TIMEOUT_MS = 120_000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;
const RETRY_BASE_DELAY_MS = 600;
const RETRY_MAX_DELAY_MS = 30_000;
const RETRIABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 524]);

class LlmHttpError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "LlmHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function extractRetryAfterFromError(error: unknown): number | null {
  if (error instanceof LlmHttpError) return error.retryAfterMs;
  return null;
}

function normalizeBase(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (
    /\/v\d+(?:beta)?$/.test(normalized) ||
    normalized.endsWith("/openai") ||
    normalized.includes("/compatible-mode/") ||
    normalized.includes("/api/paas/")
  ) {
    return normalized;
  }
  return `${normalized}/v1`;
}

function endpoint(profile: LlmProfile, path: string) {
  const base = normalizeBase(profile.baseUrl);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number, retryAfterMs: number | null = null) {
  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, RETRY_MAX_DELAY_MS);
  }
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * RETRY_BASE_DELAY_MS);
  return Math.min(base + jitter, RETRY_MAX_DELAY_MS);
}

function buildLlmHttpError(
  status: number,
  text: string,
  prefix = "LLM 请求失败",
  retryAfterMs: number | null = null,
) {
  return new LlmHttpError(status, `${prefix} (${status})：${text}`, retryAfterMs);
}

function extractStatusCode(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }
  const match = error.message.match(/\((\d{3})\)/);
  if (!match?.[1]) {
    return null;
  }
  return Number(match[1]);
}

export function isRecoverableLlmTransportError(error: unknown) {
  const status = extractStatusCode(error);
  if (status !== null) {
    return RETRIABLE_STATUS_CODES.has(status);
  }
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "AbortError") {
    return true;
  }
  return /timeout|timed out|fetch failed|network|socket|econnreset|enotfound|temporarily unavailable/i.test(error.message);
}

interface TimedFetchResult {
  response: Response;
  /** 释放超时定时器与外部 abort 监听，必须在响应体消费完毕后调用。 */
  dispose: () => void;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  timerCoversBody = true,
): Promise<TimedFetchResult> {
  if (externalSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const dispose = () => {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  };

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!timerCoversBody) {
      // 流式响应在 headers 到达后改由 per-chunk idle 超时守护，
      // 但保留外部 abort 到底层连接的传导，直到 dispose 被调用。
      clearTimeout(timer);
    }
    return { response, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

async function readWithIdleTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  idleMs: number,
): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`流式写作长时间未收到数据 (${idleMs}ms)`)),
          idleMs,
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodSchema<T>,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxAttempts = MAX_REQUEST_RETRIES,
  externalSignal?: AbortSignal,
) {
  let lastError: unknown;
  const totalAttempts = Math.max(1, maxAttempts);

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const { response, dispose } = await fetchWithTimeout(url, init, timeoutMs, externalSignal);
      try {
        // dispose 延迟到 body 读完之后，确保超时与外部 abort 覆盖整个响应而不只是 headers。
        const text = await response.text();
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
          throw buildLlmHttpError(response.status, text, "LLM 请求失败", retryAfterMs);
        }
        return schema.parse(JSON.parse(text));
      } finally {
        dispose();
      }
    } catch (error) {
      lastError = error;
      if (externalSignal?.aborted) break;
      if (attempt >= totalAttempts - 1 || !isRecoverableLlmTransportError(error)) {
        break;
      }
      await sleep(getRetryDelay(attempt, extractRetryAfterFromError(error)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("LLM 请求失败");
}

export interface LlmProbeOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  /** External AbortSignal — typically request.signal from a Next.js route handler. */
  signal?: AbortSignal;
}

export async function listModels(profile: LlmProfile, options: LlmProbeOptions = {}) {
  const schema = z.object({
    data: z.array(
      z.object({
        id: z.string(),
      }),
    ),
  });
  const payload = await requestJson(
    endpoint(profile, "/models"),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
      },
    },
    schema,
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    options.maxAttempts ?? MAX_REQUEST_RETRIES,
    options.signal,
  );
  return payload.data.map((item) => item.id);
}

export async function minimalChatProbe(profile: LlmProfile, model: string, options: LlmProbeOptions = {}) {
  const schema = z.object({
    choices: z.array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    ),
  });
  const payload = await requestJson(
    endpoint(profile, "/chat/completions"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 32,
        messages: [
          {
            role: "system",
            content: "You are a connectivity probe. Reply with OK.",
          },
          {
            role: "user",
            content: "Reply with OK only.",
          },
        ],
      }),
    },
    schema,
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    options.maxAttempts ?? MAX_REQUEST_RETRIES,
    options.signal,
  );
  return {
    ok: true,
    model,
    preview: payload.choices[0]?.message?.content?.trim() || "OK",
  };
}

export async function chatCompletionWithMeta(
  profile: LlmProfile,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions = {},
) {
  const schema = z.object({
    choices: z.array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    ),
  });
  const payload = await requestJson(
    endpoint(profile, "/chat/completions"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        messages,
      }),
    },
    schema,
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    options.maxAttempts ?? MAX_REQUEST_RETRIES,
    options.signal,
  );
  const choice = payload.choices[0];
  const content = choice?.message?.content?.trim() ?? "";
  const finishReason = choice?.finish_reason ?? null;
  if (!content) {
    // 与流式路径的「流式写作未返回内容」对齐：空 choices/空 content 不可视为合法成稿。
    throw new Error(
      finishReason ? `LLM 未返回内容 (finish_reason=${finishReason})` : "LLM 未返回内容",
    );
  }
  return {
    content,
    finishReason,
  } satisfies ChatCompletionMeta;
}

export async function chatCompletion(
  profile: LlmProfile,
  model: string,
  messages: ChatMessage[],
  options: ChatOptions = {},
) {
  const result = await chatCompletionWithMeta(profile, model, messages, options);
  return result.content;
}

export async function chatJson<T>(
  profile: LlmProfile,
  model: string,
  messages: ChatMessage[],
  schema: z.ZodSchema<T>,
  options: ChatOptions = {},
) {
  const result = await chatJsonWithTrace(profile, model, messages, schema, options);
  return result.value;
}

export async function chatJsonWithTrace<T>(
  profile: LlmProfile,
  model: string,
  messages: ChatMessage[],
  schema: z.ZodSchema<T>,
  options: ChatOptions = {},
) {
  let attemptMessages = [...messages];
  let lastError: unknown;
  const attempts: ChatJsonAttempt[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const messagesHash = createHash("sha256").update(JSON.stringify(attemptMessages)).digest("hex");
    let meta: ChatCompletionMeta;
    try {
      meta = await chatCompletionWithMeta(profile, model, attemptMessages, options);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      (failure as Error & { attempts?: ChatJsonAttempt[]; lastMessagesHash?: string }).attempts = attempts;
      (failure as Error & { lastMessagesHash?: string }).lastMessagesHash = messagesHash;
      throw failure;
    }
    const content = meta.content;
    try {
      const parsed = JSON.parse(extractJsonBlock(content));
      const value = schema.parse(parsed);
      attempts.push({
        attempt: attempt + 1,
        messagesHash,
        content,
        parsed,
        error: null,
        finishReason: meta.finishReason,
      });
      return {
        value,
        attempts,
        finishReason: meta.finishReason,
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        attempt: attempt + 1,
        messagesHash,
        content,
        parsed: null,
        error: error instanceof Error ? error.message : String(error),
        finishReason: meta.finishReason,
      });
      if (meta.finishReason === "length") {
        // 输出已被 max_tokens 截断，按相同上限重试必然再次截断，直接失败交由上层升级 token 上限。
        const truncated = new Error(
          "结构化输出被 max_tokens 截断 (finish_reason=length)，请提升输出 token 上限后重试",
        );
        (truncated as Error & { finishReason?: string }).finishReason = "length";
        lastError = truncated;
        break;
      }
      if (attempt === 2) {
        break;
      }
      const parseErrorDetail = (error instanceof Error ? error.message : String(error)).slice(0, 1200);
      attemptMessages = [
        ...messages,
        {
          role: "assistant",
          content,
        },
        {
          role: "user",
          content:
            `上一个输出未能通过 JSON 校验，具体错误：\n${parseErrorDetail}\n\n请对照错误逐项修正（字段名、类型、枚举值必须完全符合），重新输出严格合法的 JSON。不要加解释，不要加 markdown 代码块，也不要遗漏必填字段。`,
        },
      ];
    }
  }

  const failure = lastError instanceof Error ? lastError : new Error("结构化 JSON 解析失败");
  (failure as Error & { attempts?: ChatJsonAttempt[]; lastMessagesHash?: string }).attempts = attempts;
  (failure as Error & { lastMessagesHash?: string }).lastMessagesHash = attempts.at(-1)?.messagesHash;
  throw failure;
}

export async function streamChatCompletionWithMeta(
  profile: LlmProfile,
  model: string,
  messages: ChatMessage[],
  onDelta: (delta: string) => Promise<void> | void,
  options: ChatOptions = {},
) {
  let lastError: unknown;
  const totalAttempts = Math.max(1, options.maxAttempts ?? MAX_REQUEST_RETRIES);
  const idleTimeoutMs = options.streamIdleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    let emittedAny = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let disposeFetch: (() => void) | null = null;

    try {
      // timerCoversBody=false: headers 超时仅守护到响应头，body 阶段由 idle 超时守护，
      // 但外部 abort 仍可在 body 阶段主动中断底层连接。
      const { response, dispose } = await fetchWithTimeout(
        endpoint(profile, "/chat/completions"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${profile.apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: options.temperature ?? 0.9,
            max_tokens: options.maxTokens ?? 8192,
            stream: true,
            messages,
          }),
        },
        options.timeoutMs ?? STREAM_HEADER_TIMEOUT_MS,
        options.signal,
        false,
      );
      disposeFetch = dispose;

      if (!response.ok || !response.body) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        throw buildLlmHttpError(response.status, await response.text(), "流式写作失败", retryAfterMs);
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let finishReason: string | null = null;

      while (true) {
        if (options.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n");
        buffer = chunks.pop() ?? "";

        for (const line of chunks) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            continue;
          }
          // 只容忍 JSON 解析失败（坏 relay 包）；onDelta 抛出的异常（暂停/停止等
          // 控制流、消费方真实错误）必须向上传播，否则 pause 只能等到阶段边界生效。
          let parsed: {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
          } | null = null;
          try {
            parsed = JSON.parse(payload);
          } catch {
            // ignore malformed relay packets
          }
          if (parsed) {
            const choice = parsed.choices?.[0];
            if (choice?.finish_reason !== undefined) {
              finishReason = choice.finish_reason ?? null;
            }
            const delta = choice?.delta?.content;
            if (delta) {
              emittedAny = true;
              fullText += delta;
              await onDelta(delta);
            }
          }
        }
      }

      const result = fullText.trim();
      if (!result) {
        throw new Error("流式写作未返回内容");
      }
      return {
        content: result,
        finishReason,
      } satisfies ChatCompletionMeta;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) break;
      if (attempt >= totalAttempts - 1 || emittedAny || !isRecoverableLlmTransportError(error)) {
        break;
      }
      await sleep(getRetryDelay(attempt, extractRetryAfterFromError(error)));
    } finally {
      if (reader) {
        await reader.cancel().catch(() => {});
      }
      disposeFetch?.();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("流式写作失败");
}

export async function streamChatCompletion(
  profile: LlmProfile,
  model: string,
  messages: ChatMessage[],
  onDelta: (delta: string) => Promise<void> | void,
  options: ChatOptions = {},
) {
  const result = await streamChatCompletionWithMeta(profile, model, messages, onDelta, options);
  return result.content;
}
