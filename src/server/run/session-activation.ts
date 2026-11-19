import "../server-only.ts";

import { getRunControlSnapshots } from "./run-internals.ts";
import { resolveRunContinuation } from "./run-control.ts";

export function ensureRunSessionActive(
  projectId: string,
  sessionId: string,
  input?: {
    allowPaused?: boolean;
  },
) {
  const { task, lock } = getRunControlSnapshots(projectId);
  const decision = resolveRunContinuation(sessionId, task, lock);
  if (decision === "stop") {
    throw new Error("运行已停止");
  }
  if (decision === "pause" && !input?.allowPaused) {
    throw new Error("运行已暂停");
  }
}
