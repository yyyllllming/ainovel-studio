import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { ensureDatabase } from "./db/init.ts";
import { createChapterCommitRepository } from "./repositories/chapter-commit.repository.ts";
import { createArtifactOutboxRepository } from "./repositories/artifact-outbox.repository.ts";
import { createChapterCommitService } from "./commit/chapter-commit.service.ts";
import { commitStageDir, ensureProjectLayout, readFinalChapter, writeCommitStage } from "./project-files.ts";
import { projectDir } from "./paths.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function createProjectId() {
  return `chapter-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

function seedVersion(db: Database.Database, input: {
  projectId: string;
  chapterNo: number;
  versionId: string;
}) {
  db.prepare(`
    INSERT INTO chapter_versions (
      id,
      project_id,
      chapter_no,
      version_no,
      temperature,
      path,
      excerpt,
      selected,
      source,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.versionId,
    input.projectId,
    input.chapterNo,
    1,
    0.7,
    `versions/chapter_${String(input.chapterNo).padStart(3, "0")}_v1.md`,
    "excerpt",
    0,
    "workshop",
    "2026-03-31T00:00:00.000Z",
  );
}

async function createPreparedCommitHarness() {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  seedVersion(db, {
    projectId,
    chapterNo: 7,
    versionId: "version-7",
  });

  const commitRepo = createChapterCommitRepository({ db });
  const outboxRepo = createArtifactOutboxRepository({ db });
  const stageDir = commitStageDir(projectId, "commit-1");
  const manifest = await writeCommitStage(stageDir, [
    {
      relativePath: "chapters/chapter_007.md",
      content: "chapter seven final\n",
    },
  ]);

  const values = [
    "2026-03-31T00:00:00.000Z",
    "2026-03-31T00:01:00.000Z",
    "2026-03-31T00:02:00.000Z",
    "2026-03-31T00:03:00.000Z",
    "2026-03-31T00:04:00.000Z",
  ];
  const now = () => values.shift() ?? "2026-03-31T00:04:00.000Z";

  const service = createChapterCommitService({
    db,
    commitRepo,
    outboxRepo,
    now,
    nextId(prefix) {
      return prefix === "commit" ? "commit-1" : "job-1";
    },
  });

  const prepared = await service.prepareCommit({
    projectId,
    chapterNo: 7,
    sessionId: null,
    sourceKind: "run",
    acceptedVersionId: "version-7",
    idempotencyKey: `${projectId}:7:version-7:run`,
    manifest,
    stageDir,
    contentHash: "hash-7",
  });

  await service.applyStagedFiles(prepared.commitId);
  await service.markFsApplied(prepared.commitId);

  return {
    db,
    projectId,
    commitRepo,
    outboxRepo,
    service,
    prepared,
  };
}

test("chapter commit service prepares commits idempotently and finalizes them with an outbox job", async () => {
  const { db, projectId, commitRepo, outboxRepo, service } = await createPreparedCommitHarness();

  try {
    await service.applyStagedFiles("commit-1");
    assert.equal(await readFinalChapter(projectId, 7), "chapter seven final\n");

    await service.finalizeCommit("commit-1");

    const committed = commitRepo.getByCommitId("commit-1");
    assert.equal(committed?.state, "committed");
    assert.equal(committed?.committedAt, "2026-03-31T00:02:00.000Z");

    const outboxJob = outboxRepo.getByCommitAndType("commit-1", "chapter_artifact_sync");
    assert.equal(outboxJob?.state, "pending");

    const selected = db.prepare("SELECT selected FROM chapter_versions WHERE id = ?").get("version-7") as { selected: number };
    assert.equal(selected.selected, 1);
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("chapter commit service finalizeCommit is idempotent for committed commits", async () => {
  const { db, projectId, commitRepo, outboxRepo, service } = await createPreparedCommitHarness();

  try {
    await service.finalizeCommit("commit-1");
    const firstJob = outboxRepo.getByCommitAndType("commit-1", "chapter_artifact_sync");
    await service.finalizeCommit("commit-1");

    const jobs = db.prepare("SELECT COUNT(*) AS count FROM artifact_outbox WHERE commit_id = ?").get("commit-1") as { count: number };
    assert.equal(jobs.count, 1);
    assert.equal(outboxRepo.getByCommitAndType("commit-1", "chapter_artifact_sync")?.jobId, firstJob?.jobId);
    assert.equal(commitRepo.getByCommitId("commit-1")?.state, "committed");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("chapter commit service cleans up the commit stage directory after finalize", async () => {
  const { db, projectId, service } = await createPreparedCommitHarness();
  const stageDir = commitStageDir(projectId, "commit-1");

  try {
    assert.equal(existsSync(stageDir), true);
    await service.finalizeCommit("commit-1");
    assert.equal(existsSync(stageDir), false);
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("chapter commit service requeues a done outbox job when the same commit is finalized again", async () => {
  const { db, projectId, commitRepo, outboxRepo, service } = await createPreparedCommitHarness();

  try {
    await service.finalizeCommit("commit-1");
    db.prepare("UPDATE artifact_outbox SET state = 'done', attempts = 3, done_at = '2026-03-31T00:05:00.000Z' WHERE job_id = ?")
      .run("job-1");

    // 模拟重复回滚到同一版本：markFsApplied 对已 committed 的 commit 是幂等空操作。
    await service.markFsApplied("commit-1");
    assert.equal(commitRepo.getByCommitId("commit-1")?.state, "committed");

    await service.finalizeCommit("commit-1");

    const requeued = outboxRepo.getByCommitAndType("commit-1", "chapter_artifact_sync");
    assert.equal(requeued?.jobId, "job-1");
    assert.equal(requeued?.state, "pending");
    assert.equal(requeued?.attempts, 0);
    assert.equal(requeued?.doneAt, null);
    assert.equal(commitRepo.getByCommitId("commit-1")?.state, "committed");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("chapter commit service finalizeCommit rolls back selected version changes when outbox enqueue fails", async () => {
  const { db, projectId, commitRepo, outboxRepo } = await createPreparedCommitHarness();

  try {
    const service = createChapterCommitService({
      db,
      commitRepo,
      outboxRepo,
      now: () => "2026-03-31T00:10:00.000Z",
      nextId(prefix) {
        return prefix === "commit" ? "commit-1" : "job-1";
      },
      createOutboxPayload() {
        throw new Error("enqueue failed");
      },
    });

    await assert.rejects(() => service.finalizeCommit("commit-1"), /enqueue failed/);

    const selected = db.prepare("SELECT selected FROM chapter_versions WHERE id = ?").get("version-7") as { selected: number };
    assert.equal(selected.selected, 0);
    assert.equal(commitRepo.getByCommitId("commit-1")?.state, "fs_applied");
    assert.equal(outboxRepo.getByCommitAndType("commit-1", "chapter_artifact_sync"), null);
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});
