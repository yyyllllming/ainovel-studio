import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  chatCompletionWithWorkflowPolicy,
  chatJsonWithWorkflowPolicy,
  chatJsonWithWorkflowPolicyTrace,
  streamVisibleLongCompletionWithContinuation,
} from "./llm-workflows.ts";
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

test("chatJsonWithWorkflowPolicy escalates structured-json retries to the workflow hard cap after a length finish", async () => {
  const originalFetch = globalThis.fetch;
  const requestedMaxTokens: number[] = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
    requestedMaxTokens.push(body.max_tokens ?? -1);

    const firstAttempt = requestedMaxTokens.length === 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: firstAttempt ? "半截" : "完整",
              }),
            },
            finish_reason: firstAttempt ? "length" : "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await chatJsonWithWorkflowPolicy(
      {
        workflow: "foundation_draft_sync",
        profile,
        model: "test-model",
        messages: [
          {
            role: "user",
            content: "同步 draft",
          },
        ],
        assignmentMaxTokens: 4096,
        temperature: 0.2,
      },
      z.object({
        reply: z.string(),
      }),
    );

    assert.deepEqual(result, { reply: "完整" });
    assert.deepEqual(requestedMaxTokens, [1200, 2200]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatJsonWithWorkflowPolicyTrace exposes the successful request hash", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: '{"reply":"ok"}' }, finish_reason: "stop" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
  try {
    const result = await chatJsonWithWorkflowPolicyTrace(
      {
        workflow: "foundation_draft_sync",
        profile,
        model: "test-model",
        messages: [{ role: "user", content: "同步 draft" }],
        assignmentMaxTokens: 4096,
      },
      z.object({ reply: z.string() }),
    );
    assert.deepEqual(result.value, { reply: "ok" });
    assert.match(result.attempts.at(-1)?.messagesHash ?? "", /^[a-f0-9]{64}$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chatCompletionWithWorkflowPolicy reruns visible-short completions at the workflow hard cap after a length finish", async () => {
  const originalFetch = globalThis.fetch;
  const requestedMaxTokens: number[] = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
    requestedMaxTokens.push(body.max_tokens ?? -1);

    const firstAttempt = requestedMaxTokens.length === 1;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: firstAttempt ? "半截回复" : "完整回复",
            },
            finish_reason: firstAttempt ? "length" : "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await chatCompletionWithWorkflowPolicy({
      workflow: "foundation_workshop_fallback_reply",
      profile,
      model: "test-model",
      messages: [
        {
          role: "user",
          content: "继续设定共创",
        },
      ],
      assignmentMaxTokens: 4096,
      temperature: 0.2,
    });

    assert.equal(result.content, "完整回复");
    assert.deepEqual(requestedMaxTokens, [1200, 2200]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createStreamResponse(parts: string[], finishReason: string | null) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n`));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n"));
      controller.close();
    },
  });

  return new Response(body, { status: 200 });
}

test("streamVisibleLongCompletionWithContinuation continues length-truncated visible streams and replaces with the merged sentence", async () => {
  const originalFetch = globalThis.fetch;
  const emitted: Array<{ delta: string; replace?: boolean }> = [];
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      return createStreamResponse(["第一句", "还没写完"], "length");
    }
    return createStreamResponse(["，现在补完整。"], "stop");
  };

  try {
    const result = await streamVisibleLongCompletionWithContinuation(
      {
        workflow: "idea_workshop_stream_reply",
        profile,
        model: "test-model",
        messages: [
          {
            role: "user",
            content: "延展想法",
          },
        ],
        assignmentMaxTokens: 4096,
        temperature: 0.2,
      },
      (event) => {
        emitted.push({
          delta: event.delta,
          ...(event.replace ? { replace: true } : {}),
        });
      },
    );

    assert.equal(result.content, "第一句还没写完，现在补完整。");
    assert.equal(result.continuationCount, 1);
    assert.equal(result.endedAtSentenceBoundary, true);
    assert.deepEqual(emitted, [
      { delta: "第一句" },
      { delta: "还没写完" },
      { delta: "第一句还没写完，现在补完整。", replace: true },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamVisibleLongCompletionWithContinuation keeps going once more when a visible long stream stops without sentence punctuation", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      return createStreamResponse(["第一句还没收住"], "stop");
    }
    return createStreamResponse(["，现在收束。"], "stop");
  };

  try {
    const result = await streamVisibleLongCompletionWithContinuation(
      {
        workflow: "foundation_workshop_stream_reply",
        profile,
        model: "test-model",
        messages: [
          {
            role: "user",
            content: "继续设定共创",
          },
        ],
        assignmentMaxTokens: 4096,
        temperature: 0.2,
      },
      () => {},
    );

    assert.equal(result.content, "第一句还没收住，现在收束。");
    assert.equal(result.continuationCount, 1);
    assert.equal(result.endedAtSentenceBoundary, true);
    assert.equal(attempt, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("streamVisibleLongCompletionWithContinuation stops after the continuation cap even if prose still does not end at a sentence boundary", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    return createStreamResponse([`续写片段${attempt}`], "stop");
  };

  try {
    const result = await streamVisibleLongCompletionWithContinuation(
      {
        workflow: "idea_workshop_stream_reply",
        profile,
        model: "test-model",
        messages: [
          {
            role: "user",
            content: "继续",
          },
        ],
        assignmentMaxTokens: 4096,
        temperature: 0.2,
      },
      () => {},
    );

    assert.equal(result.continuationCount, 2);
    assert.equal(result.endedAtSentenceBoundary, false);
    assert.equal(attempt, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
