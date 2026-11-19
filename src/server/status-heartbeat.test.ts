import test from "node:test";
import assert from "node:assert/strict";

import { startStatusHeartbeat } from "./status-heartbeat.ts";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs: number) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt >= timeoutMs) {
      break;
    }
    await sleep(10);
  }
}

test("startStatusHeartbeat emits repeated status events until it is stopped", async () => {
  const events: Array<Record<string, unknown>> = [];
  const stop = startStatusHeartbeat(
    async (event) => {
      events.push(event);
    },
    {
      type: "status",
      stage: "draft_sync",
      progress: 96,
      message: "正在同步共创草案和下一步焦点。",
    },
    15,
  );

  await waitFor(() => events.length >= 2, 1000);
  stop();
  const countAtStop = events.length;
  await sleep(40);

  assert.ok(countAtStop >= 2);
  assert.equal(events.length, countAtStop);
  for (const event of events) {
    assert.equal(event.stage, "draft_sync");
    assert.equal(event.progress, 96);
  }
});
