import "../server-only.ts";

import path from "node:path";
import { createRunnerOrchestrator, type RunnerOrchestrator } from "./runner-orchestrator.ts";

export interface RunnerInvocation {
  sessionId: string;
  projectId: string;
}

export function parseRunnerInvocation(
  env: NodeJS.ProcessEnv,
): RunnerInvocation {
  const sessionId = env.AINOVEL_RUNNER_SESSION_ID?.trim();
  const projectId = env.AINOVEL_RUNNER_PROJECT_ID?.trim();

  if (!sessionId || !projectId) {
    throw new Error("missing detached runner identifiers");
  }

  return {
    sessionId,
    projectId,
  };
}

export function shouldRunRunnerCli(argv: string[]) {
  const entry = argv[1];
  if (!entry) {
    return false;
  }

  const normalized = path.basename(entry).toLowerCase();
  return normalized === "runner-main.ts" || normalized === "runner-main.js";
}

export async function runRunnerMain(input?: {
  env?: NodeJS.ProcessEnv;
  orchestrator?: RunnerOrchestrator;
  logError?: (error: unknown) => void;
}) {
  const env = input?.env ?? process.env;
  const orchestrator = input?.orchestrator ?? createRunnerOrchestrator();
  const logError = input?.logError ?? ((error: unknown) => {
    console.error(error);
  });

  try {
    const invocation = parseRunnerInvocation(env);
    await orchestrator.runSession(invocation.sessionId, invocation.projectId);
    return 0;
  } catch (error) {
    logError(error);
    return 1;
  }
}

if (shouldRunRunnerCli(process.argv)) {
  // Without this handler Node's default policy hard-kills the runner on any leaked
  // rejection (e.g. a heartbeat tick), bypassing the orchestrator's lease release.
  process.on("unhandledRejection", (reason) => {
    console.error("[runner] unhandled rejection:", reason);
  });
  void runRunnerMain().then((exitCode) => {
    process.exit(exitCode);
  });
}
