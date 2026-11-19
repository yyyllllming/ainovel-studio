import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";
import { createArtifactOutboxRepository } from "./repositories/artifact-outbox.repository.ts";
import { createChapterCommitRepository } from "./repositories/chapter-commit.repository.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

test("chapter commit repository stores prepared commits and advances reconcile states", () => {
  const db = createMemoryDb();
  const repository = createChapterCommitRepository({ db });
  const outboxRepo = createArtifactOutboxRepository({ db });

  try {
    const prepared = repository.insertPrepared({
      commitId: "commit-1",
      projectId: "project-a",
      chapterNo: 7,
      sessionId: null,
      sourceKind: "run",
      acceptedVersionId: "version-7",
      idempotencyKey: "project-a:7:version-7:run",
      manifestJson: "{\"chapter\":7}",
      stageDir: ".staging/commits/commit-1",
      contentHash: "hash-7",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    assert.equal(prepared.state, "prepared");
    assert.equal(repository.findByIdempotencyKey("project-a:7:version-7:run")?.commitId, "commit-1");
    assert.deepEqual(repository.listReconcileCandidates().map((entry) => entry.commitId), ["commit-1"]);

    repository.markFsApplied("commit-1", "2026-03-31T00:01:00.000Z", "2026-03-31T00:01:00.000Z");
    assert.equal(repository.getByCommitId("commit-1")?.state, "fs_applied");

    repository.markNeedsReconcile(
      "commit-1",
      "fs_probe_failed",
      "manifest mismatch",
      "2026-03-31T00:01:30.000Z",
    );
    const needsReconcile = repository.getByCommitId("commit-1");
    assert.equal(needsReconcile?.state, "needs_reconcile");
    assert.equal(needsReconcile?.lastErrorCode, "fs_probe_failed");

    repository.bumpReconcileAttempt("commit-1", "2026-03-31T00:02:00.000Z");
    assert.equal(repository.getByCommitId("commit-1")?.reconcileAttempts, 1);

    repository.markCommitted("commit-1", "2026-03-31T00:03:00.000Z", "2026-03-31T00:03:00.000Z");
    const committed = repository.getByCommitId("commit-1");
    assert.equal(committed?.state, "committed");
    assert.equal(committed?.committedAt, "2026-03-31T00:03:00.000Z");
    assert.deepEqual(repository.listReconcileCandidates().map((entry) => entry.commitId), ["commit-1"]);

    outboxRepo.insertPending({
      jobId: "job-1",
      commitId: "commit-1",
      projectId: "project-a",
      chapterNo: 7,
      jobType: "chapter_artifact_sync",
      payloadJson: "{}",
      createdAt: "2026-03-31T00:03:00.000Z",
      updatedAt: "2026-03-31T00:03:00.000Z",
    });
    assert.deepEqual(repository.listReconcileCandidates(), []);

    repository.markFailed(
      "commit-1",
      "2026-03-31T00:04:00.000Z",
      "missing_stage_dir",
      "stage missing",
      "2026-03-31T00:04:00.000Z",
    );
    const failed = repository.getByCommitId("commit-1");
    assert.equal(failed?.state, "failed");
    assert.equal(failed?.failedAt, "2026-03-31T00:04:00.000Z");
  } finally {
    db.close();
  }
});

test("chapter commit repository state guards keep committed commits from regressing", () => {
  const db = createMemoryDb();
  const repository = createChapterCommitRepository({ db });

  try {
    repository.insertPrepared({
      commitId: "commit-guard",
      projectId: "project-a",
      chapterNo: 9,
      sessionId: null,
      sourceKind: "run",
      acceptedVersionId: "version-9",
      idempotencyKey: "project-a:9:version-9:run",
      manifestJson: "{}",
      stageDir: ".staging/commits/commit-guard",
      contentHash: "hash-9",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    repository.markCommitted("commit-guard", "2026-03-31T00:01:00.000Z", "2026-03-31T00:01:00.000Z");

    const fsAppliedChanges = repository.markFsApplied(
      "commit-guard",
      "2026-03-31T00:02:00.000Z",
      "2026-03-31T00:02:00.000Z",
    );
    assert.equal(fsAppliedChanges, 0);
    assert.equal(repository.getByCommitId("commit-guard")?.state, "committed");

    const needsReconcileChanges = repository.markNeedsReconcile(
      "commit-guard",
      "reconcile_failed",
      "transient error",
      "2026-03-31T00:03:00.000Z",
    );
    assert.equal(needsReconcileChanges, 0);
    assert.equal(repository.getByCommitId("commit-guard")?.state, "committed");
  } finally {
    db.close();
  }
});

test("chapter commit repository detects newer committed commits for the same chapter", () => {
  const db = createMemoryDb();
  const repository = createChapterCommitRepository({ db });

  try {
    repository.insertPrepared({
      commitId: "commit-old",
      projectId: "project-a",
      chapterNo: 4,
      sessionId: null,
      sourceKind: "run",
      acceptedVersionId: "version-old",
      idempotencyKey: "project-a:4:version-old:run",
      manifestJson: "{}",
      stageDir: ".staging/commits/commit-old",
      contentHash: "hash-old",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    repository.insertPrepared({
      commitId: "commit-new",
      projectId: "project-a",
      chapterNo: 4,
      sessionId: null,
      sourceKind: "workshop",
      acceptedVersionId: "version-new",
      idempotencyKey: "project-a:4:version-new:workshop",
      manifestJson: "{}",
      stageDir: ".staging/commits/commit-new",
      contentHash: "hash-new",
      createdAt: "2026-03-31T01:00:00.000Z",
      updatedAt: "2026-03-31T01:00:00.000Z",
    });

    assert.equal(
      repository.hasNewerCommittedCommit("project-a", 4, "2026-03-31T00:00:00.000Z", "commit-old"),
      false,
    );

    repository.markCommitted("commit-new", "2026-03-31T01:01:00.000Z", "2026-03-31T01:01:00.000Z");
    assert.equal(
      repository.hasNewerCommittedCommit("project-a", 4, "2026-03-31T00:00:00.000Z", "commit-old"),
      true,
    );
    assert.equal(
      repository.hasNewerCommittedCommit("project-a", 4, "2026-03-31T02:00:00.000Z", "commit-other"),
      false,
    );
    assert.equal(repository.getByStageDir("project-a", ".staging/commits/commit-new")?.commitId, "commit-new");
  } finally {
    db.close();
  }
});
