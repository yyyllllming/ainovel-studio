import "../server-only.ts";

import Database from "better-sqlite3";
import { rawDb } from "../db/client.ts";
import { nowIso } from "../utils.ts";
import { createRunSessionRepository } from "../repositories/run-session.repository.ts";
import { transitionDesiredState, transitionLifecycle } from "./session-state-machine.ts";

export interface SessionReconcilerOptions {
  db?: Database.Database;
  now?: () => string;
  launchGraceMs?: number;
}

export interface SessionReconcileStats {
  staleLaunchingInterrupted: number;
  expiredLeaseTransitions: number;
}

function addMilliseconds(isoString: string, ms: number) {
  return new Date(Date.parse(isoString) + ms).toISOString();
}

function runImmediate<T>(db: Database.Database, fn: () => T) {
  const transaction = db.transaction(fn);
  return transaction.immediate();
}

export function createSessionReconciler(input?: SessionReconcilerOptions) {
  const db = input?.db ?? rawDb;
  const now = input?.now ?? nowIso;
  const launchGraceMs = input?.launchGraceMs ?? 20_000;
  const sessionRepo = createRunSessionRepository({ db });

  return {
    reconcileSessionsTick(): SessionReconcileStats {
      return runImmediate(db, () => {
        const currentTime = now();
        const staleLaunchingInterrupted = sessionRepo.interruptStaleLaunching(
          addMilliseconds(currentTime, -launchGraceMs),
          currentTime,
        );

        const expired = sessionRepo.listExpiredLeaseSessions(currentTime);
        for (const session of expired) {
          const lifecycleEvent = session.desiredState === "pause_requested"
            ? "lease_expired_pause"
            : session.desiredState === "stop_requested"
              ? "lease_expired_stop"
              : "lease_expired_interrupt";
          const desiredEvent = session.desiredState === "pause_requested" ? "reset_running" : "preserve";
          sessionRepo.clearLeaseAndSetLifecycle({
            sessionId: session.sessionId,
            lifecycleStatus: transitionLifecycle({
              from: session.lifecycleStatus,
              event: lifecycleEvent,
            }),
            desiredState: transitionDesiredState({
              from: session.desiredState,
              event: desiredEvent,
            }),
            terminalAt: session.desiredState === "stop_requested" ? currentTime : null,
            updatedAt: currentTime,
          });
        }

        return {
          staleLaunchingInterrupted,
          expiredLeaseTransitions: expired.length,
        };
      });
    },
  };
}
