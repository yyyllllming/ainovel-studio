import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function listIndexes(db: Database.Database, tableName: string) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
    .all(tableName)
    .map((row) => (row as { name: string }).name);
}

test("ensureDatabase creates Batch 1 run control tables and indexes", () => {
  const db = createMemoryDb();

  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    assert.equal(tables.includes("run_sessions"), true);
    assert.equal(tables.includes("run_checkpoints"), true);
    assert.equal(tables.includes("run_events"), true);
    assert.equal(tables.includes("run_config_snapshots"), true);
    assert.equal(tables.includes("chapter_commits"), true);
    assert.equal(tables.includes("artifact_outbox"), true);
    assert.equal(tables.includes("artifact_manifests"), true);

    const sessionIndexes = listIndexes(db, "run_sessions");
    assert.equal(sessionIndexes.includes("uq_run_sessions_project_open"), true);
    assert.equal(sessionIndexes.includes("uq_run_sessions_global_active"), true);
    assert.equal(sessionIndexes.includes("uq_run_sessions_project_seq"), true);
    assert.equal(sessionIndexes.includes("idx_run_sessions_lease_expiry"), true);
    assert.equal(sessionIndexes.includes("idx_run_sessions_status"), true);

    const checkpointIndexes = listIndexes(db, "run_checkpoints");
    assert.equal(checkpointIndexes.includes("idx_run_checkpoints_session_latest"), true);

    const eventIndexes = listIndexes(db, "run_events");
    assert.equal(eventIndexes.includes("idx_run_events_session_created"), true);
    assert.equal(eventIndexes.includes("idx_run_events_level_created"), true);

    const commitIndexes = listIndexes(db, "chapter_commits");
    assert.equal(commitIndexes.includes("idx_chapter_commits_project_state"), true);
    assert.equal(commitIndexes.includes("idx_chapter_commits_session"), true);
    assert.equal(commitIndexes.includes("idx_chapter_commits_chapter"), true);

    const outboxIndexes = listIndexes(db, "artifact_outbox");
    assert.equal(outboxIndexes.includes("idx_artifact_outbox_claimable"), true);

    const manifestIndexes = listIndexes(db, "artifact_manifests");
    assert.equal(manifestIndexes.includes("artifact_manifests_commit_path_idx"), true);
    assert.equal(manifestIndexes.includes("idx_artifact_manifests_project_chapter_family"), true);
  } finally {
    db.close();
  }
});

test("run_sessions enforces one project-open session and one global active session", () => {
  const db = createMemoryDb();

  try {
    const insert = db.prepare(`
      INSERT INTO run_sessions (
        session_id,
        project_id,
        session_seq,
        from_chapter,
        target_chapter,
        desired_state,
        lifecycle_status,
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      "session-1",
      "project-a",
      1,
      1,
      null,
      "running",
      "queued",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    );

    assert.throws(() =>
      insert.run(
        "session-2",
        "project-a",
        2,
        2,
        null,
        "running",
        "paused",
        "2026-03-31T00:01:00.000Z",
        "2026-03-31T00:01:00.000Z",
      ),
    );

    assert.throws(() =>
      insert.run(
        "session-3",
        "project-b",
        1,
        1,
        null,
        "running",
        "launching",
        "2026-03-31T00:02:00.000Z",
        "2026-03-31T00:02:00.000Z",
      ),
    );

    insert.run(
      "session-4",
      "project-b",
      1,
      1,
      null,
      "running",
      "paused",
      "2026-03-31T00:03:00.000Z",
      "2026-03-31T00:03:00.000Z",
    );

    assert.deepEqual(
      db.prepare("SELECT COUNT(*) AS count FROM run_sessions").get() as { count: number },
      { count: 2 },
    );
  } finally {
    db.close();
  }
});

test("run_checkpoints and run_config_snapshots enforce Batch 1 recovery idempotency", () => {
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
        started_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "session-1",
      "project-a",
      1,
      1,
      null,
      "running",
      "queued",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    );

    const insertCheckpoint = db.prepare(`
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
    `);

    insertCheckpoint.run(
      "cp-1",
      "session-1",
      1,
      10,
      "blueprint",
      "chapter.blueprint_accepted",
      "completed",
      1,
      "2026-03-31T00:05:00.000Z",
    );

    assert.throws(() =>
      insertCheckpoint.run(
        "cp-2",
        "session-1",
        2,
        10,
        "blueprint",
        "chapter.blueprint_accepted",
        "completed",
        1,
        "2026-03-31T00:06:00.000Z",
      ),
    );

    db.prepare(`
      INSERT INTO run_config_snapshots (
        config_snapshot_id,
        session_id,
        llm_profile_hash,
        review_policy_hash,
        style_profile_hash,
        prompt_pack_hash,
        snapshot_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "cfg-1",
      "session-1",
      "llm",
      "review",
      "style",
      "prompt",
      "{}",
      "2026-03-31T00:07:00.000Z",
    );

    assert.throws(() =>
      db.prepare(`
        INSERT INTO run_config_snapshots (
          config_snapshot_id,
          session_id,
          llm_profile_hash,
          review_policy_hash,
          style_profile_hash,
          prompt_pack_hash,
          snapshot_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "cfg-2",
        "session-1",
        "llm",
        "review",
        "style",
        "prompt",
        "{}",
        "2026-03-31T00:08:00.000Z",
      ),
    );
  } finally {
    db.close();
  }
});

test("chapter_commits and artifact_outbox enforce Batch 2 commit idempotency", () => {
  const db = createMemoryDb();

  try {
    db.prepare(`
      INSERT INTO chapter_commits (
        commit_id,
        project_id,
        chapter_no,
        session_id,
        source_kind,
        accepted_version_id,
        idempotency_key,
        state,
        manifest_json,
        stage_dir,
        content_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "commit-1",
      "project-a",
      3,
      null,
      "run",
      "version-1",
      "project-a:3:version-1:run",
      "prepared",
      "{}",
      ".staging/commit-1",
      "hash-1",
      "2026-03-31T00:00:00.000Z",
      "2026-03-31T00:00:00.000Z",
    );

    assert.throws(() =>
      db.prepare(`
        INSERT INTO chapter_commits (
          commit_id,
          project_id,
          chapter_no,
          session_id,
          source_kind,
          accepted_version_id,
          idempotency_key,
          state,
          manifest_json,
          stage_dir,
          content_hash,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "commit-2",
        "project-a",
        3,
        null,
        "run",
        "version-1",
        "project-a:3:version-1:run",
        "prepared",
        "{}",
        ".staging/commit-2",
        "hash-1",
        "2026-03-31T00:01:00.000Z",
        "2026-03-31T00:01:00.000Z",
      ),
    );

    db.prepare(`
      INSERT INTO artifact_outbox (
        job_id,
        commit_id,
        project_id,
        chapter_no,
        job_type,
        state,
        payload_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "job-1",
      "commit-1",
      "project-a",
      3,
      "chapter_artifact_sync",
      "pending",
      "{}",
      "2026-03-31T00:02:00.000Z",
      "2026-03-31T00:02:00.000Z",
    );

    assert.throws(() =>
      db.prepare(`
        INSERT INTO artifact_outbox (
          job_id,
          commit_id,
          project_id,
          chapter_no,
          job_type,
          state,
          payload_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "job-2",
        "commit-1",
        "project-a",
        3,
        "chapter_artifact_sync",
        "pending",
        "{}",
        "2026-03-31T00:03:00.000Z",
        "2026-03-31T00:03:00.000Z",
      ),
    );
  } finally {
    db.close();
  }
});
