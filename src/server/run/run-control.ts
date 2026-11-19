export interface RunTaskSnapshot {
  sessionId?: string | null;
  paused?: boolean;
  stopRequested?: boolean;
}

export interface RunLockSnapshot {
  sessionId?: string | null;
  paused?: boolean;
  stopRequested?: boolean;
  desiredState?: "idle" | "running" | "paused" | "stopped" | null;
}

function ownsSession(sessionId: string, actualSessionId: string | null | undefined) {
  return Boolean(sessionId) && actualSessionId === sessionId;
}

export function resolveRunContinuation(
  sessionId: string,
  task: RunTaskSnapshot | null | undefined,
  lock: RunLockSnapshot | null | undefined,
) {
  if (!sessionId || !task || !lock) {
    return "stop" as const;
  }

  if (!ownsSession(sessionId, task.sessionId) || !ownsSession(sessionId, lock.sessionId)) {
    return "stop" as const;
  }

  if (task.stopRequested || lock.stopRequested || lock.desiredState === "stopped") {
    return "stop" as const;
  }

  if (task.paused || lock.paused || lock.desiredState === "paused") {
    return "pause" as const;
  }

  return "continue" as const;
}

export function shouldTouchHeartbeat(
  sessionId: string,
  task: RunTaskSnapshot | null | undefined,
  lock: RunLockSnapshot | null | undefined,
) {
  return resolveRunContinuation(sessionId, task, lock) === "continue";
}

export function canReleaseSessionOwnedResource(
  expectedSessionId: string | undefined,
  currentSessionId: string | null | undefined,
) {
  if (!expectedSessionId) {
    return true;
  }
  return currentSessionId === expectedSessionId;
}
