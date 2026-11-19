import test from "node:test";
import assert from "node:assert/strict";
import type { ChapterBlueprint } from "./types.ts";
import {
  assessBlueprintFocusRisk,
  buildOpeningChapterSteering,
  repairOpeningBlueprintPlaceholders,
  buildReviewSteeringInstructions,
} from "./story/chapter-steering.ts";

function createBlueprint(overrides: Partial<ChapterBlueprint> = {}): ChapterBlueprint {
  return {
    chapterNo: 1,
    sceneGoal: "让咿呀在当前主线里做出关键行动，并为此付出代价",
    characters: ["咿呀"],
    locations: ["断崖石缝"],
    conflicts: ["咿呀眼前的计划出现变数"],
    foreshadows: ["留下一个暂时还解不开的新疑问"],
    emotionalTone: "压低声势，逐步绷紧",
    estimatedWords: 2800,
    ...overrides,
  };
}

test("buildOpeningChapterSteering tightens opening chapters around immediate goal and mystery budget", () => {
  const guidance = buildOpeningChapterSteering({
    chapterNo: 2,
    protagonistName: "咿呀",
    currentVolumeGoal: "建立人物关系、核心规则与第一层主线冲突。",
    projectPremise: "咿呀能在灵纹暴露时偷学异兽天赋。",
  });

  assert.equal(guidance.some((entry) => entry.includes("即时目标")), true);
  assert.equal(guidance.some((entry) => entry.includes("一个核心新疑问")), true);
  assert.equal(guidance.some((entry) => entry.includes("偷学异兽天赋")), true);
});

test("assessBlueprintFocusRisk flags generic and overstuffed opening blueprints", () => {
  const result = assessBlueprintFocusRisk(
    createBlueprint({
      chapterNo: 2,
      characters: ["咿呀", "青鳞狼", "黑羽灵雀", "石甲猿"],
      locations: ["当前主场景", "古殿", "古池"],
      conflicts: [
        "咿呀必须先在当前地点活下来，并把刚得到的机缘或线索带出去",
        "青鳞狼争夺金血",
        "裂岩兽堵住退路",
        "古池残阵开始异动",
      ],
      foreshadows: [
        "只留下一个和天赋灵纹来源或更深追猎有关的新疑问",
        "更古老的存在在山中苏醒",
        "整片山场将因旧鳞暴动",
      ],
    }),
  );

  assert.equal(result.shouldRepair, true);
  assert.equal(result.severity, "fail");
  assert.equal(result.notes.some((entry) => entry.includes("sceneGoal 仍然过泛")), true);
  assert.equal(result.notes.some((entry) => entry.includes("占位写法")), true);
  assert.equal(result.notes.some((entry) => entry.includes("摘要词")), true);
  assert.equal(result.notes.some((entry) => entry.includes("冲突")), true);
  assert.equal(result.notes.some((entry) => entry.includes("伏笔")), true);
});

test("assessBlueprintFocusRisk also flags stalled later blueprints that fall back to generic placeholders", () => {
  const result = assessBlueprintFocusRisk(
    createBlueprint({
      chapterNo: 12,
      sceneGoal: "让姜离围绕眼前的异兽灵纹或求生机缘采取一次冒险行动，并立刻承担受伤、暴露或被追踪的代价",
      characters: ["姜离", "裂爪青狼", "黑羽鹫"],
      locations: ["断崖山场", "灵纹偷学"],
      conflicts: [
        "姜离必须先在当前地点活下来，并把刚得到的机缘或线索带出去",
        "姜离的偷学或试探会立刻引来反噬、伤势或追踪压力",
      ],
      foreshadows: ["只留下一个和天赋灵纹来源或更深追猎有关的新疑问"],
    }),
  );

  assert.equal(result.shouldRepair, true);
  assert.equal(result.notes.some((entry) => entry.includes("fallback")), true);
  assert.equal(result.notes.some((entry) => entry.includes("机制名词")), true);
  assert.equal(result.notes.some((entry) => entry.includes("剧情会原地打转")), true);
  assert.equal(result.notes.some((entry) => entry.includes("空钩")), true);
});

test("repairOpeningBlueprintPlaceholders turns summary-like opening blueprints into concrete first-pass instructions", () => {
  const repaired = repairOpeningBlueprintPlaceholders({
    blueprint: createBlueprint({
      chapterNo: 1,
      characters: ["咿呀"],
      locations: ["当前地点"],
      conflicts: [
        "咿呀必须先在当前地点活下来，并把刚得到的机缘或线索带出去",
        "咿呀的偷学或试探会立刻引来反噬、伤势或追踪压力",
      ],
      foreshadows: ["只留下一个和天赋灵纹来源或更深追猎有关的新疑问"],
    }),
    protagonistName: "咿呀",
    currentVolumeGoal: "建立人物关系、核心规则与第一层主线冲突。",
    projectPremise: "咿呀能在灵纹暴露时偷学异兽天赋。",
    foundationCharacters: [
      { name: "咿呀", role: "protagonist" },
      { name: "裂爪青狼", role: "hunter" },
      { name: "黑羽鹫", role: "rival" },
    ],
    foundationWorldview: [
      { name: "断崖山场", description: "开篇活动区域多断崖、石涧与伏伤异兽，夜里血腥味重。" },
      { name: "偷学代价", description: "每次强行刻印灵纹，都会失血、刺痛并引来反噬。" },
      { name: "气息追猎", description: "一旦偷学成功，原主或同族可能沿着残留灵纹反向追踪。" },
    ],
  });

  assert.equal(repaired.locations.includes("当前地点"), false);
  assert.equal(repaired.conflicts.some((entry) => entry.includes("机缘或线索")), false);
  assert.equal(repaired.foreshadows.some((entry) => /只留下一个|新疑问|来源/u.test(entry)), false);
  assert.equal(assessBlueprintFocusRisk(repaired).shouldRepair, false);
});

test("repairOpeningBlueprintPlaceholders keeps non-fantasy projects free of hardcoded mythic copy", () => {
  const repaired = repairOpeningBlueprintPlaceholders({
    blueprint: createBlueprint({
      chapterNo: 2,
      sceneGoal: "让林晚在当前主线里做出关键行动，并为此付出代价",
      characters: ["林晚"],
      locations: ["当前地点"],
      conflicts: ["林晚必须先在当前地点活下来，并把刚得到的机缘或线索带出去"],
      foreshadows: ["只留下一个和天赋灵纹来源或更深追猎有关的新疑问"],
    }),
    protagonistName: "林晚",
    currentVolumeGoal: "查清母亲留下的债务来历，并保住出租屋。",
    projectPremise: "都市女孩林晚在催收逼近时发现母亲留下的旧账本。",
    foundationCharacters: [
      { name: "林晚", role: "protagonist" },
      { name: "陈默", role: "对手" },
    ],
    foundationWorldview: [
      { name: "城中村出租屋", description: "林晚的落脚点，邻里耳目众多，进出都有人记着。" },
      { name: "债务盘查", description: "催收的人会顺着线索追踪欠款人的行迹。" },
    ],
  });

  const combined = [repaired.sceneGoal, ...repaired.conflicts, ...repaired.foreshadows, ...repaired.locations].join("\n");
  assert.doesNotMatch(combined, /灵纹|偷学|兽道|断崖山场|异兽/u);
  assert.equal(repaired.sceneGoal.includes("林晚"), true);
  assert.equal(repaired.locations.includes("当前地点"), false);
  assert.equal(repaired.locations.includes("城中村出租屋"), true);
  assert.equal(assessBlueprintFocusRisk(repaired).shouldRepair, false);
});

test("repairOpeningBlueprintPlaceholders leaves concrete opening blueprints untouched", () => {
  const blueprint = createBlueprint({
    chapterNo: 2,
    sceneGoal: "让林晚把旧账本藏进夹墙，并亲眼确认陈默已经摸到楼下。",
    characters: ["林晚", "陈默"],
    locations: ["城中村出租屋"],
    conflicts: ["陈默堵住楼道，林晚必须在他敲门前处理掉账本。"],
    foreshadows: ["账本最后一页的笔迹不是母亲的。"],
  });

  const repaired = repairOpeningBlueprintPlaceholders({
    blueprint,
    protagonistName: "林晚",
    currentVolumeGoal: "查清母亲留下的债务来历。",
    projectPremise: "都市女孩林晚在催收逼近时发现母亲留下的旧账本。",
    foundationCharacters: [
      { name: "林晚", role: "protagonist" },
      { name: "陈默", role: "对手" },
    ],
    foundationWorldview: [
      { name: "城中村出租屋", description: "林晚的落脚点，邻里耳目众多。" },
    ],
  });

  assert.equal(repaired, blueprint);
});

test("buildReviewSteeringInstructions turns repeated review problems into reusable constraints", () => {
  const instructions = buildReviewSteeringInstructions({
    chapterNo: 2,
    issues: [
      { type: "progression", location: "开头", severity: "major" },
      { type: "world_rule", location: "中段", severity: "major" },
      { type: "foreshadow_debt", location: "结尾", severity: "major" },
      { type: "pacing", location: "后半", severity: "major" },
    ],
    fixInstructions:
      "补清承接，写清偷学灵纹为何此刻生效又迅速失控，压低揭示强度，只保留一个核心新疑问。",
    reason: "当前章承接不稳、规则含混、揭示过量。",
  });

  assert.equal(instructions.some((entry) => entry.includes("承接上一章最后动作")), true);
  assert.equal(instructions.some((entry) => entry.includes("触发条件")), true);
  assert.equal(instructions.some((entry) => entry.includes("一个核心新疑问")), true);
  assert.equal(instructions.some((entry) => entry.includes("章末只保留一个新的风险")), true);
});
