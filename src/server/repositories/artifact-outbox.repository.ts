import "../server-only.ts";

import Database from "better-sqlite3";
import { rawDb } from "../db/client.ts";

export type ArtifactOutboxJobType = "chapter_artifact_sync";
export type ArtifactOutboxState = "pending" | "claimed" | "done" | "failed";

export interface ArtifactOutboxRecord {
  jobId: string;
  commitId: string;
  projectId: string;
  chapterNo: number;
  jobType: ArtifactOutboxJobType;
  state: ArtifactOutboxState;
  claimToken: string | null;
  claimEpoch: number;
  workerId: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  payloadJson: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapArtifactOutbox(row: Record<string, unknown>): ArtifactOutboxRecord {
  return {
    jobId: String(row.job_id),
    commitId: String(row.commit_id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    jobType: String(row.job_type) as ArtifactOutboxJobType,
    state: String(row.state) as ArtifactOutboxState,
    claimToken: row.claim_token ? String(row.claim_token) : null,
    claimEpoch: Number(row.claim_epoch ?? 0),
    workerId: row.worker_id ? String(row.worker_id) : null,
    claimedAt: row.claimed_at ? String(row.claimed_at) : null,
    claimExpiresAt: row.claim_expires_at ? String(row.claim_expires_at) : null,
    payloadJson: String(row.payload_json),
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    doneAt: row.done_at ? String(row.done_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createArtifactOutboxRepository(input?: { db?: Database.Database }) {
  const db = input?.db ?? rawDb;

  return {
    getByJobId(jobId: string) {
      const row = db.prepare("SELECT * FROM artifact_outbox WHERE job_id = ?").get(jobId) as
        | Record<string, unknown>
        | undefined;
      return row ? mapArtifactOutbox(row) : null;
    },

    getByCommitAndType(commitId: string, jobType: ArtifactOutboxJobType) {
      const row = db.prepare("SELECT * FROM artifact_outbox WHERE commit_id = ? AND job_type = ?").get(commitId, jobType) as
        | Record<string, unknown>
        | undefined;
      return row ? mapArtifactOutbox(row) : null;
    },

    listActiveByChapter(projectId: string, chapterNo: number, jobType: ArtifactOutboxJobType) {
      const rows = db.prepare(`
        SELECT *
        FROM artifact_outbox
        WHERE project_id = ?
          AND chapter_no = ?
          AND job_type = ?
          AND state IN ('pending', 'claimed')
        ORDER BY created_at ASC, job_id ASC
      `).all(projectId, chapterNo, jobType) as Array<Record<string, unknown>>;
      return rows.map(mapArtifactOutbox);
    },

    resetToPending(jobId: string, updatedAt: string) {
      return db.prepare(`
        UPDATE artifact_outbox
        SET state = 'pending',
            claim_token = NULL,
            worker_id = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            attempts = 0,
            next_attempt_at = NULL,
            last_error_code = NULL,
            last_error_message = NULL,
            done_at = NULL,
            updated_at = ?
        WHERE job_id = ?
          AND state IN ('done', 'failed')
      `).run(updatedAt, jobId).changes;
    },

    insertPending(input: {
      jobId: string;
      commitId: string;
      projectId: string;
      chapterNo: number;
      jobType: ArtifactOutboxJobType;
      payloadJson: string;
      createdAt: string;
      updatedAt: string;
    }) {
      db.prepare(`
        INSERT INTO artifact_outbox (
          job_id,
          commit_id,
          project_id,
          chapter_no,
          job_type,
          state,
          payload_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
      `).run(
        input.jobId,
        input.commitId,
        input.projectId,
        input.chapterNo,
        input.jobType,
        input.payloadJson,
        input.createdAt,
        input.updatedAt,
      );

      return this.getByJobId(input.jobId)!;
    },

    claim(input: {
      jobId: string;
      workerId: string;
      claimToken: string;
      claimedAt: string;
      claimExpiresAt: string;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE artifact_outbox
        SET state = 'claimed',
            claim_token = ?,
            claim_epoch = claim_epoch + 1,
            worker_id = ?,
            claimed_at = ?,
            claim_expires_at = ?,
            updated_at = ?
        WHERE job_id = ?
          AND state = 'pending'
      `).run(
        input.claimToken,
        input.workerId,
        input.claimedAt,
        input.claimExpiresAt,
        input.updatedAt,
        input.jobId,
      ).changes;
    },

    selectNextClaimable(now: string) {
      const row = db.prepare(`
        SELECT *
        FROM artifact_outbox
        WHERE state = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at ASC, job_id ASC
        LIMIT 1
      `).get(now) as Record<string, unknown> | undefined;
      return row ? mapArtifactOutbox(row) : null;
    },

    peekEarliestPendingRetry(now: string) {
      const due = db.prepare(`
        SELECT 1 AS due
        FROM artifact_outbox
        WHERE state = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        LIMIT 1
      `).get(now);
      if (due) return now;
      const row = db.prepare(`
        SELECT next_attempt_at
        FROM artifact_outbox
        WHERE state = 'pending'
          AND next_attempt_at IS NOT NULL
          AND next_attempt_at > ?
        ORDER BY next_attempt_at ASC
        LIMIT 1
      `).get(now) as { next_attempt_at: string } | undefined;
      return row?.next_attempt_at ?? null;
    },

    renewClaim(input: {
      jobId: string;
      claimToken: string;
      claimEpoch: number;
      claimExpiresAt: string;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE artifact_outbox
        SET claim_expires_at = ?,
            updated_at = ?
        WHERE job_id = ?
          AND state = 'claimed'
          AND claim_token = ?
          AND claim_epoch = ?
      `).run(
        input.claimExpiresAt,
        input.updatedAt,
        input.jobId,
        input.claimToken,
        input.claimEpoch,
      ).changes;
    },

    releaseDone(input: {
      jobId: string;
      claimToken: string;
      claimEpoch: number;
      doneAt: string;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE artifact_outbox
        SET state = 'done',
            claim_token = NULL,
            worker_id = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            done_at = ?,
            updated_at = ?
        WHERE job_id = ?
          AND state = 'claimed'
          AND claim_token = ?
          AND claim_epoch = ?
      `).run(
        input.doneAt,
        input.updatedAt,
        input.jobId,
        input.claimToken,
        input.claimEpoch,
      ).changes;
    },

    failJob(input: {
      jobId: string;
      claimToken: string;
      claimEpoch: number;
      retryable: boolean;
      nextAttemptAt: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      updatedAt: string;
      maxAttempts?: number;
    }) {
      // 超过 maxAttempts 后即使错误可重试也强制进入 failed 终态，避免坏 job 无限重排队。
      const maxAttempts = input.maxAttempts ?? 10;
      const retryFlag = input.retryable ? 1 : 0;
      return db.prepare(`
        UPDATE artifact_outbox
        SET state = CASE WHEN ? = 1 AND attempts + 1 < ? THEN 'pending' ELSE 'failed' END,
            claim_token = NULL,
            worker_id = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            attempts = attempts + 1,
            next_attempt_at = CASE WHEN ? = 1 AND attempts + 1 < ? THEN ? ELSE NULL END,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        WHERE job_id = ?
          AND state = 'claimed'
          AND claim_token = ?
          AND claim_epoch = ?
      `).run(
        retryFlag,
        maxAttempts,
        retryFlag,
        maxAttempts,
        input.nextAttemptAt,
        input.errorCode,
        input.errorMessage,
        input.updatedAt,
        input.jobId,
        input.claimToken,
        input.claimEpoch,
      ).changes;
    },

    requeueExpiredClaims(now: string, updatedAt: string) {
      return db.prepare(`
        UPDATE artifact_outbox
        SET state = 'pending',
            claim_token = NULL,
            worker_id = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            updated_at = ?
        WHERE state = 'claimed'
          AND claim_expires_at IS NOT NULL
          AND claim_expires_at < ?
      `).run(updatedAt, now).changes;
    },
  };
}
