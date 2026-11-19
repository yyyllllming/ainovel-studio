import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPlaceholderCharacterNames,
  isPlaceholderCharacterName,
  normalizeBlueprintCharacterReferences,
  normalizeFoundationCharacterReferences,
} from "./character/character-name-normalization.ts";
import type { ChapterBlueprint, FoundationPayload } from "./types.ts";

test("isPlaceholderCharacterName detects role-style placeholder names", () => {
  assert.equal(isPlaceholderCharacterName("主角"), true);
  assert.equal(isPlaceholderCharacterName("男主角"), true);
  assert.equal(isPlaceholderCharacterName("反派"), true);
  assert.equal(isPlaceholderCharacterName("林舟"), false);
});

test("normalizeFoundationCharacterReferences renames placeholder characters from workshop roles and rewrites references", () => {
  const foundation: FoundationPayload = {
    premise: "主角在反派的追杀下逃回山门。",
    styleCard: "克制、苍凉",
    characters: [
      {
        name: "主角",
        role: "主角",
        goal: "主角要查清自己的血脉来历",
        traits: ["倔强"],
      },
      {
        name: "反派",
        role: "反派",
        goal: "夺走主角身上的遗骨",
        traits: ["狠厉"],
      },
    ],
    worldview: [
      {
        name: "山门",
        description: "主角曾在这里短暂栖身。",
      },
    ],
    relationships: [
      {
        source: "主角",
        target: "反派",
        label: "主角与反派之间旧怨极深",
      },
    ],
  };

  const normalized = normalizeFoundationCharacterReferences(foundation, {
    workshopCharacters: [
      {
        name: "林舟",
        role: "主角",
        goal: "查明血脉来历",
        traits: ["敏锐"],
      },
      {
        name: "晏无咎",
        role: "反派",
        goal: "夺走遗骨",
        traits: ["冷酷"],
      },
    ],
  });

  assert.equal(hasPlaceholderCharacterNames(normalized.characters), false);
  assert.deepEqual(
    normalized.characters.map((character) => character.name),
    ["林舟", "晏无咎"],
  );
  assert.equal(normalized.premise, "林舟在晏无咎的追杀下逃回山门。");
  assert.equal(normalized.characters[0]?.goal, "林舟要查清自己的血脉来历");
  assert.equal(normalized.relationships[0]?.source, "林舟");
  assert.equal(normalized.relationships[0]?.target, "晏无咎");
  assert.equal(normalized.relationships[0]?.label, "林舟与晏无咎之间旧怨极深");
  assert.equal(normalized.worldview[0]?.description, "林舟曾在这里短暂栖身。");
});

test("normalizeBlueprintCharacterReferences swaps placeholder names for concrete foundation names", () => {
  const foundation: FoundationPayload = {
    premise: "林舟将被迫回山。",
    styleCard: "冷峻、压抑",
    characters: [
      {
        name: "林舟",
        role: "主角",
        goal: "查明血脉真相",
        traits: ["倔强"],
      },
      {
        name: "沈遥",
        role: "女主",
        goal: "护住秘密",
        traits: ["冷静"],
      },
      {
        name: "晏无咎",
        role: "反派",
        goal: "夺走遗骨",
        traits: ["冷酷"],
      },
    ],
    worldview: [],
    relationships: [],
  };
  const blueprint: ChapterBlueprint = {
    chapterNo: 2,
    sceneGoal: "主角必须在反派的追索中保住女主。",
    characters: ["主角", "女主", "反派", "林舟"],
    locations: ["山门"],
    conflicts: ["主角被反派逼得无法后退。"],
    foreshadows: ["女主会在下一章揭开主角身世的一角。"],
    emotionalTone: "压迫、克制",
    estimatedWords: 3000,
  };

  const normalized = normalizeBlueprintCharacterReferences(blueprint, foundation);

  assert.deepEqual(normalized.characters, ["林舟", "沈遥", "晏无咎"]);
  assert.equal(normalized.sceneGoal, "林舟必须在晏无咎的追索中保住沈遥。");
  assert.deepEqual(normalized.conflicts, ["林舟被晏无咎逼得无法后退。"]);
  assert.deepEqual(normalized.foreshadows, ["沈遥会在下一章揭开林舟身世的一角。"]);
});

test("placeholder replacement prefers the longest token so 男主角/女主角 are not truncated by 主角", () => {
  const foundation: FoundationPayload = {
    premise: "三人在城头对峙。",
    styleCard: "冷峻、压抑",
    characters: [
      {
        name: "林舟",
        role: "主角",
        goal: "查明血脉真相",
        traits: ["倔强"],
      },
      {
        name: "顾沉",
        role: "男主",
        goal: "守住城门",
        traits: ["寡言"],
      },
      {
        name: "沈遥",
        role: "女主",
        goal: "护住秘密",
        traits: ["冷静"],
      },
    ],
    worldview: [],
    relationships: [],
  };
  const blueprint: ChapterBlueprint = {
    chapterNo: 3,
    sceneGoal: "男主角与女主角在城头对峙，主角被迫表态。",
    characters: ["男主角", "女主角"],
    locations: ["城头"],
    conflicts: ["男主必须在女主角面前承认布局。"],
    foreshadows: [],
    emotionalTone: "紧绷",
    estimatedWords: 2800,
  };

  const normalized = normalizeBlueprintCharacterReferences(blueprint, foundation);

  assert.equal(normalized.sceneGoal, "顾沉与沈遥在城头对峙，林舟被迫表态。");
  assert.deepEqual(normalized.characters, ["顾沉", "沈遥"]);
  assert.deepEqual(normalized.conflicts, ["顾沉必须在沈遥面前承认布局。"]);
});
