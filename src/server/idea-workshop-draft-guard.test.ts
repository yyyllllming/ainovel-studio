import test from "node:test";
import assert from "node:assert/strict";
import {
  guardIdeaWorkshopDraftAgainstThinning,
  type IdeaWorkshopDraft,
} from "./foundation/idea-workshop.ts";

function createIdeaDraft(overrides: Partial<IdeaWorkshopDraft> = {}): IdeaWorkshopDraft {
  return {
    premise: "",
    mainline: "",
    storyHook: "",
    desiredTone: "",
    characterIdeas: [],
    worldviewIdeas: [],
    relationshipIdeas: [],
    unresolvedQuestions: [],
    styleReferences: [],
    styleSamples: [],
    styleManualGuidance: "",
    styleAvoidances: "",
    styleSteeringCard: "",
    styleDigest: "",
    styleExemplars: [],
    styleSnapshotId: null,
    styleSnapshotVersion: null,
    ...overrides,
  };
}

test("guardIdeaWorkshopDraftAgainstThinning passes through when there is no previous draft", () => {
  const next = createIdeaDraft({ premise: "全新 premise" });

  assert.equal(guardIdeaWorkshopDraftAgainstThinning(null, next), next);
  assert.equal(guardIdeaWorkshopDraftAgainstThinning(undefined, next), next);
});

test("guardIdeaWorkshopDraftAgainstThinning restores characters dropped by a truncated rewrite", () => {
  const previous = createIdeaDraft({
    characterIdeas: [
      { name: "陆渊", role: "protagonist", goal: "旧目标", traits: ["谨慎"] },
      { name: "白泽", role: "mentor", goal: "守住骨书", traits: [] },
      { name: "灰雀", role: "antagonist", goal: "夺走骨书", traits: [] },
    ],
  });
  const next = createIdeaDraft({
    characterIdeas: [
      { name: "陆 渊", role: "protagonist", goal: "新目标", traits: ["谨慎", "会伪装"] },
    ],
  });

  const guarded = guardIdeaWorkshopDraftAgainstThinning(previous, next);

  assert.equal(guarded.characterIdeas.length, 3);
  // 同名（规范化后）角色采用新版本，被丢掉的角色按名称补回。
  assert.deepEqual(guarded.characterIdeas[0], {
    name: "陆 渊",
    role: "protagonist",
    goal: "新目标",
    traits: ["谨慎", "会伪装"],
  });
  assert.deepEqual(
    guarded.characterIdeas.slice(1).map((item) => item.name),
    ["白泽", "灰雀"],
  );
});

test("guardIdeaWorkshopDraftAgainstThinning restores worldview entries and a shortened premise", () => {
  const previous = createIdeaDraft({
    premise: "一个每说一次谎就会丢掉一段真实记忆的骗子，被迫潜入夜禁城市找回自己的名字。",
    worldviewIdeas: [
      { name: "谎言代价", description: "每说一次谎都会失去一段真实记忆。" },
      { name: "夜禁", description: "入夜后城市封锁，巡夜人接管街道。" },
    ],
  });
  const next = createIdeaDraft({
    premise: "骗子找名字。",
    worldviewIdeas: [
      { name: "谎言代价", description: "代价升级：重要的谎失去得更重。" },
    ],
  });

  const guarded = guardIdeaWorkshopDraftAgainstThinning(previous, next);

  assert.equal(guarded.premise, previous.premise);
  assert.deepEqual(guarded.worldviewIdeas, [
    { name: "谎言代价", description: "代价升级：重要的谎失去得更重。" },
    { name: "夜禁", description: "入夜后城市封锁，巡夜人接管街道。" },
  ]);
});

test("guardIdeaWorkshopDraftAgainstThinning keeps a richer rewrite untouched", () => {
  const previous = createIdeaDraft({
    premise: "旧 premise",
    characterIdeas: [
      { name: "陆渊", role: "protagonist", goal: "旧目标", traits: [] },
    ],
    worldviewIdeas: [
      { name: "谎言代价", description: "旧描述" },
    ],
  });
  const next = createIdeaDraft({
    premise: "更长更具体的新 premise，补全了冲突与代价。",
    characterIdeas: [
      { name: "陆渊", role: "protagonist", goal: "新目标", traits: ["谨慎"] },
      { name: "白泽", role: "mentor", goal: "守住骨书", traits: [] },
    ],
    worldviewIdeas: [
      { name: "谎言代价", description: "新描述" },
      { name: "夜禁", description: "入夜后城市封锁。" },
    ],
  });

  const guarded = guardIdeaWorkshopDraftAgainstThinning(previous, next);

  assert.equal(guarded.premise, next.premise);
  assert.deepEqual(guarded.characterIdeas, next.characterIdeas);
  assert.deepEqual(guarded.worldviewIdeas, next.worldviewIdeas);
});
