import test from "node:test";
import assert from "node:assert/strict";
import { createChapterSessionGuard } from "./commit/chapter-session-guard.ts";

test("chapter session guard allows mutations when no open session exists", () => {
  const guard = createChapterSessionGuard({
    getOpenSessionByProjectId() {
      return null;
    },
  });

  assert.doesNotThrow(() => guard.assertNoOpenSession("project-a", "删除章节"));
});

test("chapter session guard blocks mutations when an open session exists", () => {
  const guard = createChapterSessionGuard({
    getOpenSessionByProjectId() {
      return {
        sessionId: "session-open",
        lifecycleStatus: "paused",
        terminalAt: null,
      } as never;
    },
    getRunStage() {
      return "blueprint";
    },
  });

  assert.throws(
    () => guard.assertNoOpenSession("project-a", "回滚版本"),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, "当前存在未关闭的运行会话（paused），请先停止或关闭后再回滚版本");
      return true;
    },
  );
});

test("chapter session guard allows manual-review exceptions when requested", () => {
  const guard = createChapterSessionGuard({
    getOpenSessionByProjectId() {
      return {
        sessionId: "session-open",
        lifecycleStatus: "paused",
        terminalAt: null,
      } as never;
    },
    getRunStage() {
      return "manual_review";
    },
  });

  assert.doesNotThrow(() =>
    guard.assertNoOpenSession("project-a", "应用 Patch", {
      allowDuringManualReview: true,
    })
  );
});
