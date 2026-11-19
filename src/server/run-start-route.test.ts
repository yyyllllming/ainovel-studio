import test from "node:test";
import assert from "node:assert/strict";
import { conflict } from "./errors.ts";
import { resolveRunStartRequest } from "./run/start-route.service.ts";

function createContext(projectId = "proj-start") {
  return {
    params: Promise.resolve({ projectId }),
  };
}

function createRequest(body?: unknown) {
  return new Request("http://localhost/api/projects/proj-start/run/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

test("resolveRunStartRequest uses the new control plane and returns a compatible running payload", async () => {
  const controlCalls: Array<{ projectId: string; fromChapter: number }> = [];
  const payload = await resolveRunStartRequest(
    createRequest({ fromChapter: 99 }),
    createContext(),
    {
      controlService: {
        startOrResumeRun(params) {
          controlCalls.push(params);
          return {
            sessionId: "sess-start",
            projectId: params.projectId,
            sessionSeq: 1,
            restartOfSessionId: null,
            fromChapter: params.fromChapter,
            targetChapter: null,
            desiredState: "running",
            lifecycleStatus: "launching",
            pauseReason: null,
            stopReason: null,
            ownerToken: null,
            leaseEpoch: 0,
            ownerPid: null,
            ownerStartedAt: null,
            lastHeartbeatAt: null,
            leaseExpiresAt: null,
            launchNonce: "nonce",
            launchRequestedAt: "2026-01-01T00:00:00.000Z",
            launchStartedAt: null,
            currentChapter: null,
            currentStage: null,
            currentStepKey: null,
            configSnapshotId: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            startedAt: "2026-01-01T00:00:00.000Z",
            terminalAt: null,
            updatedAt: "2026-01-01T00:00:00.000Z",
          };
        },
      },
      progressService: {
        getRunProgressView() {
          return {
            running: false,
            stage: "idle",
            currentChapter: 1,
            totalChapters: 12,
            retryCount: 0,
            confidence: 0,
            currentPosition: 0,
            wordCount: 0,
            stageDetails: {},
            logs: [],
          };
        },
      },
      getProject() {
        return {
          hardChapterCap: 12,
        } as never;
      },
      getFoundation() {
        return {} as never;
      },
      isFoundationLocked() {
        return true;
      },
      getFoundationDriftReport() {
        return {
          coreDrift: false,
          blockingReason: null,
          workshopCoreFactsHash: "workshop",
          formalCoreFactsHash: "formal",
          differences: [],
        };
      },
    },
  );

  assert.deepEqual(controlCalls, [{ projectId: "proj-start", fromChapter: 12 }]);
  assert.equal(payload.running, true);
  assert.equal(payload.stage, "blueprint");
  assert.equal(payload.currentChapter, 12);
  assert.equal(payload.desiredState, "running");
  assert.equal(payload.sessionId, "sess-start");
  assert.equal(payload.lifecycleStatus, "launching");
});

test("resolveRunStartRequest surfaces global runner busy conflicts for the route wrapper", async () => {
  await assert.rejects(
    () =>
      resolveRunStartRequest(
        createRequest({ fromChapter: 3 }),
        createContext(),
        {
          controlService: {
            startOrResumeRun() {
              throw conflict("当前设备已有其他项目正在运行编排", {
                error: "global_runner_busy",
                activeSession: {
                  sessionId: "sess-busy",
                },
              });
            },
          },
          progressService: {
            getRunProgressView() {
              throw new Error("should not read progress when busy");
            },
          },
          getProject() {
            return {
              hardChapterCap: 20,
            } as never;
          },
          getFoundation() {
            return {} as never;
          },
          isFoundationLocked() {
            return true;
          },
          getFoundationDriftReport() {
            return {
              coreDrift: false,
              blockingReason: null,
              workshopCoreFactsHash: "workshop",
              formalCoreFactsHash: "formal",
              differences: [],
            };
          },
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, "当前设备已有其他项目正在运行编排");
      return true;
    },
  );
});

test("resolveRunStartRequest keeps foundation validation as a legacy-compatible preflight", async () => {
  await assert.rejects(
    () =>
      resolveRunStartRequest(
        createRequest({ fromChapter: 2 }),
        createContext(),
        {
          controlService: {
            startOrResumeRun() {
              throw new Error("should not start without locked foundation");
            },
          },
          progressService: {
            getRunProgressView() {
              throw new Error("should not read progress without locked foundation");
            },
          },
          getProject() {
            return {
              hardChapterCap: 20,
            } as never;
          },
          getFoundation() {
            return null;
          },
          isFoundationLocked() {
            return false;
          },
          getFoundationDriftReport() {
            return {
              coreDrift: false,
              blockingReason: null,
              workshopCoreFactsHash: "workshop",
              formalCoreFactsHash: "formal",
              differences: [],
            };
          },
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, "请先整理并锁定正式设定，再开始自动写作");
      return true;
    },
  );
});

test("resolveRunStartRequest blocks writing when canonical workshop state drifts from formal foundation", async () => {
  await assert.rejects(
    () =>
      resolveRunStartRequest(
        createRequest({ fromChapter: 2 }),
        createContext(),
        {
          controlService: {
            startOrResumeRun() {
              throw new Error("should not start with core drift");
            },
          },
          progressService: {
            getRunProgressView() {
              throw new Error("should not read progress with core drift");
            },
          },
          getProject() {
            return {
              hardChapterCap: 20,
            } as never;
          },
          getFoundation() {
            return {} as never;
          },
          isFoundationLocked() {
            return true;
          },
          getFoundationDriftReport() {
            return {
              coreDrift: true,
              blockingReason: "检测到设定工坊中的核心事实尚未整理为正式设定，请先整理正式设定后再开始自动写作。",
              workshopCoreFactsHash: "workshop",
              formalCoreFactsHash: "formal",
              differences: ["mainline"],
            };
          },
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.match((error as Error).message, /请先整理正式设定/);
      return true;
    },
  );
});
