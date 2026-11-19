import "../server-only.ts";

import { randomUUID } from "node:crypto";
import { createRunSessionRepository } from "../repositories/run-session.repository.ts";
import { getRunState } from "../repositories/run.repository.ts";
import {
  pauseRun,
  runDetachedExecution,
  stopRun,
} from "../run-manager.ts";
import { createRunProgressService } from "./progress.service.ts";
import { createSessionService, LostLeaseError } from "./session.service.ts";

export interface RunnerOrchestrator {
  runSession(sessionId: string, projectId: string): Promise<void>;
}

export interface LegacyRunProgressSnapshot {
  stage: string;
  desiredState?: string;
  error?: string;
  lifecycleStatus?: string;
  sessionId?: string;
}

export interface RunnerSessionSnapshot {
  sessionId: string;
  projectId: string;
  fromChapter: number;
  currentChapter: number | null;
  desiredState?: "running" | "pause_requested" | "stop_requested";
}

export interface LegacyRunStateSnapshot {
  currentChapter: number;
  runSessionId: string | null;
}

export interface RunnerSessionControl {
  acquireLease(input: {
    sessionId: string;
    ownerToken: string;
    ownerPid: number;
  }): {
    leaseEpoch: number;
    lifecycleStatus: "running" | "recovering";
  };
  renewLease(input: {
    sessionId: string;
    ownerToken: string;
    leaseEpoch: number;
  }): Promise<{ desiredState: "running" | "pause_requested" | "stop_requested" }> | { desiredState: "running" | "pause_requested" | "stop_requested" };
  releaseLease(input: {
    sessionId: string;
    ownerToken: string;
    leaseEpoch: number;
    finalLifecycle: "paused" | "completed" | "failed" | "stopped";
    resetDesiredState: boolean;
    lastError?: {
      code?: string | null;
      message?: string | null;
    };
  }): void;
}

export interface HeartbeatHandle {
  stop(): void;
}

export interface RunnerOrchestratorOptions {
  sessionService?: RunnerSessionControl;
  getSession?: (sessionId: string) => RunnerSessionSnapshot | null;
  getRunStateSnapshot?: (projectId: string) => LegacyRunStateSnapshot | null;
  runDetachedExecution?: (
    projectId: string,
    input: {
      sessionId: string;
      fromChapter: number;
    },
  ) => Promise<void>;
  getRunProgressView?: (projectId: string) => LegacyRunProgressSnapshot;
  pauseLegacyRun?: (projectId: string) => void;
  stopLegacyRun?: (projectId: string) => void;
  startHeartbeat?: (tick: () => Promise<void>) => HeartbeatHandle;
  ownerTokenFactory?: () => string;
}

function resolveFinalLifecycle(progress: LegacyRunProgressSnapshot) {
  if (progress.desiredState === "stopped") {
    return {
      finalLifecycle: "stopped" as const,
      resetDesiredState: false,
    };
  }
  if (progress.stage === "completed") {
    return {
      finalLifecycle: "completed" as const,
      resetDesiredState: false,
    };
  }
  if (progress.stage === "failed") {
    return {
      finalLifecycle: "failed" as const,
      resetDesiredState: false,
      lastError: {
        message: progress.error ?? "run failed",
      },
    };
  }
  if (progress.stage === "manual_review" || progress.stage === "paused" || progress.stage === "interrupted") {
    return {
      finalLifecycle: "paused" as const,
      resetDesiredState: true,
    };
  }
  return {
    finalLifecycle: "completed" as const,
    resetDesiredState: false,
  };
}

function createIntervalHeartbeat(tick: () => Promise<void>): HeartbeatHandle {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) {
      return;
    }
    inFlight = true;
    // A failing tick must never surface as an unhandled rejection: with no
    // process-level handler that would hard-kill the runner mid-write.
    void Promise.resolve(tick())
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  }, 15_000);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

export function createRunnerOrchestrator(input?: RunnerOrchestratorOptions): RunnerOrchestrator {
  const sessionService = input?.sessionService ?? createSessionService();
  const sessionRepo = createRunSessionRepository();
  const progressService = createRunProgressService();
  const getSession = input?.getSession ?? ((sessionId: string) => {
    const session = sessionRepo.getBySessionId(sessionId);
    if (!session) {
      return null;
    }
    return {
      sessionId: session.sessionId,
      projectId: session.projectId,
      fromChapter: session.fromChapter,
      currentChapter: session.currentChapter,
      desiredState: session.desiredState,
    };
  });
  const getRunStateSnapshot = input?.getRunStateSnapshot ?? ((projectId: string) => {
    const state = getRunState(projectId);
    if (!state) {
      return null;
    }
    return {
      currentChapter: state.currentChapter,
      runSessionId: state.runSessionId,
    };
  });
  const getRunProgressView = input?.getRunProgressView ?? ((projectId: string) => progressService.getRunProgressView(projectId));
  const startHeartbeat = input?.startHeartbeat ?? createIntervalHeartbeat;
  const ownerTokenFactory = input?.ownerTokenFactory ?? randomUUID;

  return {
    async runSession(sessionId: string, projectId: string) {
      const executeSession = input?.runDetachedExecution ?? runDetachedExecution;
      const pauseLegacyRun = input?.pauseLegacyRun ?? pauseRun;
      const stopLegacyRun = input?.stopLegacyRun ?? stopRun;
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`run session not found: ${sessionId}`);
      }

      const ownerToken = ownerTokenFactory();
      const lease = sessionService.acquireLease({
        sessionId,
        ownerToken,
        ownerPid: process.pid,
      });

      // run_sessions.current_chapter is the resume authority; legacy run_state is
      // the fallback for sessions that paused/crashed before progress was mirrored,
      // and only when the state was written by this very session.
      const legacyState = getRunStateSnapshot(projectId);
      const resumeChapter =
        session.currentChapter
        ?? (legacyState && legacyState.runSessionId === sessionId ? legacyState.currentChapter : null)
        ?? session.fromChapter;

      const releaseLeaseQuietly = (release: {
        finalLifecycle: "paused" | "completed" | "failed" | "stopped";
        resetDesiredState: boolean;
        lastError?: { code?: string | null; message?: string | null };
      }) => {
        try {
          sessionService.releaseLease({
            sessionId,
            ownerToken,
            leaseEpoch: lease.leaseEpoch,
            finalLifecycle: release.finalLifecycle,
            resetDesiredState: release.resetDesiredState,
            lastError: release.lastError,
          });
        } catch (error) {
          // The control plane (pause/stop + reconciler) already finalized the session;
          // the runner result is observational at this point.
          if (!(error instanceof LostLeaseError)) {
            throw error;
          }
        }
      };

      let forwardedControl: "pause_requested" | "stop_requested" | null = null;
      let leaseLost = false;
      const forwardControl = (desiredState: RunnerSessionSnapshot["desiredState"]) => {
        if (desiredState === "stop_requested" && forwardedControl !== "stop_requested") {
          stopLegacyRun(projectId);
          forwardedControl = "stop_requested";
          return;
        }
        if (desiredState === "pause_requested" && forwardedControl === null) {
          pauseLegacyRun(projectId);
          forwardedControl = "pause_requested";
        }
      };
      const heartbeat = startHeartbeat(async () => {
        if (leaseLost) {
          return;
        }

        let renew: { desiredState: "running" | "pause_requested" | "stop_requested" };
        try {
          renew = await Promise.resolve(sessionService.renewLease({
            sessionId,
            ownerToken,
            leaseEpoch: lease.leaseEpoch,
          }));
        } catch {
          // pause/stop revoke the lease before any renew can observe the desired state,
          // so a failed renew is the regular control signal: forward the latest intent
          // and let executeRun exit through its graceful suspension path. A lost lease
          // without an explicit stop (e.g. expiry after machine sleep) must also stand
          // down as a pause — another runner may legitimately take over the session.
          leaseLost = true;
          const latest = getSession(sessionId);
          try {
            forwardControl(latest?.desiredState === "stop_requested" ? "stop_requested" : "pause_requested");
          } catch {
            // The legacy run already tore down its lock/task state; nothing to forward.
          }
          return;
        }

        forwardControl(renew.desiredState);
      });

      try {
        await executeSession(projectId, {
          sessionId,
          fromChapter: resumeChapter,
        });

        // The DB-backed RunProgressView is the active control-plane source of truth.
        // Legacy lock snapshots remain observational and are logged only for divergence tracking.
        const finalState = resolveFinalLifecycle(getRunProgressView(projectId));
        releaseLeaseQuietly(finalState);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        releaseLeaseQuietly({
          finalLifecycle: "failed",
          resetDesiredState: false,
          lastError: {
            message,
          },
        });
        throw error;
      } finally {
        heartbeat.stop();
      }
    },
  };
}
