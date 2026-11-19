import "../server-only.ts";

import type { RunSessionRecord } from "../repositories/run-session.repository.ts";
import { conflict } from "../errors.ts";
import type { SessionReconcileStats } from "./session-reconciler.ts";
import type { TryEnterGlobalRunnerSlotResult } from "./session.service.ts";

type SessionLifecycleStatus = RunSessionRecord["lifecycleStatus"];

export interface RunnerLauncher {
  spawnRunner(sessionId: string, projectId: string): { pid: number | null };
}

export interface SessionReconcilerLike {
  reconcileSessionsTick(): SessionReconcileStats;
}

export interface SessionServiceLike {
  getGlobalActiveSession(): RunSessionRecord | null;
  createOrReuseOpenSession(projectId: string, fromChapter: number): RunSessionRecord;
  tryEnterGlobalRunnerSlot(sessionId: string): TryEnterGlobalRunnerSlotResult;
  pauseRun(projectId: string, reason?: string): RunSessionRecord;
  stopRun(projectId: string, reason?: string): RunSessionRecord;
}

export interface ControlServiceOptions {
  launcher: RunnerLauncher;
  sessionReconciler: SessionReconcilerLike;
  sessionService: SessionServiceLike;
}

function shouldSpawnRunner(lifecycleStatus: SessionLifecycleStatus) {
  return lifecycleStatus === "queued" || lifecycleStatus === "paused" || lifecycleStatus === "interrupted";
}

export function createControlService(input: ControlServiceOptions) {
  return {
    startOrResumeRun(params: {
      projectId: string;
      fromChapter: number;
    }) {
      input.sessionReconciler.reconcileSessionsTick();

      const active = input.sessionService.getGlobalActiveSession();
      if (active && active.projectId !== params.projectId) {
        throw conflict("当前设备已有其他项目正在运行编排", {
          error: "global_runner_busy",
          activeSession: {
            sessionId: active.sessionId,
            projectId: active.projectId,
            lifecycleStatus: active.lifecycleStatus,
            desiredState: active.desiredState,
            currentChapter: active.currentChapter,
            currentStage: active.currentStage,
            leaseExpiresAt: active.leaseExpiresAt,
            updatedAt: active.updatedAt,
          },
        });
      }

      let session = input.sessionService.createOrReuseOpenSession(params.projectId, params.fromChapter);
      if (!shouldSpawnRunner(session.lifecycleStatus)) {
        return session;
      }

      const entered = input.sessionService.tryEnterGlobalRunnerSlot(session.sessionId);
      if (!entered.ok) {
        throw conflict("当前设备已有其他项目正在运行编排", {
          error: "global_runner_busy",
          activeSession: entered.busy,
        });
      }

      input.launcher.spawnRunner(entered.session.sessionId, entered.session.projectId);
      session = entered.session;
      return session;
    },

    pauseRun(projectId: string) {
      input.sessionReconciler.reconcileSessionsTick();
      return input.sessionService.pauseRun(projectId, "pause requested by user");
    },

    stopRun(projectId: string) {
      input.sessionReconciler.reconcileSessionsTick();
      return input.sessionService.stopRun(projectId, "stop requested by user");
    },
  };
}
