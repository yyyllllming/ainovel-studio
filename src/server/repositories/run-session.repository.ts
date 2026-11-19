import "../server-only.ts";

import Database from "better-sqlite3";
import { rawDb } from "../db/client.ts";

export type RunSessionDesiredState = "running" | "pause_requested" | "stop_requested";
export type RunSessionLifecycleStatus =
  | "queued"
  | "launching"
  | "running"
  | "recovering"
  | "paused"
  | "interrupted"
  | "completed"
  | "failed"
  | "stopped";

export interface RunSessionRecord {
  sessionId: string;
  projectId: string;
  sessionSeq: number;
  restartOfSessionId: string | null;
  fromChapter: number;
  targetChapter: number | null;
  desiredState: RunSessionDesiredState;
  lifecycleStatus: RunSessionLifecycleStatus;
  pauseReason: string | null;
  stopReason: string | null;
  ownerToken: string | null;
  leaseEpoch: number;
  ownerPid: number | null;
  ownerStartedAt: string | null;
  lastHeartbeatAt: string | null;
  leaseExpiresAt: string | null;
  launchNonce: string | null;
  launchRequestedAt: string | null;
  launchStartedAt: string | null;
  currentChapter: number | null;
  currentStage: string | null;
  currentStepKey: string | null;
  configSnapshotId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  startedAt: string;
  terminalAt: string | null;
  updatedAt: string;
}

export interface BusySessionSummary {
  sessionId: string;
  projectId: string;
  lifecycleStatus: RunSessionLifecycleStatus;
  desiredState: RunSessionDesiredState;
  currentChapter: number | null;
  currentStage: string | null;
  leaseExpiresAt: string | null;
  updatedAt: string;
}

function mapRunSession(row: Record<string, unknown>): RunSessionRecord {
  return {
    sessionId: String(row.session_id),
    projectId: String(row.project_id),
    sessionSeq: Number(row.session_seq),
    restartOfSessionId: row.restart_of_session_id ? String(row.restart_of_session_id) : null,
    fromChapter: Number(row.from_chapter),
    targetChapter: row.target_chapter == null ? null : Number(row.target_chapter),
    desiredState: String(row.desired_state) as RunSessionDesiredState,
    lifecycleStatus: String(row.lifecycle_status) as RunSessionLifecycleStatus,
    pauseReason: row.pause_reason ? String(row.pause_reason) : null,
    stopReason: row.stop_reason ? String(row.stop_reason) : null,
    ownerToken: row.owner_token ? String(row.owner_token) : null,
    leaseEpoch: Number(row.lease_epoch ?? 0),
    ownerPid: row.owner_pid == null ? null : Number(row.owner_pid),
    ownerStartedAt: row.owner_started_at ? String(row.owner_started_at) : null,
    lastHeartbeatAt: row.last_heartbeat_at ? String(row.last_heartbeat_at) : null,
    leaseExpiresAt: row.lease_expires_at ? String(row.lease_expires_at) : null,
    launchNonce: row.launch_nonce ? String(row.launch_nonce) : null,
    launchRequestedAt: row.launch_requested_at ? String(row.launch_requested_at) : null,
    launchStartedAt: row.launch_started_at ? String(row.launch_started_at) : null,
    currentChapter: row.current_chapter == null ? null : Number(row.current_chapter),
    currentStage: row.current_stage ? String(row.current_stage) : null,
    currentStepKey: row.current_step_key ? String(row.current_step_key) : null,
    configSnapshotId: row.config_snapshot_id ? String(row.config_snapshot_id) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastErrorMessage: row.last_error_message ? String(row.last_error_message) : null,
    startedAt: String(row.started_at),
    terminalAt: row.terminal_at ? String(row.terminal_at) : null,
    updatedAt: String(row.updated_at),
  };
}

export function summarizeBusySession(session: RunSessionRecord): BusySessionSummary {
  return {
    sessionId: session.sessionId,
    projectId: session.projectId,
    lifecycleStatus: session.lifecycleStatus,
    desiredState: session.desiredState,
    currentChapter: session.currentChapter,
    currentStage: session.currentStage,
    leaseExpiresAt: session.leaseExpiresAt,
    updatedAt: session.updatedAt,
  };
}

export function createRunSessionRepository(input?: {
  db?: Database.Database;
}) {
  const db = input?.db ?? rawDb;

  return {
    getBySessionId(sessionId: string) {
      const row = db.prepare("SELECT * FROM run_sessions WHERE session_id = ?").get(sessionId) as
        | Record<string, unknown>
        | undefined;
      return row ? mapRunSession(row) : null;
    },

    getOpenSessionByProjectId(projectId: string) {
      const row = db.prepare(`
        SELECT * FROM run_sessions
        WHERE project_id = ? AND terminal_at IS NULL
        ORDER BY started_at DESC
        LIMIT 1
      `).get(projectId) as Record<string, unknown> | undefined;
      return row ? mapRunSession(row) : null;
    },

    getGlobalActiveSession(excludeSessionId?: string) {
      const row = excludeSessionId
        ? db.prepare(`
            SELECT * FROM run_sessions
            WHERE terminal_at IS NULL
              AND lifecycle_status IN ('queued', 'launching', 'running', 'recovering')
              AND session_id <> ?
            ORDER BY updated_at DESC
            LIMIT 1
          `).get(excludeSessionId) as Record<string, unknown> | undefined
        : db.prepare(`
            SELECT * FROM run_sessions
            WHERE terminal_at IS NULL
              AND lifecycle_status IN ('queued', 'launching', 'running', 'recovering')
            ORDER BY updated_at DESC
            LIMIT 1
          `).get() as Record<string, unknown> | undefined;
      return row ? mapRunSession(row) : null;
    },

    getMaxSessionSeq(projectId: string) {
      const row = db.prepare("SELECT MAX(session_seq) AS max_session_seq FROM run_sessions WHERE project_id = ?").get(projectId) as
        | { max_session_seq: number | null }
        | undefined;
      return row?.max_session_seq ?? 0;
    },

    insertQueuedSession(input: {
      sessionId: string;
      projectId: string;
      sessionSeq: number;
      fromChapter: number;
      targetChapter: number | null;
      startedAt: string;
      updatedAt: string;
    }) {
      db.prepare(`
        INSERT INTO run_sessions (
          session_id,
          project_id,
          session_seq,
          from_chapter,
          target_chapter,
          desired_state,
          lifecycle_status,
          started_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, 'running', 'queued', ?, ?)
      `).run(
        input.sessionId,
        input.projectId,
        input.sessionSeq,
        input.fromChapter,
        input.targetChapter,
        input.startedAt,
        input.updatedAt,
      );

      return this.getBySessionId(input.sessionId);
    },

    markLaunching(input: {
      sessionId: string;
      launchNonce: string;
      launchRequestedAt: string;
      updatedAt: string;
    }) {
      db.prepare(`
        UPDATE run_sessions
        SET lifecycle_status = 'launching',
            launch_nonce = ?,
            launch_requested_at = ?,
            updated_at = ?
        WHERE session_id = ? AND terminal_at IS NULL
      `).run(
        input.launchNonce,
        input.launchRequestedAt,
        input.updatedAt,
        input.sessionId,
      );
    },

    acquireLease(input: {
      sessionId: string;
      ownerToken: string;
      ownerPid: number;
      ownerStartedAt: string;
      nextLeaseEpoch: number;
      lifecycleStatus: Extract<RunSessionLifecycleStatus, "running" | "recovering">;
      heartbeatAt: string;
      leaseExpiresAt: string;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE run_sessions
        SET owner_token = ?,
            owner_pid = ?,
            owner_started_at = ?,
            lease_epoch = ?,
            lifecycle_status = ?,
            last_heartbeat_at = ?,
            lease_expires_at = ?,
            updated_at = ?
        WHERE session_id = ? AND terminal_at IS NULL
      `).run(
        input.ownerToken,
        input.ownerPid,
        input.ownerStartedAt,
        input.nextLeaseEpoch,
        input.lifecycleStatus,
        input.heartbeatAt,
        input.leaseExpiresAt,
        input.updatedAt,
        input.sessionId,
      ).changes;
    },

    updateProgress(input: {
      sessionId: string;
      currentChapter: number;
      currentStage: string | null;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE run_sessions
        SET current_chapter = ?,
            current_stage = ?,
            updated_at = ?
        WHERE session_id = ? AND terminal_at IS NULL
      `).run(
        input.currentChapter,
        input.currentStage,
        input.updatedAt,
        input.sessionId,
      ).changes;
    },

    updateRestartTarget(input: {
      sessionId: string;
      fromChapter: number;
      currentChapter: number;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE run_sessions
        SET from_chapter = ?,
            current_chapter = ?,
            updated_at = ?
        WHERE session_id = ? AND terminal_at IS NULL
      `).run(
        input.fromChapter,
        input.currentChapter,
        input.updatedAt,
        input.sessionId,
      ).changes;
    },

    renewLease(input: {
      sessionId: string;
      ownerToken: string;
      leaseEpoch: number;
      heartbeatAt: string;
      leaseExpiresAt: string;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE run_sessions
        SET last_heartbeat_at = ?,
            lease_expires_at = ?,
            updated_at = ?
        WHERE session_id = ?
          AND owner_token = ?
          AND lease_epoch = ?
          AND terminal_at IS NULL
      `).run(
        input.heartbeatAt,
        input.leaseExpiresAt,
        input.updatedAt,
        input.sessionId,
        input.ownerToken,
        input.leaseEpoch,
      ).changes;
    },

    releaseLease(input: {
      sessionId: string;
      ownerToken: string;
      leaseEpoch: number;
      lifecycleStatus: Extract<RunSessionLifecycleStatus, "paused" | "completed" | "failed" | "stopped">;
      desiredState: RunSessionDesiredState;
      terminalAt: string | null;
      lastErrorCode: string | null;
      lastErrorMessage: string | null;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE run_sessions
        SET lifecycle_status = ?,
            desired_state = ?,
            owner_token = NULL,
            owner_pid = NULL,
            owner_started_at = NULL,
            last_heartbeat_at = NULL,
            lease_expires_at = NULL,
            terminal_at = ?,
            last_error_code = ?,
            last_error_message = ?,
            updated_at = ?
        WHERE session_id = ?
          AND owner_token = ?
          AND lease_epoch >= ?
          AND terminal_at IS NULL
      `).run(
        input.lifecycleStatus,
        input.desiredState,
        input.terminalAt,
        input.lastErrorCode,
        input.lastErrorMessage,
        input.updatedAt,
        input.sessionId,
        input.ownerToken,
        input.leaseEpoch,
      ).changes;
    },

    revokeLease(input: {
      sessionId: string;
      nextLeaseEpoch: number;
      desiredState: Extract<RunSessionDesiredState, "pause_requested" | "stop_requested">;
      reason: string;
      leaseExpiresAt: string;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE run_sessions
        SET desired_state = ?,
            pause_reason = CASE WHEN ? = 'pause_requested' THEN ? ELSE pause_reason END,
            stop_reason = CASE WHEN ? = 'stop_requested' THEN ? ELSE stop_reason END,
            lease_epoch = ?,
            lease_expires_at = ?,
            updated_at = ?
        WHERE session_id = ? AND terminal_at IS NULL
      `).run(
        input.desiredState,
        input.desiredState,
        input.reason,
        input.desiredState,
        input.reason,
        input.nextLeaseEpoch,
        input.leaseExpiresAt,
        input.updatedAt,
        input.sessionId,
      ).changes;
    },

    interruptStaleLaunching(cutoff: string, updatedAt: string) {
      return db.prepare(`
        UPDATE run_sessions
        SET lifecycle_status = 'interrupted',
            launch_nonce = NULL,
            launch_requested_at = NULL,
            launch_started_at = NULL,
            updated_at = ?
        WHERE terminal_at IS NULL
          AND lifecycle_status IN ('queued', 'launching')
          AND owner_token IS NULL
          AND COALESCE(launch_requested_at, updated_at) < ?
      `).run(updatedAt, cutoff).changes;
    },

    listExpiredLeaseSessions(now: string) {
      return (db.prepare(`
        SELECT * FROM run_sessions
        WHERE terminal_at IS NULL
          AND lifecycle_status IN ('running', 'recovering')
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < ?
        ORDER BY updated_at ASC
      `).all(now) as Array<Record<string, unknown>>).map(mapRunSession);
    },

    clearLeaseAndSetLifecycle(input: {
      sessionId: string;
      lifecycleStatus: Extract<RunSessionLifecycleStatus, "paused" | "interrupted" | "stopped">;
      desiredState: RunSessionDesiredState;
      terminalAt: string | null;
      updatedAt: string;
    }) {
      return db.prepare(`
        UPDATE run_sessions
        SET lifecycle_status = ?,
            desired_state = ?,
            owner_token = NULL,
            owner_pid = NULL,
            owner_started_at = NULL,
            last_heartbeat_at = NULL,
            lease_expires_at = NULL,
            terminal_at = ?,
            updated_at = ?
        WHERE session_id = ? AND terminal_at IS NULL
      `).run(
        input.lifecycleStatus,
        input.desiredState,
        input.terminalAt,
        input.updatedAt,
        input.sessionId,
      ).changes;
    },
  };
}
