import "../server-only.ts";

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { conflict, notFound } from "../errors.ts";
import { rawDb } from "../db/client.ts";
import { nowIso } from "../utils.ts";
import {
  createRunSessionRepository,
  summarizeBusySession,
  type BusySessionSummary,
  type RunSessionDesiredState,
  type RunSessionLifecycleStatus,
  type RunSessionRecord,
} from "../repositories/run-session.repository.ts";
import { createRunCheckpointRepository } from "../repositories/run-checkpoint.repository.ts";
import {
  isLeaseHeldLifecycle,
  isTerminalSessionLifecycle,
  transitionDesiredState,
  transitionLifecycle,
} from "./session-state-machine.ts";

export interface LeaseGrant {
  leaseEpoch: number;
  lifecycleStatus: Extract<RunSessionLifecycleStatus, "running" | "recovering">;
}

export interface RenewResult {
  desiredState: RunSessionDesiredState;
}

export type TryEnterGlobalRunnerSlotResult = {
  ok: true;
  session: RunSessionRecord;
} | {
  ok: false;
  busy: BusySessionSummary;
};

export interface SessionServiceOptions {
  db?: Database.Database;
  now?: () => string;
  leaseDurationMs?: number;
  launchGraceMs?: number;
}

export class LostLeaseError extends Error {
  constructor(message = "session lease lost") {
    super(message);
    this.name = "LostLeaseError";
  }
}

function addMilliseconds(isoString: string, ms: number) {
  return new Date(Date.parse(isoString) + ms).toISOString();
}

function isLeaseActive(leaseExpiresAt: string | null, currentTime: string) {
  if (!leaseExpiresAt) {
    return false;
  }
  return Date.parse(leaseExpiresAt) >= Date.parse(currentTime);
}

function runImmediate<T>(db: Database.Database, fn: () => T) {
  const transaction = db.transaction(fn);
  return transaction.immediate();
}

export function createSessionService(input?: SessionServiceOptions) {
  const db = input?.db ?? rawDb;
  const now = input?.now ?? nowIso;
  const leaseDurationMs = input?.leaseDurationMs ?? 75_000;

  const sessionRepo = createRunSessionRepository({ db });
  const checkpointRepo = createRunCheckpointRepository({ db });

  function requireOpenSession(projectId: string) {
    const session = sessionRepo.getOpenSessionByProjectId(projectId);
    if (!session || session.terminalAt || isTerminalSessionLifecycle(session.lifecycleStatus)) {
      throw new Error("当前没有运行中的任务");
    }
    return session;
  }

  return {
    getGlobalActiveSession() {
      return sessionRepo.getGlobalActiveSession();
    },

    getOpenSessionByProjectId(projectId: string) {
      return sessionRepo.getOpenSessionByProjectId(projectId);
    },

    createOrReuseOpenSession(projectId: string, fromChapter: number) {
      return runImmediate(db, () => {
        const existing = sessionRepo.getOpenSessionByProjectId(projectId);
        if (existing) {
          // The caller's explicit start chapter must win when the reused session is not
          // currently executed by a runner (queued/paused/interrupted). Without this,
          // restart/resume requests silently fall back to the session's original from_chapter.
          const canRetarget = ["queued", "paused", "interrupted"].includes(existing.lifecycleStatus);
          const needsRetarget = existing.fromChapter !== fromChapter || existing.currentChapter !== fromChapter;
          if (canRetarget && needsRetarget) {
            sessionRepo.updateRestartTarget({
              sessionId: existing.sessionId,
              fromChapter,
              currentChapter: fromChapter,
              updatedAt: now(),
            });
            const updated = sessionRepo.getBySessionId(existing.sessionId);
            if (updated) {
              return updated;
            }
          }
          return existing;
        }

        const active = sessionRepo.getGlobalActiveSession();
        if (active && active.projectId !== projectId) {
          throw conflict("当前设备已有其他项目正在运行编排", {
            error: "global_runner_busy",
            activeSession: summarizeBusySession(active),
          });
        }

        const currentTime = now();
        const created = sessionRepo.insertQueuedSession({
          sessionId: nanoid(),
          projectId,
          sessionSeq: sessionRepo.getMaxSessionSeq(projectId) + 1,
          fromChapter,
          targetChapter: null,
          startedAt: currentTime,
          updatedAt: currentTime,
        });

        if (!created) {
          throw new Error("failed to create run session");
        }

        return created;
      });
    },

    tryEnterGlobalRunnerSlot(sessionId: string): TryEnterGlobalRunnerSlotResult {
      return runImmediate(db, () => {
        const session = sessionRepo.getBySessionId(sessionId);
        if (!session) {
          throw notFound("运行会话不存在", { sessionId });
        }

        if (session.terminalAt) {
          throw conflict("运行会话已结束，不能再次进入执行槽", { sessionId });
        }

        const nextLifecycle = transitionLifecycle({
          from: session.lifecycleStatus,
          event: "enter_runner_slot",
        });

        if (nextLifecycle === session.lifecycleStatus) {
          return {
            ok: true,
            session,
          };
        }

        const active = sessionRepo.getGlobalActiveSession(sessionId);
        if (active) {
          return {
            ok: false,
            busy: summarizeBusySession(active),
          };
        }

        const currentTime = now();
        sessionRepo.markLaunching({
          sessionId,
          launchNonce: randomUUID(),
          launchRequestedAt: currentTime,
          updatedAt: currentTime,
        });

        const updated = sessionRepo.getBySessionId(sessionId);
        if (!updated) {
          throw notFound("运行会话不存在", { sessionId });
        }

        return {
          ok: true,
          session: updated,
        };
      });
    },

    acquireLease(input: {
      sessionId: string;
      ownerToken: string;
      ownerPid: number;
    }): LeaseGrant {
      return runImmediate(db, () => {
        const session = sessionRepo.getBySessionId(input.sessionId);
        if (!session) {
          throw notFound("运行会话不存在", { sessionId: input.sessionId });
        }
        if (session.terminalAt) {
          throw conflict("运行会话已结束，不能获取 lease", { sessionId: input.sessionId });
        }
        if (session.ownerToken && isLeaseActive(session.leaseExpiresAt, now())) {
          throw conflict("运行会话已被其他 runner 持有", {
            error: "lease_already_owned",
            sessionId: input.sessionId,
          });
        }

        const currentTime = now();
        let lifecycleStatus: LeaseGrant["lifecycleStatus"];
        try {
          lifecycleStatus = transitionLifecycle({
            from: session.lifecycleStatus,
            event: checkpointRepo.hasAnyForSession(input.sessionId)
              ? "acquire_lease_recovering"
              : "acquire_lease_running",
          });
        } catch {
          throw conflict("运行会话尚未进入全局执行槽，不能获取 lease", {
            error: "runner_slot_not_entered",
            sessionId: input.sessionId,
            lifecycleStatus: session.lifecycleStatus,
          });
        }

        sessionRepo.acquireLease({
          sessionId: input.sessionId,
          ownerToken: input.ownerToken,
          ownerPid: input.ownerPid,
          ownerStartedAt: currentTime,
          nextLeaseEpoch: session.leaseEpoch + 1,
          lifecycleStatus,
          heartbeatAt: currentTime,
          leaseExpiresAt: addMilliseconds(currentTime, leaseDurationMs),
          updatedAt: currentTime,
        });

        return {
          leaseEpoch: session.leaseEpoch + 1,
          lifecycleStatus,
        };
      });
    },

    renewLease(input: {
      sessionId: string;
      ownerToken: string;
      leaseEpoch: number;
    }): RenewResult {
      return runImmediate(db, () => {
        const currentTime = now();
        const changed = sessionRepo.renewLease({
          sessionId: input.sessionId,
          ownerToken: input.ownerToken,
          leaseEpoch: input.leaseEpoch,
          heartbeatAt: currentTime,
          leaseExpiresAt: addMilliseconds(currentTime, leaseDurationMs),
          updatedAt: currentTime,
        });

        if (changed !== 1) {
          throw new LostLeaseError();
        }

        const updated = sessionRepo.getBySessionId(input.sessionId);
        if (!updated) {
          throw notFound("运行会话不存在", { sessionId: input.sessionId });
        }

        return {
          desiredState: updated.desiredState,
        };
      });
    },

    releaseLease(input: {
      sessionId: string;
      ownerToken: string;
      leaseEpoch: number;
      finalLifecycle: Extract<RunSessionLifecycleStatus, "paused" | "completed" | "failed" | "stopped">;
      resetDesiredState: boolean;
      lastError?: {
        code?: string | null;
        message?: string | null;
      };
    }) {
      return runImmediate(db, () => {
        const session = sessionRepo.getBySessionId(input.sessionId);
        if (!session) {
          throw notFound("运行会话不存在", { sessionId: input.sessionId });
        }

        const currentTime = now();
        const lifecycleStatus = transitionLifecycle({
          from: session.lifecycleStatus,
          event: `release_${input.finalLifecycle}`,
        });
        const desiredState = transitionDesiredState({
          from: session.desiredState,
          event: input.resetDesiredState ? "reset_running" : "preserve",
        });
        const changed = sessionRepo.releaseLease({
          sessionId: input.sessionId,
          ownerToken: input.ownerToken,
          leaseEpoch: input.leaseEpoch,
          lifecycleStatus,
          desiredState,
          terminalAt: isTerminalSessionLifecycle(lifecycleStatus) ? currentTime : null,
          lastErrorCode: input.lastError?.code ?? null,
          lastErrorMessage: input.lastError?.message ?? null,
          updatedAt: currentTime,
        });

        if (changed !== 1) {
          throw new LostLeaseError();
        }
      });
    },

    revokeLease(input: {
      sessionId: string;
      desiredState: Extract<RunSessionDesiredState, "pause_requested" | "stop_requested">;
      reason: string;
    }) {
      return runImmediate(db, () => {
        const session = sessionRepo.getBySessionId(input.sessionId);
        if (!session) {
          throw notFound("运行会话不存在", { sessionId: input.sessionId });
        }

        const currentTime = now();
        const desiredState = transitionDesiredState({
          from: session.desiredState,
          event: input.desiredState === "pause_requested" ? "request_pause" : "request_stop",
        });
        sessionRepo.revokeLease({
          sessionId: input.sessionId,
          nextLeaseEpoch: session.leaseEpoch + 1,
          desiredState,
          reason: input.reason,
          leaseExpiresAt: currentTime,
          updatedAt: currentTime,
        });
      });
    },

    pauseRun(projectId: string, reason = "pause requested by user") {
      return runImmediate(db, () => {
        const session = requireOpenSession(projectId);
        if (session.lifecycleStatus === "paused") {
          return session;
        }

        const currentTime = now();
        if (session.ownerToken && isLeaseHeldLifecycle(session.lifecycleStatus)) {
          sessionRepo.revokeLease({
            sessionId: session.sessionId,
            nextLeaseEpoch: session.leaseEpoch + 1,
            desiredState: transitionDesiredState({
              from: session.desiredState,
              event: "request_pause",
            }),
            reason,
            leaseExpiresAt: currentTime,
            updatedAt: currentTime,
          });
        } else {
          const lifecycleStatus = transitionLifecycle({
            from: session.lifecycleStatus,
            event: "pause_without_lease",
          });
          sessionRepo.clearLeaseAndSetLifecycle({
            sessionId: session.sessionId,
            lifecycleStatus,
            desiredState: transitionDesiredState({
              from: session.desiredState,
              event: "reset_running",
            }),
            terminalAt: null,
            updatedAt: currentTime,
          });
        }

        const updated = sessionRepo.getBySessionId(session.sessionId);
        if (!updated) {
          throw notFound("运行会话不存在", { projectId, sessionId: session.sessionId });
        }
        return updated;
      });
    },

    stopRun(projectId: string, reason = "stop requested by user") {
      return runImmediate(db, () => {
        const session = requireOpenSession(projectId);
        const currentTime = now();

        if (session.ownerToken && isLeaseHeldLifecycle(session.lifecycleStatus)) {
          sessionRepo.revokeLease({
            sessionId: session.sessionId,
            nextLeaseEpoch: session.leaseEpoch + 1,
            desiredState: transitionDesiredState({
              from: session.desiredState,
              event: "request_stop",
            }),
            reason,
            leaseExpiresAt: currentTime,
            updatedAt: currentTime,
          });
        } else {
          const lifecycleStatus = transitionLifecycle({
            from: session.lifecycleStatus,
            event: "stop_without_lease",
          });
          sessionRepo.clearLeaseAndSetLifecycle({
            sessionId: session.sessionId,
            lifecycleStatus,
            desiredState: transitionDesiredState({
              from: session.desiredState,
              event: "request_stop",
            }),
            terminalAt: currentTime,
            updatedAt: currentTime,
          });
        }

        const updated = sessionRepo.getBySessionId(session.sessionId);
        if (!updated) {
          throw notFound("运行会话不存在", { projectId, sessionId: session.sessionId });
        }
        return updated;
      });
    },
  };
}
