import test from "node:test";
import assert from "node:assert/strict";
import { restartRunFromChapter } from "./run/restart-run.service.ts";

test("restartRunFromChapter invalidates first and then resumes through the new control plane", async () => {
  const calls: string[] = [];
  const payload = await restartRunFromChapter(
    {
      projectId: "proj-restart",
      fromChapter: 8,
      invalidationReason: "manual review retry",
      reviewReason: "deep review failed",
    },
    {
      controlService: {
        startOrResumeRun(params) {
          calls.push(`start:${params.projectId}:${params.fromChapter}`);
          return {
            sessionId: "sess-restart",
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
      async softInvalidateChapterRange(projectId, input) {
        calls.push(`invalidate:${projectId}:${input.fromChapter}:${input.reason}:${input.reviewReason}`);
        return {
          startChapter: input.fromChapter,
          endChapter: input.fromChapter,
          invalidatedChapters: [input.fromChapter],
        };
      },
    },
  );

  assert.deepEqual(calls, [
    "invalidate:proj-restart:8:manual review retry:deep review failed",
    "start:proj-restart:8",
  ]);
  assert.equal(payload.running, true);
  assert.equal(payload.stage, "blueprint");
  assert.equal(payload.currentChapter, 8);
  assert.equal(payload.sessionId, "sess-restart");
});
