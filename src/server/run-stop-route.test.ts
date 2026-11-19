import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunStopRequest } from "./run/stop-route.service.ts";

function createContext(projectId = "proj-stop") {
  return {
    params: Promise.resolve({ projectId }),
  };
}

function createRequest() {
  return new Request("http://localhost/api/projects/proj-stop/run/stop", {
    method: "POST",
  });
}

test("resolveRunStopRequest returns a stopping-compatible payload from the new control plane", async () => {
  const payload = await resolveRunStopRequest(
    createRequest(),
    createContext(),
    {
      controlService: {
        stopRun() {
          return {
            sessionId: "sess-stop",
            projectId: "proj-stop",
            sessionSeq: 1,
            restartOfSessionId: null,
            fromChapter: 6,
            targetChapter: null,
            desiredState: "stop_requested",
            lifecycleStatus: "running",
            pauseReason: null,
            stopReason: "manual stop",
            ownerToken: "owner-a",
            leaseEpoch: 4,
            ownerPid: 123,
            ownerStartedAt: "2026-01-01T00:00:00.000Z",
            lastHeartbeatAt: "2026-01-01T00:00:05.000Z",
            leaseExpiresAt: "2026-01-01T00:01:00.000Z",
            launchNonce: "nonce",
            launchRequestedAt: "2026-01-01T00:00:00.000Z",
            launchStartedAt: "2026-01-01T00:00:01.000Z",
            currentChapter: 6,
            currentStage: "review",
            currentStepKey: "chapter.review_passed",
            configSnapshotId: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            startedAt: "2026-01-01T00:00:00.000Z",
            terminalAt: null,
            updatedAt: "2026-01-01T00:00:05.000Z",
          };
        },
      },
      progressService: {
        getRunProgressView() {
          return {
            running: true,
            stage: "review",
            currentChapter: 6,
            totalChapters: 12,
            retryCount: 0,
            confidence: 0,
            currentPosition: 0,
            wordCount: 2300,
            stageDetails: {},
            logs: [],
          };
        },
      },
    },
  );

  assert.equal(payload.running, true);
  assert.equal(payload.stage, "review");
  assert.equal(payload.desiredState, "stopped");
  assert.equal(payload.currentChapter, 6);
  assert.equal(payload.sessionId, "sess-stop");
});
