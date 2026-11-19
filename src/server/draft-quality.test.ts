import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBootstrapRetryInstructions,
  buildProseSteeringInstructions,
  filterUsableDraftCandidates,
  isBootstrapDraftCandidateAcceptable,
  pickBestDraftCandidate,
  scoreDraftCandidate,
  shouldUseBootstrapDraftSelection,
} from "./writing/draft-quality.ts";
import type { ChapterReviewState } from "./types.ts";

test("shouldUseBootstrapDraftSelection stays on for early chapters and before any deep lock", () => {
  const laterState: ChapterReviewState[] = [
    {
      projectId: "p1",
      chapterNo: 2,
      status: "provisional",
      quickCheckedAt: null,
      deepCheckedAt: null,
      openWindowId: null,
      lastReviewMode: "quick",
      latestConfidence: 0.8,
      earliestAffectedChapter: null,
      updatedAt: "2026-03-22T00:00:00.000Z",
    },
  ];

  assert.equal(
    shouldUseBootstrapDraftSelection({
      chapterNo: 2,
      reviewStates: laterState,
    }),
    true,
  );

  assert.equal(
    shouldUseBootstrapDraftSelection({
      chapterNo: 5,
      reviewStates: laterState,
    }),
    true,
  );
});

test("shouldUseBootstrapDraftSelection turns off after the opening window is deep-locked", () => {
  const states: ChapterReviewState[] = [
    {
      projectId: "p1",
      chapterNo: 3,
      status: "deep_locked",
      quickCheckedAt: null,
      deepCheckedAt: "2026-03-22T00:00:00.000Z",
      openWindowId: "w1",
      lastReviewMode: "deep",
      latestConfidence: 0.92,
      earliestAffectedChapter: null,
      updatedAt: "2026-03-22T00:00:00.000Z",
    },
  ];

  assert.equal(
    shouldUseBootstrapDraftSelection({
      chapterNo: 6,
      reviewStates: states,
    }),
    false,
  );
});

test("scoreDraftCandidate punishes model-like repetition and missing blueprint characters", () => {
  const weak = scoreDraftCandidate({
    content: [
      "它伏在石后，盯着谷底的血光。",
      "它没有立刻扑下去，只把尾巴紧紧收住。",
      "它又抬头看了一眼，耳尖轻轻一抖。",
      "它听见谷底那株怪藤轻轻一颤，后背细毛一下绷紧。",
      "它明知不对，却还是舍不得把视线移开。",
      "像有冷蛇沿着它的脊背慢慢往上爬，像有细针一点点扎进骨缝。",
      "像冷水顺着骨头缝往里灌，仿佛连胸口那团热意都被压住了。",
      "仿佛黑暗里有一只眼，正隔着石缝慢慢盯住它。",
      "不是它胆小，而是那股血腥气已经贴到了鼻尖。",
      "不是风在动，而是石缝深处那股腥气又往上拱了一截。",
    ].join(""),
    blueprint: {
      characters: ["咿呀", "赤獠狼"],
      estimatedWords: 2200,
    },
  });

  const strong = scoreDraftCandidate({
    content: [
      "夜风贴着断崖刮过去，咿呀伏在黑石后，只露出一双圆亮的眼。",
      "赤獠狼还在谷底徘徊，鼻端一次次擦过石缝，却始终不肯先动。",
      "小兽没有急着扑下去，而是先听风，再听藤身里那阵若有若无的摩擦声。",
      "等到第一缕血腥味从谷底翻上来，它才把后腿一点点压实。",
    ].join(""),
    blueprint: {
      characters: ["咿呀", "赤獠狼"],
      estimatedWords: 2200,
    },
  });

  assert.equal(weak.proseRisk.severity === "warn" || weak.proseRisk.severity === "fail", true);
  assert.equal(weak.missingCharacters.includes("咿呀"), true);
  assert.equal(strong.missingCharacters.length, 0);
  assert.equal(strong.score < weak.score, true);
});

test("pickBestDraftCandidate prefers the lower-risk candidate", () => {
  const picked = pickBestDraftCandidate(
    [
      { content: "它看着谷底。它继续往前。像冷蛇一样的风又刮过来。" },
      { content: "咿呀伏在石后，先听见风，再看见谷底那道新鲜血线。" },
    ],
    {
      characters: ["咿呀"],
      estimatedWords: 1800,
    },
  );

  assert.equal(picked?.index, 1);
});

test("buildProseSteeringInstructions turns detected risks into persistent writing guardrails", () => {
  const weak = scoreDraftCandidate({
    content: [
      "它伏在石后，盯着谷底的血光。",
      "它没有立刻扑下去，只把尾巴紧紧收住。",
      "它又抬头看了一眼，耳尖轻轻一抖。",
      "它听见谷底那株怪藤轻轻一颤，后背细毛一下绷紧。",
      "它明知不对，却还是舍不得把视线移开。",
      "像有冷蛇沿着它的脊背慢慢往上爬，像有细针一点点扎进骨缝。",
      "不是它胆小，而是那股血腥气已经贴到了鼻尖。",
      "不是风在动，而是石缝深处那股腥气又往上拱了一截。",
      "忽然，风又冷了一截。",
      "忽然，它听见石缝深处有东西动了。",
      "忽然，谷底那株怪藤也轻轻一颤。",
    ].join(""),
    blueprint: {
      characters: ["咿呀"],
      estimatedWords: 2200,
    },
  });

  const instructions = buildProseSteeringInstructions(weak.proseRisk);

  assert.equal(instructions.some((entry) => entry.includes("主体")), true);
  assert.equal(instructions.some((entry) => entry.includes("4 处以内")), true);
  assert.equal(instructions.some((entry) => entry.includes("不是……而是……")), true);
  assert.equal(instructions.some((entry) => entry.includes("忽然")), true);
});

test("buildProseSteeringInstructions warns when the same role name dominates sentence starts", () => {
  const repetitive = scoreDraftCandidate({
    content: [
      "咿呀伏在石缝边，盯着谷底的血光。",
      "咿呀没有立刻扑下去，只把尾巴紧紧收住。",
      "咿呀又抬头看了一眼，耳尖轻轻一抖。",
      "咿呀听见藤身里有水声一样的东西在爬。",
      "咿呀再往前挪时，四爪都压得极轻。",
      "咿呀盯着那枚赤果，连呼吸都一点点收紧。",
    ].join(""),
    blueprint: {
      characters: ["咿呀"],
      estimatedWords: 1600,
    },
  });

  const instructions = buildProseSteeringInstructions(repetitive.proseRisk);

  assert.equal(instructions.some((entry) => entry.includes("同一主体名词")), true);
  assert.equal(instructions.some((entry) => entry.includes("连续 6 句")), true);
  assert.equal(instructions.some((entry) => entry.includes("咿呀")), true);
  assert.equal(instructions.some((entry) => entry.includes("相邻两句")), true);
});

test("filterUsableDraftCandidates keeps successful non-empty candidates even when others fail", () => {
  const filtered = filterUsableDraftCandidates([
    { temperature: 0.55, content: "咿呀伏在石后。" },
    null,
    { temperature: 0.88, content: "   " },
    { temperature: 0.72, content: "夜风掠过断崖，咿呀没有先动。" },
  ]);

  assert.deepEqual(
    filtered.map((item) => item.temperature),
    [0.55, 0.72],
  );
});

test("isBootstrapDraftCandidateAcceptable rejects fail-level opening drafts", () => {
  const weak = scoreDraftCandidate({
    content: [
      "它伏在石后，盯着谷底的血光。",
      "它没有立刻扑下去，只把尾巴紧紧收住。",
      "它又抬头看了一眼，耳尖轻轻一抖。",
      "它听见谷底那株怪藤轻轻一颤，后背细毛一下绷紧。",
      "它明知不对，却还是舍不得把视线移开。",
      "像有冷蛇沿着它的脊背慢慢往上爬，像有细针一点点扎进骨缝。",
      "像冷水顺着骨头缝往里灌，仿佛连胸口那团热意都被压住了。",
      "仿佛黑暗里有一只眼，正隔着石缝慢慢盯住它。",
    ].join(""),
    blueprint: {
      characters: ["咿呀"],
      estimatedWords: 1800,
    },
  });

  const stronger = scoreDraftCandidate({
    content: Array.from({ length: 32 }, (_, index) => {
      const lead = ["夜风", "谷底", "石缝", "青血", "断崖", "林影", "兽吼", "湿土", "残月", "冷雾"][index % 10]!;
      return `${lead}一压下来，咿呀就在黑石后稳住呼吸，盯着青鳞狼额前起伏不定的灵纹，盘算何时冒险凑近。`;
    }).join(""),
    blueprint: {
      characters: ["咿呀", "青鳞狼"],
      estimatedWords: 1800,
    },
  });

  assert.equal(isBootstrapDraftCandidateAcceptable(weak), false);
  assert.equal(isBootstrapDraftCandidateAcceptable(stronger), true);
});

test("buildBootstrapRetryInstructions aggregates repeat prose problems into rewrite guidance", () => {
  const evaluations = [
    scoreDraftCandidate({
      content: [
        "它伏在石后，盯着谷底的血光。",
        "它没有立刻扑下去，只把尾巴紧紧收住。",
        "它又抬头看了一眼，耳尖轻轻一抖。",
        "它听见谷底那株怪藤轻轻一颤，后背细毛一下绷紧。",
        "它明知不对，却还是舍不得把视线移开。",
        "像有冷蛇沿着它的脊背慢慢往上爬。",
        "像有细针一点点扎进骨缝。",
        "像冷水顺着骨头缝往里灌。",
        "仿佛黑暗里有一只眼，正隔着石缝慢慢盯住它。",
      ].join(""),
      blueprint: {
        characters: ["咿呀"],
        estimatedWords: 1600,
      },
    }),
  ];

  const instructions = buildBootstrapRetryInstructions(evaluations);

  assert.equal(instructions.some((entry) => entry.includes("主体")), true);
  assert.equal(instructions.some((entry) => entry.includes("比喻")), true);
  assert.equal(instructions.some((entry) => entry.includes("即时目标")), true);
});
