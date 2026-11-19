import test from "node:test";
import assert from "node:assert/strict";
import { resolveRunResumeRequest } from "./run/resume-route.service.ts";

function createContext(projectId = "proj-resume") {
  return {
    params: Promise.resolve({ projectId }),
  };
}

function createRequest() {
  return new Request("http://localhost/api/projects/proj-resume/run/resume", {
    method: "POST",
  });
}

test("resolveRunResumeRequest resumes a paused open session through the new control plane", async () => {
  const controlCalls: Array<{ projectId: string; fromChapter: number }> = [];
  const payload = await resolveRunResumeRequest(
    createRequest(),
    createContext(),
    {
      controlService: {
        startOrResumeRun(params) {
          controlCalls.push(params);
          return {
            sessionId: "sess-paused",
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
            leaseEpoch: 1,
            ownerPid: null,
            ownerStartedAt: null,
            lastHeartbeatAt: null,
            leaseExpiresAt: null,
            launchNonce: "nonce",
            launchRequestedAt: "2026-01-01T00:00:00.000Z",
            launchStartedAt: null,
            currentChapter: 7,
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
            running: false,
            stage: "paused",
            currentChapter: 7,
            totalChapters: 12,
            retryCount: 0,
            confidence: 0,
            currentPosition: 4000,
            wordCount: 2100,
            stageDetails: {
              lifecycle: {
                lastActiveStage: "writing",
              },
            },
            lastActiveStage: "writing",
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
      getOpenSessionByProjectId() {
        return {
          sessionId: "sess-paused",
          projectId: "proj-resume",
          sessionSeq: 1,
          restartOfSessionId: null,
          fromChapter: 7,
          targetChapter: null,
          desiredState: "running",
          lifecycleStatus: "paused",
          pauseReason: "manual",
          stopReason: null,
          ownerToken: null,
          leaseEpoch: 1,
          ownerPid: null,
          ownerStartedAt: null,
          lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
          leaseExpiresAt: "2026-01-01T00:01:00.000Z",
          launchNonce: "nonce",
          launchRequestedAt: "2026-01-01T00:00:00.000Z",
          launchStartedAt: "2026-01-01T00:00:01.000Z",
          currentChapter: 7,
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
  );

  assert.deepEqual(controlCalls, [{ projectId: "proj-resume", fromChapter: 7 }]);
  assert.equal(payload.running, true);
  assert.equal(payload.stage, "writing");
  assert.equal(payload.currentChapter, 7);
  assert.equal(payload.desiredState, "running");
  assert.equal(payload.sessionId, "sess-paused");
  assert.equal(payload.lifecycleStatus, "launching");
});

test("resolveRunResumeRequest falls back to the session-owned run_state chapter when current_chapter is unset", async () => {
  const controlCalls: Array<{ projectId: string; fromChapter: number }> = [];

  await resolveRunResumeRequest(
    createRequest(),
    createContext(),
    {
      controlService: {
        startOrResumeRun(params) {
          controlCalls.push(params);
          return {
            sessionId: "sess-legacy",
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
            leaseEpoch: 1,
            ownerPid: null,
            ownerStartedAt: null,
            lastHeartbeatAt: null,
            leaseExpiresAt: null,
            launchNonce: "nonce",
            launchRequestedAt: "2026-01-01T00:00:00.000Z",
            launchStartedAt: null,
            currentChapter: params.fromChapter,
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
            stage: "paused",
            currentChapter: 42,
            totalChapters: 60,
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
          hardChapterCap: 60,
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
      getOpenSessionByProjectId() {
        return {
          sessionId: "sess-legacy",
          projectId: "proj-resume",
          sessionSeq: 1,
          restartOfSessionId: null,
          fromChapter: 1,
          targetChapter: null,
          desiredState: "running",
          lifecycleStatus: "paused",
          pauseReason: "manual",
          stopReason: null,
          ownerToken: null,
          leaseEpoch: 1,
          ownerPid: null,
          ownerStartedAt: null,
          lastHeartbeatAt: null,
          leaseExpiresAt: null,
          launchNonce: null,
          launchRequestedAt: null,
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
      getRunState() {
        return {
          runSessionId: "sess-legacy",
          currentChapter: 42,
        } as never;
      },
    },
  );

  // The real progress (run_state) wins over the session's original from_chapter.
  assert.deepEqual(controlCalls, [{ projectId: "proj-resume", fromChapter: 42 }]);
});

test("resolveRunResumeRequest rejects when there is no resumable open session", async () => {
  await assert.rejects(
    () =>
      resolveRunResumeRequest(
        createRequest(),
        createContext(),
        {
          controlService: {
            startOrResumeRun() {
              throw new Error("should not start without resumable state");
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
          getOpenSessionByProjectId() {
            return null;
          },
        },
      ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, "没有可恢复的运行会话");
      return true;
    },
  );
});
