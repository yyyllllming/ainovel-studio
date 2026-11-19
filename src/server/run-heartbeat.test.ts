import test from "node:test";
import assert from "node:assert/strict";
import { runWithHeartbeat } from "./run/run-heartbeat.ts";

test("runWithHeartbeat keeps touching while a long task is pending", async () => {
  let touches = 0;

  const result = await runWithHeartbeat(
    () => new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 70);
    }),
    () => {
      touches += 1;
    },
    { intervalMs: 15 },
  );

  assert.equal(result, "done");
  assert.ok(touches >= 2);
});

test("runWithHeartbeat stops after the task resolves", async () => {
  let touches = 0;

  await runWithHeartbeat(
    () => new Promise<void>((resolve) => {
      setTimeout(resolve, 35);
    }),
    () => {
      touches += 1;
    },
    { intervalMs: 10 },
  );

  const settledTouches = touches;
  await new Promise((resolve) => {
    setTimeout(resolve, 40);
  });

  assert.equal(touches, settledTouches);
});

test("runWithHeartbeat reports synchronous touch errors without failing the task", async () => {
  const errors: string[] = [];

  const result = await runWithHeartbeat(
    () => new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 35);
    }),
    () => {
      throw new Error("sync heartbeat failed");
    },
    {
      intervalMs: 10,
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    },
  );

  assert.equal(result, "done");
  assert.ok(errors.length >= 1);
  assert.equal(errors.every((entry) => entry === "sync heartbeat failed"), true);
});

test("runWithHeartbeat reports async touch rejections without failing the task", async () => {
  const errors: string[] = [];
  let attempts = 0;

  const result = await runWithHeartbeat(
    () => new Promise<string>((resolve) => {
      setTimeout(() => resolve("done"), 40);
    }),
    async () => {
      attempts += 1;
      throw new Error("async heartbeat failed");
    },
    {
      intervalMs: 10,
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error));
      },
    },
  );

  assert.equal(result, "done");
  assert.ok(attempts >= 1);
  assert.equal(errors.length, attempts);
  assert.equal(errors.every((entry) => entry === "async heartbeat failed"), true);
});
