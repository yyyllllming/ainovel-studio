import test from "node:test";
import assert from "node:assert/strict";
import {
  pickFallbackVersionForAutoReview,
  resolveManualReviewAction,
  shouldAutoPickVersionOnLowConfidence,
  shouldAutoRestartWindowReview,
} from "./run/manual-review.ts";

test("resolveManualReviewAction advances to the next chapter after approval", () => {
  assert.deepEqual(
    resolveManualReviewAction({
      action: "approve_continue",
      chapterNo: 2,
      totalChapters: 5,
    }),
    {
      restartFromChapter: 3,
      completesProject: false,
    },
  );
});

test("resolveManualReviewAction completes the project when approving the final chapter", () => {
  assert.deepEqual(
    resolveManualReviewAction({
      action: "approve_continue",
      chapterNo: 5,
      totalChapters: 5,
    }),
    {
      restartFromChapter: null,
      completesProject: true,
    },
  );
});

test("resolveManualReviewAction can complete a dynamic project before hitting the hard cap", () => {
  assert.deepEqual(
    resolveManualReviewAction({
      action: "approve_continue",
      chapterNo: 8,
      totalChapters: 20,
      shouldCompleteOnApproval: true,
    }),
    {
      restartFromChapter: null,
      completesProject: true,
    },
  );
});

test("resolveManualReviewAction restarts the same chapter when retrying", () => {
  assert.deepEqual(
    resolveManualReviewAction({
      action: "retry_chapter",
      chapterNo: 3,
      totalChapters: 5,
    }),
    {
      restartFromChapter: 3,
      completesProject: false,
    },
  );
});

test("resolveManualReviewAction treats auto pick like approval and advances", () => {
  assert.deepEqual(
    resolveManualReviewAction({
      action: "auto_pick_version",
      chapterNo: 1,
      totalChapters: 3,
    }),
    {
      restartFromChapter: 2,
      completesProject: false,
    },
  );
});

test("pickFallbackVersionForAutoReview prefers the lowest-temperature stable candidate", () => {
  assert.equal(
    pickFallbackVersionForAutoReview([
      { id: "v3", versionNo: 3, temperature: 1.1 },
      { id: "v1", versionNo: 1, temperature: 0.7 },
      { id: "v2", versionNo: 2, temperature: 0.9 },
    ])?.id,
    "v1",
  );
});

test("shouldAutoRestartWindowReview allows automatic restart for earlier-window issues within budget", () => {
  assert.equal(
    shouldAutoRestartWindowReview({
      chapterNo: 5,
      earliestAffectedChapter: 2,
      previousAutoRestarts: 1,
    }),
    true,
  );
});

test("shouldAutoRestartWindowReview stops auto restart after the retry budget is exhausted", () => {
  assert.equal(
    shouldAutoRestartWindowReview({
      chapterNo: 5,
      earliestAffectedChapter: 2,
      previousAutoRestarts: 2,
    }),
    false,
  );
});

test("shouldAutoPickVersionOnLowConfidence enables one automatic best-version pass", () => {
  assert.equal(
    shouldAutoPickVersionOnLowConfidence({
      confidence: 0.52,
      chapterNo: 4,
      earliestAffectedChapter: 4,
      previousAutoPickAttempts: 0,
    }),
    true,
  );
});

test("shouldAutoPickVersionOnLowConfidence does not re-auto-pick repeatedly", () => {
  assert.equal(
    shouldAutoPickVersionOnLowConfidence({
      confidence: 0.48,
      chapterNo: 4,
      earliestAffectedChapter: 4,
      previousAutoPickAttempts: 1,
    }),
    false,
  );
});
