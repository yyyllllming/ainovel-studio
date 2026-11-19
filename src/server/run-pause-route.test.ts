import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunPauseRequest } from "./run/pause-route.service.ts";

function createContext(projectId = "proj-pause") {
  return {
    params: Promise.resolve({ projectId }),
  };
}

function createRequest() {
  return new Request("http://localhost/api/projects/proj-pause/run/pause", {
    method: "POST",
  });
}

test("resolveRunPauseRequest returns a paused-compatible payload from the new control plane", async () => {
  const payload = await resolveRunPauseRequest(
    createRequest(),
    createContext(),
    {
      controlService: {
        pauseRun() {
          return {
            sessionId: "sess-pause",
            projectId: "proj-pause",
            sessionSeq: 1,
            restartOfSessionId: null,
            fromChapter: 5,
            targetChapter: null,
            desiredState: "running",
            lifecycleStatus: "paused",
            pauseReason: "manual pause",
            stopReason: null,
            ownerToken: null,
            leaseEpoch: 1,
            ownerPid: null,
            ownerStartedAt: null,
            lastHeartbeatAt: null,
            leaseExpiresAt: null,
            launchNonce: "nonce",
            launchRequestedAt: "2026-01-01T00:00:00.000Z",
            launchStartedAt: null,
            currentChapter: 5,
            currentStage: "writing",
            currentStepKey: "chapter.draft_generated",
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
            running: true,
            stage: "writing",
            currentChapter: 5,
            totalChapters: 12,
            retryCount: 0,
            confidence: 0,
            currentPosition: 1800,
            wordCount: 2100,
            stageDetails: {},
            logs: [],
          };
        },
      },
    },
  );

  assert.equal(payload.running, false);
  assert.equal(payload.stage, "paused");
  assert.equal(payload.desiredState, "paused");
  assert.equal(payload.currentChapter, 5);
  assert.equal(payload.sessionId, "sess-pause");
});

