import test from "node:test";
import assert from "node:assert/strict";
import { createRunnerOrchestrator } from "./run/runner-orchestrator.ts";
import { LostLeaseError } from "./run/session.service.ts";

test("runner orchestrator acquires the lease, forwards stop requests, and releases completed runs", async () => {
  const calls: string[] = [];
  let heartbeatTick: (() => Promise<void>) | null = null;

  const orchestrator = createRunnerOrchestrator({
    getSession(sessionId) {
      calls.push(`getSession:${sessionId}`);
      return {
        sessionId,
        projectId: "project-a",
        fromChapter: 7,
        currentChapter: null,
      };
    },
    getRunStateSnapshot() {
      return null;
    },
    sessionService: {
      acquireLease() {
        calls.push("acquireLease");
        return {
          leaseEpoch: 1,
          lifecycleStatus: "running",
        };
      },
      async renewLease() {
        calls.push("renewLease");
        return {
          desiredState: "stop_requested",
        };
      },
      releaseLease(input) {
        calls.push(`releaseLease:${input.finalLifecycle}:${input.resetDesiredState}`);
      },
    },
    startHeartbeat(tick) {
      heartbeatTick = tick;
      return {
        stop() {
          calls.push("stopHeartbeat");
        },
      };
    },
    async runDetachedExecution(projectId, input) {
      calls.push(`runDetachedExecution:${projectId}:${input.sessionId}:${input.fromChapter}`);
      await heartbeatTick?.();
    },
    getRunProgressView() {
      return {
        stage: "completed",
        desiredState: "idle",
      };
    },
    pauseLegacyRun() {
      calls.push("pauseLegacyRun");
    },
    stopLegacyRun(projectId) {
      calls.push(`stopLegacyRun:${projectId}`);
    },
    ownerTokenFactory() {
      return "owner-a";
    },
  });

  await orchestrator.runSession("session-a", "project-a");

  assert.deepEqual(calls, [
    "getSession:session-a",
    "acquireLease",
    "runDetachedExecution:project-a:session-a:7",
    "renewLease",
    "stopLegacyRun:project-a",
    "releaseLease:completed:false",
    "stopHeartbeat",
  ]);
});

test("runner orchestrator maps manual review into a paused resumable session", async () => {
  const releases: Array<{ finalLifecycle: string; resetDesiredState: boolean }> = [];

  const orchestrator = createRunnerOrchestrator({
    getSession(sessionId) {
      return {
        sessionId,
        projectId: "project-a",
        fromChapter: 3,
        currentChapter: 3,
      };
    },
    getRunStateSnapshot() {
      return null;
    },
    sessionService: {
      acquireLease() {
        return {
          leaseEpoch: 4,
          lifecycleStatus: "recovering",
        };
      },
      async renewLease() {
        return {
          desiredState: "running",
        };
      },
      releaseLease(input) {
        releases.push({
          finalLifecycle: input.finalLifecycle,
          resetDesiredState: input.resetDesiredState,
        });
      },
    },
    startHeartbeat() {
      return {
        stop() {},
      };
    },
    async runDetachedExecution() {},
    getRunProgressView() {
      return {
        stage: "manual_review",
        desiredState: "idle",
      };
    },
    pauseLegacyRun() {},
    stopLegacyRun() {},
    ownerTokenFactory() {
      return "owner-b";
    },
  });

  await orchestrator.runSession("session-b", "project-a");

  assert.deepEqual(releases, [
    {
      finalLifecycle: "paused",
      resetDesiredState: true,
    },
  ]);
});

test("runner orchestrator falls back to the legacy run_state chapter owned by the same session", async () => {
  const executions: Array<{ sessionId: string; fromChapter: number }> = [];

  function buildOrchestrator(runStateSnapshot: { currentChapter: number; runSessionId: string | null } | null) {
    return createRunnerOrchestrator({
      getSession(sessionId) {
        return {
          sessionId,
          projectId: "project-a",
          fromChapter: 1,
          currentChapter: null,
        };
      },
      getRunStateSnapshot() {
        return runStateSnapshot;
      },
      sessionService: {
        acquireLease() {
          return {
            leaseEpoch: 1,
            lifecycleStatus: "running",
          };
        },
        async renewLease() {
          return {
            desiredState: "running",
          };
        },
        releaseLease() {},
      },
      startHeartbeat() {
        return {
          stop() {},
        };
      },
      async runDetachedExecution(_projectId, input) {
        executions.push(input);
      },
      getRunProgressView() {
        return {
          stage: "completed",
          desiredState: "idle",
        };
      },
      pauseLegacyRun() {},
      stopLegacyRun() {},
      ownerTokenFactory() {
        return "owner-c";
      },
    });
  }

  // run_state written by this session carries the real progress.
  await buildOrchestrator({ currentChapter: 50, runSessionId: "session-c" }).runSession("session-c", "project-a");
  // run_state owned by a different session must not hijack a fresh start.
  await buildOrchestrator({ currentChapter: 50, runSessionId: "other-session" }).runSession("session-c", "project-a");

  assert.deepEqual(executions, [
    { sessionId: "session-c", fromChapter: 50 },
    { sessionId: "session-c", fromChapter: 1 },
  ]);
});

test("runner orchestrator forwards pause on lost lease and still releases the session as paused", async () => {
  const calls: string[] = [];
  let heartbeatTick: (() => Promise<void>) | null = null;

  const orchestrator = createRunnerOrchestrator({
    getSession(sessionId) {
      return {
        sessionId,
        projectId: "project-a",
        fromChapter: 4,
        currentChapter: 4,
        desiredState: "pause_requested",
      };
    },
    getRunStateSnapshot() {
      return null;
    },
    sessionService: {
      acquireLease() {
        return {
          leaseEpoch: 2,
          lifecycleStatus: "running",
        };
      },
      async renewLease() {
        calls.push("renewLease");
        throw new LostLeaseError();
      },
      releaseLease(input) {
        calls.push(`releaseLease:${input.finalLifecycle}:${input.resetDesiredState}`);
        throw new LostLeaseError();
      },
    },
    startHeartbeat(tick) {
      heartbeatTick = tick;
      return {
        stop() {
          calls.push("stopHeartbeat");
        },
      };
    },
    async runDetachedExecution() {
      // Simulate the pause arriving mid-run: the revoked lease bumps the epoch and the
      // next heartbeat renew throws. The tick must swallow it and forward the pause.
      await heartbeatTick?.();
      await heartbeatTick?.();
    },
    getRunProgressView() {
      return {
        stage: "paused",
        desiredState: "paused",
      };
    },
    pauseLegacyRun(projectId) {
      calls.push(`pauseLegacyRun:${projectId}`);
    },
    stopLegacyRun() {
      calls.push("stopLegacyRun");
    },
    ownerTokenFactory() {
      return "owner-d";
    },
  });

  await orchestrator.runSession("session-d", "project-a");

  assert.deepEqual(calls, [
    "renewLease",
    "pauseLegacyRun:project-a",
    // The second tick exits early: the lease is gone and pause was already forwarded.
    "releaseLease:paused:true",
    "stopHeartbeat",
  ]);
});
