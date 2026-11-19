import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { ensureDatabase } from "./db/init.ts";
import { createCheckpointService, recordChapterFinalizationCheckpoint } from "./run/checkpoint.service.ts";
import { createSessionService } from "./run/session.service.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

test("insertCompletedCheckpoint records completed milestones idempotently", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const checkpoints = createCheckpointService({
      db,
      now: () => "2026-03-31T00:00:05.000Z",
    });

    const session = sessions.createOrReuseOpenSession("project-a", 10);

    checkpoints.insertCompletedCheckpoint({
      sessionId: session.sessionId,
      checkpointSeq: 1,
      chapterNo: 10,
      stage: "blueprint",
      stepKey: "chapter.blueprint_accepted",
      stepStatus: "completed",
      leaseEpoch: 1,
      payloadJson: JSON.stringify({ ok: true }),
    });
    checkpoints.insertCompletedCheckpoint({
      sessionId: session.sessionId,
      checkpointSeq: 1,
      chapterNo: 10,
      stage: "blueprint",
      stepKey: "chapter.blueprint_accepted",
      stepStatus: "completed",
      leaseEpoch: 1,
      payloadJson: JSON.stringify({ ok: true }),
    });

    assert.deepEqual(
      db.prepare("SELECT COUNT(*) AS count FROM run_checkpoints WHERE session_id = ?").get(session.sessionId) as { count: number },
      { count: 1 },
    );
  } finally {
    db.close();
  }
});

test("buildResumeCursor advances from the latest completed checkpoint", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const checkpoints = createCheckpointService({
      db,
      now: () => "2026-03-31T00:00:05.000Z",
    });

    const session = sessions.createOrReuseOpenSession("project-a", 10);

    assert.deepEqual(checkpoints.buildResumeCursor(session.sessionId), {
      chapterNo: null,
      nextStepKey: "chapter.context_ready",
      draftCheckpointPath: null,
    });

    checkpoints.insertCompletedCheckpoint({
      sessionId: session.sessionId,
      checkpointSeq: 1,
      chapterNo: 10,
      stage: "context",
      stepKey: "chapter.context_ready",
      stepStatus: "completed",
      leaseEpoch: 1,
      artifactRefsJson: JSON.stringify({ draftCheckpointPath: "drafts/.checkpoints/ch10.md" }),
    });

    assert.deepEqual(checkpoints.buildResumeCursor(session.sessionId), {
      chapterNo: 10,
      nextStepKey: "chapter.blueprint_accepted",
      draftCheckpointPath: "drafts/.checkpoints/ch10.md",
    });

    checkpoints.insertCompletedCheckpoint({
      sessionId: session.sessionId,
      checkpointSeq: 2,
      chapterNo: 10,
      stage: "analysis",
      stepKey: "chapter.finalization_committed",
      stepStatus: "completed",
      leaseEpoch: 1,
    });

    assert.deepEqual(checkpoints.buildResumeCursor(session.sessionId), {
      chapterNo: 11,
      nextStepKey: "chapter.context_ready",
      draftCheckpointPath: null,
    });
  } finally {
    db.close();
  }
});

test("loadLatestCheckpoint returns the highest checkpoint sequence for a session", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const checkpoints = createCheckpointService({
      db,
      now: () => "2026-03-31T00:00:05.000Z",
    });

    const session = sessions.createOrReuseOpenSession("project-a", 10);

    checkpoints.insertCompletedCheckpoint({
      sessionId: session.sessionId,
      checkpointSeq: 1,
      chapterNo: 10,
      stage: "blueprint",
      stepKey: "chapter.blueprint_accepted",
      stepStatus: "completed",
      leaseEpoch: 1,
    });
    checkpoints.insertCompletedCheckpoint({
      sessionId: session.sessionId,
      checkpointSeq: 2,
      chapterNo: 10,
      stage: "writing",
      stepKey: "chapter.draft_generated",
      stepStatus: "completed",
      leaseEpoch: 1,
    });

    const latest = checkpoints.loadLatestCheckpoint(session.sessionId);
    assert.equal(latest?.checkpointSeq, 2);
    assert.equal(latest?.stepKey, "chapter.draft_generated");
  } finally {
    db.close();
  }
});

test("recordChapterFinalizationCheckpoint persists committed chapters and skips unknown sessions", () => {
  const db = createMemoryDb();

  try {
    const sessions = createSessionService({
      db,
      now: () => "2026-03-31T00:00:00.000Z",
    });
    const checkpoints = createCheckpointService({
      db,
      now: () => "2026-03-31T00:00:05.000Z",
    });

    const session = sessions.createOrReuseOpenSession("project-a", 10);
    sessions.tryEnterGlobalRunnerSlot(session.sessionId);
    sessions.acquireLease({
      sessionId: session.sessionId,
      ownerToken: "owner-a",
      ownerPid: 4567,
    });

    const recorded = recordChapterFinalizationCheckpoint({
      sessionId: session.sessionId,
      chapterNo: 10,
      db,
      now: () => "2026-03-31T00:00:06.000Z",
    });

    assert.equal(recorded?.stepKey, "chapter.finalization_committed");
    assert.equal(recorded?.chapterNo, 10);
    assert.equal(recorded?.checkpointSeq, 1);
    assert.equal(recorded?.leaseEpoch, 1);
    assert.deepEqual(checkpoints.buildResumeCursor(session.sessionId), {
      chapterNo: 11,
      nextStepKey: "chapter.context_ready",
      draftCheckpointPath: null,
    });

    // Re-finalizing the same chapter (e.g. a retried run) stays idempotent.
    recordChapterFinalizationCheckpoint({
      sessionId: session.sessionId,
      chapterNo: 10,
      db,
      now: () => "2026-03-31T00:00:07.000Z",
    });
    const next = recordChapterFinalizationCheckpoint({
      sessionId: session.sessionId,
      chapterNo: 11,
      db,
      now: () => "2026-03-31T00:00:08.000Z",
    });
    assert.equal(next?.checkpointSeq, 2);
    assert.deepEqual(
      db.prepare("SELECT COUNT(*) AS count FROM run_checkpoints WHERE session_id = ?").get(session.sessionId) as { count: number },
      { count: 2 },
    );

    // Legacy in-process session ids without a run_sessions row write nothing.
    assert.equal(
      recordChapterFinalizationCheckpoint({
        sessionId: "legacy-nanoid",
        chapterNo: 3,
        db,
      }),
      null,
    );
    assert.equal(
      recordChapterFinalizationCheckpoint({
        sessionId: null,
        chapterNo: 3,
        db,
      }),
      null,
    );
  } finally {
    db.close();
  }
});
