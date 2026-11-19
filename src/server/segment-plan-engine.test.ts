import test from "node:test";
import assert from "node:assert/strict";

import { applyNarrativeFieldsToSegmentItem } from "./story/segment-plan-engine.ts";
import type { SegmentPlanItem } from "./types.ts";

function createItem(overrides: Partial<SegmentPlanItem> = {}): SegmentPlanItem {
  return {
    id: "segment-item-4",
    chapterNo: 4,
    title: "第 4 章推进位",
    intent: "让林舟拿到第一条会改写调查方向的新线索。",
    requiredProgressDeltas: ["information_shift"],
    requiredObligations: [],
    focusCharacters: ["林舟"],
    arenaHints: ["旧港仓栈"],
    suggestedActionPattern: null,
    antagonistHint: null,
    forbiddenRecentAxes: [],
    narrativeTitle: null,
    narrativeIntent: null,
    narrativeSummary: null,
    arcConnection: null,
    nextHook: null,
    rewriteStatus: "pending",
    userOverridden: false,
    ...overrides,
  };
}

test("applyNarrativeFieldsToSegmentItem never overwrites skeleton fields", () => {
  const next = applyNarrativeFieldsToSegmentItem(
    createItem(),
    {
      narrativeTitle: "逼近黑匣子的旧栈桥",
      narrativeIntent: "让林舟先确认旧港里谁在提前收网。",
      narrativeSummary: "林舟在旧港仓栈逼近黑匣子线索，同时让顾南的站位变得更危险。",
      arcConnection: "把旧港调查线真正推到黑匣子主人身上。",
      nextHook: "下一章必须接住黑匣子主人的提前布网。",
    },
  );

  assert.equal(next.title, "第 4 章推进位");
  assert.equal(next.intent, "让林舟拿到第一条会改写调查方向的新线索。");
  assert.equal(next.narrativeTitle, "逼近黑匣子的旧栈桥");
  assert.equal(next.rewriteStatus, "ready");
});

test("applyNarrativeFieldsToSegmentItem respects userOverridden narrative fields", () => {
  const next = applyNarrativeFieldsToSegmentItem(
    createItem({
      narrativeTitle: "用户手改标题",
      userOverridden: true,
    }),
    {
      narrativeTitle: "模型生成标题",
      narrativeIntent: "模型生成意图",
      narrativeSummary: "模型生成摘要",
      arcConnection: "模型生成主线连接",
      nextHook: "模型生成下一钩子",
    },
  );

  assert.equal(next.narrativeTitle, "用户手改标题");
  assert.equal(next.narrativeIntent, "模型生成意图");
  assert.equal(next.nextHook, "模型生成下一钩子");
  assert.equal(next.rewriteStatus, "ready");
});
