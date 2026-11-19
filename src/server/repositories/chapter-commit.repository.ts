import "../server-only.ts";

import Database from "better-sqlite3";
import { rawDb } from "../db/client.ts";

export type ChapterCommitSourceKind = "run" | "workshop" | "rollback";
export type ChapterCommitState = "prepared" | "fs_applied" | "committed" | "needs_reconcile" | "failed";

export interface ChapterCommitRecord {
  commitId: string;
  projectId: string;
  chapterNo: number;
  sessionId: string | null;
  sourceKind: ChapterCommitSourceKind;
  acceptedVersionId: string;
  idempotencyKey: string;
  state: ChapterCommitState;
  manifestJson: string;
  stageDir: string;
  contentHash: string;
  fsAppliedAt: string | null;
  committedAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  reconcileAttempts: number;
  createdAt: string;
  updatedAt: string;
}

function mapChapterCommit(row: Record<string, unknown>): ChapterCommitRecord {
  return {
    commitId: String(row.commit_id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    sessionId: row.session_id ? String(row.session_id) : null,
    sourceKind: String(row.source_kind) as ChapterCommitSourceKind,
    acceptedVersionId: String(row.accepted_version_id),
    idempotencyKey: String(row.idempotency_key),
    state: String(row.state) as ChapterCommitState,
    manifestJson: String(row.manifest_json),
    stageDir: String(row.stage_dir),
    contentHash: String(row.content_hash),
    fsAppliedAt: row.fs_applied_at ? String(row.fs_applied_at) : null,
    committedAt: row.committed_at ? String(row.committed_at) : null,
    failedAt: row.failed_at ? String(row.failed_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    reconcileAttempts: Number(row.reconcile_attempts ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createChapterCommitRepository(input?: { db?: Database.Database }) {
  const db = input?.db ?? rawDb;

  return {
    getByCommitId(commitId: string) {
      const row = db.prepare("SELECT * FROM chapter_commits WHERE commit_id = ?").get(commitId) as
        | Record<string, unknown>
        | undefined;
      return row ? mapChapterCommit(row) : null;
    },

    findByIdempotencyKey(idempotencyKey: string) {
      const row = db.prepare("SELECT * FROM chapter_commits WHERE idempotency_key = ?").get(idempotencyKey) as
        | Record<string, unknown>
        | undefined;
      return row ? mapChapterCommit(row) : null;
    },

    insertPrepared(input: {
      commitId: string;
      projectId: string;
      chapterNo: number;
      sessionId: string | null;
      sourceKind: ChapterCommitSourceKind;
      acceptedVersionId: string;
      idempotencyKey: string;
      manifestJson: string;
      stageDir: string;
      contentHash: string;
      createdAt: string;
      updatedAt: string;
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?)
      `).run(
        input.commitId,
        input.projectId,
        input.chapterNo,
        input.sessionId,
        input.sourceKind,
        input.acceptedVersionId,
        input.idempotencyKey,
        input.manifestJson,
        input.stageDir,
        input.contentHash,
        input.createdAt,
        input.updatedAt,
      );

      return this.getByCommitId(input.commitId)!;
    },

    markFsApplied(commitId: string, fsAppliedAt: string, updatedAt: string) {
      return db.prepare(`
        UPDATE chapter_commits
        SET state = 'fs_applied',
            fs_applied_at = ?,
            updated_at = ?
        WHERE commit_id = ?
          AND state IN ('prepared', 'fs_applied', 'needs_reconcile')
      `).run(fsAppliedAt, updatedAt, commitId).changes;
    },

    markCommitted(commitId: string, committedAt: string, updatedAt: string) {
      return db.prepare(`
        UPDATE chapter_commits
        SET state = 'committed',
            committed_at = ?,
            updated_at = ?
        WHERE commit_id = ?
      `).run(committedAt, updatedAt, commitId).changes;
    },

    markNeedsReconcile(
      commitId: string,
      errorCode: string | null,
      errorMessage: string | null,
      updatedAt: string,
    ) {
      return db.prepare(`
        UPDATE chapter_commits
        SET state = 'needs_reconcile',
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        WHERE commit_id = ?
          AND state NOT IN ('committed', 'failed')
      `).run(errorCode, errorMessage, updatedAt, commitId).changes;
    },

    markFailed(commitId: string, failedAt: string, errorCode: string | null, errorMessage: string | null, updatedAt: string) {
      return db.prepare(`
        UPDATE chapter_commits
        SET state = 'failed',
            failed_at = ?,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        WHERE commit_id = ?
      `).run(failedAt, errorCode, errorMessage, updatedAt, commitId).changes;
    },

    hasNewerCommittedCommit(projectId: string, chapterNo: number, createdAt: string, excludeCommitId: string) {
      const row = db.prepare(`
        SELECT 1
        FROM chapter_commits
        WHERE project_id = ?
          AND chapter_no = ?
          AND state = 'committed'
          AND commit_id != ?
          AND created_at >= ?
        LIMIT 1
      `).get(projectId, chapterNo, excludeCommitId, createdAt);
      return Boolean(row);
    },

    getByStageDir(projectId: string, stageDir: string) {
      const row = db.prepare(`
        SELECT *
        FROM chapter_commits
        WHERE project_id = ? AND stage_dir = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(projectId, stageDir) as Record<string, unknown> | undefined;
      return row ? mapChapterCommit(row) : null;
    },

    bumpReconcileAttempt(commitId: string, updatedAt: string) {
      return db.prepare(`
        UPDATE chapter_commits
        SET reconcile_attempts = reconcile_attempts + 1,
            updated_at = ?
        WHERE commit_id = ?
      `).run(updatedAt, commitId).changes;
    },

    listReconcileCandidates(limit = 50) {
      const rows = db.prepare(`
        SELECT c.*
        FROM chapter_commits c
        LEFT JOIN artifact_outbox o
          ON o.commit_id = c.commit_id
         AND o.job_type = 'chapter_artifact_sync'
        WHERE c.state IN ('prepared', 'fs_applied', 'needs_reconcile')
           OR (c.state = 'committed' AND o.job_id IS NULL)
        ORDER BY c.updated_at ASC, c.created_at ASC
        LIMIT ?
      `).all(limit) as Array<Record<string, unknown>>;
      return rows.map(mapChapterCommit);
    },
  };
}
