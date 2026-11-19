import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMonitorEvaluationPrompt,
  collectMonitorCharterSignals,
  decideMonitorManualReviewAction,
  getAttachModeSkippedChapters,
  getMonitorCandidateChapters,
  shouldRetryMonitorLoopError,
  shouldTreatMonitorResolveErrorAsRecovered,
  summarizeLocalFlavorSignals,
  selectEvaluatorProfile,
  summarizePlannerQualityFromTrace,
} from "./run-beast-reference-test.mjs";

test("collectMonitorCharterSignals surfaces structured charter violations for monitor reports", () => {
  const signals = collectMonitorCharterSignals(
    {
      foundation: {
        styleProfile: {
          writingCharter: {
            chapterLengthRule: "章长完整推进",
            mechanismRevealRule: "先撞上异动再补辨认",
            mechanismRevealRedlines: ["不要写成解释 -> 验证 -> 总结三段式。"],
          },
        },
      },
    },
    {
      reviews: [
        {
          charterViolations: [
            {
              key: "mechanism_triad_pattern",
              label: "机制露出策略/解释 -> 验证 -> 总结三段式",
              actual: 1,
              limit: 0,
              detail: "出现了一次完整三段式。",
              evidence: ["解释 -> 验证 -> 总结"],
              severity: "major",
              scope: "mechanism",
            },
          ],
          styleChecklistHits: [
            {
              dimension: "机制露出",
              description: "出现了解释 -> 验证 -> 总结式的机制复述。",
              severity: "major",
            },
          ],
        },
      ],
    },
  );

  assert.match(signals.charterSummary, /先撞上异动再补辨认/);
  assert.equal(signals.charterViolations.length, 1);
  assert.equal(signals.charterViolations[0]?.key, "mechanism_triad_pattern");
  assert.equal(signals.styleChecklistHits[0]?.dimension, "机制露出");
  assert.equal(signals.storyProgression, null);
  assert.equal(signals.genreFulfillment, null);
  assert.equal(signals.loopRisk, null);
});

test("decideMonitorManualReviewAction retries window-level manual review from earliest affected chapter", () => {
  const decision = decideMonitorManualReviewAction({
    manualReview: {
      awaiting: true,
      canApprove: false,
      canAutoPick: false,
      requiresWindowRestart: true,
      earliestAffectedChapter: 17,
    },
  });

  assert.deepEqual(decision, {
    action: "retry_chapter",
    reason: "window_restart",
    requiresWindowRestart: true,
    restartFromChapter: 17,
  });
});

test("decideMonitorManualReviewAction stops on unsupported manual review states", () => {
  const decision = decideMonitorManualReviewAction({
    manualReview: {
      awaiting: true,
      canApprove: false,
      canAutoPick: false,
      requiresWindowRestart: false,
      earliestAffectedChapter: null,
    },
  });

  assert.deepEqual(decision, {
    action: null,
    reason: "unsupported_manual_review",
    requiresWindowRestart: false,
    restartFromChapter: null,
  });
});

test("shouldTreatMonitorResolveErrorAsRecovered accepts already-running handoff after manual review", () => {
  const recovered = shouldTreatMonitorResolveErrorAsRecovered(
    new Error("当前已有正在进行中的写作任务"),
    {
      running: true,
      stage: "blueprint",
      currentChapter: 21,
    },
    20,
  );

  assert.equal(recovered, true);
});

test("shouldTreatMonitorResolveErrorAsRecovered rejects still-blocked manual review state", () => {
  const recovered = shouldTreatMonitorResolveErrorAsRecovered(
    new Error("当前已有正在进行中的写作任务"),
    {
      running: false,
      stage: "manual_review",
      currentChapter: 20,
    },
    20,
  );

  assert.equal(recovered, false);
});

test("shouldRetryMonitorLoopError accepts transient fetch and html failures", () => {
  assert.equal(shouldRetryMonitorLoopError(new Error("fetch failed")), true);
  assert.equal(shouldRetryMonitorLoopError(new Error("monitor_progress_response_invalid")), true);
  assert.equal(shouldRetryMonitorLoopError(new Error("<!DOCTYPE html><html><body>500</body></html>")), true);
});

test("shouldRetryMonitorLoopError rejects non-recoverable logic failures", () => {
  assert.equal(shouldRetryMonitorLoopError(new Error("manual review decision missing action")), false);
});

test("getAttachModeSkippedChapters skips historical backlog in attach mode but keeps the latest completed chapter", () => {
  const skipped = getAttachModeSkippedChapters(
    {
      writtenChapters: [1, 2, 3, 18, 19, 20, 21],
    },
    50,
    21,
  );

  assert.deepEqual(skipped, [1, 2, 3, 18, 19]);
});

test("getMonitorCandidateChapters only returns persisted chapters within target range", () => {
  const chapters = getMonitorCandidateChapters(
    {
      writtenChapters: [2, 1, 2, 3, 0, -1, 51, "4", "oops"],
    },
    4,
  );

  assert.deepEqual(chapters, [1, 2, 3, 4]);
});

test("buildMonitorEvaluationPrompt asks for story progression, genre fulfillment, and loop risk", () => {
  const prompt = buildMonitorEvaluationPrompt({
    projectPayload: {
      project: {
        id: "proj-1",
        title: "洪荒异兽",
        genre: "玄幻修仙",
        premise: "这是一个山海经的故事，山川有灵，神兽遍地。",
        storyContract: {
          currentVolume: 1,
          endingPromise: "找出赤钩热痕真正源头。",
          genreObligationPacks: [
            { id: "core-only", active: true },
            { id: "mythic_beastiary", active: true },
          ],
          volumes: [
            {
              volumeNo: 1,
              goal: "找出赤钩热痕真正源头。",
            },
          ],
        },
      },
      foundation: {
        styleDigest: "高压推进，动作带信息。",
        styleExemplars: [],
        styleProfile: {
          writingCharter: {
            chapterLengthRule: "写满完整推进。",
            mechanismRevealRule: "先后果再辨认。",
            mechanismRevealRedlines: ["不要写成解释 -> 验证 -> 总结三段式。"],
          },
        },
      },
    },
    chapterNo: 7,
    chapterPayload: {
      blueprint: {
        chapterNo: 7,
        sceneGoal: "让姜离闯进古地裂缝并确认新的禁忌。",
        characters: ["姜离", "背碑巨鼋"],
        locations: ["古地裂缝"],
        conflicts: ["姜离必须先摸清古地裂缝的怪规则。"],
        foreshadows: ["更深处有山海异谱残痕。"],
        emotionalTone: "压低声势，逐步绷紧",
        estimatedWords: 2800,
      },
      content: "姜离顺着裂缝往下滑，听见不像风的换气声。",
    },
    charterSignals: {
      charterSummary: "章长=写满完整推进；机制露出=先后果再辨认。",
      charterViolations: [],
      styleChecklistHits: [],
      mechanismViolations: [],
      budgetHitLabels: [],
      storyProgression: {
        risk: "watch",
        score: 60,
        summary: "已推进，但仍有循环轴。",
        advancements: ["进入新地带"],
        stallSignals: ["same_arena"],
      },
      genreFulfillment: {
        risk: "watch",
        score: 62,
        summary: "已有洪荒异感，但还不够实。",
        present: ["出现怪地气息"],
        missing: ["巨兽体量不够"],
        activePacks: ["mythic_beastiary"],
      },
      loopRisk: {
        risk: "watch",
        score: 58,
        summary: "还在复用同一目标轴。",
        repetitionAxes: ["same_objective"],
        stuckDimensions: ["objective_loop"],
      },
      primaryDeltaDelivered: "information_shift",
      stuckDimensions: ["objective_loop"],
    },
    recentBriefSummaries: ["第 5 章：姜离在骨泽里看见会迁移的药精。"],
    plannerQuality: {
      candidateAttempts: 3,
      selectedScore: 4,
      selectedReason: "candidate=2 / score=4",
      repairUsed: true,
      fallbackUsed: false,
      failureReasons: ["sceneGoal 太泛"],
    },
  });

  assert.match(prompt, /storyProgression/);
  assert.match(prompt, /genreFulfillment/);
  assert.match(prompt, /loopRisk/);
  assert.match(prompt, /primaryDeltaDelivered/);
  assert.match(prompt, /单纯把同一场追逃\/打斗拖长，不算推进/);
  assert.match(prompt, /山海经\/洪荒\/异兽志气质/);
  assert.match(prompt, /当前本地循环风险/);
  assert.match(prompt, /当前本地蓝图入口质量/);
  assert.match(prompt, /candidateAttempts/);
});

test("summarizePlannerQualityFromTrace condenses trace fallback details for monitor output", () => {
  const summary = summarizePlannerQualityFromTrace({
    selectedCandidateIndex: 1,
    selectedScore: 3,
    selectedReason: "repair_after_candidate_2 / score=3",
    repairUsed: true,
    fallbackUsed: true,
    fallbackReason: "规划器没有给出通过 verifier 的候选蓝图。",
    candidateAttempts: [
      {
        attemptNo: 1,
        verification: {
          reasons: ["sceneGoal 太泛"],
        },
      },
      {
        attemptNo: 2,
        verification: {
          reasons: ["同地追逃"],
        },
      },
    ],
    repairVerification: {
      pass: false,
      reasons: ["缺少对下一章的明确承接钩子。"],
    },
  });

  assert.deepEqual(summary, {
    candidateAttempts: 2,
    selectedScore: 3,
    selectedReason: "repair_after_candidate_2 / score=3",
    repairUsed: true,
    fallbackUsed: true,
    failureReasons: [
      "同地追逃",
      "缺少对下一章的明确承接钩子。",
      "规划器没有给出通过 verifier 的候选蓝图。",
    ],
  });
});

test("summarizeLocalFlavorSignals condenses prose signal counts for monitor output", () => {
  const summary = summarizeLocalFlavorSignals({
    severity: "warn",
    score: 4,
    notes: ["解释补句偏直", "词块回钉偏多"],
    warnings: ["“不是……而是……”开始重复（2 处）"],
    momentMarkerCount: 2,
    explanationLeadCount: 3,
    judgmentLeadCount: 1,
    phraseReuseHits: [{ phrase: "偏偏", count: 3 }],
    pronounLeadCount: 3,
    pronounLeadRatio: 0.15,
    simileCount: 2,
    contrastTemplateCount: 2,
    abruptTurnCount: 1,
    repeatedSentenceStarts: [{ lead: "纪渊", count: 4 }],
    dominantLead: { lead: "纪渊", count: 4 },
    sentenceCount: 18,
  });

  assert.deepEqual(summary, {
    severity: "warn",
    score: 4,
    topWarnings: ["解释补句偏直", "词块回钉偏多", "“不是……而是……”开始重复（2 处）"],
    momentMarkerCount: 2,
    explanationLeadCount: 3,
    judgmentLeadCount: 1,
    phraseReuseHits: ["偏偏×3"],
    pronounLeadCount: 3,
    simileCount: 2,
    contrastTemplateCount: 2,
    abruptTurnCount: 1,
    dominantLead: "纪渊×4",
  });
});

test("selectEvaluatorProfile respects a forced evaluator profile id", async () => {
  const profiles = [
    {
      id: "forced-small",
      defaultModel: "claude-opus-4-6",
      baseUrl: "https://forced.example",
      apiKey: "sk-forced",
      enabled: true,
    },
    {
      id: "fallback-gpt",
      defaultModel: "gpt-5.4",
      baseUrl: "https://fallback.example/v1",
      apiKey: "sk-fallback",
      enabled: true,
    },
  ];

  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith("/v1/chat/completions")) {
      return {
        ok: true,
        text: async () => "{\"choices\":[{\"message\":{\"content\":\"OK\"}}]}",
      };
    }
    if (String(url).endsWith("/chat/completions")) {
      return {
        ok: true,
        text: async () => "<!doctype html><title>gateway</title>",
      };
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const result = await selectEvaluatorProfile(
      {
        assignments: [{ role: "writer", profileId: "fallback-gpt", model: "gpt-5.4" }],
      },
      profiles,
      "forced-small",
    );

    assert.equal(result.profile?.id, "forced-small");
    assert.deepEqual(result.failures, []);
    assert.deepEqual(urls, [
      "https://forced.example/chat/completions",
      "https://forced.example/v1/chat/completions",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
