import assert from "node:assert/strict";
import test from "node:test";
import { canTrashProjectForRunState, canTrashProjectForStage, PROJECT_PURGE_TABLES, resolveTrashStage } from "./project-trash.ts";

test("canTrashProjectForStage only allows idle or non-active stages", () => {
  assert.equal(canTrashProjectForStage(undefined), true);
  assert.equal(canTrashProjectForStage(null), true);
  assert.equal(canTrashProjectForStage("idle"), true);
  assert.equal(canTrashProjectForStage("paused"), true);
  assert.equal(canTrashProjectForStage("completed"), true);
  assert.equal(canTrashProjectForStage("failed"), true);
  assert.equal(canTrashProjectForStage("manual_review"), true);

  assert.equal(canTrashProjectForStage("blueprint"), false);
  assert.equal(canTrashProjectForStage("context"), false);
  assert.equal(canTrashProjectForStage("writing"), false);
  assert.equal(canTrashProjectForStage("review"), false);
  assert.equal(canTrashProjectForStage("analysis"), false);
});

test("resolveTrashStage downgrades stale active runs to interrupted for trash checks", () => {
  const staleHeartbeat = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal(
    resolveTrashStage({
      stage: "analysis",
      desiredState: "running",
      heartbeatAt: staleHeartbeat,
    }),
    "interrupted",
  );
  assert.equal(
    canTrashProjectForRunState({
      stage: "analysis",
      desiredState: "running",
      heartbeatAt: staleHeartbeat,
    }),
    true,
  );
  assert.equal(
    canTrashProjectForRunState({
      stage: "analysis",
      desiredState: "running",
      heartbeatAt: new Date().toISOString(),
    }),
    false,
  );
});

test("PROJECT_PURGE_TABLES covers all project-bound tables used by trash purge", () => {
  assert.equal(PROJECT_PURGE_TABLES.includes("context_packs"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("canon_fact_index"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("project_cards"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("foundation_workshop_sessions"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("style_reference_imports"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("style_card_snapshots"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("project_card_messages"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("card_progressions"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("chapter_review_states"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("run_logs"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("chapter_plans"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("hook_plans"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("style_delta_notes"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("artifact_manifests"), true);
  assert.equal(PROJECT_PURGE_TABLES.includes("canon_facts" as never), false);
});
