import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveEffectiveRunStage,
  deriveRunProgressView,
  mergeRunStageDetails,
  resolveResumeStage,
} from "./run/run-state.ts";
import type { RunProgressPayload } from "./types.ts";

function createProgress(overrides: Partial<RunProgressPayload> = {}): RunProgressPayload {
  return {
    running: true,
    stage: "writing",
    currentChapter: 3,
    totalChapters: 20,
    retryCount: 0,
    confidence: 0.8,
    currentPosition: 1200,
    wordCount: 850,
    stageDetails: {},
    logs: [],
    ...overrides,
  };
}

test("deriveRunProgressView keeps an active run active while the heartbeat is fresh", () => {
  const now = Date.parse("2026-03-22T08:00:20.000Z");
  const view = deriveRunProgressView(
    createProgress(),
    {
      desiredState: "running",
      heartbeatAt: "2026-03-22T08:00:15.000Z",
    },
    now,
  );

  assert.equal(view.stage, "writing");
  assert.equal(view.running, true);
});

test("deriveRunProgressView marks stale active sessions as interrupted instead of paused", () => {
  const now = Date.parse("2026-03-22T08:04:10.000Z");
  const view = deriveRunProgressView(
    createProgress(),
    {
      desiredState: "running",
      heartbeatAt: "2026-03-22T08:00:00.000Z",
    },
    now,
  );

  assert.equal(view.stage, "interrupted");
  assert.equal(view.running, false);
  assert.equal(view.staleHeartbeat, true);
  assert.equal(view.lastActiveStage, "writing");
  assert.equal(view.heartbeatAgeMs, 250_000);
});

test("deriveRunProgressView preserves explicit user pauses", () => {
  const now = Date.parse("2026-03-22T08:01:00.000Z");
  const view = deriveRunProgressView(
    createProgress({
      running: false,
      stage: "paused",
    }),
    {
      desiredState: "paused",
      heartbeatAt: "2026-03-22T08:00:58.000Z",
    },
    now,
  );

  assert.equal(view.stage, "paused");
  assert.equal(view.running, false);
});

test("deriveEffectiveRunStage turns stale active states into interrupted", () => {
  const now = Date.parse("2026-03-22T08:05:00.000Z");
  const stage = deriveEffectiveRunStage("style_pass", "running", "2026-03-22T08:00:00.000Z", now);

  assert.equal(stage, "interrupted");
});

test("mergeRunStageDetails remembers the latest active stage across pauses", () => {
  const activeDetails = mergeRunStageDetails("writing", {}, {
    writing: {
      draftFile: "chapter-001.md",
      currentPosition: 1200,
      wordCount: 900,
    },
  });
  const pausedDetails = mergeRunStageDetails("paused", activeDetails, {});

  assert.equal(activeDetails.lifecycle?.lastActiveStage, "writing");
  assert.equal(pausedDetails.lifecycle?.lastActiveStage, "writing");
});

test("resolveResumeStage restores the latest active stage when resuming a paused run", () => {
  const pausedDetails = mergeRunStageDetails("paused", {
    lifecycle: {
      lastActiveStage: "review",
    },
  }, {});

  assert.equal(resolveResumeStage("paused", pausedDetails), "review");
  assert.equal(resolveResumeStage("interrupted", {}), "blueprint");
});

test("deriveRunProgressView exposes desired state and last active stage for stopped runs", () => {
  const now = Date.parse("2026-03-22T08:02:00.000Z");
  const view = deriveRunProgressView(
    createProgress({
      running: false,
      stage: "paused",
      stageDetails: {
        lifecycle: {
          lastActiveStage: "analysis",
        },
      },
    }),
    {
      desiredState: "stopped",
      heartbeatAt: "2026-03-22T08:01:55.000Z",
    },
    now,
  );

  assert.equal(view.stage, "paused");
  assert.equal(view.desiredState, "stopped");
  assert.equal(view.lastActiveStage, "analysis");
  assert.equal(view.staleHeartbeat, false);
  assert.equal(view.heartbeatAgeMs, 5_000);
});
