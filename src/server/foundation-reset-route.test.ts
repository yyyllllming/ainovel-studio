import test from "node:test";
import assert from "node:assert/strict";
import { resolveFoundationResetRequest } from "./foundation-reset-route.service.ts";

function createContext(projectId = "proj-reset") {
  return {
    params: Promise.resolve({ projectId }),
  };
}

function createRequest() {
  return new Request("http://localhost/api/projects/proj-reset/foundation/reset", {
    method: "POST",
  });
}

test("resolveFoundationResetRequest validates params and returns refreshed progress payload", async () => {
  const calls: string[] = [];
  const payload = await resolveFoundationResetRequest(
    createRequest(),
    createContext(),
    {
      foundationResetService: {
        resetProjectToFoundationWorkshop(projectId) {
          calls.push(projectId);
          return Promise.resolve({
            running: false,
            stage: "idle",
            currentChapter: 1,
            totalChapters: 50,
            retryCount: 0,
            confidence: 0,
            currentPosition: 0,
            wordCount: 0,
            desiredState: "idle",
            stageDetails: {},
            logs: [],
          });
        },
      },
    },
  );

  assert.deepEqual(calls, ["proj-reset"]);
  assert.equal(payload.stage, "idle");
  assert.equal(payload.currentChapter, 1);
  assert.equal(payload.desiredState, "idle");
});

test("resolveFoundationResetRequest rejects invalid project ids before touching the service", async () => {
  let called = false;

  await assert.rejects(
    () =>
      resolveFoundationResetRequest(
        createRequest(),
        createContext("../bad-id"),
        {
          foundationResetService: {
            resetProjectToFoundationWorkshop() {
              called = true;
              return Promise.reject(new Error("should not be called"));
            },
          },
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.match((error as Error).message, /projectId 不合法/);
      assert.equal(called, false);
      return true;
    },
  );
});
