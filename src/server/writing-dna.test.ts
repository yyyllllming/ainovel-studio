import test from "node:test";
import assert from "node:assert/strict";
import { buildIntegratedWritingDna, createDefaultWritingDna, formatWritingDnaForPrompt } from "./writing/writing-dna.ts";

test("createDefaultWritingDna includes low-AI and planning source tags", () => {
  const dna = createDefaultWritingDna();

  assert.equal(dna.sourceTags.includes("feishu.low-ai"), true);
  assert.equal(dna.sourceTags.includes("skills.ai.txt"), true);
  assert.equal(dna.planningRules.some((entry) => entry.includes("单稿强规划直写")), true);
  assert.equal(dna.antiAiRules.some((entry) => entry.includes("连续 6 句叙述")), true);
  assert.equal(dna.antiAiRules.some((entry) => entry.includes("不要超过 4 次")), true);
  assert.equal(dna.antiAiRules.some((entry) => entry.includes("重复、固定的句式结构")), true);
});

test("buildIntegratedWritingDna adds fantasy-specific pressure and cost rules", () => {
  const dna = buildIntegratedWritingDna({
    genre: "玄幻修仙",
    premise: "一只小兽可以偷学异兽灵纹，在追猎中求生。",
    styleProfile: {
      forbiddenLexicon: ["推进主线"],
      toneGuardrails: ["不要把人物动机写成条目式总结。"],
      imageryRegister: {
        avoid: ["空泛抒情"],
        densityRule: "",
        textureRule: "",
      },
    },
  });

  assert.equal(dna.sourceTags.includes("skills.2.dark-fantasy-engine"), true);
  assert.equal(dna.sceneRules.some((entry) => entry.includes("高压迫、高反馈和强因果")), true);
  assert.equal(dna.sceneRules.some((entry) => entry.includes("保姆外挂")), true);
  assert.equal(dna.antiAiRules.some((entry) => entry.includes("推进主线")), true);
  assert.equal(dna.reviewChecklist.some((entry) => entry.includes("触发条件、代价、追猎压力")), true);
});

test("buildIntegratedWritingDna adds mythic bestiary progression rules for shanhai-like premises", () => {
  const dna = buildIntegratedWritingDna({
    genre: "玄幻修仙",
    premise: "这是一个山海经的故事，里面有神兽、灵药成精与山川有灵。",
    foundation: {
      premise: "这是一个山海经的故事，里面有神兽、灵药成精与山川有灵。",
      styleCard: "",
      characters: [],
      worldview: [
        { name: "山川有灵", description: "山壁会回应血气与灵纹。" },
      ],
      relationships: [],
    },
    styleProfile: {
      forbiddenLexicon: [],
      toneGuardrails: [],
      imageryRegister: {
        avoid: [],
        densityRule: "",
        textureRule: "",
      },
    },
  });

  assert.equal(dna.sourceTags.includes("skills.shanhai-mythic-engine"), true);
  assert.equal(dna.planningRules.some((entry) => entry.includes("单纯把同一场追猎拖长不算推进")), true);
  assert.equal(dna.sceneRules.some((entry) => entry.includes("巨兽体量")), true);
  assert.equal(dna.voiceRules.some((entry) => entry.includes("别总落回狼、鹫、蛇")), true);
  assert.equal(dna.reviewChecklist.some((entry) => entry.includes("新的异兽、怪地、灵药、禁忌或主线线索")), true);
});

test("formatWritingDnaForPrompt renders all DNA sections", () => {
  const rendered = formatWritingDnaForPrompt(createDefaultWritingDna());

  assert.equal(rendered.includes("前置规划："), true);
  assert.equal(rendered.includes("场景执行："), true);
  assert.equal(rendered.includes("语言笔触："), true);
  assert.equal(rendered.includes("去AI味："), true);
  assert.equal(rendered.includes("自检清单："), true);
});
