import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const legacyBridgeTargets = [
  "src/server/services/blueprint-generate.service.ts",
  "src/server/services/manual-review.service.ts",
  "src/server/commit/sync-committed-artifacts.service.ts",
  "src/server/commit/apply-stored-patch.service.ts",
  "src/server/commit/rollback-version.service.ts",
  "src/server/run/manual-review-route.service.ts",
];

const migratedRepositoryTargets = [
  "src/server/agent-resolver.ts",
  "src/server/foundation/idea-workshop.ts",
  "src/server/run/chapter-shared.ts",
  "src/server/run/planning-repair.ts",
  "src/server/services/chapter-range-delete.service.ts",
  "src/server/services/chapter-optimize.service.ts",
  "src/server/services/chapter-version-generate.service.ts",
  "src/server/services/foundation-generate.service.ts",
  "src/server/services/foundation-handoff.service.ts",
  "src/server/services/project-execution-context.ts",
  // Batch A: story/ module (7 files)
  "src/server/story/blueprint-plan-engine.ts",
  "src/server/story/chapter-plan-engine.ts",
  "src/server/story/segment-plan-engine.ts",
  "src/server/story/story-contract-engine.ts",
  "src/server/story/story-progression-sync.ts",
  "src/server/story/timeline-invalidation.ts",
  "src/server/story/planner-exemplars.ts",
  // Batch A: run/ module (8 files)
  "src/server/run/chapter-runner.ts",
  "src/server/run/chapter-draft.ts",
  "src/server/run/chapter-review.ts",
  "src/server/run/chapter-finalize.ts",
  "src/server/run/chapter-audit.ts",
  "src/server/run/chapter-style-pass.ts",
  "src/server/run/context-engine.ts",
  "src/server/run/manual-review-engine.ts",
  // Batch A: commit/ module (2 files)
  "src/server/commit/chapter-commit-engine.ts",
  "src/server/commit/chapter-artifact-sync.ts",
  // Batch A: character/ module (2 files)
  "src/server/character/card-workshop.ts",
  "src/server/character/auto-character-discovery-runtime.ts",
];

test("run-manager stays below the orchestration size budget", async () => {
  const source = await readFile(resolve(platformRoot, "src/server/run-manager.ts"), "utf8");
  const lineCount = source.split(/\r?\n/u).length;
  assert.ok(lineCount < 700, `run-manager.ts should stay below 700 lines, received ${lineCount}`);
});

test("legacy runtime helpers are not lazy-loaded from service boundaries", async () => {
  for (const relativePath of legacyBridgeTargets) {
    const source = await readFile(resolve(platformRoot, relativePath), "utf8");
    assert.ok(
      !source.includes('await import("../run-manager.ts")'),
      `${relativePath} should use dedicated domain modules instead of lazy-loading run-manager`,
    );
  }
});

test("migrated services do not regress back to the repository compat barrel", async () => {
  for (const relativePath of migratedRepositoryTargets) {
    const source = await readFile(resolve(platformRoot, relativePath), "utf8");
    assert.ok(
      !source.includes('from "../repository.ts"') && !source.includes('from "./repository.ts"'),
      `${relativePath} should import focused repository modules instead of ../repository.ts`,
    );
  }
});
