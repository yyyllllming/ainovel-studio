import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStructurePlan,
  deriveObligationCards,
  scoreStructure,
} from "./content/structure-engine.ts";

test("structure engine derives obligation cards and bounded scene cards", () => {
  const obligationCards = deriveObligationCards({
    chapterNo: 4,
    futureContext: [
      "必须保持：姜离已经暴露血气痕迹。",
      "可以暗示：更深的古地禁忌会顺着石壁回响苏醒。",
      "不要重复：不要再把上一章的断骨山谷逃亡整段复述。",
    ],
    nextSegmentIntent: "让姜离拿到能改写路线的新线索。",
    requiredObligations: ["introduce_new_mythic_novelty", "relationship_shift"],
  });

  const plan = buildStructurePlan({
    chapterNo: 4,
    sceneGoal: "让姜离沿着石壁回响摸到新线索，并立刻承担代价。",
    primaryConflict: "姜离一伸手就会暴露给顺着血气逼近的旧追迹者。",
    foreshadow: "章末留下更深禁忌已经被惊醒的后患。",
    protagonistName: "姜离",
    supportNames: ["阿绛"],
    locationAnchors: ["断骨山谷北侧裂缝", "祭痕石壁"],
    worldAnchors: ["石壁回响", "古地禁忌"],
    currentVolumeGoal: "确认古地深处真正的源头。",
    previousChapterTail: "姜离贴着裂缝停住呼吸。",
    obligationCards,
    mythicStory: true,
    requiredProgressDeltas: ["information_shift", "world_shift"],
    avoidAxes: ["arena_loop"],
  });

  assert.equal(plan.sceneCards.length >= 2 && plan.sceneCards.length <= 4, true);
  assert.equal(plan.obligationCards.length >= 3, true);
  assert.match(plan.structureBrief, /不可逆变化/);
  assert.match(plan.storyBrief, /当前章要做的事/);
  assert.equal(plan.sceneCards.every((card) => card.irreversibleChange.trim().length > 0), true);
  assert.equal(plan.sceneCards.every((card) => card.hookType.trim().length > 0), true);
  assert.equal(plan.riskFlags.includes("avoid:arena_loop"), true);
});

test("structure engine scoreStructure flags recap-heavy and loop-heavy outputs", () => {
  const score = scoreStructure({
    sceneCards: [
      {
        id: "scene-1",
        label: "Scene 1",
        objective: "复述上一章断骨山谷的逃亡。",
        obstacle: "旧追迹者继续追。",
        irreversibleChange: "没有变化。",
        hookType: "new_risk",
        requiredAnchors: ["断骨山谷"],
      },
      {
        id: "scene-2",
        label: "Scene 2",
        objective: "继续在断骨山谷里逃。",
        obstacle: "旧追迹者继续追。",
        irreversibleChange: "还是没有变化。",
        hookType: "new_risk",
        requiredAnchors: ["断骨山谷"],
      },
    ],
    chapterContent: "上一章姜离如何逃命，这一章仍是同样的断骨山谷逃亡。",
  });

  assert.equal(score.score < 0.65, true);
  assert.equal(score.risk, "risk");
  assert.equal(score.flags.some((flag) => flag.includes("recap_opening")), true);
  assert.equal(score.flags.some((flag) => flag.includes("loop_risk")), true);
});
