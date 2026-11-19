import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCommitReconcilerLaunchSpec,
  buildRunnerLaunchSpec,
  createLauncherService,
} from "./run/launcher.service.ts";

function createEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...overrides,
  };
}

test("buildRunnerLaunchSpec uses the tsx entry in development when no built worker exists", () => {
  const spec = buildRunnerLaunchSpec({
    sessionId: "session-a",
    projectId: "project-a",
    cwd: "D:\\ainote\\ainovel-cli\\platform",
    execPath: "node",
    env: createEnv(),
    fileExists: () => false,
  });

  assert.equal(spec.command, "node");
  assert.deepEqual(spec.args, [
    "--import",
    "tsx",
    "D:\\ainote\\ainovel-cli\\platform\\src\\server\\run\\runner-main.ts",
  ]);
  assert.equal(spec.env.AINOVEL_SKIP_SERVER_ONLY, "1");
  assert.equal(spec.env.AINOVEL_RUNNER_SESSION_ID, "session-a");
  assert.equal(spec.env.AINOVEL_RUNNER_PROJECT_ID, "project-a");
  assert.equal(spec.detached, true);
  assert.equal(spec.stdio, "ignore");
});

test("buildRunnerLaunchSpec prefers the built worker entry when it exists", () => {
  const spec = buildRunnerLaunchSpec({
    sessionId: "session-a",
    projectId: "project-a",
    cwd: "D:\\ainote\\ainovel-cli\\platform",
    execPath: "node",
    env: createEnv(),
    fileExists: (path) => path.endsWith("dist-worker\\run\\runner-main.js"),
  });

  assert.equal(spec.command, "node");
  assert.deepEqual(spec.args, [
    "D:\\ainote\\ainovel-cli\\platform\\dist-worker\\run\\runner-main.js",
  ]);
});

test("spawnRunner is best-effort and passes detached child options through to spawn", () => {
  const calls: Array<{
    command: string;
    args: string[];
    options: Record<string, unknown>;
    unrefCalled: boolean;
  }> = [];

  const launcher = createLauncherService({
    cwd: "D:\\ainote\\ainovel-cli\\platform",
    execPath: "node",
    env: createEnv(),
    fileExists: () => false,
    spawnImpl(command, args, options) {
      const call = {
        command,
        args,
        options: options as Record<string, unknown>,
        unrefCalled: false,
      };
      calls.push(call);
      return {
        pid: 4321,
        unref() {
          call.unrefCalled = true;
        },
      };
    },
  });

  const result = launcher.spawnRunner("session-a", "project-a");

  assert.equal(result.pid, 4321);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.options.detached, true);
  assert.equal(calls[0]?.options.stdio, "ignore");
  assert.equal(calls[0]?.options.windowsHide, true);
  assert.equal(calls[0]?.unrefCalled, true);
});

test("spawnRunner returns null pid when spawning fails", () => {
  const launcher = createLauncherService({
    cwd: "D:\\ainote\\ainovel-cli\\platform",
    execPath: "node",
    env: createEnv(),
    fileExists: () => false,
    spawnImpl() {
      throw new Error("spawn failed");
    },
  });

  const result = launcher.spawnRunner("session-a", "project-a");
  assert.equal(result.pid, null);
});

test("buildCommitReconcilerLaunchSpec uses the tsx entry in development when no built worker exists", () => {
  const spec = buildCommitReconcilerLaunchSpec({
    cwd: "D:\\ainote\\ainovel-cli\\platform",
    execPath: "node",
    env: createEnv(),
    fileExists: () => false,
  });

  assert.equal(spec.command, "node");
  assert.deepEqual(spec.args, [
    "--import",
    "tsx",
    "D:\\ainote\\ainovel-cli\\platform\\src\\server\\commit\\commit-reconciler-main.ts",
  ]);
  assert.equal(spec.env.AINOVEL_SKIP_SERVER_ONLY, "1");
});

test("spawnCommitReconciler is best-effort and passes detached child options through to spawn", () => {
  const calls: Array<{
    command: string;
    args: string[];
    options: Record<string, unknown>;
    unrefCalled: boolean;
  }> = [];

  const launcher = createLauncherService({
    cwd: "D:\\ainote\\ainovel-cli\\platform",
    execPath: "node",
    env: createEnv(),
    fileExists: () => false,
    spawnImpl(command, args, options) {
      const call = {
        command,
        args,
        options: options as Record<string, unknown>,
        unrefCalled: false,
      };
      calls.push(call);
      return {
        pid: 8765,
        unref() {
          call.unrefCalled = true;
        },
      };
    },
  });

  const result = launcher.spawnCommitReconciler();

  assert.equal(result.pid, 8765);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.args.at(-1), "D:\\ainote\\ainovel-cli\\platform\\src\\server\\commit\\commit-reconciler-main.ts");
  assert.equal(calls[0]?.options.detached, true);
  assert.equal(calls[0]?.options.stdio, "ignore");
  assert.equal(calls[0]?.unrefCalled, true);
});
