import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";
import { createArtifactOutboxRepository } from "./repositories/artifact-outbox.repository.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function seedCommit(db: Database.Database, commitId = "commit-1") {
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
    commitId,
    "project-a",
    7,
    null,
    "run",
    "version-7",
    `project-a:7:${commitId}:run`,
    "prepared",
    "{}",
    `.staging/commits/${commitId}`,
    "hash-7",
    "2026-03-31T00:00:00.000Z",
    "2026-03-31T00:00:00.000Z",
  );
}

function insertPendingJob(repository: ReturnType<typeof createArtifactOutboxRepository>, jobId = "job-1") {
  return repository.insertPending({
    jobId,
    commitId: "commit-1",
    projectId: "project-a",
    chapterNo: 7,
    jobType: "chapter_artifact_sync",
    payloadJson: "{\"chapter\":7}",
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z",
  });
}

test("artifact outbox repository claims, renews, completes, fails, and requeues jobs", () => {
  const db = createMemoryDb();
  seedCommit(db);
  const repository = createArtifactOutboxRepository({ db });

  try {
    const pending = insertPendingJob(repository);
    assert.equal(pending.state, "pending");
    assert.equal(repository.selectNextClaimable("2026-03-31T00:00:00.000Z")?.jobId, "job-1");

    const claimed = repository.claim({
      jobId: "job-1",
      workerId: "worker-1",
      claimToken: "claim-1",
      claimedAt: "2026-03-31T00:01:00.000Z",
      claimExpiresAt: "2026-03-31T00:05:00.000Z",
      updatedAt: "2026-03-31T00:01:00.000Z",
    });
    assert.equal(claimed, 1);
    assert.equal(repository.selectNextClaimable("2026-03-31T00:01:00.000Z"), null);

    const renewed = repository.renewClaim({
      jobId: "job-1",
      claimToken: "claim-1",
      claimEpoch: 1,
      claimExpiresAt: "2026-03-31T00:06:00.000Z",
      updatedAt: "2026-03-31T00:02:00.000Z",
    });
    assert.equal(renewed, 1);
    assert.equal(repository.getByJobId("job-1")?.claimExpiresAt, "2026-03-31T00:06:00.000Z");

    const released = repository.releaseDone({
      jobId: "job-1",
      claimToken: "claim-1",
      claimEpoch: 1,
      doneAt: "2026-03-31T00:03:00.000Z",
      updatedAt: "2026-03-31T00:03:00.000Z",
    });
    assert.equal(released, 1);
    const doneRow = repository.getByJobId("job-1");
    assert.equal(doneRow?.state, "done");
    assert.equal(doneRow?.doneAt, "2026-03-31T00:03:00.000Z");

    seedCommit(db, "commit-2");
    repository.insertPending({
      jobId: "job-2",
      commitId: "commit-2",
      projectId: "project-a",
      chapterNo: 8,
      jobType: "chapter_artifact_sync",
      payloadJson: "{\"chapter\":8}",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    repository.claim({
      jobId: "job-2",
      workerId: "worker-2",
      claimToken: "claim-2",
      claimedAt: "2026-03-31T00:04:00.000Z",
      claimExpiresAt: "2026-03-31T00:07:00.000Z",
      updatedAt: "2026-03-31T00:04:00.000Z",
    });
    const failed = repository.failJob({
      jobId: "job-2",
      claimToken: "claim-2",
      claimEpoch: 1,
      retryable: true,
      nextAttemptAt: "2026-03-31T00:10:00.000Z",
      errorCode: "retryable_error",
      errorMessage: "try again",
      updatedAt: "2026-03-31T00:05:00.000Z",
    });
    assert.equal(failed, 1);
    const retryableRow = repository.getByJobId("job-2");
    assert.equal(retryableRow?.state, "pending");
    assert.equal(retryableRow?.attempts, 1);
    assert.equal(retryableRow?.nextAttemptAt, "2026-03-31T00:10:00.000Z");

    repository.claim({
      jobId: "job-2",
      workerId: "worker-2",
      claimToken: "claim-3",
      claimedAt: "2026-03-31T00:10:00.000Z",
      claimExpiresAt: "2026-03-31T00:12:00.000Z",
      updatedAt: "2026-03-31T00:10:00.000Z",
    });
    repository.failJob({
      jobId: "job-2",
      claimToken: "claim-3",
      claimEpoch: 2,
      retryable: false,
      nextAttemptAt: null,
      errorCode: "fatal_error",
      errorMessage: "stop",
      updatedAt: "2026-03-31T00:11:00.000Z",
    });
    const failedRow = repository.getByJobId("job-2");
    assert.equal(failedRow?.state, "failed");
    assert.equal(failedRow?.attempts, 2);
    assert.equal(failedRow?.nextAttemptAt, null);

    seedCommit(db, "commit-3");
    repository.insertPending({
      jobId: "job-3",
      commitId: "commit-3",
      projectId: "project-a",
      chapterNo: 9,
      jobType: "chapter_artifact_sync",
      payloadJson: "{\"chapter\":9}",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    repository.claim({
      jobId: "job-3",
      workerId: "worker-3",
      claimToken: "claim-4",
      claimedAt: "2026-03-31T00:06:00.000Z",
      claimExpiresAt: "2026-03-31T00:07:00.000Z",
      updatedAt: "2026-03-31T00:06:00.000Z",
    });
    const requeued = repository.requeueExpiredClaims(
      "2026-03-31T00:08:00.000Z",
      "2026-03-31T00:08:00.000Z",
    );
    assert.equal(requeued, 1);
    const requeuedRow = repository.getByJobId("job-3");
    assert.equal(requeuedRow?.state, "pending");
    assert.equal(requeuedRow?.claimToken, null);
    assert.equal(repository.selectNextClaimable("2026-03-31T00:08:00.000Z")?.jobId, "job-3");
  } finally {
    db.close();
  }
});

test("artifact outbox repository lists active chapter jobs and resets finished jobs to pending", () => {
  const db = createMemoryDb();
  seedCommit(db);
  const repository = createArtifactOutboxRepository({ db });

  try {
    insertPendingJob(repository);
    assert.deepEqual(
      repository.listActiveByChapter("project-a", 7, "chapter_artifact_sync").map((job) => job.jobId),
      ["job-1"],
    );
    assert.deepEqual(repository.listActiveByChapter("project-a", 8, "chapter_artifact_sync"), []);

    repository.claim({
      jobId: "job-1",
      workerId: "worker-1",
      claimToken: "claim-1",
      claimedAt: "2026-03-31T00:01:00.000Z",
      claimExpiresAt: "2026-03-31T00:05:00.000Z",
      updatedAt: "2026-03-31T00:01:00.000Z",
    });
    assert.deepEqual(
      repository.listActiveByChapter("project-a", 7, "chapter_artifact_sync").map((job) => job.state),
      ["claimed"],
    );

    repository.releaseDone({
      jobId: "job-1",
      claimToken: "claim-1",
      claimEpoch: 1,
      doneAt: "2026-03-31T00:02:00.000Z",
      updatedAt: "2026-03-31T00:02:00.000Z",
    });
    assert.deepEqual(repository.listActiveByChapter("project-a", 7, "chapter_artifact_sync"), []);

    const reset = repository.resetToPending("job-1", "2026-03-31T00:03:00.000Z");
    assert.equal(reset, 1);
    const resetRow = repository.getByJobId("job-1");
    assert.equal(resetRow?.state, "pending");
    assert.equal(resetRow?.attempts, 0);
    assert.equal(resetRow?.doneAt, null);
    assert.equal(resetRow?.claimToken, null);

    // pending 状态不允许重置（仅 done/failed 终态可重新入队）。
    assert.equal(repository.resetToPending("job-1", "2026-03-31T00:04:00.000Z"), 0);
  } finally {
    db.close();
  }
});

test("artifact outbox repository forces failed state once attempts reach the cap", () => {
  const db = createMemoryDb();
  seedCommit(db);
  const repository = createArtifactOutboxRepository({ db });

  try {
    insertPendingJob(repository);

    repository.claim({
      jobId: "job-1",
      workerId: "worker-1",
      claimToken: "claim-1",
      claimedAt: "2026-03-31T00:01:00.000Z",
      claimExpiresAt: "2026-03-31T00:05:00.000Z",
      updatedAt: "2026-03-31T00:01:00.000Z",
    });
    repository.failJob({
      jobId: "job-1",
      claimToken: "claim-1",
      claimEpoch: 1,
      retryable: true,
      nextAttemptAt: "2026-03-31T00:06:00.000Z",
      errorCode: "transient",
      errorMessage: "retry once",
      updatedAt: "2026-03-31T00:02:00.000Z",
      maxAttempts: 2,
    });
    assert.equal(repository.getByJobId("job-1")?.state, "pending");
    assert.equal(repository.getByJobId("job-1")?.attempts, 1);

    repository.claim({
      jobId: "job-1",
      workerId: "worker-1",
      claimToken: "claim-2",
      claimedAt: "2026-03-31T00:06:00.000Z",
      claimExpiresAt: "2026-03-31T00:10:00.000Z",
      updatedAt: "2026-03-31T00:06:00.000Z",
    });
    repository.failJob({
      jobId: "job-1",
      claimToken: "claim-2",
      claimEpoch: 2,
      retryable: true,
      nextAttemptAt: "2026-03-31T00:11:00.000Z",
      errorCode: "transient",
      errorMessage: "retry again",
      updatedAt: "2026-03-31T00:07:00.000Z",
      maxAttempts: 2,
    });

    const cappedRow = repository.getByJobId("job-1");
    assert.equal(cappedRow?.state, "failed");
    assert.equal(cappedRow?.attempts, 2);
    assert.equal(cappedRow?.nextAttemptAt, null);
  } finally {
    db.close();
  }
});
