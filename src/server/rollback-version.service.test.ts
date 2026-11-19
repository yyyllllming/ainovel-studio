import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { rm } from "node:fs/promises";
import { ensureDatabase } from "./db/init.ts";
import { createChapterCommitRepository } from "./repositories/chapter-commit.repository.ts";
import { createArtifactOutboxRepository } from "./repositories/artifact-outbox.repository.ts";
import { createChapterCommitService } from "./commit/chapter-commit.service.ts";
import { createRollbackVersionService } from "./commit/rollback-version.service.ts";
import { findReplayableTimelineMutationEffect, resumeTimelineMutationEffect } from "./commit/timeline-mutation-effect.ts";
import { ensureProjectLayout, readFinalChapter, writeFinalChapter, writeVersionFile } from "./project-files.ts";
import { projectDir, resolveProjectFilePath } from "./paths.ts";
import { readTextFile } from "./utils.ts";
import type { ProjectVoiceSnapshot } from "./content/types.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function createProjectId() {
  return `rollback-service-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

function createSnapshot(projectId: string): ProjectVoiceSnapshot {
  return {
    id: `snapshot-${projectId}`,
    version: 1,
    updatedAt: "2026-04-01T00:00:00.000Z",
    sourceChapterNos: [],
    digest: "test snapshot",
    positiveAnchors: ["身体反馈先行"],
    antiPatterns: ["不要先总结再动作"],
    exemplars: [],
  };
}

test("rollback version service restores the selected version through the commit journal", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 7, "current chapter\n");
  const versionPath = await writeVersionFile(projectId, 7, 1, "restored chapter\n");

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
    "version-7",
    projectId,
    7,
    1,
    0.7,
    versionPath,
    "restored chapter",
    0,
    "workshop",
    "2026-03-31T00:00:00.000Z",
  );

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });
    const commitService = createChapterCommitService({
      commitRepo,
      outboxRepo,
      db,
      now: (() => {
        const values = [
          "2026-03-31T00:00:00.000Z",
          "2026-03-31T00:01:00.000Z",
          "2026-03-31T00:02:00.000Z",
        ];
        return () => values.shift() ?? "2026-03-31T00:02:00.000Z";
      })(),
      nextId(prefix) {
        return prefix === "commit" ? "commit-rollback-1" : "job-rollback-1";
      },
    });

    const logs: string[] = [];
    let spawnCalls = 0;
    const snapshotCalls: string[] = [];
    const rollbackService = createRollbackVersionService({
      findReplayableTimelineMutationEffect: (projectId, chapterNo, mutationIdentity, currentContentHash) => findReplayableTimelineMutationEffect(projectId, chapterNo, mutationIdentity, currentContentHash, db),
      resumeTimelineMutationEffect: (operationKey, invalidate) => resumeTimelineMutationEffect(operationKey, invalidate, db),
      getChapterVersion(versionId) {
        const row = db.prepare("SELECT * FROM chapter_versions WHERE id = ?").get(versionId) as Record<string, unknown> | undefined;
        if (!row) {
          return null;
        }
        return {
          id: String(row.id),
          projectId: String(row.project_id),
          chapterNo: Number(row.chapter_no),
          versionNo: Number(row.version_no),
          temperature: Number(row.temperature),
          path: String(row.path),
          excerpt: String(row.excerpt),
          selected: Boolean(row.selected),
          source: String(row.source),
          createdAt: String(row.created_at),
        };
      },
      resolveProjectFilePath,
      readFinalChapter,
      readVersionFile: readTextFile,
      commitService,
      invalidateFutureTimelineAfterChapterChange: async () => ({ startChapter: 8, endChapter: 9 }),
      spawnCommitReconciler: () => {
        spawnCalls += 1;
        return { pid: 4321 };
      },
      updateProjectVoiceSnapshot: async (nextProjectId) => {
        snapshotCalls.push(nextProjectId);
        return createSnapshot(nextProjectId);
      },
      appendRunLog: (_projectId, _level, message) => {
        logs.push(message);
      },
    });

    const result = await rollbackService.rollbackVersion(projectId, 7, "version-7");

    assert.equal(await readFinalChapter(projectId, 7), "restored chapter\n");
    assert.equal((result.invalidatedTimeline as { startChapter?: number } | null)?.startChapter, 8);
    assert.equal(spawnCalls, 1);
    assert.deepEqual(snapshotCalls, [projectId]);
    assert.equal(logs.some((message) => message.includes("已回滚到版本 1")), true);

    const commit = db.prepare("SELECT * FROM chapter_commits WHERE project_id = ? AND chapter_no = 7").get(projectId) as
      | { commit_id: string; state: string }
      | undefined;
    assert.equal(commit?.state, "committed");
    assert.equal(outboxRepo.getByCommitAndType(commit!.commit_id, "chapter_artifact_sync")?.state, "pending");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("rollback replay resumes the pending invalidation after the selected text already matches", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 5, "current\n");
  const versionPath = await writeVersionFile(projectId, 5, 1, "target\n");
  db.prepare(`
    INSERT INTO chapter_versions (
      id, project_id, chapter_no, version_no, temperature, path, excerpt, selected, source, created_at
    ) VALUES ('rollback-replay-version', ?, 5, 1, 0.2, ?, 'target', 0, 'workshop', '2026-04-01T00:00:00.000Z')
  `).run(projectId, versionPath);
  try {
    let invalidationAttempts = 0;
    const service = createRollbackVersionService({
      commitService: createChapterCommitService({ db }),
      findReplayableTimelineMutationEffect: (projectId, chapterNo, mutationIdentity, currentContentHash) => findReplayableTimelineMutationEffect(projectId, chapterNo, mutationIdentity, currentContentHash, db),
      resumeTimelineMutationEffect: (operationKey, invalidate) => resumeTimelineMutationEffect(operationKey, invalidate, db),
      getChapterVersion(versionId) {
        const row = db.prepare("SELECT * FROM chapter_versions WHERE id = ?").get(versionId) as Record<string, unknown> | undefined;
        return row ? {
          id: String(row.id),
          projectId: String(row.project_id),
          chapterNo: Number(row.chapter_no),
          versionNo: Number(row.version_no),
          temperature: Number(row.temperature),
          path: String(row.path),
          excerpt: String(row.excerpt),
          selected: Boolean(row.selected),
          source: String(row.source),
          createdAt: String(row.created_at),
        } : null;
      },
      invalidateFutureTimelineAfterChapterChange: async () => {
        invalidationAttempts += 1;
        if (invalidationAttempts === 1) throw new Error("rollback invalidation failed once");
        return { startChapter: 6, endChapter: 8 };
      },
      updateProjectVoiceSnapshot: async () => createSnapshot(projectId),
      spawnCommitReconciler: () => ({ pid: null }),
      appendRunLog: () => undefined,
    });

    await assert.rejects(
      service.rollbackVersion(projectId, 5, "rollback-replay-version"),
      /rollback invalidation failed once/,
    );
    assert.equal(await readFinalChapter(projectId, 5), "target\n");
    const result = await service.rollbackVersion(projectId, 5, "rollback-replay-version");
    assert.equal((result.invalidatedTimeline as { startChapter: number }).startChapter, 6);
    assert.equal(invalidationAttempts, 2);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_commits WHERE project_id = ?").get(projectId) as { count: number }).count), 1);
    const effect = db.prepare("SELECT state, attempts FROM timeline_mutation_effects WHERE project_id = ?").get(projectId) as { state: string; attempts: number };
    assert.deepEqual(effect, { state: "done", attempts: 2 });
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});
