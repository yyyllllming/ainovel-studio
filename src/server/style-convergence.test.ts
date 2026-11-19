import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDivergences,
  iterativeStyleConvergence,
} from "./style-convergence.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import { computeStyleFingerprint, type StyleFingerprint } from "./style-fingerprint.ts";
import type { StyleExcerpt } from "./types.ts";

function createReferenceText() {
  return `潮气顺着石阶往上涌，他把呼吸压得很轻，免得让门后的人先听见他的犹豫。

“再往前一步，夜禁就不是规矩，是收尸。”她没有抬头，只把灯往高处举了举。

他没有回头，手指在刀柄上扣紧，像把所有后退的念头都按回骨缝里。`;
}

function createFingerprint(text: string): StyleFingerprint {
  return computeStyleFingerprint(text, []);
}

function createExcerpt(text: string): StyleExcerpt {
  return {
    id: "excerpt-1",
    sourceId: "source-1",
    sourceTitle: "测试来源",
    label: "第1章",
    tags: ["narrative", "dialogue"],
    content: text,
    wordCount: text.length,
    startOffset: 0,
    endOffset: text.length,
    positionRatio: 0.1,
    dialogueRatio: 0.28,
  };
}

test("computeDivergences returns normalized deviations for compared fingerprints", () => {
  const reference = createFingerprint(createReferenceText());
  const generated = createFingerprint("他走得很快。风很大。她喊了一声。");
  const divergences = computeDivergences(reference, generated);

  assert.equal(divergences.length >= 10, true);
  assert.equal(divergences.some((entry) => entry.dimension === "sentenceLength.mean"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "paragraphLength.mean"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "dialogue.overallRatio"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "punctuation.exclamation"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "sentenceLength.shortRatio"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "rhetoric.simileDensity"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "narrativeRhythm.rhythmVariance"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "emotionRendering.restraintScore"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "deepTexture.sensoryDetailDensity"), true);
  assert.equal(divergences.some((entry) => entry.dimension === "paragraphLength.singleSentenceRatio"), true);
  assert.equal(divergences.some((entry) => entry.deviation > 0.2), true);
});

test("iterativeStyleConvergence returns a high score when generated text matches the reference fingerprint", async () => {
  const text = createReferenceText();
  const profile = buildFallbackStyleProfile({
    references: [],
    manualGuidance: "保持动作推进。",
    avoidances: "不要解释腔。",
  });
  const referenceFingerprint = createFingerprint(text);

  const result = await iterativeStyleConvergence({
    initialProfile: profile,
    referenceFingerprint,
    referenceExcerpts: [createExcerpt(text)],
    maxIterations: 1,
    writerSystemPrompt: "你是小说主笔 Writer。",
    llmCall: async () => text,
  });

  assert.equal(result.iterations, 1);
  assert.equal(result.convergenceScore > 0.9, true);
});

test("computeDivergences detects large sentence-length gaps", () => {
  const reference = createFingerprint("他沿着旧墙慢慢走过去，手掌一直贴着冰冷潮湿的砖缝。");
  const generated = createFingerprint("走。停。喊。跑。");
  const divergences = computeDivergences(reference, generated);
  const sentenceLengthGap = divergences.find((entry) => entry.dimension === "sentenceLength.mean");

  assert.ok(sentenceLengthGap);
  assert.equal((sentenceLengthGap?.deviation ?? 0) > 0.3, true);
});
