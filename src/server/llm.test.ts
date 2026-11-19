import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  chatCompletion,
  chatCompletionWithMeta,
  chatJson,
  chatJsonWithTrace,
  isRecoverableLlmTransportError,
  listModels,
  minimalChatProbe,
  streamChatCompletion,
  streamChatCompletionWithMeta,
} from "./llm.ts";
import type { LlmProfile } from "./types.ts";

const profile: LlmProfile = {
  id: "profile_test",
  name: "Test",
  providerId: "custom",
  protocol: "openai_compatible",
  baseUrl: "https://relay.example.com",
  apiKey: "test-key",
  defaultModel: "test-model",
  enabled: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

test("chatJson retries with a repair prompt when the first payload is invalid", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  let attempt = 0;

  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ""));
    attempt += 1;

    const content =
      attempt === 1
        ? "```json\n{ invalid json }\n```"
        : '```json\n{"reply":"ok"}\n```';

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const result = await chatJson(
      profile,
      "test-model",
      [
        {
          role: "user",
          content: "return json",
        },
      ],
      z.object({
        reply: z.string(),
      }),
    );

    assert.deepEqual(result, { reply: "ok" });
    assert.equal(attempt, 2);
    assert.match(bodies[1] ?? "", /重新输出严格合法的 JSON/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatJsonWithTrace captures invalid and repaired attempts", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    const content =
      attempt === 1
        ? "```json\n{ invalid json }\n```"
        : '```json\n{"reply":"ok"}\n```';

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const result = await chatJsonWithTrace(
      profile,
      "test-model",
      [
        {
          role: "user",
          content: "return json",
        },
      ],
      z.object({
        reply: z.string(),
      }),
    );

    assert.deepEqual(result.value, { reply: "ok" });
    assert.equal(result.attempts.length, 2);
    assert.match(result.attempts[0]?.error ?? "", /Unexpected token|JSON/i);
    assert.equal(result.attempts[1]?.error, null);
    assert.deepEqual(result.attempts[1]?.parsed, { reply: "ok" });
    assert.equal(
      result.attempts[0]?.messagesHash,
      createHash("sha256").update(JSON.stringify([{ role: "user", content: "return json" }])).digest("hex"),
    );
    assert.match(result.attempts[1]?.messagesHash ?? "", /^[a-f0-9]{64}$/u);
    assert.notEqual(result.attempts[0]?.messagesHash, result.attempts[1]?.messagesHash);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatJsonWithTrace preserves the actual repair-prompt hash when transport fails", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: string[] = [];
  let attempt = 0;
  globalThis.fetch = async (_url, init) => {
    bodies.push(String(init?.body ?? ""));
    attempt += 1;
    if (attempt === 1) {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "{ invalid json }" }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new TypeError("simulated network failure");
  };

  try {
    await assert.rejects(
      () => chatJsonWithTrace(
        profile,
        "test-model",
        [{ role: "user", content: "return json" }],
        z.object({ reply: z.string() }),
        { maxAttempts: 1 },
      ),
      (error: Error & { lastMessagesHash?: string }) => {
        const finalBody = JSON.parse(bodies.at(-1) ?? "{}") as { messages?: unknown };
        const expected = createHash("sha256").update(JSON.stringify(finalBody.messages)).digest("hex");
        assert.equal(error.lastMessagesHash, expected);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletion retries transient 524 errors before succeeding", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      return new Response("upstream timeout", { status: 524 });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "ok",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await chatCompletion(profile, "test-model", [
      {
        role: "user",
        content: "hello",
      },
    ]);

    assert.equal(result, "ok");
    assert.equal(attempt, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletionWithMeta returns finishReason from the completion payload", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: "半截内容",
          },
          finish_reason: "length",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

  try {
    const result = await chatCompletionWithMeta(profile, "test-model", [
      {
        role: "user",
        content: "hello",
      },
    ]);

    assert.equal(result.content, "半截内容");
    assert.equal(result.finishReason, "length");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletion honors a custom timeout for long-form rewrites", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async (_url, init) => {
    attempts += 1;
    const signal = init?.signal as AbortSignal | undefined;
    await new Promise((_, reject) => {
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("This operation was aborted", "AbortError")),
        { once: true },
      );
    });
    return new Response("unreachable", { status: 500 });
  };

  try {
    await assert.rejects(
      () => chatCompletion(
        profile,
        "test-model",
        [
          {
            role: "user",
            content: "hello",
          },
        ],
        {
          timeoutMs: 1,
        },
      ),
      /aborted/i,
    );
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isRecoverableLlmTransportError treats network and abort failures as degradable", () => {
  assert.equal(
    isRecoverableLlmTransportError(new Error("fetch failed")),
    true,
  );
  assert.equal(
    isRecoverableLlmTransportError(new DOMException("This operation was aborted", "AbortError")),
    true,
  );
  assert.equal(
    isRecoverableLlmTransportError(new Error("blueprint missing")),
    false,
  );
});

test("chatCompletion honors a custom maxAttempts budget for best-effort rescues", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts += 1;
    throw new Error("fetch failed");
  };

  try {
    await assert.rejects(
      () => chatCompletion(
        profile,
        "test-model",
        [
          {
            role: "user",
            content: "hello",
          },
        ],
        {
          maxAttempts: 1,
        },
      ),
      /fetch failed/i,
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChatCompletion retries transient 524 before any delta and preserves output once", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let attempt = 0;
  let streamed = "";

  globalThis.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      return new Response("cf timeout", { status: 524 });
    }

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"山风"}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"压低了草叶。"}}]}\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      },
    });

    return new Response(body, { status: 200 });
  };

  try {
    const result = await streamChatCompletion(
      profile,
      "test-model",
      [
        {
          role: "user",
          content: "stream",
        },
      ],
      (delta) => {
        streamed += delta;
      },
    );

    assert.equal(result, "山风压低了草叶。");
    assert.equal(streamed, "山风压低了草叶。");
    assert.equal(attempt, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChatCompletionWithMeta preserves finishReason from the terminal stream packet", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  globalThis.fetch = async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"山风"}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"压低了草叶。"}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      },
    });

    return new Response(body, { status: 200 });
  };

  try {
    const result = await streamChatCompletionWithMeta(
      profile,
      "test-model",
      [
        {
          role: "user",
          content: "stream",
        },
      ],
      () => {},
    );

    assert.equal(result.content, "山风压低了草叶。");
    assert.equal(result.finishReason, "length");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("minimalChatProbe keeps Gemini OpenAI compatibility base URLs intact", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "OK",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await minimalChatProbe(
      {
        ...profile,
        providerId: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      },
      "gemini-3-flash-preview",
    );
    assert.equal(
      requestedUrl,
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletion aborts a stalled response body once the timeout elapses", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();

  globalThis.fetch = async (_url, init) => {
    const signal = init?.signal as AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"choices":['));
        signal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("This operation was aborted", "AbortError")),
          { once: true },
        );
        // 永不 close：模拟 headers 已到但 body trickle 挂起的中转站
      },
    });
    return new Response(body, { status: 200 });
  };

  try {
    await assert.rejects(
      () => chatCompletion(
        profile,
        "test-model",
        [
          {
            role: "user",
            content: "hello",
          },
        ],
        {
          timeoutMs: 30,
          maxAttempts: 1,
        },
      ),
      /abort/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletion propagates an external abort while the body is still streaming", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const aborter = new AbortController();

  globalThis.fetch = async (_url, init) => {
    const signal = init?.signal as AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"choices":['));
        signal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("This operation was aborted", "AbortError")),
          { once: true },
        );
      },
    });
    return new Response(body, { status: 200 });
  };

  try {
    setTimeout(() => aborter.abort(), 20);
    await assert.rejects(
      () => chatCompletion(
        profile,
        "test-model",
        [
          {
            role: "user",
            content: "hello",
          },
        ],
        {
          signal: aborter.signal,
        },
      ),
      /abort/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamChatCompletion aborts an in-flight stream read when the caller cancels", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const aborter = new AbortController();

  globalThis.fetch = async (_url, init) => {
    const signal = init?.signal as AbortSignal | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"山风"}}]}\n'));
        signal?.addEventListener(
          "abort",
          () => controller.error(new DOMException("This operation was aborted", "AbortError")),
          { once: true },
        );
        // 永不 close：模拟连接挂起，只有 abort 能中断
      },
    });
    return new Response(body, { status: 200 });
  };

  try {
    setTimeout(() => aborter.abort(), 20);
    await assert.rejects(
      () => streamChatCompletion(
        profile,
        "test-model",
        [
          {
            role: "user",
            content: "stream",
          },
        ],
        () => {},
        {
          signal: aborter.signal,
        },
      ),
      /abort/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletion rejects empty choices instead of treating them as a finished draft", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(
    JSON.stringify({ choices: [] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(
      () => chatCompletion(profile, "test-model", [
        {
          role: "user",
          content: "hello",
        },
      ]),
      /LLM 未返回内容/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletion surfaces finish_reason when content is null", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: null,
          },
          finish_reason: "content_filter",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(
      () => chatCompletion(profile, "test-model", [
        {
          role: "user",
          content: "hello",
        },
      ]),
      /LLM 未返回内容 \(finish_reason=content_filter\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatJsonWithTrace fails fast when JSON output is truncated by max_tokens", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"reply":"被截断的半截 JS',
            },
            finish_reason: "length",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await assert.rejects(
      () => chatJsonWithTrace(
        profile,
        "test-model",
        [
          {
            role: "user",
            content: "return json",
          },
        ],
        z.object({
          reply: z.string(),
        }),
      ),
      (error: unknown) => {
        const failure = error as Error & {
          attempts?: Array<{ finishReason?: string | null }>;
          finishReason?: string;
        };
        assert.match(failure.message, /max_tokens 截断/);
        assert.equal(failure.finishReason, "length");
        assert.equal(failure.attempts?.length, 1);
        assert.equal(failure.attempts?.[0]?.finishReason, "length");
        return true;
      },
    );
    assert.equal(attempt, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listModels honors interactive maxAttempts without retrying", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    return new Response("bad gateway", { status: 502 });
  };

  try {
    await assert.rejects(
      () => listModels(profile, { timeoutMs: 1_000, maxAttempts: 1 }),
      /502/,
    );
    assert.equal(attempt, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("minimalChatProbe stops retrying when the caller cancels via signal", async () => {
  const originalFetch = globalThis.fetch;
  const aborter = new AbortController();
  let attempt = 0;

  globalThis.fetch = async (_url, init) => {
    attempt += 1;
    const signal = init?.signal as AbortSignal | undefined;
    await new Promise((_, reject) => {
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("This operation was aborted", "AbortError")),
        { once: true },
      );
    });
    return new Response("unreachable", { status: 500 });
  };

  try {
    setTimeout(() => aborter.abort(), 20);
    await assert.rejects(
      () => minimalChatProbe(profile, "test-model", { signal: aborter.signal }),
      /abort/i,
    );
    assert.equal(attempt, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listModels keeps GLM OpenAI compatibility base URLs intact", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(
      JSON.stringify({
        data: [{ id: "glm-5" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const models = await listModels(
      {
        ...profile,
        providerId: "glm",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
      },
    );
    assert.deepEqual(models, ["glm-5"]);
    assert.equal(requestedUrl, "https://open.bigmodel.cn/api/paas/v4/models");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
