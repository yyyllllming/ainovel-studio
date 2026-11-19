import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";
import { createSessionService } from "./run/session.service.ts";
import { createSessionReconciler } from "./run/session-reconciler.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function getSessionRow(db: Database.Database, sessionId: string) {
  return db
    .prepare("SELECT * FROM run_sessions WHERE session_id = ?")
    .get(sessionId) as Record<string, unknown>;
}

test("createOrReuseOpenSession creates the first queued session and reuses it for the same project", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessions = createSessionService({
      db,
      now: () => now,
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });

    const created = sessions.createOrReuseOpenSession("project-a", 3);
    now = "2026-03-31T00:01:00.000Z";
    const reused = sessions.createOrReuseOpenSession("project-a", 8);

    assert.equal(created.sessionId, reused.sessionId);
    assert.equal(created.sessionSeq, 1);
    assert.equal(reused.lifecycleStatus, "queued");
    assert.deepEqual(
      db.prepare("SELECT COUNT(*) AS count FROM run_sessions").get() as { count: number },
      { count: 1 },
    );

    const row = getSessionRow(db, created.sessionId);
    assert.equal(row.project_id, "project-a");
    // The caller's explicit start chapter is honored when reusing a non-executing session.
    assert.equal(row.from_chapter, 8);
    assert.equal(row.current_chapter, 8);
    assert.equal(row.lifecycle_status, "queued");
    assert.equal(row.desired_state, "running");
  } finally {
    db.close();
  }
});

test("createOrReuseOpenSession retargets paused sessions but never sessions holding an active lease", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessions = createSessionService({
      db,
      now: () => now,
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });

    const session = sessions.createOrReuseOpenSession("project-a", 1);
    sessions.tryEnterGlobalRunnerSlot(session.sessionId);
    sessions.acquireLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      ownerPid: 4567,
    });

    // While the lease is held, an explicit fromChapter must not move a live runner.
    const activeReuse = sessions.createOrReuseOpenSession("project-a", 9);
    assert.equal(activeReuse.sessionId, session.sessionId);
    assert.equal(activeReuse.fromChapter, 1);

    sessions.releaseLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      leaseEpoch: 1,
      finalLifecycle: "paused",
      resetDesiredState: true,
    });
    db.prepare("UPDATE run_sessions SET current_chapter = 5 WHERE session_id = ?").run(session.sessionId);

    now = "2026-03-31T00:01:00.000Z";
    const retargeted = sessions.createOrReuseOpenSession("project-a", 9);

    assert.equal(retargeted.sessionId, session.sessionId);
    assert.equal(retargeted.fromChapter, 9);
    assert.equal(retargeted.currentChapter, 9);
    assert.equal(retargeted.lifecycleStatus, "paused");
  } finally {
    db.close();
  }
});

test("createOrReuseOpenSession blocks another project while the global runner slot is active", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });

    sessions.createOrReuseOpenSession("project-a", 1);

    assert.throws(() => sessions.createOrReuseOpenSession("project-b", 1));
  } finally {
    db.close();
  }
});

test("acquireLease, renewLease, and releaseLease drive the Batch 1 session lifecycle", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessions = createSessionService({
      db,
      now: () => now,
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });

    const session = sessions.createOrReuseOpenSession("project-a", 1);
    const entered = sessions.tryEnterGlobalRunnerSlot(session.sessionId);
    assert.equal(entered.ok, true);

    const lease = sessions.acquireLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      ownerPid: 4567,
    });

    assert.equal(lease.lifecycleStatus, "running");
    assert.equal(lease.leaseEpoch, 1);

    let row = getSessionRow(db, session.sessionId);
    assert.equal(row.lifecycle_status, "running");
    assert.equal(row.owner_token, "owner-a");
    assert.equal(row.owner_pid, 4567);

    now = "2026-03-31T00:00:15.000Z";
    const renew = sessions.renewLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      leaseEpoch: 1,
    });

    assert.equal(renew.desiredState, "running");

    now = "2026-03-31T00:00:16.000Z";
    sessions.releaseLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      leaseEpoch: 1,
      finalLifecycle: "paused",
      resetDesiredState: true,
    });

    row = getSessionRow(db, session.sessionId);
    assert.equal(row.lifecycle_status, "paused");
    assert.equal(row.desired_state, "running");
    assert.equal(row.owner_token, null);
    assert.equal(row.terminal_at, null);
  } finally {
    db.close();
  }
});

test("acquireLease refuses to bypass the global runner slot transition", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });

    const session = sessions.createOrReuseOpenSession("project-a", 1);

    assert.throws(() =>
      sessions.acquireLease({
        sessionId: session.sessionId,
        ownerToken: "owner-a",
        ownerPid: 4567,
      }),
    );
  } finally {
    db.close();
  }
});

test("acquireLease enters recovering when a completed checkpoint already exists", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });

    const session = sessions.createOrReuseOpenSession("project-a", 10);
    sessions.tryEnterGlobalRunnerSlot(session.sessionId);

    db.prepare(`
      INSERT INTO run_checkpoints (
        checkpoint_id,
        session_id,
        checkpoint_seq,
        chapter_no,
        stage,
        step_key,
        step_status,
        lease_epoch,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "cp-1",
      session.sessionId,
      1,
      10,
      "blueprint",
      "chapter.blueprint_accepted",
      "completed",
      0,
      "2026-03-31T00:00:00.000Z",
    );

    const lease = sessions.acquireLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      ownerPid: 4567,
    });

    assert.equal(lease.lifecycleStatus, "recovering");
  } finally {
    db.close();
  }
});

test("session reconciler repairs stale launching sessions and expired leases", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessions = createSessionService({
      db,
      now: () => now,
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => now,
      launchGraceMs: 20_000,
    });

    const launching = sessions.createOrReuseOpenSession("project-a", 1);
    sessions.tryEnterGlobalRunnerSlot(launching.sessionId);

    now = "2026-03-31T00:00:25.000Z";
    let stats = reconciler.reconcileSessionsTick();
    assert.equal(stats.staleLaunchingInterrupted, 1);
    assert.equal(getSessionRow(db, launching.sessionId).lifecycle_status, "interrupted");

    now = "2026-03-31T00:01:00.000Z";
    const resumable = sessions.createOrReuseOpenSession("project-a", 1);
    sessions.tryEnterGlobalRunnerSlot(resumable.sessionId);
    const lease = sessions.acquireLease({
      sessionId: resumable.sessionId,
      ownerToken: "owner-a",
      ownerPid: 9876,
    });
    sessions.revokeLease({
      sessionId: resumable.sessionId,
      desiredState: "pause_requested",
      reason: "pause requested by user",
    });

    now = "2026-03-31T00:01:01.000Z";
    stats = reconciler.reconcileSessionsTick();
    assert.equal(stats.expiredLeaseTransitions, 1);

    const pausedRow = getSessionRow(db, resumable.sessionId);
    assert.equal(pausedRow.lifecycle_status, "paused");
    assert.equal(pausedRow.desired_state, "running");
    assert.equal(pausedRow.lease_epoch, lease.leaseEpoch + 1);

    now = "2026-03-31T00:02:00.000Z";
    const stoppable = sessions.createOrReuseOpenSession("project-a", 1);
    sessions.tryEnterGlobalRunnerSlot(stoppable.sessionId);
    sessions.acquireLease({
      sessionId: stoppable.sessionId,
      ownerToken: "owner-b",
      ownerPid: 6543,
    });
    sessions.revokeLease({
      sessionId: stoppable.sessionId,
      desiredState: "stop_requested",
      reason: "stop requested by user",
    });

    now = "2026-03-31T00:02:01.000Z";
    stats = reconciler.reconcileSessionsTick();
    assert.equal(stats.expiredLeaseTransitions, 1);

    const stoppedRow = getSessionRow(db, stoppable.sessionId);
    assert.equal(stoppedRow.lifecycle_status, "stopped");
    assert.notEqual(stoppedRow.terminal_at, null);
  } finally {
    db.close();
  }
});

test("session reconciler interrupts stale queued sessions that never launched", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessions = createSessionService({
      db,
      now: () => now,
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => now,
      launchGraceMs: 20_000,
    });

    const queued = sessions.createOrReuseOpenSession("project-a", 1);

    now = "2026-03-31T00:00:25.000Z";
    const stats = reconciler.reconcileSessionsTick();

    assert.equal(stats.staleLaunchingInterrupted, 1);

    const row = getSessionRow(db, queued.sessionId);
    assert.equal(row.lifecycle_status, "interrupted");
    assert.equal(row.launch_nonce, null);
    assert.equal(row.launch_requested_at, null);
    assert.equal(row.launch_started_at, null);
  } finally {
    db.close();
  }
});

test("tryEnterGlobalRunnerSlot relaunches paused and interrupted sessions through launching", () => {
  const db = createMemoryDb();
  let now = "2026-03-31T00:00:00.000Z";

  try {
    const sessions = createSessionService({
      db,
      now: () => now,
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });
    const reconciler = createSessionReconciler({
      db,
      now: () => now,
      launchGraceMs: 20_000,
    });

    const session = sessions.createOrReuseOpenSession("project-a", 1);
    const paused = sessions.pauseRun("project-a");
    assert.equal(paused.lifecycleStatus, "paused");

    let entered = sessions.tryEnterGlobalRunnerSlot(session.sessionId);
    assert.equal(entered.ok, true);
    assert.equal(entered.session.lifecycleStatus, "launching");

    now = "2026-03-31T00:00:25.000Z";
    reconciler.reconcileSessionsTick();
    assert.equal(getSessionRow(db, session.sessionId).lifecycle_status, "interrupted");

    entered = sessions.tryEnterGlobalRunnerSlot(session.sessionId);
    assert.equal(entered.ok, true);
    assert.equal(entered.session.lifecycleStatus, "launching");
  } finally {
    db.close();
  }
});

test("pauseRun and stopRun overwrite desired state while the lease is still active", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
      leaseDurationMs: 75_000,
      launchGraceMs: 20_000,
    });

    const session = sessions.createOrReuseOpenSession("project-a", 1);
    sessions.tryEnterGlobalRunnerSlot(session.sessionId);
    sessions.acquireLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      ownerPid: 4567,
    });

    let updated = sessions.pauseRun("project-a");
    assert.equal(updated.lifecycleStatus, "running");
    assert.equal(updated.desiredState, "pause_requested");

    updated = sessions.stopRun("project-a");
    assert.equal(updated.lifecycleStatus, "running");
    assert.equal(updated.desiredState, "stop_requested");

    updated = sessions.pauseRun("project-a");
    assert.equal(updated.lifecycleStatus, "running");
    assert.equal(updated.desiredState, "pause_requested");
  } finally {
    db.close();
  }
});
