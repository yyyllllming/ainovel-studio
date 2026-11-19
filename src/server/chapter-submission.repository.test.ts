import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { ensureDatabase } from "./db/init.ts";
import { AppError } from "./errors.ts";
import { createChapterSubmissionRepository } from "./repositories/chapter-submission.repository.ts";
import type { ChapterSubmissionStatus, NewChapterSubmission } from "./types.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function fixture(overrides: Partial<NewChapterSubmission> = {}): NewChapterSubmission {
  return {
    projectId: "project-a",
    chapterNo: 7,
    title: "第七章",
    source: "human",
    contentPath: "author-submissions/chapter_007_sha256-a.md",
    contentHash: "sha256-default",
    ...overrides,
  };
}

function insertChapterVersion(
  db: Database.Database,
  input: { id: string; projectId?: string; chapterNo?: number },
) {
  db.prepare(`
    INSERT INTO chapter_versions (
      id, project_id, chapter_no, version_no, temperature, path, excerpt, selected, source, created_at
    ) VALUES (?, ?, ?, 1, 0.7, ?, 'excerpt', 1, 'author_submission', '2026-07-11T00:00:00.000Z')
  `).run(
    input.id,
    input.projectId ?? "project-a",
    input.chapterNo ?? 7,
    `versions/${input.id}.md`,
  );
}

function assertConflict(action: () => unknown, message?: string) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "CONFLICT");
    assert.equal(error.status, 409);
    if (message) {
      assert.equal(error.message, message);
    }
    return true;
  });
}

test("createOrGet returns the same submission for project, chapter and hash", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const first = repository.createOrGet(fixture({ contentHash: "sha256-a" }));
    const second = repository.createOrGet(fixture({ contentHash: "sha256-a" }));
    assert.equal(second.id, first.id);

    const changed = repository.createOrGet(fixture({ contentHash: "sha256-b" }));
    assert.notEqual(changed.id, first.id);
  } finally {
    db.close();
  }
});

test("transition accepts every edge in the author submission state machine", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });
  let sequence = 0;

  const create = () => repository.createOrGet(fixture({ contentHash: `transition-${sequence += 1}` }));
  const reach = (path: ChapterSubmissionStatus[]) => {
    const submission = create();
    for (const status of path) {
      repository.transition(submission.id, status);
    }
    return submission.id;
  };

  try {
    assert.equal(repository.transition(reach([]), "queued").status, "queued");
    assert.equal(repository.transition(reach([]), "failed").status, "failed");
    assert.equal(repository.transition(reach(["queued"]), "reviewing").status, "reviewing");
    assert.equal(repository.transition(reach(["queued"]), "failed").status, "failed");
    assert.equal(repository.transition(reach(["queued", "reviewing"]), "needs_revision").status, "needs_revision");
    assert.equal(repository.transition(reach(["queued", "reviewing"]), "approved").status, "approved");
    assert.equal(repository.transition(reach(["queued", "reviewing"]), "failed").status, "failed");
    assert.equal(repository.transition(reach(["queued", "reviewing", "needs_revision"]), "queued").status, "queued");
    assert.equal(repository.transition(reach(["queued", "reviewing", "needs_revision"]), "failed").status, "failed");
    const approvedId = reach(["queued", "reviewing", "approved"]);
    insertChapterVersion(db, { id: "valid-transition-version" });
    assert.equal(repository.attachCommittedVersion(approvedId, "valid-transition-version").status, "committed");
    assert.equal(repository.transition(reach(["queued", "reviewing", "approved"]), "failed").status, "failed");
    assert.equal(repository.transition(reach(["failed"]), "queued").status, "queued");
  } finally {
    db.close();
  }
});

test("an invalid transition rolls back without changing the stored status", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const submission = repository.createOrGet(fixture({ contentHash: "invalid-transition" }));
    assertConflict(() => repository.transition(submission.id, "approved"));
    assert.equal(repository.getById(submission.id)?.status, "draft");

    repository.transition(submission.id, "queued");
    repository.transition(submission.id, "reviewing");
    repository.transition(submission.id, "approved");
    assertConflict(() => repository.transition(submission.id, "committed"));
    assert.equal(repository.getById(submission.id)?.status, "approved");
    insertChapterVersion(db, { id: "committed-version" });
    repository.attachCommittedVersion(submission.id, "committed-version");
    assertConflict(() => repository.transition(submission.id, "failed"));
    assert.equal(repository.getById(submission.id)?.status, "committed");
  } finally {
    db.close();
  }
});

test("createOrGet rejects non-draft initial state and incompatible identity replays", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const invalidInitialState = {
      ...fixture({ contentHash: "invalid-initial-state" }),
      status: "committed",
    } as unknown as NewChapterSubmission;
    assertConflict(() => repository.createOrGet(invalidInitialState));

    const original = repository.createOrGet(fixture({ contentHash: "immutable-replay" }));
    assertConflict(() => repository.createOrGet(fixture({
      contentHash: original.contentHash,
      source: "codex",
    })));
    assertConflict(() => repository.createOrGet(fixture({
      contentHash: original.contentHash,
      contentPath: "author-submissions/different-path.md",
    })));
  } finally {
    db.close();
  }
});

test("createOrGet enforces batch and parent project boundaries", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const foreignBatch = repository.createOrGetBatch({
      projectId: "project-b",
      sourceFileName: "foreign.md",
      sourceFileHash: "foreign-batch",
      chapterCount: 1,
    });
    assertConflict(() => repository.createOrGet(fixture({
      batchId: foreignBatch.id,
      contentHash: "foreign-batch-child",
    })));
    assertConflict(() => repository.createOrGet(fixture({
      parentSubmissionId: "missing-parent",
      contentHash: "missing-parent-child",
    })));

    const foreignParent = repository.createOrGet(fixture({
      projectId: "project-b",
      contentHash: "foreign-parent",
    }));
    assertConflict(() => repository.createOrGet(fixture({
      parentSubmissionId: foreignParent.id,
      contentHash: "foreign-parent-child",
    })));
  } finally {
    db.close();
  }
});

test("createRevision links its parent while preserving independent content identity", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const parent = repository.createOrGet(fixture({ contentHash: "revision-parent" }));
    const revision = repository.createRevision({
      parentSubmissionId: parent.id,
      title: "第七章（修订）",
      source: "codex",
      contentPath: "author-submissions/chapter_007_revision-child.md",
      contentHash: "revision-child",
    });

    assert.notEqual(revision.id, parent.id);
    assert.equal(revision.parentSubmissionId, parent.id);
    assert.equal(revision.projectId, parent.projectId);
    assert.equal(revision.chapterNo, parent.chapterNo);
    assert.equal(revision.contentHash, "revision-child");
    assert.equal(revision.status, "draft");

    const sameRevision = repository.createRevision({
      parentSubmissionId: parent.id,
      title: "第七章（修订）",
      source: "codex",
      contentPath: "author-submissions/chapter_007_revision-child.md",
      contentHash: "revision-child",
    });
    assert.equal(sameRevision.id, revision.id);

    assertConflict(() => repository.createRevision({
      parentSubmissionId: parent.id,
      title: "第七章（未变化）",
      source: "codex",
      contentPath: parent.contentPath,
      contentHash: parent.contentHash,
    }));
  } finally {
    db.close();
  }
});

test("createRevision rejects a content identity owned by another lineage", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const firstParent = repository.createOrGet(fixture({ contentHash: "lineage-parent-a" }));
    const secondParent = repository.createOrGet(fixture({ contentHash: "lineage-parent-b" }));
    repository.createOrGet(fixture({ contentHash: "standalone-child" }));

    assertConflict(() => repository.createRevision({
      parentSubmissionId: firstParent.id,
      title: "第七章（独立稿冲突）",
      source: "codex",
      contentPath: "author-submissions/chapter_007_standalone-child.md",
      contentHash: "standalone-child",
    }));

    repository.createRevision({
      parentSubmissionId: firstParent.id,
      title: "第七章（第一条血缘）",
      source: "codex",
      contentPath: "author-submissions/chapter_007_shared-child.md",
      contentHash: "shared-child",
    });
    assertConflict(() => repository.createRevision({
      parentSubmissionId: secondParent.id,
      title: "第七章（第二条血缘）",
      source: "codex",
      contentPath: "author-submissions/chapter_007_shared-child.md",
      contentHash: "shared-child",
    }));
  } finally {
    db.close();
  }
});

test("listByProject applies filters and returns a deterministic chapter order", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const laterChapter = repository.createOrGet(fixture({
      chapterNo: 9,
      source: "codex",
      contentHash: "list-9",
    }));
    const earlierChapter = repository.createOrGet(fixture({
      chapterNo: 3,
      source: "import",
      contentHash: "list-3",
    }));
    repository.transition(laterChapter.id, "queued");

    assert.deepEqual(
      repository.listByProject("project-a").map((entry) => entry.chapterNo),
      [3, 9],
    );
    assert.deepEqual(
      repository.listByProject("project-a", { status: "queued", source: "codex", chapterNo: 9 }).map((entry) => entry.id),
      [laterChapter.id],
    );
    assert.deepEqual(
      repository.listByProject("project-a", { status: "draft", source: "import" }).map((entry) => entry.id),
      [earlierChapter.id],
    );
  } finally {
    db.close();
  }
});

test("listByProject does not expose foreign batch metadata from legacy invalid rows", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const foreignBatch = repository.createOrGetBatch({
      projectId: "project-b",
      sourceFileName: "foreign.md",
      sourceFileHash: "legacy-foreign-batch",
      chapterCount: 1,
    });
    db.prepare(`
      INSERT INTO chapter_submissions (
        id, batch_id, project_id, chapter_no, title, source, content_path, content_hash,
        status, parent_submission_id, committed_version_id, created_at, updated_at
      ) VALUES (
        'legacy-invalid-row', ?, 'project-a', 7, '第七章', 'human',
        'author-submissions/legacy-invalid-row.md', 'legacy-invalid-row',
        'draft', NULL, NULL, '2026-07-11T00:00:00.000Z', '2026-07-11T00:00:00.000Z'
      )
    `).run(foreignBatch.id);

    const [row] = repository.listByProject("project-a");
    assert.equal(row?.batchStatus, null);
    assert.equal(row?.batchSourceFileName, null);
  } finally {
    db.close();
  }
});

test("batch identity is idempotent and partial_failed is persisted and queryable", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const first = repository.createOrGetBatch({
      projectId: "project-a",
      sourceFileName: "novel.md",
      sourceFileHash: "source-file-hash",
      chapterCount: 80,
      status: "importing",
    });
    const second = repository.createOrGetBatch({
      projectId: "project-a",
      sourceFileName: "renamed.md",
      sourceFileHash: "source-file-hash",
      chapterCount: 80,
      status: "importing",
    });
    assert.equal(second.id, first.id);
    assertConflict(() => repository.createOrGetBatch({
      projectId: "project-a",
      sourceFileName: "novel.md",
      sourceFileHash: "source-file-hash",
      chapterCount: 79,
      status: "importing",
    }));

    const partial = repository.setBatchStatus(first.id, "partial_failed");
    assert.equal(partial.status, "partial_failed");

    const submission = repository.createOrGet(fixture({
      batchId: first.id,
      contentHash: "batch-chapter",
    }));
    const list = repository.listByProject("project-a", { batchId: first.id });
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, submission.id);
    assert.equal(list[0]?.batchStatus, "partial_failed");
    assert.equal(list[0]?.batchSourceFileName, "novel.md");
  } finally {
    db.close();
  }
});

test("attachCommittedVersion atomically moves approved submissions to committed", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const submission = repository.createOrGet(fixture({ contentHash: "commit-attachment" }));
    repository.transition(submission.id, "queued");
    repository.transition(submission.id, "reviewing");
    repository.transition(submission.id, "approved");
    insertChapterVersion(db, { id: "version-7" });

    const committed = repository.attachCommittedVersion(submission.id, "version-7");
    assert.equal(committed.status, "committed");
    assert.equal(committed.committedVersionId, "version-7");

    const repeated = repository.attachCommittedVersion(submission.id, "version-7");
    assert.equal(repeated.id, committed.id);
    assert.equal(repeated.committedVersionId, "version-7");
  } finally {
    db.close();
  }
});

test("attachCommittedVersion rejects missing and mismatched chapter versions", () => {
  const db = createMemoryDb();
  const repository = createChapterSubmissionRepository({ db });

  try {
    const approve = (contentHash: string) => {
      const submission = repository.createOrGet(fixture({ contentHash }));
      repository.transition(submission.id, "queued");
      repository.transition(submission.id, "reviewing");
      return repository.transition(submission.id, "approved");
    };

    const missing = approve("missing-version");
    assertConflict(() => repository.attachCommittedVersion(missing.id, "does-not-exist"));
    assert.equal(repository.getById(missing.id)?.status, "approved");

    insertChapterVersion(db, { id: "foreign-project-version", projectId: "project-b" });
    const foreignProject = approve("foreign-project-version-submission");
    assertConflict(() => repository.attachCommittedVersion(foreignProject.id, "foreign-project-version"));

    insertChapterVersion(db, { id: "foreign-chapter-version", chapterNo: 8 });
    const foreignChapter = approve("foreign-chapter-version-submission");
    assertConflict(() => repository.attachCommittedVersion(foreignChapter.id, "foreign-chapter-version"));
  } finally {
    db.close();
  }
});

test("a competing commit attachment rejects the stale state without overwriting the winner", () => {
  const db = createMemoryDb();
  const firstRepository = createChapterSubmissionRepository({ db });
  const secondRepository = createChapterSubmissionRepository({ db });

  try {
    const submission = firstRepository.createOrGet(fixture({ contentHash: "stale-commit" }));
    firstRepository.transition(submission.id, "queued");
    firstRepository.transition(submission.id, "reviewing");
    firstRepository.transition(submission.id, "approved");
    insertChapterVersion(db, { id: "version-winner" });
    insertChapterVersion(db, { id: "version-stale" });

    firstRepository.attachCommittedVersion(submission.id, "version-winner");
    assertConflict(
      () => secondRepository.attachCommittedVersion(submission.id, "version-stale"),
      "作者稿状态已变化",
    );
    assert.equal(firstRepository.getById(submission.id)?.committedVersionId, "version-winner");
  } finally {
    db.close();
  }
});

test("attachCommittedVersion normalizes a competing SQLite writer lock to conflict", () => {
  const directory = mkdtempSync(join(tmpdir(), "ainovel-submission-lock-"));
  const databasePath = join(directory, "app.db");
  const firstDb = new Database(databasePath, { timeout: 20 });
  ensureDatabase(firstDb);
  firstDb.pragma("busy_timeout = 20");
  firstDb.pragma("journal_mode = WAL");
  const competingDb = new Database(databasePath, { timeout: 20 });
  const repository = createChapterSubmissionRepository({ db: firstDb });

  try {
    const submission = repository.createOrGet(fixture({ contentHash: "writer-lock" }));
    repository.transition(submission.id, "queued");
    repository.transition(submission.id, "reviewing");
    repository.transition(submission.id, "approved");
    insertChapterVersion(firstDb, { id: "writer-lock-version" });

    competingDb.exec("BEGIN IMMEDIATE");
    assertConflict(
      () => repository.attachCommittedVersion(submission.id, "writer-lock-version"),
      "作者稿状态已变化",
    );
    assert.equal(repository.getById(submission.id)?.status, "approved");
  } finally {
    if (competingDb.inTransaction) {
      competingDb.exec("ROLLBACK");
    }
    competingDb.close();
    firstDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
