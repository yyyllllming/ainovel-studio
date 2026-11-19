import "../server-only.ts";

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { withinProject } from "../paths.ts";
import { getProject } from "../repositories/project.repository.ts";
import { getRunState, upsertRunState } from "../repositories/run.repository.ts";
import { createRunSessionRepository } from "../repositories/run-session.repository.ts";
import type { RunProgressPayload } from "../types.ts";
import { nowIso } from "../utils.ts";
import { safeParseJson } from "../utils/safe-json.ts";
import { canReleaseSessionOwnedResource, resolveRunContinuation, shouldTouchHeartbeat } from "./run-control.ts";
import { isRunHeartbeatStale } from "./run-state.ts";

export interface RunningTask {
  projectId: string;
  sessionId: string;
  startedAt: number;
  paused: boolean;
  stopRequested: boolean;
  lockFile: string;
}

export interface LockState {
  pid?: number;
  sessionId?: string;
  createdAt?: string;
  heartbeatAt?: string;
  desiredState?: "idle" | "running" | "paused" | "stopped";
  paused?: boolean;
  stopRequested?: boolean;
}

export const runningTasks = new Map<string, RunningTask>();

export function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getLockFile(projectId: string) {
  return withinProject(projectId, ".lock");
}

export function readLockState(projectId: string): LockState | null {
  const lockFile = getLockFile(projectId);
  if (!existsSync(lockFile)) {
    return null;
  }

  return safeParseJson<LockState>(readFileSync(lockFile, "utf8"));
}

export function writeLockState(projectId: string, nextState: LockState) {
  writeFileSync(getLockFile(projectId), JSON.stringify(nextState, null, 2), "utf8");
  return nextState;
}

export function updateLockState(projectId: string, patch: Partial<LockState>) {
  const current = readLockState(projectId);
  if (!current) {
    throw new Error("当前没有运行中的任务");
  }
  return writeLockState(projectId, {
    ...current,
    ...patch,
  });
}

export function getRunControlSnapshots(projectId: string) {
  const task = runningTasks.get(projectId);
  const lockState = readLockState(projectId);
  return {
    task: task
      ? {
        sessionId: task.sessionId,
        paused: task.paused,
        stopRequested: task.stopRequested,
      }
      : null,
    lock: lockState
      ? {
        sessionId: lockState.sessionId,
        paused: lockState.paused,
        stopRequested: lockState.stopRequested,
        desiredState: lockState.desiredState,
      }
      : null,
  };
}

export function touchRunHeartbeat(projectId: string, input?: { stage?: RunProgressPayload["stage"]; sessionId?: string }) {
  const now = nowIso();
  const state = getRunState(projectId);
  if (!state || !input?.sessionId) {
    return;
  }
  const { task, lock } = getRunControlSnapshots(projectId);
  if (!shouldTouchHeartbeat(input.sessionId, task, lock)) {
    return;
  }
  if (lock) {
    updateLockState(projectId, {
      heartbeatAt: now,
      desiredState: "running",
      sessionId: input.sessionId,
      paused: false,
    });
  }
  upsertRunState(projectId, {
    stage: input?.stage ?? state.stage,
    status: state.status,
    desiredState: "running",
    runSessionId: input.sessionId,
    heartbeatAt: now,
    currentChapter: state.currentChapter,
    totalChapters: state.totalChapters,
    retryCount: state.retryCount,
    confidence: state.confidence,
    lastError: state.lastError,
    draftFile: state.draftFile,
    currentPosition: state.currentPosition,
    wordCount: state.wordCount,
    stageDetails: state.stageDetails,
  });
  // Mirror real progress into the control-plane record so pause/crash resume can
  // restart from the chapter actually being written instead of the session's
  // original from_chapter. No-op for legacy session ids without a run_sessions row.
  createRunSessionRepository().updateProgress({
    sessionId: input.sessionId,
    currentChapter: state.currentChapter,
    currentStage: input?.stage ?? state.stage,
    updatedAt: now,
  });
}

export function buildSuspendedRunStatePatch(
  projectId: string,
  desiredState: "paused" | "stopped",
  fallbackChapter?: number,
) {
  const state = getRunState(projectId);
  const project = getProject(projectId);

  return {
    stage: "paused" as const,
    status: "paused" as const,
    desiredState,
    heartbeatAt: nowIso(),
    currentChapter: state?.currentChapter ?? fallbackChapter ?? 1,
    totalChapters:
      state?.totalChapters
      ?? project?.storyContract?.forecast.target
      ?? project?.chapterBudgetTarget
      ?? 1,
    retryCount: state?.retryCount ?? 0,
    confidence: state?.confidence ?? 0,
    lastError: null,
    draftFile: state?.draftFile ?? null,
    currentPosition: state?.currentPosition ?? 0,
    wordCount: state?.wordCount ?? 0,
    stageDetails: state?.stageDetails ?? {},
  };
}

export function createLock(projectId: string, sessionId: string) {
  const lockFile = getLockFile(projectId);
  mkdirSync(withinProject(projectId), { recursive: true });
  if (runningTasks.has(projectId)) {
    throw new Error("该项目正在运行中");
  }
  if (existsSync(lockFile)) {
    const raw = safeParseJson<LockState>(readFileSync(lockFile, "utf8"), {});
    if (!raw) {
      unlinkSync(lockFile);
    } else if (
      raw.pid
      && isProcessAlive(raw.pid)
      && raw.desiredState === "running"
      && !isRunHeartbeatStale(raw.heartbeatAt)
    ) {
      throw new Error("检测到锁文件：该项目可能已在其他标签页或进程中运行");
    } else {
      unlinkSync(lockFile);
    }
  }

  writeLockState(projectId, {
    pid: process.pid,
    sessionId,
    createdAt: nowIso(),
    heartbeatAt: nowIso(),
    desiredState: "running",
    paused: false,
    stopRequested: false,
  });

  const task: RunningTask = {
    projectId,
    sessionId,
    startedAt: Date.now(),
    paused: false,
    stopRequested: false,
    lockFile,
  };
  runningTasks.set(projectId, task);
  return task;
}

export async function releaseLock(projectId: string, sessionId?: string) {
  const task = runningTasks.get(projectId);
  if (canReleaseSessionOwnedResource(sessionId, task?.sessionId)) {
    runningTasks.delete(projectId);
  }

  const lockState = readLockState(projectId);
  if (!lockState || !canReleaseSessionOwnedResource(sessionId, lockState.sessionId)) {
    return;
  }

  unlinkSync(getLockFile(projectId));
}

export async function waitIfPaused(projectId: string, sessionId?: string) {
  while (true) {
    if (!sessionId) {
      if (!readLockState(projectId)?.paused) {
        return;
      }
    } else {
      const { task, lock } = getRunControlSnapshots(projectId);
      const decision = resolveRunContinuation(sessionId, task, lock);
      if (decision === "continue") {
        return;
      }
      if (decision === "stop") {
        throw new Error("运行已停止");
      }
      // Detached runners must exit on pause instead of blocking forever:
      // executeRun catches this message, persists the paused run_state, and lets the
      // orchestrator release the session lease as paused so a later resume can spawn
      // a fresh runner without racing a still-alive paused process.
      throw new Error("运行已暂停");
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

process.on("exit", () => {
  for (const task of runningTasks.values()) {
    if (existsSync(task.lockFile)) {
      unlinkSync(task.lockFile);
    }
  }
});
