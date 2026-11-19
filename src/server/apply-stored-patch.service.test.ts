import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { rm } from "node:fs/promises";
import { ensureDatabase } from "./db/init.ts";
import { createApplyStoredPatchService } from "./commit/apply-stored-patch.service.ts";
import { createChapterCommitService } from "./commit/chapter-commit.service.ts";
import { buildTimelineMutationKeys, findReplayableTimelineMutationEffect, resumeTimelineMutationEffect } from "./commit/timeline-mutation-effect.ts";
import { createChapterCommitRepository } from "./repositories/chapter-commit.repository.ts";
import { createArtifactOutboxRepository } from "./repositories/artifact-outbox.repository.ts";
import { ensureProjectLayout, readFinalChapter, writeFinalChapter } from "./project-files.ts";
import { projectDir } from "./paths.ts";
import type { ProjectVoiceSnapshot } from "./content/types.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function createProjectId() {
  return `apply-patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

function insertVersion(db: Database.Database, input: {
  id: string;
  projectId: string;
  chapterNo: number;
  versionNo: number;
  path: string;
  excerpt: string;
  source: string;
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
    input.versionNo,
    0.2,
    input.path,
    input.excerpt,
    0,
    input.source,
    "2026-04-01T00:00:00.000Z",
  );
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

test("timeline mutation keys are stable and include old/new content plus mutation identity", () => {
  const input = {
    projectId: "project-key",
    chapterNo: 4,
    oldContentHash: "old",
    newContentHash: "new",
    mutationIdentity: "patch:one",
  };
  const first = buildTimelineMutationKeys(input);
  assert.deepEqual(buildTimelineMutationKeys(input), first);
  assert.notEqual(buildTimelineMutationKeys({ ...input, oldContentHash: "other" }).operationKey, first.operationKey);
  assert.notEqual(buildTimelineMutationKeys({ ...input, newContentHash: "other" }).operationKey, first.operationKey);
  assert.notEqual(buildTimelineMutationKeys({ ...input, mutationIdentity: "patch:two" }).identityKey, first.identityKey);
});

test("apply stored patch service applies the patch through the commit journal", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 4, "old line\n");

  try {
    const commitRepo = createChapterCommitRepository({ db });
    const outboxRepo = createArtifactOutboxRepository({ db });
    let versionSeq = 0;
    let idSeq = 0;
    const commitService = createChapterCommitService({
      db,
      commitRepo,
      outboxRepo,
      nextId(prefix) {
        idSeq += 1;
        return `${prefix}-patch-${idSeq}`;
      },
    });

    const invalidationCalls: string[] = [];
    let spawnCalls = 0;
    const snapshotCalls: string[] = [];
    const patchService = createApplyStoredPatchService({
      findReplayableTimelineMutationEffect: (projectId, chapterNo, mutationIdentity, currentContentHash) => findReplayableTimelineMutationEffect(projectId, chapterNo, mutationIdentity, currentContentHash, db),
      resumeTimelineMutationEffect: (operationKey, invalidate) => resumeTimelineMutationEffect(operationKey, invalidate, db),
      commitService,
      getNextVersionNo(nextProjectId, nextChapterNo) {
        const row = db.prepare(
          "SELECT MAX(version_no) AS max_no FROM chapter_versions WHERE project_id = ? AND chapter_no = ?",
        ).get(nextProjectId, nextChapterNo) as { max_no: number | null } | undefined;
        return Number(row?.max_no ?? 0) + 1;
      },
      saveChapterVersion(input) {
        versionSeq += 1;
        const versionId = `patch-version-${versionSeq}`;
        insertVersion(db, {
          id: versionId,
          projectId: input.projectId,
          chapterNo: input.chapterNo,
          versionNo: input.versionNo,
          path: input.path,
          excerpt: input.excerpt,
          source: input.source,
        });
        return versionId;
      },
      invalidateFutureTimelineAfterChapterChange: async (nextProjectId, nextChapterNo) => {
        invalidationCalls.push(`${nextProjectId}:${nextChapterNo}`);
        return { startChapter: nextChapterNo + 1 };
      },
      spawnCommitReconciler: () => {
        spawnCalls += 1;
        return { pid: 1234 };
      },
      updateProjectVoiceSnapshot: async (nextProjectId) => {
        snapshotCalls.push(nextProjectId);
        return createSnapshot(nextProjectId);
      },
    });

    const result = await patchService.applyStoredPatch({
      projectId,
      chapterNo: 4,
      patch: {
        summary: "replace opening word",
        operations: [
          {
            type: "replace",
            range: {
              start: 0,
              end: 3,
            },
            text: "new",
          },
        ],
      },
    });

    assert.equal(result.versionId, "patch-version-1");
    assert.equal(result.content, "new line\n");
    assert.deepEqual(result.invalidatedTimeline, { startChapter: 5 });
    assert.equal(await readFinalChapter(projectId, 4), "new line\n");
    assert.equal(spawnCalls, 1);
    assert.deepEqual(snapshotCalls, [projectId]);
    assert.deepEqual(invalidationCalls, [`${projectId}:4`]);

    const commit = db.prepare("SELECT * FROM chapter_commits WHERE project_id = ? AND chapter_no = 4").get(projectId) as
      | { commit_id: string; state: string }
      | undefined;
    assert.equal(commit?.state, "committed");
    assert.equal(outboxRepo.getByCommitAndType(commit!.commit_id, "chapter_artifact_sync")?.state, "pending");
    const selectedRow = db.prepare("SELECT selected FROM chapter_versions WHERE id = ?").get("patch-version-1") as
      | { selected: number }
      | undefined;
    assert.equal(selectedRow?.selected, 1);
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("apply stored patch service keeps unchanged patches explainable and does not invalidate future chapters", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 2, "steady text\n");

  try {
    let versionSeq = 0;
    const snapshotCalls: string[] = [];
    const patchService = createApplyStoredPatchService({
      findReplayableTimelineMutationEffect: (projectId, chapterNo, mutationIdentity, currentContentHash) => findReplayableTimelineMutationEffect(projectId, chapterNo, mutationIdentity, currentContentHash, db),
      resumeTimelineMutationEffect: (operationKey, invalidate) => resumeTimelineMutationEffect(operationKey, invalidate, db),
      commitService: createChapterCommitService({
        db,
        nextId(prefix) {
          return `${prefix}-unchanged-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        },
      }),
      getNextVersionNo(nextProjectId, nextChapterNo) {
        const row = db.prepare(
          "SELECT MAX(version_no) AS max_no FROM chapter_versions WHERE project_id = ? AND chapter_no = ?",
        ).get(nextProjectId, nextChapterNo) as { max_no: number | null } | undefined;
        return Number(row?.max_no ?? 0) + 1;
      },
      saveChapterVersion(input) {
        versionSeq += 1;
        const versionId = `steady-version-${versionSeq}`;
        insertVersion(db, {
          id: versionId,
          projectId: input.projectId,
          chapterNo: input.chapterNo,
          versionNo: input.versionNo,
          path: input.path,
          excerpt: input.excerpt,
          source: input.source,
        });
        return versionId;
      },
      invalidateFutureTimelineAfterChapterChange: async () => {
        throw new Error("unchanged patch should not invalidate timeline");
      },
      spawnCommitReconciler: () => ({ pid: 5678 }),
      updateProjectVoiceSnapshot: async (nextProjectId) => {
        snapshotCalls.push(nextProjectId);
        return createSnapshot(nextProjectId);
      },
    });

    const result = await patchService.applyStoredPatch({
      projectId,
      chapterNo: 2,
      patch: {
        summary: "no-op replace",
        operations: [
          {
            type: "replace",
            range: {
              start: 0,
              end: 6,
            },
            text: "steady",
          },
        ],
      },
    });

    assert.equal(result.versionId, "steady-version-1");
    assert.equal(result.content, "steady text\n");
    assert.equal(result.invalidatedTimeline, null);
    assert.equal(await readFinalChapter(projectId, 2), "steady text\n");
    assert.deepEqual(snapshotCalls, [projectId]);

    const outboxRepo = createArtifactOutboxRepository({ db });
    const commitRepo = createChapterCommitRepository({ db });
    const commit = db.prepare("SELECT * FROM chapter_commits WHERE project_id = ? AND chapter_no = 2").get(projectId) as
      | { commit_id: string; state: string }
      | undefined;
    assert.equal(commit?.state, "committed");
    assert.equal(outboxRepo.getByCommitAndType(commit!.commit_id, "chapter_artifact_sync")?.state, "pending");
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});

test("patch replay resumes a pending invalidation without duplicating an insert, version, or commit", async () => {
  const db = createMemoryDb();
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 3, "base\n");
  try {
    let versionSeq = 0;
    let invalidationAttempts = 0;
    const commitService = createChapterCommitService({ db });
    const service = createApplyStoredPatchService({
      commitService,
      findReplayableTimelineMutationEffect: (projectId, chapterNo, mutationIdentity, currentContentHash) => findReplayableTimelineMutationEffect(projectId, chapterNo, mutationIdentity, currentContentHash, db),
      resumeTimelineMutationEffect: (operationKey, invalidate) => resumeTimelineMutationEffect(operationKey, invalidate, db),
      getNextVersionNo: () => versionSeq + 1,
      saveChapterVersion(input) {
        versionSeq += 1;
        const id = `replay-version-${versionSeq}`;
        insertVersion(db, {
          id,
          projectId: input.projectId,
          chapterNo: input.chapterNo,
          versionNo: input.versionNo,
          path: input.path,
          excerpt: input.excerpt,
          source: input.source,
        });
        return id;
      },
      invalidateFutureTimelineAfterChapterChange: async () => {
        invalidationAttempts += 1;
        if (invalidationAttempts === 1) throw new Error("invalidation failed once");
        return { startChapter: 4, endChapter: 6 };
      },
      updateProjectVoiceSnapshot: async () => createSnapshot(projectId),
      spawnCommitReconciler: () => ({ pid: null }),
      appendRunLog: () => undefined,
    });
    const patch = {
      summary: "insert once",
      operations: [{ type: "insert" as const, range: { start: 0, end: 0 }, text: "X" }],
    };

    await assert.rejects(
      service.applyStoredPatch({ projectId, chapterNo: 3, patch }),
      /invalidation failed once/,
    );
    assert.equal(await readFinalChapter(projectId, 3), "Xbase\n");

    const result = await service.applyStoredPatch({ projectId, chapterNo: 3, patch });
    assert.equal(result.versionId, "replay-version-1");
    assert.equal(await readFinalChapter(projectId, 3), "Xbase\n");
    assert.equal(versionSeq, 1);
    assert.equal(invalidationAttempts, 2);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_versions WHERE project_id = ?").get(projectId) as { count: number }).count), 1);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_commits WHERE project_id = ?").get(projectId) as { count: number }).count), 1);
    const effect = db.prepare("SELECT state, attempts FROM timeline_mutation_effects WHERE project_id = ?").get(projectId) as { state: string; attempts: number };
    assert.deepEqual(effect, { state: "done", attempts: 2 });
  } finally {
    db.close();
    await cleanupProject(projectId);
  }
});
