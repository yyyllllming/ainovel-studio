import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";
import { createSessionService } from "./run/session.service.ts";
import { createSessionReconciler } from "./run/session-reconciler.ts";
import { createControlService } from "./run/control.service.ts";
import { createRunProgressService } from "./run/progress.service.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function createLegacyProgress() {
  return {
    running: true,
    stage: "writing" as const,
    currentChapter: 1,
    totalChapters: 20,
    retryCount: 0,
    confidence: 0,
    currentPosition: 0,
    wordCount: 0,
    stageDetails: {},
    logs: [],
    desiredState: "running" as const,
  };
}

test("startOrResumeRun rejects when another project already owns the global runner slot", () => {
  const db = createMemoryDb();

  try {
    const sessionService = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const launches: Array<{ sessionId: string; projectId: string }> = [];
    const control = createControlService({
      sessionService,
      sessionReconciler: reconciler,
      launcher: {
        spawnRunner(sessionId, projectId) {
          launches.push({ sessionId, projectId });
          return { pid: 1234 };
        },
      },
    });

    control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 1,
    });

    assert.throws(() =>
      control.startOrResumeRun({
        projectId: "project-b",
        fromChapter: 1,
      }),
    );
    assert.equal(launches.length, 1);
  } finally {
    db.close();
  }
});

test("startOrResumeRun spawns a runner for queued sessions and reuses the same open session", () => {
  const db = createMemoryDb();

  try {
    const sessionService = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const launches: Array<{ sessionId: string; projectId: string }> = [];
    const control = createControlService({
      sessionService,
      sessionReconciler: reconciler,
      launcher: {
        spawnRunner(sessionId, projectId) {
          launches.push({ sessionId, projectId });
          return { pid: 1234 };
        },
      },
    });

    const started = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 5,
    });
    const resumed = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 9,
    });

    assert.equal(started.sessionId, resumed.sessionId);
    assert.equal(launches.length, 1);
    assert.deepEqual(launches[0], {
      sessionId: started.sessionId,
      projectId: "project-a",
    });
  } finally {
    db.close();
  }
});

test("startOrResumeRun respawns interrupted sessions but does not double-spawn active ones", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessionService = createSessionService({
      db,
      now: () => now,
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => now,
    });
    const launches: Array<{ sessionId: string; projectId: string }> = [];
    const control = createControlService({
      sessionService,
      sessionReconciler: reconciler,
      launcher: {
        spawnRunner(sessionId, projectId) {
          launches.push({ sessionId, projectId });
          return { pid: 1234 };
        },
      },
    });

    const started = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 1,
    });

    assert.equal(launches.length, 1);

    const active = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 1,
    });

    assert.equal(active.sessionId, started.sessionId);
    assert.equal(launches.length, 1);

    now = "2026-03-31T00:00:30.000Z";
    reconciler.reconcileSessionsTick();

    const resumed = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 1,
    });

    assert.equal(resumed.sessionId, started.sessionId);
    assert.equal(launches.length, 2);
  } finally {
    db.close();
  }
});

test("interrupted sessions resume through the new path even while legacy progress still reports writing", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessionService = createSessionService({
      db,
      now: () => now,
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => now,
    });
    const launches: Array<{ sessionId: string; projectId: string }> = [];
    const control = createControlService({
      sessionService,
      sessionReconciler: reconciler,
      launcher: {
        spawnRunner(sessionId, projectId) {
          launches.push({ sessionId, projectId });
          return { pid: 1234 };
        },
      },
    });
    const progressService = createRunProgressService({
      db,
      now: () => Date.parse(now),
      buildProgressSnapshot: createLegacyProgress,
    });

    const started = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 1,
    });
    now = "2026-03-31T00:00:30.000Z";
    reconciler.reconcileSessionsTick();

    const interrupted = progressService.getRunProgressView("project-a");
    assert.equal(interrupted.stage, "interrupted");
    assert.equal(interrupted.running, false);

    const resumed = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 1,
    });

    assert.equal(resumed.sessionId, started.sessionId);
    assert.equal(launches.length, 2);
  } finally {
    db.close();
  }
});

test("pauseRun and stopRun move non-leased sessions through the new session authority", () => {
  const db = createMemoryDb();

  try {
    const sessionService = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const control = createControlService({
      sessionService,
      sessionReconciler: reconciler,
      launcher: {
        spawnRunner() {
          return { pid: 1234 };
        },
      },
    });

    control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 4,
    });

    const paused = control.pauseRun("project-a");
    assert.equal(paused.lifecycleStatus, "paused");
    assert.equal(paused.desiredState, "running");

    const stopped = control.stopRun("project-a");
    assert.equal(stopped.lifecycleStatus, "stopped");
    assert.equal(stopped.desiredState, "stop_requested");
    assert.notEqual(stopped.terminalAt, null);
  } finally {
    db.close();
  }
});

test("pauseRun and stopRun issue lease-backed control requests for actively owned sessions", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessionService = createSessionService({
      db,
      now: () => now,
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => now,
    });
    const control = createControlService({
      sessionService,
      sessionReconciler: reconciler,
      launcher: {
        spawnRunner() {
          return { pid: 1234 };
        },
      },
    });

    const started = control.startOrResumeRun({
      projectId: "project-a",
      fromChapter: 2,
    });
    const lease = sessionService.acquireLease({
      sessionId: started.sessionId,
      ownerToken: "owner-a",
      ownerPid: 777,
    });

    const pauseRequested = control.pauseRun("project-a");
    assert.equal(pauseRequested.lifecycleStatus, "running");
    assert.equal(pauseRequested.desiredState, "pause_requested");
    assert.equal(pauseRequested.leaseEpoch, lease.leaseEpoch + 1);

    const stopRequested = control.stopRun("project-a");
    assert.equal(stopRequested.lifecycleStatus, "running");
    assert.equal(stopRequested.desiredState, "stop_requested");
    assert.equal(stopRequested.leaseEpoch, lease.leaseEpoch + 2);
  } finally {
    db.close();
  }
});
