import "../server-only.ts";

import Database from "better-sqlite3";
import { rawDb } from "../db/client.ts";
import { buildRunProgress } from "../repositories/run.repository.ts";
import { createRunSessionRepository, type RunSessionRecord } from "../repositories/run-session.repository.ts";
import type { RunProgressPayload } from "../types.ts";
import { isActiveRunnerLifecycle } from "./session-state-machine.ts";
import { getLastActiveRunStage, isRunHeartbeatStale } from "./run-state.ts";

export interface RunProgressView extends RunProgressPayload {
  sessionId?: string;
  lifecycleStatus?: string;
  recoverable?: boolean;
}

export interface RunProgressServiceOptions {
  db?: Database.Database;
  now?: () => number;
  buildProgressSnapshot?: (projectId: string) => RunProgressPayload;
}

const ACTIVE_RUN_STAGES = new Set<RunProgressPayload["stage"]>([
  "blueprint",
  "context",
  "writing",
  "style_pass",
  "planning_repair",
  "review",
  "analysis",
]);

function mapDesiredState(input: {
  desiredState: string;
  lifecycleStatus: string;
}): NonNullable<RunProgressPayload["desiredState"]> {
  if (input.lifecycleStatus === "paused" || input.desiredState === "pause_requested") {
    return "paused";
  }
  if (input.lifecycleStatus === "stopped" || input.desiredState === "stop_requested") {
    return "stopped";
  }
  if (input.lifecycleStatus === "completed" || input.lifecycleStatus === "failed") {
    return "idle";
  }
  return "running";
}

function mapStage(input: {
  lifecycleStatus: string;
  desiredState: string;
  currentStage: string | null;
  fallbackStage: RunProgressPayload["stage"];
}): RunProgressPayload["stage"] {
  if (input.lifecycleStatus === "paused") {
    return input.fallbackStage === "manual_review" ? "manual_review" : "paused";
  }
  if (input.lifecycleStatus === "interrupted") {
    return "interrupted";
  }
  if (input.lifecycleStatus === "completed") {
    return "completed";
  }
  if (input.lifecycleStatus === "failed") {
    return "failed";
  }
  if (input.lifecycleStatus === "stopped") {
    return "paused";
  }
  if (
    input.desiredState === "pause_requested"
    && ["queued", "launching", "running", "recovering"].includes(input.lifecycleStatus)
  ) {
    return "paused";
  }

  const mappedStage = input.currentStage as RunProgressPayload["stage"] | null;
  return mappedStage ?? input.fallbackStage;
}

function isRecoverableLifecycle(lifecycleStatus: string) {
  return lifecycleStatus === "paused" || lifecycleStatus === "interrupted";
}

function deriveStaleStopRecovery(input: {
  lifecycleStatus: RunSessionRecord["lifecycleStatus"];
  desiredState: string;
  currentStage: string | null;
  snapshot: RunProgressPayload;
  heartbeatAt: string | null;
  now: number;
}) {
  const staleStopRequested =
    isActiveRunnerLifecycle(input.lifecycleStatus)
    && input.desiredState === "stop_requested"
    && isRunHeartbeatStale(input.heartbeatAt, input.now);

  if (!staleStopRequested) {
    return null;
  }

  const resumeStage = (input.currentStage as RunProgressPayload["stage"] | null) ?? input.snapshot.stage;
  return {
    running: false,
    stage: input.lifecycleStatus === "launching" ? "interrupted" : "paused",
    recoverable: true,
    staleHeartbeat: true,
    lastActiveStage: getLastActiveRunStage(resumeStage, input.snapshot.stageDetails),
  } satisfies Pick<RunProgressView, "running" | "stage" | "recoverable" | "staleHeartbeat" | "lastActiveStage">;
}

function deriveStaleRunningRecovery(input: {
  lifecycleStatus: RunSessionRecord["lifecycleStatus"];
  desiredState: string;
  currentStage: string | null;
  snapshot: RunProgressPayload;
  leaseExpiresAt: string | null;
  now: number;
}) {
  // A runner that died without releasing its lease leaves the session in
  // running/recovering with desired_state=running forever (the reconciler only runs
  // on control requests). Degrade the view so the UI offers a recovery entry point.
  const staleRunning =
    isActiveRunnerLifecycle(input.lifecycleStatus)
    && input.desiredState === "running"
    && Boolean(input.leaseExpiresAt)
    && Date.parse(input.leaseExpiresAt!) < input.now;

  if (!staleRunning) {
    return null;
  }

  const resumeStage = (input.currentStage as RunProgressPayload["stage"] | null) ?? input.snapshot.stage;
  return {
    running: false,
    stage: "interrupted" as const,
    recoverable: true,
    staleHeartbeat: true,
    lastActiveStage: getLastActiveRunStage(resumeStage, input.snapshot.stageDetails),
  } satisfies Pick<RunProgressView, "running" | "stage" | "recoverable" | "staleHeartbeat" | "lastActiveStage">;
}

function normalizeSnapshotWithoutSession(snapshot: RunProgressPayload): RunProgressView {
  const lastActiveStage = snapshot.lastActiveStage ?? getLastActiveRunStage(snapshot.stage, snapshot.stageDetails);
  const lostControlPlaneAuthority =
    ACTIVE_RUN_STAGES.has(snapshot.stage)
    || snapshot.running
    || snapshot.desiredState === "running";

  if (!lostControlPlaneAuthority) {
    return {
      ...snapshot,
      running: false,
      recoverable: false,
      lastActiveStage,
    };
  }

  return {
    ...snapshot,
    running: false,
    stage: "interrupted",
    desiredState: "idle",
    recoverable: false,
    staleHeartbeat: true,
    lastActiveStage,
  };
}

export function createRunProgressService(input?: RunProgressServiceOptions) {
  const db = input?.db ?? rawDb;
  const now = input?.now ?? (() => Date.now());
  const buildProgressSnapshot = input?.buildProgressSnapshot ?? buildRunProgress;
  const sessionRepo = createRunSessionRepository({ db });

  return {
    getRunProgressView(projectId: string): RunProgressView {
      const snapshot = buildProgressSnapshot(projectId);
      const session = sessionRepo.getOpenSessionByProjectId(projectId);

      if (!session) {
        return normalizeSnapshotWithoutSession(snapshot);
      }

      const latestEventRows = db.prepare(`
        SELECT level, message, created_at
        FROM run_events
        WHERE session_id = ?
        ORDER BY created_at DESC, event_id DESC
        LIMIT 25
      `).all(session.sessionId) as Array<{
        level: string;
        message: string;
        created_at: string;
      }>;

      const desiredState = mapDesiredState({
        desiredState: session.desiredState,
        lifecycleStatus: session.lifecycleStatus,
      });
      // Once a run_session exists, it is the authoritative control-plane record.
      // Legacy run_state data remains a compatibility source for non-control fields only.
      const lifecycleActive = isActiveRunnerLifecycle(session.lifecycleStatus);
      const stage = mapStage({
        lifecycleStatus: session.lifecycleStatus,
        desiredState: session.desiredState,
        currentStage: session.currentStage,
        fallbackStage: snapshot.stage,
      });
      const staleHeartbeat =
        lifecycleActive
        && session.desiredState !== "pause_requested"
        && Boolean(session.leaseExpiresAt)
        && Date.parse(session.leaseExpiresAt!) < now();
      const staleStopRecovery = deriveStaleStopRecovery({
        lifecycleStatus: session.lifecycleStatus,
        desiredState: session.desiredState,
        currentStage: session.currentStage,
        snapshot,
        heartbeatAt: session.lastHeartbeatAt,
        now: now(),
      });
      const staleRecovery = staleStopRecovery ?? deriveStaleRunningRecovery({
        lifecycleStatus: session.lifecycleStatus,
        desiredState: session.desiredState,
        currentStage: session.currentStage,
        snapshot,
        leaseExpiresAt: session.leaseExpiresAt,
        now: now(),
      });

      return {
        ...snapshot,
        running: staleRecovery?.running ?? (lifecycleActive && session.desiredState !== "pause_requested"),
        stage: staleRecovery?.stage ?? stage,
        currentChapter: session.currentChapter ?? snapshot.currentChapter ?? session.fromChapter,
        desiredState,
        heartbeatAt: session.lastHeartbeatAt,
        heartbeatAgeMs: session.lastHeartbeatAt ? Math.max(0, now() - Date.parse(session.lastHeartbeatAt)) : null,
        staleHeartbeat: staleRecovery?.staleHeartbeat ?? staleHeartbeat,
        // run_events is still write-pending in production code paths; fall back to the
        // run_logs-backed snapshot logs so the progress view never goes blind.
        logs: latestEventRows.length
          ? latestEventRows
            .slice()
            .reverse()
            .map((entry) => ({
              level: entry.level,
              message: entry.message,
              createdAt: entry.created_at,
            }))
          : snapshot.logs,
        sessionId: session.sessionId,
        lifecycleStatus: session.lifecycleStatus,
        recoverable: staleRecovery?.recoverable ?? isRecoverableLifecycle(session.lifecycleStatus),
        lastActiveStage: staleRecovery?.lastActiveStage ?? snapshot.lastActiveStage,
      };
    },
  };
}

const defaultRunProgressService = createRunProgressService();

export function getRunProgress(projectId: string) {
  return defaultRunProgressService.getRunProgressView(projectId);
}
