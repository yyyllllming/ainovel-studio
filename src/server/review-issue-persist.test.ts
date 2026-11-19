import test from "node:test";
import assert from "node:assert/strict";
import { persistCrossChapterIssues } from "./run/chapter-shared.ts";

test("persistCrossChapterIssues keeps type, location, severity, and evidence", () => {
  const persisted = persistCrossChapterIssues([
    {
      type: "character_reentry_without_bridge",
      location: "章首",
      severity: "major",
      evidence: "沈檀 未经出场动作直接进入当前场景",
    },
  ]);
  assert.deepEqual(persisted, [
    {
      type: "character_reentry_without_bridge",
      location: "章首",
      severity: "major",
      evidence: "沈檀 未经出场动作直接进入当前场景",
    },
  ]);
});
