import test from "node:test";
import assert from "node:assert/strict";
import { parseRunnerInvocation, runRunnerMain, shouldRunRunnerCli } from "./run/runner-main.ts";

function createEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...overrides,
  };
}

test("parseRunnerInvocation reads the session and project from environment variables", () => {
  const invocation = parseRunnerInvocation(createEnv({
    AINOVEL_RUNNER_SESSION_ID: "session-a",
    AINOVEL_RUNNER_PROJECT_ID: "project-a",
  }));

  assert.deepEqual(invocation, {
    sessionId: "session-a",
    projectId: "project-a",
  });
});

test("shouldRunRunnerCli only enables the detached runner entrypoint for runner-main files", () => {
  assert.equal(shouldRunRunnerCli(["node", "src/server/run/runner-main.ts"]), true);
  assert.equal(shouldRunRunnerCli(["node", "dist-worker/runner-main.js"]), true);
  assert.equal(shouldRunRunnerCli(["node", "src/server/runner-main.test.ts"]), false);
  assert.equal(shouldRunRunnerCli(["node"]), false);
});

test("runRunnerMain delegates to the orchestrator when invocation is valid", async () => {
  const calls: Array<{ sessionId: string; projectId: string }> = [];

  const exitCode = await runRunnerMain({
    env: createEnv({
      AINOVEL_RUNNER_SESSION_ID: "session-a",
      AINOVEL_RUNNER_PROJECT_ID: "project-a",
    }),
    orchestrator: {
      async runSession(sessionId, projectId) {
        calls.push({ sessionId, projectId });
      },
    },
    logError() {
      throw new Error("logError should not be called");
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      sessionId: "session-a",
      projectId: "project-a",
    },
  ]);
});

test("runRunnerMain returns a non-zero exit code when required identifiers are missing", async () => {
  const errors: string[] = [];

  const exitCode = await runRunnerMain({
    env: createEnv(),
    orchestrator: {
      async runSession() {
        throw new Error("runSession should not be called");
      },
    },
    logError(error) {
      errors.push(error instanceof Error ? error.message : String(error));
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(errors.length, 1);
});

test("runRunnerMain returns a non-zero exit code when the orchestrator throws", async () => {
  const errors: string[] = [];

  const exitCode = await runRunnerMain({
    env: createEnv({
      AINOVEL_RUNNER_SESSION_ID: "session-a",
      AINOVEL_RUNNER_PROJECT_ID: "project-a",
    }),
    orchestrator: {
      async runSession() {
        throw new Error("orchestrator failed");
      },
    },
    logError(error) {
      errors.push(error instanceof Error ? error.message : String(error));
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(errors, ["orchestrator failed"]);
});
