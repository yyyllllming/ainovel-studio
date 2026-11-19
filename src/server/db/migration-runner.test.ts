import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { runMigrations } from "./migration-runner.ts";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const migrations = readMigrationFiles({ migrationsFolder: resolve(platformRoot, "migrations") });
const reviewLineageColumns = [
  "submission_id",
  "version_id",
  "content_hash",
  "reviewer_profile_id",
  "prompt_hash",
  "review_schema_version",
];

function ledgerCount(db: Database.Database) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM "__drizzle_migrations"').get() as { count: number };
  return row.count;
}

function hasTable(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { present: number } | undefined;
  return Boolean(row?.present);
}

function hasColumn(db: Database.Database, tableName: string, columnName: string) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function hasIndex(db: Database.Database, indexName: string) {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
    .get(indexName) as { present: number } | undefined;
  return Boolean(row?.present);
}

function getIndexDefinition(db: Database.Database, tableName: string, indexName: string) {
  const indexes = db.prepare(`PRAGMA index_list(${tableName})`).all() as Array<{
    name: string;
    unique: number;
  }>;
  const index = indexes.find((candidate) => candidate.name === indexName);
  assert.ok(index, `missing index ${indexName}`);
  const columns = db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{
    seqno: number;
    name: string;
  }>;
  return {
    unique: index.unique === 1,
    columns: columns.sort((left, right) => left.seqno - right.seqno).map((column) => column.name),
  };
}

test("runMigrations brings a fresh database to the latest schema", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations);

    assert.equal(hasTable(db, "projects"), true);
    assert.equal(hasTable(db, "hook_plans"), true);
    assert.equal(hasColumn(db, "chapter_plans", "hook_slots_json"), true);
    assert.equal(hasIndex(db, "idx_idea_workshop_messages_idea_created"), true);
    assert.equal(hasColumn(db, "hook_plans", "planning_status"), false);
    assert.equal(ledgerCount(db), migrations.length);
  } finally {
    db.close();
  }
});

test("migration 0015 preserves legacy review reports and adds nullable lineage columns", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations.slice(0, -2));
    db.prepare(
      `INSERT INTO review_reports (
        id, project_id, chapter_no, verdict, confidence, reason,
        fix_instructions, issues_json, path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "legacy-review",
      "project-1",
      7,
      "pass",
      0.9,
      "legacy reason",
      "legacy fix",
      "[]",
      "reviews/7.json",
      "2026-07-11T00:00:00.000Z",
    );

    runMigrations(db, migrations);

    const report = db
      .prepare(
        `SELECT id, submission_id, version_id, content_hash,
          reviewer_profile_id, prompt_hash, review_schema_version
        FROM review_reports WHERE id = ?`,
      )
      .get("legacy-review");
    assert.deepEqual(report, {
      id: "legacy-review",
      submission_id: null,
      version_id: null,
      content_hash: null,
      reviewer_profile_id: null,
      prompt_hash: null,
      review_schema_version: null,
    });

    const columns = db.prepare("PRAGMA table_info(review_reports)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    assert.deepEqual(
      columns
        .filter((column) => reviewLineageColumns.includes(column.name))
        .map((column) => ({ name: column.name, notnull: column.notnull })),
      reviewLineageColumns.map((name) => ({ name, notnull: 0 })),
    );
    assert.equal(ledgerCount(db), migrations.length);
  } finally {
    db.close();
  }
});

test("migration 0016 preserves review lineage and adds nullable window hash", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations.slice(0, -1));
    db.prepare(
      `INSERT INTO review_reports (
        id, project_id, chapter_no, verdict, confidence, reason,
        fix_instructions, issues_json, path, created_at, content_hash,
        reviewer_profile_id, prompt_hash, review_schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "lineage-review",
      "project-1",
      8,
      "pass",
      0.9,
      "lineage reason",
      "lineage fix",
      "[]",
      "reviews/8.json",
      "2026-07-12T00:00:00.000Z",
      "a".repeat(64),
      "reviewer-profile",
      "b".repeat(64),
      "deep-review-v1",
    );

    runMigrations(db, migrations);

    const report = db.prepare(
      "SELECT content_hash, prompt_hash, window_content_hash FROM review_reports WHERE id = ?",
    ).get("lineage-review");
    assert.deepEqual(report, {
      content_hash: "a".repeat(64),
      prompt_hash: "b".repeat(64),
      window_content_hash: null,
    });
    assert.equal(hasColumn(db, "review_reports", "window_content_hash"), true);
    assert.equal(ledgerCount(db), migrations.length);
  } finally {
    db.close();
  }
});

test("chapter submission batch constraints reject invalid status and duplicate identity", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations);
    const insert = db.prepare(
      `INSERT INTO chapter_submission_batches (
        id, project_id, source_file_name, source_file_hash,
        chapter_count, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    assert.throws(() =>
      insert.run("batch-invalid", "project-1", "invalid.txt", "hash-invalid", 1, "unknown", "t1", "t1"),
    );
    insert.run("batch-1", "project-1", "source.txt", "hash-1", 2, "preview", "t1", "t1");
    assert.throws(() =>
      insert.run("batch-2", "project-1", "renamed.txt", "hash-1", 2, "completed", "t2", "t2"),
    );
  } finally {
    db.close();
  }
});

test("chapter submission constraints reject invalid status, source, and duplicate identity", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations);
    const insert = db.prepare(
      `INSERT INTO chapter_submissions (
        id, project_id, chapter_no, title, source, content_path,
        content_hash, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    assert.throws(() =>
      insert.run("submission-status", "project-1", 1, "Chapter 1", "human", "1.md", "hash-status", "unknown", "t1", "t1"),
    );
    assert.throws(() =>
      insert.run("submission-source", "project-1", 1, "Chapter 1", "model", "1.md", "hash-source", "draft", "t1", "t1"),
    );
    insert.run("submission-1", "project-1", 1, "Chapter 1", "human", "1.md", "hash-1", "draft", "t1", "t1");
    assert.throws(() =>
      insert.run("submission-2", "project-1", 1, "Renamed", "codex", "1-v2.md", "hash-1", "approved", "t2", "t2"),
    );
  } finally {
    db.close();
  }
});

test("submission indexes preserve uniqueness and exact column order", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations);

    assert.deepEqual(
      getIndexDefinition(db, "chapter_submission_batches", "idx_submission_batches_identity"),
      { unique: true, columns: ["project_id", "source_file_hash"] },
    );
    assert.deepEqual(
      getIndexDefinition(db, "chapter_submissions", "idx_chapter_submissions_identity"),
      { unique: true, columns: ["project_id", "chapter_no", "content_hash"] },
    );
    assert.deepEqual(
      getIndexDefinition(db, "chapter_submissions", "idx_chapter_submissions_batch"),
      { unique: false, columns: ["batch_id"] },
    );
    assert.deepEqual(
      getIndexDefinition(db, "chapter_submissions", "idx_chapter_submissions_parent"),
      { unique: false, columns: ["parent_submission_id"] },
    );
  } finally {
    db.close();
  }
});

test("ledgerless database at the latest schema is re-marked without re-executing migrations", () => {
  const db = new Database(":memory:");
  try {
    runMigrations(db, migrations);
    db.exec('DROP TABLE "__drizzle_migrations"');

    // Would throw "table hook_plans already exists" if migrations were re-run.
    runMigrations(db, migrations);

    assert.equal(ledgerCount(db), migrations.length);
    assert.equal(hasColumn(db, "hook_plans", "planning_status"), false);
  } finally {
    db.close();
  }
});

test("ledgerless database stuck at an old schema gets the remaining migrations executed", () => {
  const db = new Database(":memory:");
  try {
    // Database state as of migration 0008: projects exists, hook_plans does not.
    runMigrations(db, migrations.slice(0, 9));
    db.exec('DROP TABLE "__drizzle_migrations"');
    assert.equal(hasTable(db, "hook_plans"), false);

    runMigrations(db, migrations);

    assert.equal(hasTable(db, "hook_plans"), true);
    assert.equal(hasColumn(db, "hook_plans", "slot_index"), true);
    assert.equal(hasColumn(db, "hook_plans", "planning_status"), false);
    assert.equal(hasColumn(db, "chapter_plans", "hook_slots_json"), true);
    assert.equal(hasIndex(db, "idx_idea_workshop_messages_idea_created"), true);
    assert.equal(ledgerCount(db), migrations.length);
  } finally {
    db.close();
  }
});

test("ledgerless database missing only the newest objects resumes from the right migration", () => {
  const db = new Database(":memory:");
  try {
    // Database state as of migration 0011: chapter_plans lacks hook_slots_json.
    runMigrations(db, migrations.slice(0, 12));
    db.exec('DROP TABLE "__drizzle_migrations"');
    assert.equal(hasColumn(db, "chapter_plans", "hook_slots_json"), false);

    runMigrations(db, migrations);

    assert.equal(hasColumn(db, "chapter_plans", "hook_slots_json"), true);
    assert.equal(hasIndex(db, "idx_review_reports_project_chapter_created"), true);
    assert.equal(hasIndex(db, "idx_idea_workshop_messages_idea_created"), true);
    assert.equal(ledgerCount(db), migrations.length);
  } finally {
    db.close();
  }
});
