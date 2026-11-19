import "../server-only.ts";

import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { envWithTenant } from "../tenant.ts";

export interface RunnerLaunchSpec {
  command: string;
  args: string[];
  cwd: string;
  detached: true;
  stdio: "ignore";
  env: NodeJS.ProcessEnv;
  windowsHide: true;
}

export interface CommitReconcilerLaunchSpec extends RunnerLaunchSpec {}

export interface LauncherServiceOptions {
  cwd?: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  spawnImpl?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => {
    pid?: number;
    unref(): void;
  };
}

export function buildRunnerLaunchSpec(input: {
  sessionId: string;
  projectId: string;
  cwd?: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
}): RunnerLaunchSpec {
  const cwd = input.cwd ?? process.cwd();
  const execPath = input.execPath ?? process.execPath;
  const env = envWithTenant({
    ...(input.env ?? process.env),
    AINOVEL_SKIP_SERVER_ONLY: "1",
    AINOVEL_RUNNER_SESSION_ID: input.sessionId,
    AINOVEL_RUNNER_PROJECT_ID: input.projectId,
  });
  const fileExists = input.fileExists ?? existsSync;
  const builtEntry = join(cwd, "dist-worker", "run", "runner-main.js");
  const tsEntry = join(cwd, "src", "server", "run", "runner-main.ts");

  const args = fileExists(builtEntry)
    ? [builtEntry]
    : ["--import", "tsx", tsEntry];

  return {
    command: execPath,
    args,
    cwd,
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  };
}

export function buildCommitReconcilerLaunchSpec(input?: {
  cwd?: string;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
}): CommitReconcilerLaunchSpec {
  const cwd = input?.cwd ?? process.cwd();
  const execPath = input?.execPath ?? process.execPath;
  const env = envWithTenant({
    ...(input?.env ?? process.env),
    AINOVEL_SKIP_SERVER_ONLY: "1",
  });
  const fileExists = input?.fileExists ?? existsSync;
  const builtEntry = join(cwd, "dist-worker", "commit", "commit-reconciler-main.js");
  const tsEntry = join(cwd, "src", "server", "commit", "commit-reconciler-main.ts");
  const args = fileExists(builtEntry)
    ? [builtEntry]
    : ["--import", "tsx", tsEntry];

  return {
    command: execPath,
    args,
    cwd,
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  };
}

export function createLauncherService(input?: LauncherServiceOptions) {
  const spawnImpl = input?.spawnImpl ?? spawn;

  return {
    spawnRunner(sessionId: string, projectId: string) {
      try {
        const spec = buildRunnerLaunchSpec({
          sessionId,
          projectId,
          cwd: input?.cwd,
          execPath: input?.execPath,
          env: input?.env,
          fileExists: input?.fileExists,
        });
        const child = spawnImpl(spec.command, spec.args, {
          cwd: spec.cwd,
          detached: spec.detached,
          stdio: spec.stdio,
          env: spec.env,
          windowsHide: spec.windowsHide,
        });
        child.unref();
        return {
          pid: child.pid ?? null,
        };
      } catch {
        return {
          pid: null,
        };
      }
    },

    spawnCommitReconciler() {
      try {
        const spec = buildCommitReconcilerLaunchSpec({
          cwd: input?.cwd,
          execPath: input?.execPath,
          env: input?.env,
          fileExists: input?.fileExists,
        });
        const child = spawnImpl(spec.command, spec.args, {
          cwd: spec.cwd,
          detached: spec.detached,
          stdio: spec.stdio,
          env: spec.env,
          windowsHide: spec.windowsHide,
        });
        child.unref();
        return {
          pid: child.pid ?? null,
        };
      } catch {
        return {
          pid: null,
        };
      }
    },
  };
}
