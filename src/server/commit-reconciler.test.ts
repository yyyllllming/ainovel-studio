import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { readFile, rm } from "node:fs/promises";
import { ensureDatabase } from "./db/init.ts";
import { createChapterCommitRepository } from "./repositories/chapter-commit.repository.ts";
import { createArtifactOutboxRepository } from "./repositories/artifact-outbox.repository.ts";
import { createChapterCommitService } from "./commit/chapter-commit.service.ts";
import { createOutboxService } from "./commit/outbox.service.ts";
import { createCommitReconciler, runCommitReconcilerPass } from "./commit/commit-reconciler.ts";
import { syncCommittedChapterArtifacts } from "./commit/sync-committed-artifacts.service.ts";
import { createArtifactManifestService } from "./infrastructure/artifacts/artifact-manifest.service.ts";
import { createArtifactIntegrityChecker } from "./infrastructure/artifacts/integrity-checker.ts";
import {
  cleanupCommitStage,
  commitStageDir,
  ensureProjectLayout,
  inspectCommitStage,
  promoteCommitStage,
  readFinalChapter,
  scanCommitStageResidues,
  writeCommitStage,
} from "./project-files.ts";
import { projectDir } from "./paths.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function createProjectId() {
  return `commit-reconciler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

test("syncCommittedChapterArtifacts refuses to run when the committed chapter file is missing", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    await assert.rejects(
      () => syncCommittedChapterArtifacts(projectId, 9),
      /正式章节正文不存在，无法同步分析产物/,
    );
  } finally {
    await cleanupProject(projectId);
  }
});

function insertVersion(db: Database.Database, input: {
  id: string;
  projectId: string;
  chapterNo: number;
  path: string;
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
    input.id,
    input.projectId,
    input.chapterNo,
    1,
    0.2,
    input.path,
    "excerpt",
    0,
    "final",
    "2026-04-01T00:00:00.000Z",
  );
}

test("commit reconciler converges a prepared commit into committed plus outbox", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });
    const artifactManifestService = createArtifactManifestService({
      db,
      nextId: () => "manifest-1",
    });
    const commitService = createChapterCommitService({
      db,
      commitRepo,
      outboxRepo,
      artifactManifestService,
      nextId(prefix) {
        return prefix === "job" ? "job-reconcile-1" : "commit-1";
      },
    });
    const stageDir = commitStageDir(projectId, "prepared-1");
    const manifest = await writeCommitStage(stageDir, [
      {
        relativePath: "chapters/chapter_004.md",
        content: "reconciled content\n",
      },
    ]);
    insertVersion(db, {
      id: "version-4",
      projectId,
      chapterNo: 4,
      path: `${projectDir(projectId)}\\versions\\chapter_004_v1.md`,
    });
    await commitService.prepareCommit({
      projectId,
      chapterNo: 4,
      sessionId: null,
      sourceKind: "run",
      acceptedVersionId: "version-4",
      idempotencyKey: `${projectId}:4:version-4:run`,
      manifest,
      stageDir,
      contentHash: "hash-4",
    });
    assert.deepEqual(
      artifactManifestService.listByCommitId("commit-1").map((entry) => entry.artifactFamily),
      ["chapter"],
    );

    const reconciler = createCommitReconciler({
      commitRepo,
      outboxRepo,
      commitService,
      outboxService: createOutboxService({ db, outboxRepo }),
      inspectCommitStage,
    });

    const stats = await reconciler.reconcileCommitsTick();

    assert.equal(stats.reconciled, 1);
    assert.equal(await readFinalChapter(projectId, 4), "reconciled content\n");
    assert.equal(commitRepo.getByCommitId("commit-1")?.state, "committed");
    assert.equal(outboxRepo.getByCommitAndType("commit-1", "chapter_artifact_sync")?.state, "pending");
    const selectedRow = db.prepare("SELECT selected FROM chapter_versions WHERE id = ?").get("version-4") as
      | { selected: number }
      | undefined;
    assert.equal(selectedRow?.selected, 1);
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("artifact integrity checker only treats chapter, blueprint, and review files as manifest authority", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    const stageDir = commitStageDir(projectId, "integrity-1");
    const manifest = await writeCommitStage(stageDir, [
      {
        relativePath: "chapters/chapter_004.md",
        content: "chapter body\n",
      },
      {
        relativePath: "blueprints/chapter_004_blueprint.json",
        content: "{\"chapterNo\":4}\n",
      },
      {
        relativePath: "reviews/chapter_004_review_123.json",
        content: "{\"verdict\":\"pass\"}\n",
      },
      {
        relativePath: "canon/facts.jsonl",
        content: "{\"fact\":\"ignore\"}\n",
      },
    ]);
    const checker = createArtifactIntegrityChecker();

    const stagedOnly = await checker.inspectManifestAuthority({
      projectId,
      stageDir,
      manifest,
    });
    assert.equal(stagedOnly.authorityEntries, 3);
    assert.deepEqual(stagedOnly.authorityMissingFiles, []);
    assert.deepEqual(
      stagedOnly.authorityMismatchedFiles.sort(),
      [
        "blueprints/chapter_004_blueprint.json",
        "chapters/chapter_004.md",
        "reviews/chapter_004_review_123.json",
      ],
    );

    await promoteCommitStage(projectId, stageDir, manifest);

    const finalized = await checker.inspectManifestAuthority({
      projectId,
      stageDir,
      manifest,
    });
    assert.equal(finalized.finalAuthorityReady, true);
    assert.deepEqual(finalized.authorityMismatchedFiles, []);
  } finally {
    await cleanupProject(projectId);
  }
});

test("commit reconciler marks missing staging directories as failed", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });
    insertVersion(db, {
      id: "version-missing",
      projectId,
      chapterNo: 5,
      path: `${projectDir(projectId)}\\versions\\chapter_005_v1.md`,
    });
    commitRepo.insertPrepared({
      commitId: "commit-missing",
      projectId,
      chapterNo: 5,
      sessionId: null,
      sourceKind: "workshop",
      acceptedVersionId: "version-missing",
      idempotencyKey: `${projectId}:5:version-missing:workshop`,
      manifestJson: JSON.stringify({
        files: [{ relativePath: "chapters/chapter_005.md", contentHash: "missing" }],
      }),
      stageDir: commitStageDir(projectId, "missing-stage"),
      contentHash: "missing",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    commitRepo.markNeedsReconcile("commit-missing", "probe_failed", "missing", "2026-04-01T00:01:00.000Z");

    const reconciler = createCommitReconciler({
      commitRepo,
      outboxRepo,
      commitService: createChapterCommitService({ db, commitRepo, outboxRepo }),
      outboxService: createOutboxService({ db, outboxRepo }),
      inspectCommitStage,
    });

    await reconciler.reconcileCommitsTick();

    const failed = commitRepo.getByCommitId("commit-missing");
    assert.equal(failed?.state, "failed");
    assert.equal(failed?.lastErrorCode, "missing_stage_dir");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("commit reconciler restores missing outbox jobs for committed commits and drains jobs", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  const fixedNow = "2026-04-01T00:03:00.000Z";

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });
    insertVersion(db, {
      id: "version-restore",
      projectId,
      chapterNo: 6,
      path: `${projectDir(projectId)}\\versions\\chapter_006_v1.md`,
    });
    commitRepo.insertPrepared({
      commitId: "commit-restore",
      projectId,
      chapterNo: 6,
      sessionId: null,
      sourceKind: "rollback",
      acceptedVersionId: "version-restore",
      idempotencyKey: `${projectId}:6:version-restore:rollback`,
      manifestJson: JSON.stringify({
        files: [{ relativePath: "chapters/chapter_006.md", contentHash: "restored" }],
      }),
      stageDir: commitStageDir(projectId, "restore-stage"),
      contentHash: "restored",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    commitRepo.markFsApplied("commit-restore", "2026-04-01T00:01:00.000Z", "2026-04-01T00:01:00.000Z");
    commitRepo.markCommitted("commit-restore", "2026-04-01T00:02:00.000Z", "2026-04-01T00:02:00.000Z");

    const reconciler = createCommitReconciler({
      commitRepo,
      outboxRepo,
      commitService: createChapterCommitService({
        db,
        commitRepo,
        outboxRepo,
        nextId(prefix) {
          return `${prefix}-restore-1`;
        },
      }),
      outboxService: createOutboxService({
        db,
        outboxRepo,
        now: () => fixedNow,
        nextClaimToken: () => "claim-restore",
      }),
      inspectCommitStage,
      runOutboxJob: async (job) => {
        if (job.chapterNo === 7) {
          throw new Error("temporary sync failure");
        }
      },
      now: () => fixedNow,
      buildNextAttemptAt: () => "2026-04-01T00:10:00.000Z",
    });

    await reconciler.reconcileCommitsTick();
    assert.equal(outboxRepo.getByCommitAndType("commit-restore", "chapter_artifact_sync")?.state, "pending");

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
      "commit-job-2",
      projectId,
      7,
      null,
      "run",
      "version-job-2",
      `${projectId}:7:version-job-2:run`,
      "committed",
      "{}",
      commitStageDir(projectId, "job-2"),
      "hash-job-2",
      "2026-04-01T00:00:00.000Z",
      "2026-04-01T00:00:00.000Z",
    );
    outboxRepo.insertPending({
      jobId: "job-existing-2",
      commitId: "commit-job-2",
      projectId,
      chapterNo: 7,
      jobType: "chapter_artifact_sync",
      payloadJson: "{}",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const drained = await reconciler.drainOutbox("worker-reconciler", 2);
    assert.equal(drained, 2);
    assert.equal(outboxRepo.getByCommitAndType("commit-restore", "chapter_artifact_sync")?.state, "done");
    const retryRow = outboxRepo.getByCommitAndType("commit-job-2", "chapter_artifact_sync");
    assert.equal(retryRow?.state, "pending");
    assert.equal(retryRow?.attempts, 1);
    assert.equal(retryRow?.nextAttemptAt, "2026-04-01T00:10:00.000Z");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

function insertCommitRow(db: Database.Database, input: {
  commitId: string;
  projectId: string;
  chapterNo: number;
  state: string;
  stageDir: string;
  createdAt: string;
}) {
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
    input.commitId,
    input.projectId,
    input.chapterNo,
    null,
    "run",
    `version-${input.commitId}`,
    `${input.projectId}:${input.chapterNo}:${input.commitId}`,
    input.state,
    "{}",
    input.stageDir,
    `hash-${input.commitId}`,
    input.createdAt,
    input.createdAt,
  );
}

test("commit reconciler fails superseded stale commits instead of replaying old chapter content", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });

    // 崩溃残留的旧 commit：stage 就绪，但同章已有更新的 committed commit。
    const staleStageDir = commitStageDir(projectId, "stale-stage");
    const staleManifest = await writeCommitStage(staleStageDir, [
      {
        relativePath: "chapters/chapter_004.md",
        content: "stale content\n",
      },
    ]);
    insertCommitRow(db, {
      commitId: "commit-stale",
      projectId,
      chapterNo: 4,
      state: "prepared",
      stageDir: staleStageDir,
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    db.prepare("UPDATE chapter_commits SET manifest_json = ? WHERE commit_id = ?")
      .run(JSON.stringify(staleManifest), "commit-stale");

    // 更新的 committed commit 已把新正文落盘，并已有 outbox job。
    const freshStageDir = commitStageDir(projectId, "fresh-stage");
    const freshManifest = await writeCommitStage(freshStageDir, [
      {
        relativePath: "chapters/chapter_004.md",
        content: "fresh content\n",
      },
    ]);
    await promoteCommitStage(projectId, freshStageDir, freshManifest);
    insertCommitRow(db, {
      commitId: "commit-fresh",
      projectId,
      chapterNo: 4,
      state: "committed",
      stageDir: freshStageDir,
      createdAt: "2026-04-01T01:00:00.000Z",
    });
    outboxRepo.insertPending({
      jobId: "job-fresh",
      commitId: "commit-fresh",
      projectId,
      chapterNo: 4,
      jobType: "chapter_artifact_sync",
      payloadJson: "{}",
      createdAt: "2026-04-01T01:00:00.000Z",
      updatedAt: "2026-04-01T01:00:00.000Z",
    });

    const reconciler = createCommitReconciler({
      commitRepo,
      outboxRepo,
      commitService: createChapterCommitService({ db, commitRepo, outboxRepo }),
      outboxService: createOutboxService({ db, outboxRepo }),
      inspectCommitStage,
    });

    await reconciler.reconcileCommitsTick();

    const stale = commitRepo.getByCommitId("commit-stale");
    assert.equal(stale?.state, "failed");
    assert.equal(stale?.lastErrorCode, "superseded");
    assert.equal(await readFinalChapter(projectId, 4), "fresh content\n");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("commit reconciler marks deterministic business errors as non-retryable by default", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  const fixedNow = "2026-04-01T00:00:00.000Z";

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });
    insertCommitRow(db, {
      commitId: "commit-permanent",
      projectId,
      chapterNo: 3,
      state: "committed",
      stageDir: commitStageDir(projectId, "permanent-stage"),
      createdAt: fixedNow,
    });
    outboxRepo.insertPending({
      jobId: "job-permanent",
      commitId: "commit-permanent",
      projectId,
      chapterNo: 3,
      jobType: "chapter_artifact_sync",
      payloadJson: "{}",
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });

    const reconciler = createCommitReconciler({
      commitRepo,
      outboxRepo,
      commitService: createChapterCommitService({ db, commitRepo, outboxRepo }),
      outboxService: createOutboxService({ db, outboxRepo, now: () => fixedNow }),
      inspectCommitStage,
      runOutboxJob: async () => {
        throw new Error("缺少章节蓝图");
      },
      now: () => fixedNow,
    });

    await reconciler.drainOutbox("worker-permanent", 1);

    const failedRow = outboxRepo.getByJobId("job-permanent");
    assert.equal(failedRow?.state, "failed");
    assert.equal(failedRow?.nextAttemptAt, null);
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("commit reconciler renews claims during long jobs and warns when the claim was taken over", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });
    insertCommitRow(db, {
      commitId: "commit-renew",
      projectId,
      chapterNo: 2,
      state: "committed",
      stageDir: commitStageDir(projectId, "renew-stage"),
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    outboxRepo.insertPending({
      jobId: "job-renew",
      commitId: "commit-renew",
      projectId,
      chapterNo: 2,
      jobType: "chapter_artifact_sync",
      payloadJson: "{}",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const warnings: string[] = [];
    let initialExpiry: string | null = null;
    let renewedExpiry: string | null = null;
    const reconciler = createCommitReconciler({
      commitRepo,
      outboxRepo,
      commitService: createChapterCommitService({ db, commitRepo, outboxRepo }),
      outboxService: createOutboxService({ db, outboxRepo }),
      inspectCommitStage,
      renewClaimIntervalMs: 10,
      logWarning: (message) => warnings.push(message),
      runOutboxJob: async (job) => {
        initialExpiry = job.claimExpiresAt;
        await delay(80);
        renewedExpiry = outboxRepo.getByJobId(job.jobId)?.claimExpiresAt ?? null;
        // 模拟另一进程抢占 claim：claim_epoch 前进后 releaseDone 应失败并告警。
        db.prepare("UPDATE artifact_outbox SET claim_epoch = claim_epoch + 1 WHERE job_id = ?").run(job.jobId);
      },
    });

    await reconciler.drainOutbox("worker-renew", 1);

    assert.ok(initialExpiry, "job should carry a claim expiry");
    assert.ok(renewedExpiry, "renewed expiry should be readable during the job");
    assert.ok(String(renewedExpiry) > String(initialExpiry), "claim expiry should be extended by renewals");
    assert.ok(warnings.some((message) => message.includes("job-renew")), "claim takeover should be logged");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("commit reconciler cleans up stage residues for terminal commits only", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });

    const committedStage = commitStageDir(projectId, "stage-committed");
    await writeCommitStage(committedStage, [
      { relativePath: "chapters/chapter_001.md", content: "committed body\n" },
    ]);
    insertCommitRow(db, {
      commitId: "commit-terminal",
      projectId,
      chapterNo: 1,
      state: "committed",
      stageDir: committedStage,
      createdAt: "2026-04-01T00:00:00.000Z",
    });

    const preparedStage = commitStageDir(projectId, "stage-prepared");
    await writeCommitStage(preparedStage, [
      { relativePath: "chapters/chapter_002.md", content: "prepared body\n" },
    ]);
    insertCommitRow(db, {
      commitId: "commit-active",
      projectId,
      chapterNo: 2,
      state: "prepared",
      stageDir: preparedStage,
      createdAt: "2026-04-01T00:00:00.000Z",
    });

    // 没有 DB 记录的目录可能是尚未写入 chapter_commits 的进行中 commit，必须保留。
    const unknownStage = commitStageDir(projectId, "stage-unknown");
    await writeCommitStage(unknownStage, [
      { relativePath: "chapters/chapter_003.md", content: "unknown body\n" },
    ]);

    const reconciler = createCommitReconciler({
      commitRepo,
      outboxRepo,
      commitService: createChapterCommitService({ db, commitRepo, outboxRepo }),
      outboxService: createOutboxService({ db, outboxRepo }),
      inspectCommitStage,
      scanCommitStageResidues,
      cleanupCommitStage,
      listProjectIds: () => [projectId],
    });

    const removed = await reconciler.cleanupStageResidues();

    assert.equal(removed, 1);
    assert.equal(existsSync(committedStage), false);
    assert.equal(existsSync(preparedStage), true);
    assert.equal(existsSync(unknownStage), true);
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("runCommitReconcilerPass waits once for the next retry then drains again and exits", async () => {
  const sleeps: number[] = [];
  let now = Date.parse("2026-04-01T00:00:00.000Z");
  let drains = 0;
  let cleanups = 0;
  await runCommitReconcilerPass({
    reconciler: {
      async reconcileCommitsTick() {
        return { reconciled: 0 };
      },
      async drainOutbox() {
        drains += 1;
        return drains;
      },
      peekNextRetryAt() {
        return drains === 1 ? "2026-04-01T00:00:30.000Z" : null;
      },
      async cleanupStageResidues() {
        cleanups += 1;
        return 0;
      },
    },
    workerId: "worker-retry",
    nowMs: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    maxWaitMs: 60_000,
  });
  assert.equal(drains, 2);
  assert.deepEqual(sleeps, [30_000]);
  assert.equal(cleanups, 1);
});

test("runCommitReconcilerPass keeps waiting while retries stay inside maxWaitMs", async () => {
  const sleeps: number[] = [];
  let now = Date.parse("2026-04-01T00:00:00.000Z");
  let drains = 0;
  await runCommitReconcilerPass({
    reconciler: {
      async reconcileCommitsTick() {
        return { reconciled: 0 };
      },
      async drainOutbox() {
        drains += 1;
        return drains;
      },
      peekNextRetryAt() {
        if (drains === 1) return "2026-04-01T00:00:10.000Z";
        if (drains === 2) return "2026-04-01T00:00:25.000Z";
        return null;
      },
      async cleanupStageResidues() {
        return 0;
      },
    },
    workerId: "worker-loop",
    nowMs: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    maxWaitMs: 60_000,
  });
  assert.equal(drains, 3);
  assert.deepEqual(sleeps, [10_000, 15_000]);
});

test("runCommitReconcilerPass does not sleep past maxWaitMs", async () => {
  const sleeps: number[] = [];
  let drains = 0;
  await runCommitReconcilerPass({
    reconciler: {
      async reconcileCommitsTick() {
        return { reconciled: 0 };
      },
      async drainOutbox() {
        drains += 1;
        return drains;
      },
      peekNextRetryAt() {
        return "2026-04-01T00:10:00.000Z";
      },
      async cleanupStageResidues() {
        return 0;
      },
    },
    workerId: "worker-cap",
    nowMs: () => Date.parse("2026-04-01T00:00:00.000Z"),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    maxWaitMs: 5_000,
  });
  assert.equal(drains, 1);
  assert.deepEqual(sleeps, []);
});

test("runCommitReconcilerPass drains due backlog without sleeping", async () => {
  const sleeps: number[] = [];
  let drains = 0;
  const now = Date.parse("2026-04-01T00:00:00.000Z");
  await runCommitReconcilerPass({
    reconciler: {
      async reconcileCommitsTick() {
        return { reconciled: 0 };
      },
      async drainOutbox() {
        drains += 1;
        return drains === 1 ? 8 : 1;
      },
      peekNextRetryAt() {
        return drains === 1 ? "2026-04-01T00:00:00.000Z" : null;
      },
      async cleanupStageResidues() {
        return 0;
      },
    },
    workerId: "worker-due",
    nowMs: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    maxWaitMs: 60_000,
  });
  assert.equal(drains, 2);
  assert.deepEqual(sleeps, []);
});

test("reconciler CLI scripts share the skip-env wrapper", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(pkg.scripts["reconciler:dev"] ?? "", /run-commit-reconciler/);
  assert.match(pkg.scripts["reconciler:prod"] ?? "", /run-commit-reconciler/);
  assert.match(pkg.scripts["reconciler:prod"] ?? "", /--prod/);
  const wrapper = await readFile(new URL("../../scripts/run-commit-reconciler.mjs", import.meta.url), "utf8");
  assert.match(wrapper, /AINOVEL_SKIP_SERVER_ONLY/);
  assert.match(wrapper, /dist-worker\/commit\/commit-reconciler-main/);
  const built = await readFile(new URL("../../dist-worker/commit/commit-reconciler-main.js", import.meta.url), "utf8");
  assert.match(built, /runCommitReconcilerPass/);
  assert.match(built, /peekNextRetryAt/);
});

test("peekEarliestPendingRetry returns the soonest future outbox retry", () => {
  const db = createMemoryDb();
  const outboxRepo = createArtifactOutboxRepository({ db });
  const outboxService = createOutboxService({
    db,
    outboxRepo,
    now: () => "2026-04-01T00:00:00.000Z",
  });
  try {
    insertCommitRow(db, {
      commitId: "commit-retry",
      projectId: "project-retry",
      chapterNo: 1,
      state: "committed",
      stageDir: "stage-retry",
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    outboxRepo.insertPending({
      jobId: "job-retry",
      commitId: "commit-retry",
      projectId: "project-retry",
      chapterNo: 1,
      jobType: "chapter_artifact_sync",
      payloadJson: "{}",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    assert.equal(outboxService.peekEarliestPendingRetry(), "2026-04-01T00:00:00.000Z");
    db.prepare("UPDATE artifact_outbox SET next_attempt_at = ? WHERE job_id = ?").run(
      "2026-04-01T00:00:30.000Z",
      "job-retry",
    );
    assert.equal(outboxService.peekEarliestPendingRetry(), "2026-04-01T00:00:30.000Z");
  } finally {
    db.close();
  }
});
