import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDeterministicQuickAudit } from "./writing/quick-audit.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";

test("buildDeterministicQuickAudit reuses writingCharter budgets and escalates when they are exceeded", () => {
  const styleProfile = createDefaultStyleProfile();
  const writingCharter = {
    ...styleProfile.writingCharter!,
    endingPolicy: {
      ...styleProfile.writingCharter!.endingPolicy,
      maxConclusionSentences: 0,
    },
    mechanismRevealPolicy: {
      ...styleProfile.writingCharter!.mechanismRevealPolicy,
      maxExplicitSummarySentences: 0,
      maxTriadPatterns: 0,
    },
    transitionBudget: {
      ...styleProfile.writingCharter!.transitionBudget,
      maxContrastTemplates: 0,
      maxAbruptTurns: 0,
      maxHardTransitionMarkers: 1,
    },
    simileBudget: {
      ...styleProfile.writingCharter!.simileBudget,
      maxPerChapter: 1,
      maxPerParagraph: 1,
    },
    subjectLeadBudget: {
      ...styleProfile.writingCharter!.subjectLeadBudget,
      maxPronounLeads: 0,
      maxDominantLeadCount: 3,
      maxSameLeadInWindow: 2,
      windowSize: 6,
    },
    motifReuseBudget: {
      ...styleProfile.writingCharter!.motifReuseBudget,
      maxPerMotif: 2,
      minParagraphSpan: 2,
    },
  };

  const audit = buildDeterministicQuickAudit({
    chapterContent: [
      "咿呀盯着岩缝里那道灵纹，不肯先退。",
      "咿呀又往前挪了一寸，爪尖还压在潮石上。",
      "咿呀听见石缝里有碎响，耳尖轻轻一抖。",
      "咿呀立刻意识到这道灵纹的机制很清楚，这意味着它只要沾上血气就会反咬。",
      "下一刻灵纹果然亮了一下，像冷蛇一样沿着石面爬开。",
      "这也说明这套机制已经被它彻底摸到了门路。",
      "忽然山风倒灌下来，忽然碎石又从高处滚落，然而它还是没退。",
      "不是它想赌，而是这次不赌就再没有机会。",
      "",
      "铜铃贴着断崖轻轻一响，像有人把同一个后患又敲回它耳边。铜铃没停，铜铃的回声反而顺着石缝往里钻。",
      "",
      "咿呀伏低身子，像被冷针一点点缝进骨头里，仿佛连后背细毛都被一寸寸拽紧。宛如潮水倒灌进脊骨，似乎连呼吸都被那道灵纹捏住了。",
      "",
      "这意味着它已经知道接下来该怎么做了。这也说明今晚真正要紧的已经不是眼前这一击，而是更后面的整套变化。总之，它已经把这一层门道全想明白了。",
    ].join("\n\n"),
    blueprint: {
      chapterNo: 8,
      sceneGoal: "让咿呀试探灵纹反咬的边界",
      characters: ["咿呀"],
      locations: ["断崖石缝"],
      conflicts: ["咿呀必须先撞上灵纹反咬，再判断能不能偷学。"],
      foreshadows: ["这道灵纹背后还有更深的追咬。"],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2800,
    },
    hasHardConflict: false,
    writingCharter,
  });

  assert.equal(audit.verdict, "escalate");
  assert.equal(audit.styleChecklistHits.some((hit) => hit.dimension.includes("章末")), true);
  assert.equal(audit.styleChecklistHits.some((hit) => hit.dimension.includes("机制")), true);
  assert.equal(audit.styleChecklistHits.some((hit) => hit.dimension.includes("转场")), true);
  assert.equal(audit.styleChecklistHits.some((hit) => hit.dimension.includes("比喻")), true);
  assert.equal(audit.styleChecklistHits.some((hit) => hit.dimension.includes("句首主体")), true);
  assert.equal(audit.charterViolations.some((hit) => hit.key === "motif_reuse"), true);
  assert.equal(audit.fixInstructions.includes("机制"), true);
});

test("buildDeterministicQuickAudit does not escalate on lexical motif reuse alone", () => {
  const styleProfile = createDefaultStyleProfile();
  const writingCharter = {
    ...styleProfile.writingCharter!,
    motifReuseBudget: {
      ...styleProfile.writingCharter!.motifReuseBudget,
      maxPerMotif: 2,
      minParagraphSpan: 2,
    },
  };

  const audit = buildDeterministicQuickAudit({
    chapterContent: [
      "潮铃在湿墙后轻响，姜离没有立刻探手，只先顺着那一下响动摸到墙缝里的铜屑，再看灰尘往哪一边轻轻滑落。他还特地用刀背敲了两下砖面，分清回音是从近处反弹回来，还是从更里面慢慢送出来，才把手指探进那条新开的细缝。",
      "",
      "第二段里潮铃又响，但真正变化的是墙缝后的暗槽开始缓慢滑开，露出一道原本被泥浆封住的铜边。姜离没有急着碰它，只先把碎泥拨开，试着压了压那块铜边的受力，再辨认里面吹上来的潮风到底偏冷还是偏湿。",
      "",
      "第三段里潮铃第三次响起，姜离借着那条新缝看见了里面更老的一截铜纹，也因此看出这道暗槽并没有完全坏掉。他把这一下变化记进心里，因为真正有用的是墙后终于给出了一条能够继续辨认的痕迹，而不是让他一直停在原地猜来猜去。",
    ].join("\n\n"),
    blueprint: {
      chapterNo: 2,
      sceneGoal: "让姜离借潮铃异动发现旧梯。",
      characters: ["姜离"],
      locations: ["枯井边"],
      conflicts: ["姜离必须先摸清潮铃为何会牵动井壁暗槽。"],
      foreshadows: ["井下还有更老的旧门。"],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2600,
      requiredProgressDelta: "information_shift",
    },
    hasHardConflict: false,
    writingCharter,
  });

  assert.equal(audit.verdict, "pass");
  assert.equal(audit.charterViolations.some((hit) => hit.key === "motif_reuse"), true);
});

test("buildDeterministicQuickAudit flags unfinished draft artifacts through the shared quality guard", () => {
  const audit = buildDeterministicQuickAudit({
    chapterContent: [
      "墨渊贴着墙根往前蹭，刚想抬手，忽然听见墙后像有人咬碎骨头一样地响了一下。",
      "",
      "TODO：这里补一段更有压迫感的追逐。",
    ].join("\n\n"),
    blueprint: {
      chapterNo: 3,
      sceneGoal: "让墨渊确认墙后的追猎已经贴近。",
      characters: ["墨渊"],
      locations: ["夜禁外墙"],
      conflicts: ["墨渊必须先确认追猎方向，再决定要不要翻墙。"],
      foreshadows: ["墙后还有更老的夜禁标记。"],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2600,
    },
    hasHardConflict: false,
  });

  assert.equal(audit.issues.some((issue) => issue.type === "draft_artifact"), true);
  assert.equal(audit.verdict, "escalate");
});

test("Quick and Deep review both enforce the deterministic cross-chapter audit", async () => {
  const [quickSource, deepSource] = await Promise.all([
    readFile(new URL("./run/chapter-audit.ts", import.meta.url), "utf8"),
    readFile(new URL("./run/chapter-review.ts", import.meta.url), "utf8"),
  ]);

  assert.match(quickSource, /auditCrossChapterManuscript/);
  assert.match(quickSource, /crossChapterAudit\.verdict === "escalate"/);
  assert.match(deepSource, /auditCrossChapterManuscript/);
  assert.match(deepSource, /verdict: preserveManualWindow \? "manual_review_window" : "rewrite_current"/);
});
