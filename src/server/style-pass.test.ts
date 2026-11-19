import test from "node:test";
import assert from "node:assert/strict";
import { applyDeterministicStylePass } from "./writing/style-pass.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import { inspectProseStyleSignals } from "./writing/prose-normalizer.ts";
import type { StyleReferenceSelection } from "./types.ts";

const references = [
  {
    kind: "book",
    label: "长夜潮声",
    author: "沈知白",
    source: "network",
    relation: "primary",
  },
] satisfies StyleReferenceSelection[];

test("applyDeterministicStylePass merges over-split narrative paragraphs and removes planning lexicon", () => {
  const profile = buildFallbackStyleProfile({
    references,
    manualGuidance: "要像正常中文小说，不要一句一段。",
    avoidances: "不要把推进主线、阻力、信息投放写进正文。",
  });

  const input = [
    "夜色压在街巷上。",
    "",
    "这成了他今晚最大的阻力。",
    "",
    "他得继续推进主线。",
    "",
    "“你还不走？”",
  ].join("\n");

  const result = applyDeterministicStylePass(input, profile);

  assert.equal(result.content.includes("推进主线"), false);
  assert.equal(result.content.includes("阻力"), false);
  assert.equal(result.content.split("\n\n")[0]?.includes("夜色压在街巷上。这成了他今晚最大的难处。"), true);
  assert.match(result.content, /“你还不走？”/);
  assert.equal(result.removedLexicon.includes("推进主线"), true);
});

test("applyDeterministicStylePass hard-trims over-budget prose templates before quick audit", () => {
  const profile = buildFallbackStyleProfile({
    references,
    manualGuidance: "先砍模板味，再做后续返修。",
  });

  profile.writingCharter = {
    ...profile.writingCharter!,
    transitionBudget: {
      ...profile.writingCharter!.transitionBudget,
      maxContrastTemplates: 0,
      maxAbruptTurns: 0,
      maxHardTransitionMarkers: 0,
      hardTransitionMarkers: ["忽然", "骤然", "下一刻"],
    },
    simileBudget: {
      ...profile.writingCharter!.simileBudget,
      maxPerChapter: 1,
      maxPerParagraph: 1,
    },
    subjectLeadBudget: {
      ...profile.writingCharter!.subjectLeadBudget,
      maxPronounLeads: 0,
      maxDominantLeadCount: 1,
      maxSameLeadInWindow: 1,
      windowSize: 3,
    },
  };

  const input = [
    "姜离伏在石后，没有立刻起身。姜离又把刀横过来。姜离听见崖下骨翼拍石。",
    "它先闻见血腥。它又往后缩了半步。",
    "忽然风口一沉。下一刻碎石全都滚了下来。",
    "不是山风，而是崖下那头东西先动了。",
    "胸口像被火钩住，仿佛连骨头都要裂开。",
    "这一瞬，姜离听见裂缝深处像有东西在换气。这一息，他意识到脚下那层湿土正在松。 这意味着他若再往前一步，整片碎石都要翻起来。",
    "更像是一张伏在崖底缓缓张开的嘴。偏偏那股气息没有散，反而一点点压进胸口。偏偏那股气息没有散，反而一点点压进胸口。",
  ].join("\n\n");

  const result = applyDeterministicStylePass(input, profile);
  const signals = inspectProseStyleSignals(result.content);
  const dominantLead = signals.repeatedSentenceStarts.find((entry) => entry.lead === "姜离");

  assert.equal(result.content.includes("忽然"), false);
  assert.equal(result.content.includes("下一刻"), false);
  assert.equal(result.content.includes("不是山风，而是"), false);
  assert.equal(signals.contrastTemplateCount, 0);
  assert.equal(signals.pronounLeadCount, 0);
  assert.equal(signals.simileCount <= 1, true);
  assert.equal(signals.momentMarkerCount <= 1, true);
  assert.equal(signals.explanationLeadCount <= 1, true);
  assert.equal(signals.judgmentLeadCount <= 1, true);
  assert.equal(signals.phraseReuseHits.every((entry) => entry.count <= 2), true);
  assert.equal((dominantLead?.count ?? 0) <= 1, true);
  assert.equal(result.localFlavorSignals.simileCount, signals.simileCount);
  assert.equal(result.localFlavorSignals.contrastTemplateCount, signals.contrastTemplateCount);
  assert.equal(result.localFlavorSignals.abruptTurnCount, signals.abruptTurnCount);
  assert.equal(result.localFlavorSignals.momentMarkerCount, signals.momentMarkerCount);
  assert.equal(result.localFlavorSignals.explanationLeadCount, signals.explanationLeadCount);
  assert.equal(result.localFlavorSignals.judgmentLeadCount, signals.judgmentLeadCount);
  assert.deepEqual(result.localFlavorSignals.phraseReuseHits, signals.phraseReuseHits);
  assert.equal(result.localFlavorSignals.severity, "ok");
});
