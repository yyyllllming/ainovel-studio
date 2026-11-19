import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeSentenceBoundaryContinuation,
  prepareSentenceBoundaryContinuation,
  requestWithSentenceBoundaryContinuation,
  type SentenceBoundaryContinuationPass,
} from "./long-form-continuation.ts";

test("prepareSentenceBoundaryContinuation keeps the stable prefix at the last complete sentence boundary", () => {
  const plan = prepareSentenceBoundaryContinuation("第一句。第二句没有写完");

  assert.equal(plan.stablePrefix, "第一句。");
  assert.equal(plan.lastCompleteSentence, "第一句。");
  assert.equal(plan.contextTail.includes("第二句没有写完"), true);
});

test("mergeSentenceBoundaryContinuation drops the incomplete tail and appends only new continuation text", () => {
  const merged = mergeSentenceBoundaryContinuation(
    "第一句。第二句没有写完",
    "第二句终于补完了。第三句也到了。",
  );

  assert.equal(merged, "第一句。第二句终于补完了。第三句也到了。");
});

test("mergeSentenceBoundaryContinuation removes a duplicated opening sentence from the continuation", () => {
  const merged = mergeSentenceBoundaryContinuation(
    "第一句。第二句。第三句还没写完",
    "第二句。第三句终于补完了。第四句落下来。",
  );

  assert.equal(merged, "第一句。第二句。第三句终于补完了。第四句落下来。");
});

test("mergeSentenceBoundaryContinuation preserves an unfinished opening fragment when no complete sentence exists yet", () => {
  const merged = mergeSentenceBoundaryContinuation(
    "第一句还没收住",
    "，现在收束。",
  );

  assert.equal(merged, "第一句还没收住，现在收束。");
});

test("requestWithSentenceBoundaryContinuation returns the first pass untouched when not truncated", async () => {
  const passes: SentenceBoundaryContinuationPass[] = [];

  const result = await requestWithSentenceBoundaryContinuation({
    messages: [{ role: "user", content: "写一段" }],
    request: async (_messages, pass) => {
      passes.push(pass);
      return { content: "第一句。", finishReason: "stop", policy: { hardCap: 4096 } };
    },
  });

  assert.equal(result.content, "第一句。");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(passes, [{ kind: "first" }]);
});

test("requestWithSentenceBoundaryContinuation requests one continuation at the hard cap and merges at the sentence boundary", async () => {
  const passes: SentenceBoundaryContinuationPass[] = [];
  let stillTruncatedCalls = 0;

  const result = await requestWithSentenceBoundaryContinuation({
    messages: [{ role: "user", content: "写一段" }],
    request: async (messages, pass) => {
      passes.push(pass);
      if (pass.kind === "first") {
        return { content: "第一句。第二句没有写完", finishReason: "length", policy: { hardCap: 8192 } };
      }
      assert.equal(messages.length, 3);
      assert.equal(messages[1]?.role, "assistant");
      return { content: "第二句终于补完了。", finishReason: "stop", policy: { hardCap: 8192 } };
    },
    onStillTruncated: () => {
      stillTruncatedCalls += 1;
    },
  });

  assert.equal(result.content, "第一句。第二句终于补完了。");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(passes, [{ kind: "first" }, { kind: "continuation", overrideMaxTokens: 8192 }]);
  assert.equal(stillTruncatedCalls, 0);
});

test("requestWithSentenceBoundaryContinuation reports when the continuation is still truncated", async () => {
  let reportedFinishReason: string | null = null;

  const result = await requestWithSentenceBoundaryContinuation({
    messages: [{ role: "user", content: "写一段" }],
    request: async (_messages, pass) =>
      pass.kind === "first"
        ? { content: "第一句。后半没收住", finishReason: "length", policy: { hardCap: 8192 } }
        : { content: "后半补上了，但又断", finishReason: "length", policy: { hardCap: 8192 } },
    onStillTruncated: (finalPass) => {
      reportedFinishReason = finalPass.finishReason;
    },
  });

  assert.equal(reportedFinishReason, "length");
  assert.equal(result.finishReason, "length");
});
