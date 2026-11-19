import test from "node:test";
import assert from "node:assert/strict";
import { buildDraftRecoveryResetPatch } from "./run/chapter-runner.ts";

test("buildDraftRecoveryResetPatch clears every draft recovery signal before a fresh rewrite", () => {
  const patch = buildDraftRecoveryResetPatch("review", 7);

  assert.equal(patch.stage, "review");
  assert.equal(patch.currentChapter, 7);
  assert.equal(patch.draftFile, null);
  assert.equal(patch.currentPosition, 0);
  assert.equal(patch.wordCount, 0);
  // stageDetails 浅合并时必须显式覆盖 writing，否则 writeDraftFromContext 会把旧稿当成中断草稿恢复。
  assert.equal("writing" in patch.stageDetails, true);
  assert.equal(patch.stageDetails.writing, undefined);
  // 持久化为 JSON 后 writing 信号被彻底移除。
  assert.equal("writing" in JSON.parse(JSON.stringify(patch.stageDetails)), false);
});
