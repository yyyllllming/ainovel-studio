import test from "node:test";
import assert from "node:assert/strict";
import { assessProseStyleRisk } from "./writing/prose-normalizer.ts";
import { buildDefaultRuntimeReviewSignals } from "./story/story-progression.ts";
import {
  buildAutoProseRescueReview,
  evaluateWritingCharterGate,
  enforceLocalProsePassGate,
  shouldAutoRescueBeforeQuickAudit,
} from "./writing/prose-rescue.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";

function createDeepPassReview(chapterNo: number) {
  const runtimeSignals = buildDefaultRuntimeReviewSignals(null);
  return {
    reviewMode: "deep" as const,
    verdict: "pass" as const,
    confidence: 0.9,
    reason: "深审通过",
    fixInstructions: "无",
    issues: [],
    triggerReasons: [],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: runtimeSignals.storyProgression,
    genreFulfillment: runtimeSignals.genreFulfillment,
    loopRisk: runtimeSignals.loopRisk,
    primaryDeltaDelivered: runtimeSignals.primaryDeltaDelivered,
    stuckDimensions: runtimeSignals.stuckDimensions,
    windowStartChapter: chapterNo,
    windowEndChapter: chapterNo,
    earliestAffectedChapter: chapterNo,
  };
}

test("shouldAutoRescueBeforeQuickAudit rescues early chapters with style-only major drift", () => {
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

  const shouldRescue = shouldAutoRescueBeforeQuickAudit({
    chapterNo: 1,
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
  });

  assert.equal(shouldRescue, true);
});

test("shouldAutoRescueBeforeQuickAudit does not bypass non-style major issues", () => {
  const proseRisk = assessProseStyleRisk("山风掠过林梢，咿呀贴着岩面缓缓挪动。");

  const shouldRescue = shouldAutoRescueBeforeQuickAudit({
    chapterNo: 1,
    retryCount: 0,
    proseRisk,
    quickAudit: {
      verdict: "escalate",
      issues: [
        {
          type: "blueprint_drift",
          location: "全文",
          severity: "major",
        },
        {
          type: "style_drift",
          location: "正文文笔",
          severity: "minor",
        },
      ],
    },
  });

  assert.equal(shouldRescue, false);
});

test("shouldAutoRescueBeforeQuickAudit keeps rescuing early warn-level prose when two risks remain", () => {
  const proseRisk = assessProseStyleRisk([
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

  const shouldRescue = shouldAutoRescueBeforeQuickAudit({
    chapterNo: 3,
    retryCount: 2,
    proseRisk,
    quickAudit: {
      verdict: "escalate",
      issues: [
        {
          type: "style_drift",
          location: "正文文笔",
          severity: "minor",
        },
      ],
    },
  });

  assert.equal(shouldRescue, true);
});

test("shouldAutoRescueBeforeQuickAudit also rescues later chapters when the issue is still pure style drift", () => {
  const proseRisk = assessProseStyleRisk([
    "姜离贴着崖壁往前挪。", "姜离没有回头。", "姜离先听后方碎石声。", "姜离又把呼吸压低。",
    "它知道青狼还在后面。", "像冷水顺着骨头缝往里灌，仿佛连旧伤都被一点点扯开。",
    "不是他想慢，而是前面那条横路太窄。", "忽然一块碎石从上面滚下来，忽然风又从裂口里倒灌。",
  ].join(""));

  const shouldRescue = shouldAutoRescueBeforeQuickAudit({
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
  });

  assert.equal(shouldRescue, true);
});

test("buildAutoProseRescueReview turns prose signals into a writer-facing rescue brief", () => {
  const proseRisk = assessProseStyleRisk([
    "咿呀伏在石缝边，盯着谷底的血光。",
    "咿呀没有立刻扑下去，只把尾巴紧紧收住。",
    "咿呀又抬头看了一眼，耳尖轻轻一抖。",
    "咿呀听见藤身里有水声一样的东西在爬。",
    "咿呀再往前挪时，四爪都压得极轻。",
    "咿呀盯着那枚赤果，连呼吸都一点点收紧。",
    "像冷水顺着骨头缝往里灌，仿佛连胸口那团热意都被压住了。",
    "像裂开的伤口，如同夜里睁开的眼。",
  ].join(""));

  const review = buildAutoProseRescueReview({
    chapterNo: 1,
    proseRisk,
  });

  assert.equal(review.verdict, "rewrite_current");
  assert.equal(review.fixInstructions.includes("咿呀"), true);
  assert.equal(review.fixInstructions.includes("不改剧情事实"), true);
  assert.equal(review.fixInstructions.includes("不要把同一后患反复说三遍"), true);
  assert.equal(review.fixInstructions.includes("先逐段处理句首"), true);
  assert.equal(review.fixInstructions.includes("压到 3 处以内"), true);
  assert.equal(review.issues.some((issue) => issue.type === "style_drift"), true);
});

test("buildAutoProseRescueReview includes concrete deletion quotas for charter overages", () => {
  const proseRisk = assessProseStyleRisk([
    "姜离伏在裂口边，盯着下面的暗腔。", "姜离又往前探了一寸。", "姜离听见石缝里有水声。", "姜离没有立刻退开。",
    "忽然裂口里亮了一下，像冷蛇一样沿着石面爬开。", "下一刻又像细针一样扎进掌心。", "不是他想赌，而是这次不赌就没机会。",
  ].join(""));
  const writingCharter = createDefaultStyleProfile().writingCharter!;

  const review = buildAutoProseRescueReview({
    chapterNo: 9,
    chapterContent: [
      "姜离伏在裂口边，盯着下面的暗腔。",
      "姜离又往前探了一寸。",
      "姜离听见石缝里有水声。",
      "姜离没有立刻退开。",
      "忽然裂口里亮了一下，像冷蛇一样沿着石面爬开。下一刻又像细针一样扎进掌心。",
      "不是他想赌，而是这次不赌就没机会。",
    ].join("\n"),
    proseRisk,
    writingCharter: {
      ...writingCharter,
      transitionBudget: {
        ...writingCharter.transitionBudget,
        maxAbruptTurns: 0,
        maxHardTransitionMarkers: 0,
      },
      simileBudget: {
        ...writingCharter.simileBudget,
        maxPerChapter: 1,
        maxPerParagraph: 1,
      },
    },
  });

  assert.equal(review.fixInstructions.includes("至少删改"), true);
  assert.equal(review.fixInstructions.includes("至少删掉"), true);
});

test("enforceLocalProsePassGate blocks deep-review pass when local prose risk still fails", () => {
  const proseRisk = assessProseStyleRisk([
    "它伏在石后，盯着谷底的血光。",
    "它没有立刻扑下去，只把尾巴紧紧收住。",
    "它又抬头看了一眼，耳尖轻轻一抖。",
    "它听见藤身里有水声一样的东西在爬。",
    "它再往前挪时，四爪都压得极轻。",
    "它盯着那枚赤果，连呼吸都一点点收紧。",
    "它明知不对，却还是舍不得把视线移开。",
    "像冷水顺着骨头缝往里灌，仿佛连胸口那团热意都被压住了。",
    "像裂开的伤口，如同夜里睁开的眼。",
    "像有冷蛇沿着它的脊背慢慢往上爬，像有细针一点点扎进骨缝。",
    "不是它胆小，而是那股血腥气已经贴到了鼻尖。",
    "不是风太冷，而是谷底那株怪藤像活物一样在喘。",
    "不是它想退，而是那股凶气已经像手一样按在它头顶。",
  ].join(""));

  const gated = enforceLocalProsePassGate({
    chapterNo: 1,
    review: createDeepPassReview(1),
    proseRisk,
  });

  assert.equal(gated.verdict, "rewrite_current");
  assert.equal(gated.reason.includes("本地 prose gate"), true);
  assert.equal(gated.fixInstructions.includes("压到 3 处以内"), true);
  assert.equal(gated.issues.some((issue) => issue.type === "style_drift"), true);
});

test("enforceLocalProsePassGate also blocks pass when writingCharter budgets are exceeded", () => {
  const content = [
    "咿呀盯着岩缝里那道灵纹，不肯先退。",
    "咿呀又往前挪了一寸，爪尖还压在潮石上。",
    "咿呀听见石缝里有碎响，耳尖轻轻一抖。",
    "咿呀立刻意识到这道灵纹的机制很清楚，这意味着它只要沾上血气就会反咬。",
    "下一刻灵纹果然亮了一下，像冷蛇一样沿着石面爬开。",
    "这也说明这套机制已经被它彻底摸到了门路。",
    "忽然山风倒灌下来，忽然碎石又从高处滚落，然而它还是没退。",
    "不是它想赌，而是这次不赌就再没有机会。",
    "",
    "咿呀伏低身子，像被冷针一点点缝进骨头里，仿佛连后背细毛都被一寸寸拽紧。宛如潮水倒灌进脊骨，似乎连呼吸都被那道灵纹捏住了。",
    "",
    "这意味着它已经知道接下来该怎么做了。这也说明今晚真正要紧的已经不是眼前这一击，而是更后面的整套变化。总之，它已经把这一层门道全想明白了。",
  ].join("\n\n");
  const proseRisk = assessProseStyleRisk(content);
  const baseCharter = createDefaultStyleProfile().writingCharter!;

  const gated = enforceLocalProsePassGate({
    chapterNo: 8,
    chapterContent: content,
    writingCharter: {
      ...baseCharter,
      endingPolicy: {
        ...baseCharter.endingPolicy,
        maxConclusionSentences: 0,
      },
      mechanismRevealPolicy: {
        ...baseCharter.mechanismRevealPolicy,
        maxExplicitSummarySentences: 0,
        maxTriadPatterns: 0,
      },
      transitionBudget: {
        ...baseCharter.transitionBudget,
        maxContrastTemplates: 0,
        maxAbruptTurns: 0,
        maxHardTransitionMarkers: 1,
      },
      simileBudget: {
        ...baseCharter.simileBudget,
        maxPerChapter: 1,
        maxPerParagraph: 1,
      },
      subjectLeadBudget: {
        ...baseCharter.subjectLeadBudget,
        maxPronounLeads: 0,
        maxDominantLeadCount: 3,
        maxSameLeadInWindow: 2,
        windowSize: 6,
      },
      motifReuseBudget: {
        ...baseCharter.motifReuseBudget,
        maxPerMotif: 2,
        minParagraphSpan: 2,
      },
    },
    review: {
      ...createDeepPassReview(8),
      confidence: 0.92,
    },
    proseRisk,
  });

  assert.equal(gated.verdict, "rewrite_current");
  assert.equal(gated.reason.includes("本地 prose gate"), true);
  assert.equal(gated.fixInstructions.includes("章末"), true);
  assert.equal(gated.fixInstructions.includes("机制"), true);
  assert.equal(gated.styleChecklistHits.some((hit) => hit.dimension.includes("章末")), true);
  assert.equal(gated.styleChecklistHits.some((hit) => hit.dimension.includes("机制")), true);
  assert.equal(gated.styleChecklistHits.some((hit) => hit.dimension.includes("转场")), true);
  assert.equal(gated.styleChecklistHits.some((hit) => hit.dimension.includes("比喻")), true);
  assert.equal(gated.styleChecklistHits.some((hit) => hit.dimension.includes("句首主体")), true);
});

test("evaluateWritingCharterGate ignores functional motif stopwords and quoted charter stopwords", () => {
  const content = [
    "山风压下来，石缝里的灰立刻往外冒。姜离刚抬手，立刻闻到一股旧腥气。",
    "阿绛往下看时，碎石又立刻滚下来，却没有真的砸到人。",
    "潮气顺着崖面压下来，立刻又被骨鸣顶开，谁也没有先动。",
  ].join("\n\n");
  const proseRisk = assessProseStyleRisk(content);
  const baseCharter = createDefaultStyleProfile().writingCharter!;

  const gated = evaluateWritingCharterGate({
    chapterContent: content,
    proseRisk,
    writingCharter: {
      ...baseCharter,
      transitionBudget: {
        ...baseCharter.transitionBudget,
        maxHardTransitionMarkers: 10,
        maxAbruptTurns: 10,
        maxContrastTemplates: 10,
      },
      simileBudget: {
        ...baseCharter.simileBudget,
        maxPerChapter: 10,
        maxPerParagraph: 10,
      },
      subjectLeadBudget: {
        ...baseCharter.subjectLeadBudget,
        maxPronounLeads: 10,
        maxDominantLeadCount: 10,
        maxSameLeadInWindow: 10,
        windowSize: 8,
      },
      motifReuseBudget: {
        ...baseCharter.motifReuseBudget,
        maxPerMotif: 1,
        minParagraphSpan: 2,
        stopwords: ["不要统计“立刻”", "不要统计“下来”"],
      },
    },
  });

  assert.equal(gated.budgetViolations.some((hit) => `${hit.label} ${hit.detail} ${hit.evidence.join(" ")}`.includes("立刻")), false);
  assert.equal(gated.budgetViolations.some((hit) => `${hit.label} ${hit.detail} ${hit.evidence.join(" ")}`.includes("下来")), false);
});

test("evaluateWritingCharterGate returns structured budget violations including motif reuse", () => {
  const baseCharter = createDefaultStyleProfile().writingCharter!;
  const chapterContent = [
    "风先卷过巷口，那枚铜铃响了一下，压得人肩骨发冷。",
    "",
    "巷子里的风往回卷时，那枚铜铃第二次响起，连门框都跟着轻颤。",
    "",
    "他没有说话，只盯着门缝里那点影子继续后退。",
    "",
    "等影子贴到墙边，那枚铜铃第三次贴着耳边摇开，连墙上的影子都像被同一只手推了一把。",
  ].join("\n\n");
  const proseRisk = assessProseStyleRisk(chapterContent);
  const gate = evaluateWritingCharterGate({
    chapterContent,
    proseRisk,
    writingCharter: {
      ...baseCharter,
      motifReuseBudget: {
        ...baseCharter.motifReuseBudget,
        maxPerMotif: 2,
        minParagraphSpan: 2,
      },
    },
  });

  assert.equal(gate.reuseSeverity, "lexical");
  assert.equal(gate.shouldBlock, false);
  assert.equal(gate.budgetViolations.some((entry) => entry.key === "motif_reuse"), true);
  assert.equal(gate.budgetViolations.some((entry) => entry.key === "motif_reuse" && entry.evidence.join(" ").includes("铜铃")), true);
});

test("evaluateWritingCharterGate does not count the dominant sentence lead as motif reuse evidence", () => {
  const baseCharter = createDefaultStyleProfile().writingCharter!;
  const chapterContent = [
    "姜离贴着石壁往前挪。姜离没回头。",
    "",
    "姜离听见后方碎石声，还是继续前压。",
    "",
    "姜离再抬眼时，才看见裂口里那点暗红。",
  ].join("\n\n");
  const proseRisk = assessProseStyleRisk(chapterContent);
  const gate = evaluateWritingCharterGate({
    chapterContent,
    proseRisk,
    writingCharter: {
      ...baseCharter,
      motifReuseBudget: {
        ...baseCharter.motifReuseBudget,
        maxPerMotif: 2,
        minParagraphSpan: 2,
      },
    },
  });

  assert.equal(
    gate.budgetViolations.some((entry) => entry.key === "motif_reuse" && entry.evidence.includes("姜离")),
    false,
  );
});

test("evaluateWritingCharterGate downgrades pure lexical motif reuse to non-blocking", () => {
  const baseCharter = createDefaultStyleProfile().writingCharter!;
  const chapterContent = [
    "潮铃在巷口响了一下。姜离没抬头，只是继续往前试探。",
    "",
    "第二段里潮铃又响，像有人在门后试音，但这一次真正变化的是门栓自己退开了。",
    "",
    "第三段里潮铃第三次响起，姜离顺着门栓留下的缝隙看见了新路。",
  ].join("\n\n");
  const proseRisk = assessProseStyleRisk(chapterContent);
  const gate = evaluateWritingCharterGate({
    chapterContent,
    proseRisk,
    writingCharter: {
      ...baseCharter,
      motifReuseBudget: {
        ...baseCharter.motifReuseBudget,
        maxPerMotif: 2,
        minParagraphSpan: 2,
      },
    },
  });

  assert.equal(gate.reuseSeverity, "lexical");
  assert.equal(gate.shouldBlock, false);
  assert.equal(gate.budgetViolations.some((entry) => entry.key === "motif_reuse"), true);
});

test("evaluateWritingCharterGate keeps structural motif reuse as blocking", () => {
  const baseCharter = createDefaultStyleProfile().writingCharter!;
  const chapterContent = [
    "铜铃在断壁边响起，姜离又一次贴墙后退，先判断自己还能不能活着脱身。",
    "",
    "第二段里铜铃继续在断壁边响，姜离还是贴墙后退，仍旧只在判断自己能不能活着脱身。",
    "",
    "第三段里铜铃第三次在断壁边响，姜离照旧贴墙后退，局势没有换，连代价都还是同一种窒息感。",
  ].join("\n\n");
  const proseRisk = assessProseStyleRisk(chapterContent);
  const gate = evaluateWritingCharterGate({
    chapterContent,
    proseRisk,
    writingCharter: {
      ...baseCharter,
      motifReuseBudget: {
        ...baseCharter.motifReuseBudget,
        maxPerMotif: 2,
        minParagraphSpan: 2,
      },
    },
  });

  assert.equal(gate.reuseSeverity, "structural");
  assert.equal(gate.shouldBlock, true);
});
