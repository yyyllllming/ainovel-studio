import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";
import { createArtifactOutboxRepository } from "./repositories/artifact-outbox.repository.ts";
import { createOutboxService } from "./commit/outbox.service.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function seedCommit(db: Database.Database, commitId: string) {
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
    `${commitId}:idem`,
    "prepared",
    "{}",
    `.staging/commits/${commitId}`,
    "hash-7",
    "2026-03-31T00:00:00.000Z",
    "2026-03-31T00:00:00.000Z",
  );
}

test("outbox service prevents double claims and recovers expired claims", () => {
  const db = createMemoryDb();
  seedCommit(db, "commit-1");
  const outboxRepo = createArtifactOutboxRepository({ db });
  outboxRepo.insertPending({
    jobId: "job-1",
    commitId: "commit-1",
    projectId: "project-a",
    chapterNo: 7,
    jobType: "chapter_artifact_sync",
    payloadJson: "{}",
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z",
  });

  const timestamps = [
    "2026-03-31T00:01:00.000Z",
    "2026-03-31T00:01:00.000Z",
    "2026-03-31T00:02:01.000Z",
  ];
  let claimSeq = 0;
  const service = createOutboxService({
    db,
    outboxRepo,
    now: () => timestamps.shift() ?? "2026-03-31T00:04:01.000Z",
    nextClaimToken: () => `claim-${++claimSeq}`,
    claimTtlMs: 60_000,
  });

  try {
    const firstClaim = service.claimNextJob("worker-a");
    assert.equal(firstClaim?.jobId, "job-1");
    assert.equal(firstClaim?.claimToken, "claim-1");
    assert.equal(firstClaim?.claimEpoch, 1);

    const secondClaim = service.claimNextJob("worker-b");
    assert.equal(secondClaim, null);

    const thirdClaim = service.claimNextJob("worker-c");
    assert.equal(thirdClaim?.jobId, "job-1");
    assert.equal(thirdClaim?.claimToken, "claim-2");
    assert.equal(thirdClaim?.claimEpoch, 2);
  } finally {
    db.close();
  }
});

test("outbox service renews, completes, and fails claimed jobs", () => {
  const db = createMemoryDb();
  seedCommit(db, "commit-2");
  const outboxRepo = createArtifactOutboxRepository({ db });
  outboxRepo.insertPending({
    jobId: "job-2",
    commitId: "commit-2",
    projectId: "project-a",
    chapterNo: 8,
    jobType: "chapter_artifact_sync",
    payloadJson: "{}",
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z",
  });

  const timestamps = [
    "2026-03-31T00:01:00.000Z",
    "2026-03-31T00:01:30.000Z",
    "2026-03-31T00:02:00.000Z",
    "2026-03-31T00:03:00.000Z",
    "2026-03-31T00:04:00.000Z",
  ];
  const service = createOutboxService({
    db,
    outboxRepo,
    now: () => timestamps.shift() ?? "2026-03-31T00:04:00.000Z",
    nextClaimToken: () => "claim-done",
    claimTtlMs: 60_000,
  });

  try {
    const claim = service.claimNextJob("worker-done");
    assert.equal(claim?.claimToken, "claim-done");
    assert.equal(
      service.renewClaim({
        jobId: "job-2",
        claimToken: "claim-done",
        claimEpoch: 1,
      }),
      true,
    );
    assert.equal(
      service.releaseDone({
        jobId: "job-2",
        claimToken: "claim-done",
        claimEpoch: 1,
      }),
      true,
    );
    assert.equal(outboxRepo.getByJobId("job-2")?.state, "done");

    seedCommit(db, "commit-3");
    outboxRepo.insertPending({
      jobId: "job-3",
      commitId: "commit-3",
      projectId: "project-a",
      chapterNo: 9,
      jobType: "chapter_artifact_sync",
      payloadJson: "{}",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    const retryClaim = service.claimNextJob("worker-retry");
    assert.equal(retryClaim?.claimEpoch, 1);
    assert.equal(
      service.failJob({
        jobId: "job-3",
        claimToken: retryClaim!.claimToken!,
        claimEpoch: retryClaim!.claimEpoch,
        retryable: true,
        nextAttemptAt: "2026-03-31T00:05:00.000Z",
        errorCode: "retryable",
        errorMessage: "retry later",
      }),
      true,
    );
    const retryRow = outboxRepo.getByJobId("job-3");
    assert.equal(retryRow?.state, "pending");
    assert.equal(retryRow?.attempts, 1);
    assert.equal(retryRow?.nextAttemptAt, "2026-03-31T00:05:00.000Z");
  } finally {
    db.close();
  }
});
