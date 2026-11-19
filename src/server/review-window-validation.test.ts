import test from "node:test";
import assert from "node:assert/strict";
import { validateEarliestAffectedChapter } from "./run/chapter-review.ts";
import type { DeepReviewVerdict } from "./types.ts";

function review(earliestAffectedChapter: number | null): DeepReviewVerdict {
  return {
    reviewMode: "deep",
    verdict: "rewrite_current",
    confidence: 0.8,
    reason: "需要返修",
    fixInstructions: "修正连续性",
    issues: [],
    triggerReasons: ["cadence"],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: {
      risk: "watch",
      score: 70,
      summary: "存在风险",
      advancements: [],
      stallSignals: [],
      primaryDelta: null,
      deliveredDeltas: [],
    },
    genreFulfillment: null,
    loopRisk: {
      risk: "watch",
      score: 70,
      summary: "存在风险",
      repetitionAxes: [],
      stuckDimensions: [],
    },
    primaryDeltaDelivered: null,
    stuckDimensions: [],
    windowStartChapter: 5,
    windowEndChapter: 8,
    earliestAffectedChapter,
  };
}

test("validateEarliestAffectedChapter preserves an in-window restart point", () => {
  const result = validateEarliestAffectedChapter(review(6), 5, 8);
  assert.equal(result.earliestAffectedChapter, 6);
  assert.equal(result.verdict, "rewrite_current");
  assert.equal(result.issues.length, 0);
});

test("validateEarliestAffectedChapter rejects a restart before the reviewed window", () => {
  const result = validateEarliestAffectedChapter(review(4), 5, 8);
  assert.equal(result.earliestAffectedChapter, null);
  assert.equal(result.verdict, "manual_review_window");
  assert.equal(result.issues.some((issue) => issue.type === "invalid_review_window" && issue.severity === "major"), true);
});

test("validateEarliestAffectedChapter rejects a restart after the reviewed window", () => {
  const result = validateEarliestAffectedChapter(review(9), 5, 8);
  assert.equal(result.earliestAffectedChapter, null);
  assert.equal(result.verdict, "manual_review_window");
  assert.equal(result.issues.some((issue) => issue.type === "invalid_review_window"), true);
});
