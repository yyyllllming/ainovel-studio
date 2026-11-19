import test from "node:test";
import assert from "node:assert/strict";
import { auditCrossChapterManuscript, charactersPresentInWindow } from "./writing/cross-chapter-audit.ts";

const base = {
  chapterNo: 3,
  previousChapters: [
    {
      chapterNo: 2,
      text: "林雾离开南码头，沿石阶走向旧钟楼。她把铜牌收进口袋，约定天亮前再见。",
    },
  ],
  previousEndState: {
    location: "南码头",
    timeMarker: "深夜",
    charactersPresent: ["林雾"],
  },
  currentStartState: {
    location: "旧钟楼",
    timeMarker: "次日清晨",
    charactersPresent: ["林雾"],
  },
};

test("cross-chapter audit escalates exact paragraph and long n-gram overlap", () => {
  const copied = "潮水退到第三根石柱时，林雾把登记册翻到夹着蓝线的那一页，逐字核对失物编号。";
  const result = auditCrossChapterManuscript({
    ...base,
    previousChapters: [{ chapterNo: 2, text: `${copied}\n\n她随后离开。` }],
    currentText: `${copied}\n\n门外响起新的脚步声。`,
  });
  assert.equal(result.verdict, "escalate");
  assert.equal(result.issues.some((issue) => issue.type === "cross_chapter_overlap"), true);
  assert.equal(result.overlapScore > 0.2, true);
});

test("cross-chapter audit detects repeated ritual or warning scene templates", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    previousChapters: [{ chapterNo: 2, text: "守门人敲响铜铃，宣读三条禁令，众人依次按下血印，门才打开。" }],
    currentText: "守门人再次敲响铜铃，宣读禁令，众人依次按下血印，随后石门打开。",
  });
  assert.equal(result.repeatedSceneTags.includes("ritual_gate"), true);
  assert.equal(result.verdict, "escalate");
});

test("cross-chapter audit detects unbridged character, location, and time discontinuity", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    currentText: "沈檀掀开桌布，拿走了账册。",
    currentStartState: {
      location: "北山塔顶",
      timeMarker: "前夜",
      charactersPresent: ["林雾", "沈檀"],
    },
  });
  assert.equal(result.issues.some((issue) => issue.type === "character_reentry_without_bridge"), true);
  assert.equal(result.issues.some((issue) => issue.type === "location_jump_without_bridge"), true);
  assert.equal(result.issues.some((issue) => issue.type === "time_reversal_without_flashback"), true);
});

test("cross-chapter audit ignores blueprint characters absent from the opening", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    currentText: "林雾翻开账册，发现夹在中间的页码已经被人擦去。",
    currentStartState: {
      ...base.currentStartState,
      charactersPresent: ["林雾", "周野"],
    },
  });

  assert.equal(result.issues.some((issue) => issue.type === "character_reentry_without_bridge"), false);
});

test("cross-chapter audit accepts an explicit scene-resident bridge", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    currentText: "沈檀仍在驾驶位，听见林雾上车后才关门。",
    currentStartState: {
      ...base.currentStartState,
      charactersPresent: ["林雾", "沈檀"],
    },
  });

  assert.equal(result.issues.some((issue) => issue.type === "character_reentry_without_bridge"), false);
});

test("cross-chapter audit detects broken manuscript surface and weak endings", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    previousChapters: [],
    previousEndState: null,
    currentStartState: null,
    currentText: "林雾推开门（却没有进去。\n\n【待补：解释钥匙来源】\n\n总之，这一章说明了很多事情，但这一切究竟意味着什么？",
  });
  for (const type of ["unpaired_punctuation", "placeholder", "summary_ending", "empty_question_hook"]) {
    assert.equal(result.issues.some((issue) => issue.type === type), true, type);
  }
});

test("cross-chapter audit detects an incomplete final sentence", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    previousChapters: [],
    previousEndState: null,
    currentStartState: null,
    currentText: "林雾抓住门环，正要把藏在门后的名字念出来，却忽然",
  });
  assert.equal(result.issues.some((issue) => issue.type === "incomplete_sentence"), true);
  assert.equal(result.verdict, "escalate");
});

test("cross-chapter audit accepts explicit travel, flashbacks, and deliberate refrains", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    previousChapters: [{ chapterNo: 2, text: "母亲说过：“雾散以后，记得回家。”" }],
    currentText: "她连夜乘渡船离开南码头，次日清晨抵达旧钟楼。回忆里，时间退回前夜，母亲那句“雾散以后，记得回家”又响了一次。沈檀随后推门赶到，把账册放在桌上。",
    currentStartState: {
      location: "旧钟楼",
      timeMarker: "前夜",
      charactersPresent: ["林雾", "沈檀"],
    },
  });
  assert.equal(result.issues.some((issue) => issue.type.includes("without_bridge") || issue.type === "time_reversal_without_flashback"), false);
  assert.equal(result.repeatedSceneTags.length, 0);
});

test("charactersPresentInWindow keeps only candidate names that appear in the text window", () => {
  assert.deepEqual(
    charactersPresentInWindow("周野仍在驾驶位，林雾坐进后排。", ["林雾", "周野", "林见夏"]),
    ["林雾", "周野"],
  );
  assert.deepEqual(
    charactersPresentInWindow("林雾把账册翻开，低声说：“林见夏还在南码头等着。”", ["林雾", "林见夏"]),
    ["林雾"],
  );
  assert.deepEqual(
    charactersPresentInWindow("林雾忽然想起林见夏把铜牌留下的那天。", ["林雾", "林见夏"]),
    ["林雾"],
  );
  assert.deepEqual(
    charactersPresentInWindow("林雾说：“林见夏还在码头。”随后林见夏推门进来。", ["林雾", "林见夏"]),
    ["林雾", "林见夏"],
  );
});

test("cross-chapter audit does not treat a flashback mention as unbridged reentry", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    currentText: "林雾忽然想起林见夏把铜牌留下的那天，于是把账册翻到第一页。",
    currentStartState: {
      ...base.currentStartState,
      charactersPresent: ["林雾", "林见夏"],
    },
  });
  assert.equal(result.issues.some((issue) => issue.type === "character_reentry_without_bridge"), false);
});

test("cross-chapter audit does not treat a quoted dialogue mention as unbridged reentry", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    currentText: "林雾把账册翻开，低声说：“林见夏还在南码头等着。”",
    currentStartState: {
      ...base.currentStartState,
      charactersPresent: ["林雾", "林见夏"],
    },
  });
  assert.equal(result.issues.some((issue) => issue.type === "character_reentry_without_bridge"), false);
});

test("cross-chapter audit still flags an unbridged entry after an earlier quoted mention", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    currentText: "林雾说：“沈檀不会来。”沈檀掀开桌布，拿走了账册。",
    currentStartState: {
      location: "北山塔顶",
      timeMarker: "前夜",
      charactersPresent: ["林雾", "沈檀"],
    },
  });
  assert.equal(result.issues.some((issue) => issue.type === "character_reentry_without_bridge"), true);
});

test("cross-chapter reentry issues include the character name as evidence", () => {
  const result = auditCrossChapterManuscript({
    ...base,
    currentText: "沈檀掀开桌布，拿走了账册。",
    currentStartState: {
      location: "北山塔顶",
      timeMarker: "前夜",
      charactersPresent: ["林雾", "沈檀"],
    },
  });
  const reentry = result.issues.find((issue) => issue.type === "character_reentry_without_bridge");
  assert.equal(reentry?.evidence.includes("沈檀"), true);
});
