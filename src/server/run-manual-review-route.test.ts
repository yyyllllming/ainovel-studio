import test from "node:test";
import assert from "node:assert/strict";
import { resolveManualReviewRequest } from "./run/manual-review-route.service.ts";

function createContext(chapterNo = "3") {
  return {
    params: Promise.resolve({
      projectId: "proj-manual",
      chapterNo,
    }),
  };
}

function createRequest(action: string) {
  return new Request("http://localhost/api/projects/proj-manual/chapters/3/manual-review", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
}

test("resolveManualReviewRequest approves and continues via the new restart helper", async () => {
  const calls: Array<string> = [];
  const payload = await resolveManualReviewRequest(
    createRequest("approve_continue"),
    createContext("3"),
    {
      getProject() {
        return {
          chapterPlanningMode: "fixed",
          targetChapters: 12,
          hardChapterCap: 12,
        } as never;
      },
      progressService: {
        getRunProgressView() {
          return {
            running: false,
            stage: "manual_review",
            currentChapter: 3,
            totalChapters: 12,
            retryCount: 0,
            confidence: 0,
            currentPosition: 0,
            wordCount: 0,
            stageDetails: {
              review: {
                mode: "deep",
                verdict: "manual_review_window",
                confidence: 0,
                retryCount: 0,
                earliestAffectedChapter: 3,
                triggerReasons: [],
              },
            },
            logs: [],
          };
        },
      },
      async autoPickVersionForManualReview() {
        throw new Error("should not auto-pick for approve_continue");
      },
      async rollbackVersion() {
        throw new Error("should not rollback for approve_continue");
      },
      async readFinalChapter() {
        return "chapter content";
      },
      async persistAcceptedChapterSignals(projectId, chapterNo) {
        calls.push(`persist:${projectId}:${chapterNo}`);
      },
      async finalizeProjectCompletion() {
        throw new Error("should not complete project in this scenario");
      },
      appendRunLog(_projectId, _level, message) {
        calls.push(`log:${message}`);
      },
      async restartRunFromChapter(input) {
        calls.push(`restart:${input.projectId}:${input.fromChapter}`);
        return {
          running: true,
          stage: "blueprint",
          currentChapter: input.fromChapter,
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
  ) as {
    currentChapter: number;
    running: boolean;
  };

  assert.deepEqual(calls, [
    "persist:proj-manual:3",
    "log:第 3 章已人工确认，继续生成第 4 章",
    "restart:proj-manual:4",
  ]);
  assert.equal(payload.currentChapter, 4);
  assert.equal(payload.running, true);
});

test("resolveManualReviewRequest retries an earlier review window through soft restart", async () => {
  const calls: Array<string> = [];
  const payload = await resolveManualReviewRequest(
    createRequest("retry_chapter"),
    createContext("5"),
    {
      getProject() {
        return {
          chapterPlanningMode: "fixed",
          targetChapters: 12,
          hardChapterCap: 12,
        } as never;
      },
      progressService: {
        getRunProgressView() {
          return {
            running: false,
            stage: "manual_review",
            currentChapter: 5,
            totalChapters: 12,
            retryCount: 0,
            confidence: 0,
            currentPosition: 0,
            wordCount: 0,
            error: "window mismatch",
            stageDetails: {
              review: {
                mode: "deep",
                earliestAffectedChapter: 3,
                confidence: 0,
                retryCount: 0,
                triggerReasons: [],
                verdict: "manual_review_window",
              },
            },
            logs: [],
          };
        },
      },
      async autoPickVersionForManualReview() {
        throw new Error("should not auto-pick for retry");
      },
      async rollbackVersion() {
        throw new Error("should not rollback for retry");
      },
      async readFinalChapter() {
        throw new Error("should not read final chapter for retry");
      },
      async persistAcceptedChapterSignals() {
        throw new Error("should not persist accepted signals for retry");
      },
      async finalizeProjectCompletion() {
        throw new Error("should not complete project for retry");
      },
      appendRunLog(_projectId, _level, message) {
        calls.push(`log:${message}`);
      },
      async restartRunFromChapter(input) {
        calls.push(`restart:${input.projectId}:${input.fromChapter}:${input.invalidationReason}`);
        return {
          running: true,
          stage: "blueprint",
          currentChapter: input.fromChapter,
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
  ) as {
    currentChapter: number;
    running: boolean;
  };

  assert.deepEqual(calls, [
    "log:根据深审窗口结论，从第 3 章起软失效并重新生成",
    "restart:proj-manual:3:深审窗口判定从第 3 章起的时间线失效，需整体重跑。",
  ]);
  assert.equal(payload.currentChapter, 3);
  assert.equal(payload.running, true);
});
