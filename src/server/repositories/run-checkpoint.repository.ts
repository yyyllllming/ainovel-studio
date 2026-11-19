import "../server-only.ts";

import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";

export type RunCheckpointStepStatus = "completed" | "skipped";

export interface RunCheckpointRecord {
  checkpointId: string;
  sessionId: string;
  checkpointSeq: number;
  chapterNo: number;
  stage: string;
  stepKey: string;
  stepStatus: RunCheckpointStepStatus;
  resumeCursorJson: string | null;
  artifactRefsJson: string | null;
  payloadJson: string | null;
  leaseEpoch: number;
  createdAt: string;
}

function mapRunCheckpoint(row: Record<string, unknown>): RunCheckpointRecord {
  return {
    checkpointId: String(row.checkpoint_id),
    sessionId: String(row.session_id),
    checkpointSeq: Number(row.checkpoint_seq),
    chapterNo: Number(row.chapter_no),
    stage: String(row.stage),
    stepKey: String(row.step_key),
    stepStatus: String(row.step_status) as RunCheckpointStepStatus,
    resumeCursorJson: row.resume_cursor_json ? String(row.resume_cursor_json) : null,
    artifactRefsJson: row.artifact_refs_json ? String(row.artifact_refs_json) : null,
    payloadJson: row.payload_json ? String(row.payload_json) : null,
    leaseEpoch: Number(row.lease_epoch),
    createdAt: String(row.created_at),
  };
}

export function createRunCheckpointRepository(input?: {
  db?: Database.Database;
}) {
  const db = input?.db ?? rawDb;

  return {
    getLatestCompleted(sessionId: string) {
      const row = db.prepare(`
        SELECT * FROM run_checkpoints
        WHERE session_id = ?
        ORDER BY checkpoint_seq DESC
        LIMIT 1
      `).get(sessionId) as Record<string, unknown> | undefined;
      return row ? mapRunCheckpoint(row) : null;
    },

    findCompletedStep(input: {
      sessionId: string;
      chapterNo: number;
      stepKey: string;
      stepStatus: RunCheckpointStepStatus;
    }) {
      const row = db.prepare(`
        SELECT * FROM run_checkpoints
        WHERE session_id = ?
          AND chapter_no = ?
          AND step_key = ?
          AND step_status = ?
        LIMIT 1
      `).get(
        input.sessionId,
        input.chapterNo,
        input.stepKey,
        input.stepStatus,
      ) as Record<string, unknown> | undefined;
      return row ? mapRunCheckpoint(row) : null;
    },

    hasAnyForSession(sessionId: string) {
      const row = db.prepare("SELECT 1 AS present FROM run_checkpoints WHERE session_id = ? LIMIT 1").get(sessionId) as
        | { present: number }
        | undefined;
      return Boolean(row?.present);
    },

    insertCompletedCheckpoint(input: {
      checkpointId?: string;
      sessionId: string;
      checkpointSeq: number;
      chapterNo: number;
      stage: string;
      stepKey: string;
      stepStatus: RunCheckpointStepStatus;
      resumeCursorJson?: string | null;
      artifactRefsJson?: string | null;
      payloadJson?: string | null;
      leaseEpoch: number;
      createdAt: string;
    }) {
      const checkpointId = input.checkpointId ?? nanoid();
      db.prepare(`
        INSERT INTO run_checkpoints (
          checkpoint_id,
          session_id,
          checkpoint_seq,
          chapter_no,
          stage,
          step_key,
          step_status,
          resume_cursor_json,
          artifact_refs_json,
          payload_json,
          lease_epoch,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checkpointId,
        input.sessionId,
        input.checkpointSeq,
        input.chapterNo,
        input.stage,
        input.stepKey,
        input.stepStatus,
        input.resumeCursorJson ?? null,
        input.artifactRefsJson ?? null,
        input.payloadJson ?? null,
        input.leaseEpoch,
        input.createdAt,
      );

      return this.getLatestCompleted(input.sessionId);
    },
  };
}
