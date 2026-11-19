import test from "node:test";
import assert from "node:assert/strict";

import {
  containsDraftArtifactText,
  hasFoundationPlaceholderResidue,
  isPlaceholderWorldCardDraft,
  listFoundationPlaceholderResidueKinds,
} from "./foundation/foundation-quality-guards.ts";

test("containsDraftArtifactText recognizes unfinished draft markers", () => {
  assert.equal(containsDraftArtifactText("这里先写 TODO，后面再补。"), true);
  assert.equal(containsDraftArtifactText("【修订指令】把这一段换成更冷的笔调。"), true);
  assert.equal(containsDraftArtifactText("这里已经是正式正文，没有脏标记。"), false);
});

test("isPlaceholderWorldCardDraft recognizes legacy placeholder world cards", () => {
  assert.equal(isPlaceholderWorldCardDraft({
    name: "世界基调",
    description: "玄幻修仙 类型故事，保持 default 风格",
  }), true);
  assert.equal(isPlaceholderWorldCardDraft({
    name: "夜禁律",
    description: "夜里越界者会被城禁追踪。",
  }), false);
});

test("hasFoundationPlaceholderResidue reports character and worldview placeholders together", () => {
  const placeholderFoundation = {
    premise: "主角卷入夜禁追猎。",
    mainline: "主角继续逃。",
    storyHook: "主角第一次越线就失手。",
    styleCard: "风格卡",
    characters: [
      {
        name: "主角",
        role: "protagonist",
        goal: "活下去",
        traits: ["谨慎"],
      },
    ],
    worldview: [
      {
        name: "世界基调",
        description: "玄幻修仙 类型故事，保持 default 风格",
      },
    ],
    relationships: [],
  };
  assert.equal(hasFoundationPlaceholderResidue(placeholderFoundation), true);
  assert.deepEqual(listFoundationPlaceholderResidueKinds(placeholderFoundation), [
    "character_names",
    "worldview_rules",
  ]);

  const cleanFoundation = {
    premise: "墨渊卷入夜禁追猎。",
    mainline: "墨渊继续逃。",
    storyHook: "墨渊第一次越线就失手。",
    styleCard: "风格卡",
    characters: [
      {
        name: "墨渊",
        role: "protagonist",
        goal: "活下去",
        traits: ["谨慎"],
      },
    ],
    worldview: [
      {
        name: "夜禁律",
        description: "夜里越界者会被城禁追踪。",
      },
    ],
    relationships: [],
  };
  assert.equal(hasFoundationPlaceholderResidue(cleanFoundation), false);
  assert.deepEqual(listFoundationPlaceholderResidueKinds(cleanFoundation), []);
});
