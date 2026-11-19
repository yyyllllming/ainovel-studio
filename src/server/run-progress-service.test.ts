import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";
import { createRunProgressService } from "./run/progress.service.ts";
import type { RunProgressPayload } from "./types.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function createLegacyProgress(overrides: Partial<RunProgressPayload> = {}): RunProgressPayload {
  return {
    running: false,
    stage: "idle",
    currentChapter: 1,
    totalChapters: 20,
    retryCount: 0,
    confidence: 0,
    currentPosition: 0,
    wordCount: 0,
    stageDetails: {},
    logs: [],
    ...overrides,
  };
}

test("getRunProgressView keeps run_sessions as the active truth source and downgrades orphaned active snapshots", () => {
  const db = createMemoryDb();

  try {
    const service = createRunProgressService({
      db,
      now: () => Date.parse("2026-03-31T00:00:00.000Z"),
      buildProgressSnapshot: () => createLegacyProgress({
        running: true,
        stage: "writing",
        currentChapter: 3,
      }),
    });

    const progress = service.getRunProgressView("project-a");
    assert.equal(progress.stage, "interrupted");
    assert.equal(progress.currentChapter, 3);
    assert.equal(progress.running, false);
    assert.equal(progress.desiredState, "idle");
    assert.equal(progress.recoverable, false);
    assert.equal(progress.staleHeartbeat, true);
    assert.equal(progress.lastActiveStage, "writing");
    assert.equal("sessionId" in progress, false);
  } finally {
    db.close();
  }
});

test("getRunProgressView prefers run session authority while preserving persisted progress details", () => {
  const db = createMemoryDb();

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        target_chapter,
        desired_state,
        lifecycle_status,
        last_heartbeat_at,
        lease_expires_at,
        current_chapter,
        current_stage,
        current_step_key,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "session-1",
      "project-a",
      1,
      10,
      null,
      "running",
      "running",
      "2026-03-31T00:00:05.000Z",
      "2026-03-31T00:01:20.000Z",
      10,
      "review",
      "chapter.review_passed",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:05.000Z",
    );

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
      "session-1",
      1,
      10,
      "review",
      "chapter.review_passed",
      "completed",
      1,
      "2026-03-31T00:00:05.000Z",
    );

    db.prepare(`
      INSERT INTO run_events (
        event_id,
        session_id,
        actor_type,
        event_type,
        level,
        chapter_no,
        stage,
        step_key,
        message,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "ev-1",
      "session-1",
      "runner",
      "step_completed",
      "info",
      10,
      "review",
      "chapter.review_passed",
      "review complete",
      "2026-03-31T00:00:06.000Z",
    );

    const service = createRunProgressService({
      db,
      now: () => Date.parse("2026-03-31T00:00:10.000Z"),
      buildProgressSnapshot: () => createLegacyProgress({
        retryCount: 2,
        confidence: 0.72,
        totalChapters: 24,
        stageDetails: {
          review: {
            mode: "deep",
            verdict: "pass",
            confidence: 0.72,
            retryCount: 2,
          },
        },
      }),
    });

    const progress = service.getRunProgressView("project-a");
    assert.equal(progress.running, true);
    assert.equal(progress.stage, "review");
    assert.equal(progress.currentChapter, 10);
    assert.equal(progress.totalChapters, 24);
    assert.equal(progress.retryCount, 2);
    assert.equal(progress.confidence, 0.72);
    assert.equal(progress.desiredState, "running");
    assert.equal(progress.heartbeatAt, "2026-03-31T00:00:05.000Z");
    assert.equal(progress.sessionId, "session-1");
    assert.equal(progress.lifecycleStatus, "running");
    assert.equal(progress.recoverable, false);
    assert.deepEqual(progress.logs, [
      {
        level: "info",
        message: "review complete",
        createdAt: "2026-03-31T00:00:06.000Z",
      },
    ]);
  } finally {
    db.close();
  }
});

test("getRunProgressView falls back to run_logs-backed logs when no run_events exist for the session", () => {
  const db = createMemoryDb();

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        desired_state,
        lifecycle_status,
        current_chapter,
        current_stage,
        last_heartbeat_at,
        lease_expires_at,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "session-logs",
      "project-a",
      1,
      4,
      "running",
      "running",
      4,
      "writing",
      "2026-03-31T00:00:05.000Z",
      "2026-03-31T00:01:20.000Z",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:05.000Z",
    );

    const snapshotLogs = [
      {
        level: "info",
        message: "开始处理第 4 章",
        createdAt: "2026-03-31T00:00:04.000Z",
      },
    ];
    const service = createRunProgressService({
      db,
      now: () => Date.parse("2026-03-31T00:00:10.000Z"),
      buildProgressSnapshot: () => createLegacyProgress({
        running: true,
        stage: "writing",
        currentChapter: 4,
        logs: snapshotLogs,
      }),
    });

    const progress = service.getRunProgressView("project-a");
    assert.equal(progress.running, true);
    assert.deepEqual(progress.logs, snapshotLogs);
  } finally {
    db.close();
  }
});

test("getRunProgressView degrades running sessions with expired leases into recoverable interrupted views", () => {
  const db = createMemoryDb();
  const now = Date.parse("2026-03-31T00:05:00.000Z");

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        desired_state,
        lifecycle_status,
        current_chapter,
        current_stage,
        lease_epoch,
        last_heartbeat_at,
        lease_expires_at,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sess-dead-runner",
      "project-a",
      1,
      7,
      "running",
      "running",
      7,
      "writing",
      2,
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:01:15.000Z",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    );

    const service = createRunProgressService({
      db,
      now: () => now,
      buildProgressSnapshot: () => createLegacyProgress({
        running: true,
        stage: "writing",
        currentChapter: 7,
      }),
    });

    const progress = service.getRunProgressView("project-a");
    assert.equal(progress.running, false);
    assert.equal(progress.stage, "interrupted");
    assert.equal(progress.recoverable, true);
    assert.equal(progress.staleHeartbeat, true);
    assert.equal(progress.lastActiveStage, "writing");
    assert.equal(progress.currentChapter, 7);
  } finally {
    db.close();
  }
});

test("getRunProgressView marks interrupted sessions as recoverable and preserves stopped intent", () => {
  const db = createMemoryDb();

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        target_chapter,
        desired_state,
        lifecycle_status,
        last_heartbeat_at,
        lease_expires_at,
        current_chapter,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "session-2",
      "project-a",
      1,
      12,
      null,
      "stop_requested",
      "interrupted",
      "2026-03-31T00:00:05.000Z",
      "2026-03-31T00:00:06.000Z",
      12,
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:07.000Z",
    );

    const service = createRunProgressService({
      db,
      now: () => Date.parse("2026-03-31T00:00:10.000Z"),
      buildProgressSnapshot: () => createLegacyProgress({
        totalChapters: 24,
      }),
    });

    const progress = service.getRunProgressView("project-a");
    assert.equal(progress.running, false);
    assert.equal(progress.stage, "interrupted");
    assert.equal(progress.currentChapter, 12);
    assert.equal(progress.desiredState, "stopped");
    assert.equal(progress.staleHeartbeat, false);
    assert.equal(progress.recoverable, true);
    assert.equal(progress.lifecycleStatus, "interrupted");
  } finally {
    db.close();
  }
});

test("getRunProgressView preserves pause control intent for active sessions", () => {
  const db = createMemoryDb();
  const now = Date.parse("2026-03-31T00:00:10.000Z");

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        desired_state,
        lifecycle_status,
        current_chapter,
        current_stage,
        lease_epoch,
        last_heartbeat_at,
        lease_expires_at,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sess-pause",
      "project-a",
      1,
      5,
      "pause_requested",
      "running",
      5,
      "writing",
      2,
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:01:00.000Z",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    );

    const service = createRunProgressService({
      db,
      now: () => now,
      buildProgressSnapshot() {
        return {
          running: false,
          stage: "idle",
          currentChapter: 5,
          totalChapters: 12,
          retryCount: 0,
          confidence: 0,
          currentPosition: 0,
          wordCount: 0,
          stageDetails: {},
          logs: [],
        };
      },
    });

    const paused = service.getRunProgressView("project-a");
    assert.equal(paused.running, false);
    assert.equal(paused.stage, "paused");
    assert.equal(paused.desiredState, "paused");
  } finally {
    db.close();
  }
});

test("getRunProgressView preserves stop control intent for active sessions", () => {
  const db = createMemoryDb();
  const now = Date.parse("2026-03-31T00:00:10.000Z");

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        desired_state,
        lifecycle_status,
        current_chapter,
        current_stage,
        lease_epoch,
        last_heartbeat_at,
        lease_expires_at,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sess-stop",
      "project-b",
      1,
      6,
      "stop_requested",
      "running",
      6,
      "review",
      3,
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:01:00.000Z",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    );

    const service = createRunProgressService({
      db,
      now: () => now,
      buildProgressSnapshot() {
        return {
          running: false,
          stage: "idle",
          currentChapter: 6,
          totalChapters: 12,
          retryCount: 0,
          confidence: 0,
          currentPosition: 0,
          wordCount: 0,
          stageDetails: {},
          logs: [],
        };
      },
    });

    const stopping = service.getRunProgressView("project-b");
    assert.equal(stopping.running, true);
    assert.equal(stopping.stage, "review");
    assert.equal(stopping.desiredState, "stopped");
  } finally {
    db.close();
  }
});

test("getRunProgressView degrades stale stop-requested sessions into recoverable progress", () => {
  const db = createMemoryDb();
  const now = Date.parse("2026-03-31T00:04:30.000Z");

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        desired_state,
        lifecycle_status,
        current_chapter,
        current_stage,
        lease_epoch,
        last_heartbeat_at,
        lease_expires_at,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sess-stop-stale",
      "project-c",
      1,
      8,
      "stop_requested",
      "running",
      8,
      "review",
      3,
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:01:00.000Z",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    );

    const service = createRunProgressService({
      db,
      now: () => now,
      buildProgressSnapshot() {
        return {
          running: false,
          stage: "idle",
          currentChapter: 8,
          totalChapters: 12,
          retryCount: 0,
          confidence: 0,
          currentPosition: 0,
          wordCount: 0,
          stageDetails: {},
          logs: [],
        };
      },
    });

    const progress = service.getRunProgressView("project-c");
    assert.equal(progress.running, false);
    assert.equal(progress.stage, "paused");
    assert.equal(progress.desiredState, "stopped");
    assert.equal(progress.recoverable, true);
    assert.equal(progress.staleHeartbeat, true);
  } finally {
    db.close();
  }
});
