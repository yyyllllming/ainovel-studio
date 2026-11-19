import test from "node:test";
import assert from "node:assert/strict";
import {
  canReleaseSessionOwnedResource,
  resolveRunContinuation,
  shouldTouchHeartbeat,
  type RunLockSnapshot,
  type RunTaskSnapshot,
} from "./run/run-control.ts";

function createTask(overrides: Partial<RunTaskSnapshot> = {}): RunTaskSnapshot {
  return {
    sessionId: "session-a",
    paused: false,
    stopRequested: false,
    ...overrides,
  };
}

function createLock(overrides: Partial<RunLockSnapshot> = {}): RunLockSnapshot {
  return {
    sessionId: "session-a",
    paused: false,
    stopRequested: false,
    desiredState: "running",
    ...overrides,
  };
}

test("resolveRunContinuation allows the owned session to keep running", () => {
  assert.equal(
    resolveRunContinuation("session-a", createTask(), createLock()),
    "continue",
  );
});

test("resolveRunContinuation pauses when the current session is marked paused", () => {
  assert.equal(
    resolveRunContinuation("session-a", createTask(), createLock({ paused: true })),
    "pause",
  );
});

test("resolveRunContinuation stops stale sessions after delete or restart", () => {
  assert.equal(
    resolveRunContinuation("session-a", null, createLock()),
    "stop",
  );
  assert.equal(
    resolveRunContinuation("session-a", createTask({ sessionId: "session-b" }), createLock()),
    "stop",
  );
  assert.equal(
    resolveRunContinuation("session-a", createTask(), createLock({ sessionId: "session-b" })),
    "stop",
  );
});

test("shouldTouchHeartbeat only allows the active owned session to refresh progress", () => {
  assert.equal(
    shouldTouchHeartbeat("session-a", createTask(), createLock()),
    true,
  );
  assert.equal(
    shouldTouchHeartbeat("session-a", createTask(), createLock({ desiredState: "paused" })),
    false,
  );
  assert.equal(
    shouldTouchHeartbeat("session-a", createTask({ sessionId: "session-b" }), createLock()),
    false,
  );
});

test("canReleaseSessionOwnedResource protects newer sessions from older finally blocks", () => {
  assert.equal(canReleaseSessionOwnedResource("session-a", "session-a"), true);
  assert.equal(canReleaseSessionOwnedResource("session-a", "session-b"), false);
  assert.equal(canReleaseSessionOwnedResource(undefined, "session-b"), true);
});
