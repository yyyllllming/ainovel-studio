import test from "node:test";
import assert from "node:assert/strict";
import { measureReviewMessages } from "./services/context-serialization.ts";
import { rawDb } from "./db/client.ts";
import { saveReviewContextUsage } from "./repositories/review.repository.ts";

test("measureReviewMessages records the exact serialized payload size", () => {
  const messages = [
    { role: "system" as const, content: "系统规则" },
    { role: "user" as const, content: "正文与上下文" },
  ];
  const usage = measureReviewMessages(messages, 128_000);
  assert.equal(usage.serializedChars, JSON.stringify(messages).length);
  assert.equal(
    Object.values(usage.sectionUsage).reduce((sum, section) => sum + section.serializedChars, 0),
    usage.serializedChars,
  );
  assert.equal(usage.budgetTokens, 128_000);
});

test("measureReviewMessages input token estimate grows with the real final messages", () => {
  const small = measureReviewMessages([{ role: "user" as const, content: "短文本" }], 128_000);
  const large = measureReviewMessages([{ role: "user" as const, content: "长文本".repeat(2_000) }], 128_000);
  assert.equal(large.estimatedInputTokens > small.estimatedInputTokens, true);
});

test("review context usage persists on the latest chapter context pack", () => {
  const projectId = `context-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = `${projectId}-pack`;
  rawDb.prepare(`
    INSERT INTO context_packs (id, project_id, chapter_no, total_tokens, breakdown_json, usage_json, conflicts_json, created_at)
    VALUES (?, ?, 9, 10, '{}', NULL, '[]', ?)
  `).run(id, projectId, new Date().toISOString());
  try {
    const usage = measureReviewMessages([{ role: "user", content: "真实消息" }], 128_000);
    assert.equal(saveReviewContextUsage(projectId, 9, "deep", usage), true);
    const row = rawDb.prepare("SELECT usage_json FROM context_packs WHERE id = ?").get(id) as { usage_json: string };
    assert.deepEqual(JSON.parse(row.usage_json).deep, usage);
  } finally {
    rawDb.prepare("DELETE FROM context_packs WHERE id = ?").run(id);
  }
});
