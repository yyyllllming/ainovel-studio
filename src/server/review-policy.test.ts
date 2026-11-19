import test from "node:test";
import assert from "node:assert/strict";
import { buildDefaultRuntimeReviewSignals } from "./story/story-progression.ts";
import {
  buildReviewCharterPromptContract,
  decideDeepReview,
  decideMandatoryDeepReview,
  getDefaultCadenceForStoryLength,
  getDefaultDeepReviewStartChapterForStoryLength,
  getReviewWindowStartChapter,
  resolveReviewPolicy,
} from "./run/review-policy.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";
import type { ChapterReviewState, QuickAuditVerdict } from "./types.ts";

function createQuickAudit(overrides: Partial<QuickAuditVerdict> = {}): QuickAuditVerdict {
  const runtimeSignals = buildDefaultRuntimeReviewSignals(null);
  return {
    reviewMode: "quick",
    verdict: "pass",
    confidence: 0.82,
    reason: "通过",
    fixInstructions: "无需修改",
    issues: [],
    triggerReasons: [],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: runtimeSignals.storyProgression,
    genreFulfillment: runtimeSignals.genreFulfillment,
    loopRisk: runtimeSignals.loopRisk,
    primaryDeltaDelivered: runtimeSignals.primaryDeltaDelivered,
    stuckDimensions: runtimeSignals.stuckDimensions,
    ...overrides,
  };
}

test("resolveReviewPolicy uses story-length presets and keeps manual checkpoints sorted", () => {
  assert.equal(getDefaultCadenceForStoryLength("short"), 1);
  assert.equal(getDefaultCadenceForStoryLength("medium"), 3);
  assert.equal(getDefaultCadenceForStoryLength("long"), 4);
  assert.equal(getDefaultDeepReviewStartChapterForStoryLength("short"), 1);
  assert.equal(getDefaultDeepReviewStartChapterForStoryLength("medium"), 1);
  assert.equal(getDefaultDeepReviewStartChapterForStoryLength("long"), 1);

  const resolved = resolveReviewPolicy("long", {
    manualCheckpointChapters: [8, 3, 8, -1],
  });

  assert.deepEqual(resolved.manualCheckpointChapters, [3, 8]);
  assert.equal(resolved.cadenceChapters, 4);
  assert.equal(resolved.deepReviewStartChapter, 1);
  assert.equal(resolved.perChapterCheckMode, "minimal");
});

test("decideDeepReview forces deep review across opening chapters", () => {
  const policy = resolveReviewPolicy("medium", {
    manualCheckpointChapters: [4],
  });

  assert.deepEqual(decideDeepReview({
    chapterNo: 3,
    totalChapters: 18,
    policy,
    quickAudit: createQuickAudit(),
    hasHardConflict: false,
    hasMajorProgression: false,
  }), {
    shouldDeepReview: true,
    triggerReasons: ["opening_window"],
  });
});

test("decideMandatoryDeepReview covers opening, mid, and cadence windows before Quick Review", () => {
  const policy = resolveReviewPolicy("long");

  for (const chapterNo of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    const decision = decideMandatoryDeepReview({
      chapterNo,
      totalChapters: 80,
      policy,
      isCompletionCandidate: false,
    });
    assert.equal(decision.shouldDeepReview, true, `第 ${chapterNo} 章应强制深审`);
  }
});

test("decideDeepReview uses high-frequency/risk-based checks across chapters 7-12", () => {
  const policy = resolveReviewPolicy("medium", {
    manualCheckpointChapters: [8],
  });

  const cadenceMid = decideDeepReview({
    chapterNo: 8,
    totalChapters: 18,
    policy,
    quickAudit: createQuickAudit(),
    hasHardConflict: false,
    hasMajorProgression: false,
  });

  assert.deepEqual(cadenceMid, {
    shouldDeepReview: true,
    triggerReasons: ["manual_checkpoint", "mid_window"],
  });

  const riskMid = decideDeepReview({
    chapterNo: 9,
    totalChapters: 18,
    policy,
    quickAudit: createQuickAudit({
      verdict: "escalate",
      confidence: 0.41,
    }),
    hasHardConflict: false,
    hasMajorProgression: true,
  });

  assert.equal(riskMid.shouldDeepReview, true);
  assert.equal(riskMid.triggerReasons.includes("low_confidence"), true);
  assert.equal(riskMid.triggerReasons.includes("major_progression"), true);
});

test("decideDeepReview resumes cadence and low-confidence triggers after chapter 12", () => {
  const policy = resolveReviewPolicy("long");

  const cadenceReview = decideDeepReview({
    chapterNo: 16,
    totalChapters: 40,
    policy,
    quickAudit: createQuickAudit(),
    hasHardConflict: false,
    hasMajorProgression: false,
  });
  assert.deepEqual(cadenceReview, {
    shouldDeepReview: true,
    triggerReasons: ["cadence"],
  });

  const lowConfidenceReview = decideDeepReview({
    chapterNo: 17,
    totalChapters: 40,
    policy,
    quickAudit: createQuickAudit({
      verdict: "escalate",
      confidence: 0.41,
    }),
    hasHardConflict: false,
    hasMajorProgression: true,
  });
  assert.equal(lowConfidenceReview.triggerReasons.includes("low_confidence"), true);
  assert.equal(lowConfidenceReview.triggerReasons.includes("major_progression"), true);

  const finalChapter = decideDeepReview({
    chapterNo: 40,
    totalChapters: 40,
    policy,
    quickAudit: createQuickAudit(),
    hasHardConflict: false,
    hasMajorProgression: false,
  });
  assert.equal(finalChapter.triggerReasons.includes("final_chapter"), true);
});

test("getReviewWindowStartChapter reopens from the chapter after the latest deep lock", () => {
  const states: ChapterReviewState[] = [
    {
      projectId: "p1",
      chapterNo: 1,
      status: "deep_locked",
      quickCheckedAt: null,
      deepCheckedAt: "2026-03-20T00:00:00.000Z",
      openWindowId: "window-1",
      lastReviewMode: "deep",
      latestConfidence: 0.9,
      earliestAffectedChapter: null,
      updatedAt: "2026-03-20T00:00:00.000Z",
    },
    {
      projectId: "p1",
      chapterNo: 2,
      status: "provisional",
      quickCheckedAt: "2026-03-20T00:01:00.000Z",
      deepCheckedAt: null,
      openWindowId: "window-2",
      lastReviewMode: "quick",
      latestConfidence: 0.71,
      earliestAffectedChapter: null,
      updatedAt: "2026-03-20T00:01:00.000Z",
    },
  ];

  assert.equal(getReviewWindowStartChapter(states, 4), 2);
  assert.equal(getReviewWindowStartChapter([], 4), 1);
});

test("buildReviewCharterPromptContract forces reviewer prompts to reuse the same charter terms", () => {
  const contract = buildReviewCharterPromptContract({
    mode: "deep",
    writingCharter: createDefaultStyleProfile().writingCharter!,
  }).join("\n");

  assert.match(contract, /章末策略/);
  assert.match(contract, /机制露出策略/);
  assert.match(contract, /转场预算/);
  assert.match(contract, /比喻预算/);
  assert.match(contract, /主体起句预算/);
  assert.match(contract, /母题复用预算/);
  assert.match(contract, /charterViolations/);
});
