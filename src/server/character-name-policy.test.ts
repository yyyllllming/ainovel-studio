import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeCharacterName,
  validateCharacterName,
} from "../lib/character-name-policy.ts";

test("character name policy accepts concrete proper names and a single kinship prefix normalization", () => {
  assert.equal(canonicalizeCharacterName("姜尘"), "姜尘");
  assert.equal(canonicalizeCharacterName("姜烈"), "姜烈");
  assert.equal(canonicalizeCharacterName("风氏"), "风氏");
  assert.equal(canonicalizeCharacterName("哥哥姜烈"), "姜烈");
});

test("character name policy no longer blocks names that contain former single-book tokens", () => {
  assert.equal(canonicalizeCharacterName("风家主"), "风家主");
  assert.equal(canonicalizeCharacterName("风家明"), "风家明");
});

test("character name policy rejects noisy fragments and title suffix variants", () => {
  const rejectedInputs = [
    "主角",
    "男主",
    "女主",
    "反派",
    "配角",
    "母的警告",
    "母的禁",
    "母的分裂",
    "母捡",
    "母严",
    "母收养",
    "姜烈就是在这",
    "老姜烈现身",
    "风氏夫人",
    "姜烈·隐于暗处",
    "风氏·暗中布局",
  ];

  for (const input of rejectedInputs) {
    const result = validateCharacterName(input);
    assert.equal(result.accepted, false, `${input} 应被拒绝`);
    assert.equal(result.canonical, null, `${input} 不应得到 canonical`);
  }
});
