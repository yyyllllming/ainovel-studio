import test from "node:test";
import assert from "node:assert/strict";
import { buildDefaultRuntimeReviewSignals } from "./story/story-progression.ts";
import {
  classifyReviewFailureCategory,
  classifyReviewRepairPath,
  hasBlockingContextConflicts,
  resolveDeepReviewOutcome,
  shouldFallbackAfterAutoProseRescueFailure,
  shouldRewriteAfterQuickAudit,
  shouldInvokeDeepReview,
  shouldInvokeLlmStyleRescue,
  shouldInvokeQuickAudit,
  shouldInvokeStyleRescue,
} from "./run/run-decisions.ts";
import { assessProseStyleRisk } from "./writing/prose-normalizer.ts";
import { resolveReviewPolicy } from "./run/review-policy.ts";
import type { ConflictRecord, QuickAuditVerdict, ReviewVerdict } from "./types.ts";

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

function createDeepReview(overrides: Partial<ReviewVerdict> = {}): ReviewVerdict {
  const runtimeSignals = buildDefaultRuntimeReviewSignals(null);
  return {
    reviewMode: "deep",
    verdict: "rewrite_current",
    confidence: 0.72,
    reason: "需要返修",
    fixInstructions: "补足当前章问题",
    issues: [],
    triggerReasons: [],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: runtimeSignals.storyProgression,
    genreFulfillment: runtimeSignals.genreFulfillment,
    loopRisk: runtimeSignals.loopRisk,
    primaryDeltaDelivered: runtimeSignals.primaryDeltaDelivered,
    stuckDimensions: runtimeSignals.stuckDimensions,
    windowStartChapter: 1,
    windowEndChapter: 1,
    earliestAffectedChapter: 1,
    ...overrides,
  };
}

test("hasBlockingContextConflicts only blocks on hard conflicts", () => {
  const softOnly: ConflictRecord[] = [
    {
      id: "c1",
      type: "timeline",
      severity: "soft",
      message: "时间线需要注意",
    },
  ];
  const withHardConflict: ConflictRecord[] = [
    ...softOnly,
    {
      id: "c2",
      type: "character_state",
      severity: "hard",
      message: "角色状态冲突",
    },
  ];

  assert.equal(hasBlockingContextConflicts(softOnly), false);
  assert.equal(hasBlockingContextConflicts(withHardConflict), true);
});

test("shouldInvokeStyleRescue follows current prose-rescue policy and stops at attempt cap", () => {
  const proseRisk = assessProseStyleRisk([
    "咿呀伏在石缝边，盯着谷底的血光。",
    "咿呀没有立刻扑下去，只把尾巴紧紧收住。",
    "咿呀又抬头看了一眼，耳尖轻轻一抖。",
    "咿呀听见藤身里有水声一样的东西在爬。",
    "咿呀再往前挪时，四爪都压得极轻。",
    "咿呀盯着那枚赤果，连呼吸都一点点收紧。",
    "它明知不对，却还是舍不得把视线移开。",
    "像有冷蛇沿着它的脊背慢慢往上爬，像有细针一点点扎进骨缝。",
    "像冷水顺着骨头缝往里灌，仿佛连胸口那团热意都被压住了。",
    "不是它胆小，而是那股血腥气已经贴到了鼻尖。",
  ].join(""));

  assert.equal(
    shouldInvokeStyleRescue({
      attemptsUsed: 0,
      maxAttempts: 3,
      chapterNo: 9,
      retryCount: 0,
      proseRisk,
      quickAudit: {
        verdict: "escalate",
        issues: [
          {
            type: "style_drift",
            location: "正文文笔",
            severity: "major",
          },
        ],
      },
    }),
    true,
  );

  assert.equal(
    shouldInvokeStyleRescue({
      attemptsUsed: 3,
      maxAttempts: 3,
      chapterNo: 9,
      retryCount: 0,
      proseRisk,
      quickAudit: {
        verdict: "escalate",
        issues: [
          {
            type: "style_drift",
            location: "正文文笔",
            severity: "major",
          },
        ],
      },
    }),
    false,
  );
});

test("shouldRewriteAfterQuickAudit keeps pre-deep-review prose-only escalation in rewrite loop", () => {
  const proseRisk = assessProseStyleRisk([
    "姜离贴着断崖往前挪，掌心的热一阵紧过一阵。",
    "姜离没有回头，只把呼吸压得更轻。",
    "姜离又往石缝里缩了一寸，肩骨全绷紧了。",
    "他听见后头碎石轻响，脚下也跟着一紧。",
    "他刚抬眼，黑羽便贴着风切了下来。",
    "像刀一样的风从耳侧擦过去，像冷水一样灌进领口。",
    "不是他想停，而是那股追咬已经贴到了背上。",
  ].join(""))!;

  assert.equal(
    shouldRewriteAfterQuickAudit({
      attemptsUsed: 0,
      maxAttempts: 2,
      proseRisk,
      quickAudit: createQuickAudit({
        verdict: "escalate",
        issues: [
          {
            type: "style_drift",
            location: "作者习惯卡",
            severity: "major",
          },
        ],
        styleChecklistHits: [
          {
            dimension: "比喻预算",
            description: "显性比喻过密",
            severity: "major",
          },
        ],
      }),
    }),
    true,
  );

  assert.equal(
    shouldRewriteAfterQuickAudit({
      attemptsUsed: 2,
      maxAttempts: 2,
      proseRisk,
      quickAudit: createQuickAudit({
        verdict: "escalate",
        issues: [
          {
            type: "style_drift",
            location: "作者习惯卡",
            severity: "major",
          },
        ],
      }),
    }),
    false,
  );

  assert.equal(
    shouldRewriteAfterQuickAudit({
      attemptsUsed: 0,
      maxAttempts: 2,
      proseRisk,
      quickAudit: createQuickAudit({
        verdict: "escalate",
        issues: [
          {
            type: "structure_break",
            location: "章节结构",
            severity: "major",
          },
        ],
      }),
    }),
    false,
  );
});

test("shouldFallbackAfterAutoProseRescueFailure only degrades on transient LLM transport failures", () => {
  assert.equal(
    shouldFallbackAfterAutoProseRescueFailure(new Error("fetch failed")),
    true,
  );
  assert.equal(
    shouldFallbackAfterAutoProseRescueFailure(new DOMException("This operation was aborted", "AbortError")),
    true,
  );
  assert.equal(
    shouldFallbackAfterAutoProseRescueFailure(new Error("项目不存在")),
    false,
  );
});

test("shouldInvokeDeepReview preserves review-policy escalation behavior", () => {
  const policy = resolveReviewPolicy("long");

  assert.deepEqual(
    shouldInvokeDeepReview({
      chapterNo: 12,
      totalChapters: 180,
      policy,
      quickAudit: createQuickAudit(),
      hasHardConflict: false,
      hasMajorProgression: false,
    }),
    {
      shouldInvoke: true,
      triggerReasons: ["cadence", "mid_window"],
    },
  );

  assert.deepEqual(
    shouldInvokeDeepReview({
      chapterNo: 16,
      totalChapters: 180,
      policy,
      quickAudit: createQuickAudit(),
      hasHardConflict: false,
      hasMajorProgression: false,
    }),
    {
      shouldInvoke: true,
      triggerReasons: ["cadence"],
    },
  );
});

test("shouldInvokeLlmStyleRescue only keeps warn-level rescue in the early chapters", () => {
  const warnRisk = assessProseStyleRisk([
    "咿呀伏在石缝边，盯着谷底的血光。",
    "咿呀没有立刻扑下去，只把尾巴紧紧收住。",
    "咿呀又抬头看了一眼，耳尖轻轻一抖。",
    "咿呀听见藤身里有水声一样的东西在爬。",
    "咿呀再往前挪时，四爪都压得极轻。",
    "咿呀盯着那枚赤果，连呼吸都一点点收紧。",
    "咿呀刚要探头，鼻端又闻见一阵冷腥。",
    "像冷水顺着骨头缝往里灌，仿佛连胸口那团热意都被压住了。",
    "像裂开的伤口，如同夜里睁开的眼。",
    "像有细针一点点扎进骨缝，似乎连耳尖都跟着发麻。",
  ].join(""));
  const failRisk = assessProseStyleRisk([
    "它伏在石后，盯着谷底的血光。",
    "它没有立刻扑下去，只把尾巴紧紧收住。",
    "它又抬头看了一眼，耳尖轻轻一抖。",
    "它听见藤身里有水声一样的东西在爬。",
    "它再往前挪时，四爪都压得极轻。",
    "它盯着那枚赤果，连呼吸都一点点收紧。",
    "它明知不对，却还是舍不得挪开视线。",
    "像有冷蛇沿着它的脊背慢慢往上爬，像有细针一点点扎进骨缝。",
    "不是它胆小，而是那股血腥气已经贴到了鼻尖。",
    "不是风太冷，而是谷底那株怪藤像活物一样在喘。",
    "像裂开的伤口，像夜里睁开的眼。",
    "不是它想退，而是那股凶气已经像手一样按在它头顶。",
  ].join(""));

  assert.equal(shouldInvokeLlmStyleRescue({ chapterNo: 3, proseRisk: warnRisk }), true);
  assert.equal(shouldInvokeLlmStyleRescue({ chapterNo: 8, proseRisk: warnRisk }), false);
  assert.equal(shouldInvokeLlmStyleRescue({ chapterNo: 8, proseRisk: failRisk }), true);
});

test("shouldInvokeQuickAudit only runs on escalation or policy checkpoints", () => {
  const policy = resolveReviewPolicy("long", {
    manualCheckpointChapters: [8],
  });

  assert.equal(
    shouldInvokeQuickAudit({
      chapterNo: 7,
      totalChapters: 180,
      retryCount: 0,
      policy,
      localGate: createQuickAudit(),
      isCompletionCandidate: false,
    }),
    false,
  );

  assert.equal(
    shouldInvokeQuickAudit({
      chapterNo: 7,
      totalChapters: 180,
      retryCount: 1,
      policy,
      localGate: createQuickAudit(),
      isCompletionCandidate: false,
    }),
    true,
  );

  assert.equal(
    shouldInvokeQuickAudit({
      chapterNo: 7,
      totalChapters: 180,
      retryCount: 0,
      policy,
      localGate: createQuickAudit({
        verdict: "escalate",
        confidence: 0.42,
      }),
      isCompletionCandidate: false,
    }),
    true,
  );

  assert.equal(
    shouldInvokeQuickAudit({
      chapterNo: 8,
      totalChapters: 180,
      retryCount: 0,
      policy,
      localGate: createQuickAudit(),
      isCompletionCandidate: false,
    }),
    true,
  );

  assert.equal(
    shouldInvokeQuickAudit({
      chapterNo: 100,
      totalChapters: 180,
      retryCount: 0,
      policy,
      localGate: createQuickAudit(),
      isCompletionCandidate: false,
    }),
    true,
  );
});

test("mandatory deep-review windows cannot bypass the quick audit gate", () => {
  const policy = resolveReviewPolicy("long");

  for (const chapterNo of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    assert.equal(
      shouldInvokeQuickAudit({
        chapterNo,
        totalChapters: 80,
        retryCount: 0,
        policy,
        localGate: createQuickAudit(),
        isCompletionCandidate: false,
      }),
      true,
      `第 ${chapterNo} 章必须先运行 Quick Review 才能进入强制 Deep Review`,
    );
  }
});

test("classifyReviewFailureCategory marks progression and hook debt issues as planning failures", () => {
  const review = createDeepReview({
    issues: [
      {
        type: "story_progression",
        location: "章节主线",
        severity: "major",
      },
      {
        type: "hook_debt",
        location: "章末钩子",
        severity: "major",
      },
    ],
  });

  assert.equal(
    classifyReviewFailureCategory({ review }),
    "planning_failure",
  );
});

test("classifyReviewRepairPath can downgrade pure anchor miss with healthy prose into voice polish", () => {
  const review = createDeepReview({
    issues: [
      {
        type: "continuation_anchor_miss",
        location: "章节开头",
        severity: "major",
      },
    ],
  });

  assert.equal(
    classifyReviewRepairPath({
      review,
      proseSeverity: "ok",
      proseScore: 0.86,
    }),
    "voice_polish",
  );

  assert.equal(
    classifyReviewRepairPath({
      review,
      proseSeverity: "warn",
      proseScore: 0.42,
    }),
    "planning_repair",
  );
});

test("resolveDeepReviewOutcome separates accept, manual-review, and rewrite paths", () => {
  assert.deepEqual(
    resolveDeepReviewOutcome({
      retryCount: 0,
      review: createDeepReview({
        verdict: "pass",
        confidence: 0.84,
      }),
    }),
    {
      action: "accept",
      relaxedPassThreshold: 0.8,
    },
  );

  assert.deepEqual(
    resolveDeepReviewOutcome({
      retryCount: 1,
      review: createDeepReview({
        verdict: "manual_review_window",
        confidence: 0.79,
      }),
    }),
    {
      action: "manual_review",
      relaxedPassThreshold: 0.8,
    },
  );

  assert.deepEqual(
    resolveDeepReviewOutcome({
      retryCount: 2,
      review: createDeepReview({
        verdict: "rewrite_current",
        confidence: 0.72,
      }),
    }),
    {
      action: "rewrite",
      relaxedPassThreshold: 0.8,
    },
  );

  assert.deepEqual(
    resolveDeepReviewOutcome({
      retryCount: 3,
      review: createDeepReview({
        verdict: "pass",
        confidence: 0.61,
      }),
    }),
    {
      action: "accept",
      relaxedPassThreshold: 0.6,
    },
  );
});

test("classifyReviewRepairPath routes structure failures to scene rescue and style failures to voice polish", () => {
  assert.equal(
    classifyReviewRepairPath({
      review: createDeepReview({
        issues: [
          {
            type: "structure_break",
            location: "场景结构",
            severity: "major",
          },
        ],
        loopRisk: {
          risk: "risk",
          score: 30,
          summary: "",
          repetitionAxes: [],
          stuckDimensions: [],
        },
      }),
    }),
    "scene_rescue",
  );

  assert.equal(
    classifyReviewRepairPath({
      review: createDeepReview({
        issues: [],
        loopRisk: {
          risk: "pass",
          score: 80,
          summary: "",
          repetitionAxes: [],
          stuckDimensions: [],
        },
        storyProgression: {
          risk: "pass",
          score: 82,
          summary: "",
          advancements: [],
          stallSignals: [],
          primaryDelta: null,
          deliveredDeltas: [],
        },
        styleChecklistHits: [
          {
            dimension: "voice",
            description: "summary first",
            severity: "major",
          },
        ],
      }),
    }),
    "voice_polish",
  );
});
