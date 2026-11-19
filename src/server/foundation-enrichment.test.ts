import test from "node:test";
import assert from "node:assert/strict";
import {
  assessFoundationCoverage,
  buildFallbackFoundationExpansion,
  mergeFoundationPayload,
} from "./foundation/foundation-enrichment.ts";
import type { FoundationPayload } from "./types.ts";

test("assessFoundationCoverage flags thin opening foundations with placeholder world rules", () => {
  const weakFoundation: FoundationPayload = {
    premise: "咿呀能在灵纹暴露时偷学异兽天赋。",
    styleCard: "荒古、凶险、灵性沸腾",
    characters: [
      {
        name: "咿呀",
        role: "protagonist",
        goal: "推动主线完成",
        traits: ["敏锐", "主动"],
      },
    ],
    worldview: [
      {
        name: "世界基调",
        description: "玄幻修仙类型故事，保持 default 风格。",
      },
    ],
    relationships: [],
  };

  const result = assessFoundationCoverage(weakFoundation);

  assert.equal(result.shouldExpand, true);
  assert.equal(result.severity, "fail");
  assert.equal(result.notes.some((entry) => entry.includes("角色过少")), true);
  assert.equal(result.notes.some((entry) => entry.includes("占位内容")), true);
});

test("mergeFoundationPayload keeps stronger cards and drops generic world placeholders when richer rules exist", () => {
  const base: FoundationPayload = {
    premise: "咿呀能偷学异兽灵纹。",
    styleCard: "莽烈、荒古",
    styleSnapshotId: "snapshot-base",
    styleSnapshotVersion: 3,
    styleDigest: "基础风格摘要",
    styleExemplars: [
      {
        id: "base-1",
        sourceId: "src-1",
        sourceTitle: "参考书",
        label: "基础片段",
        tags: ["pressure"],
        content: "一阵冷风压过石缝，咿呀把呼吸压进齿间，没敢先看背后的影子。",
        wordCount: 30,
        startOffset: 0,
        endOffset: 30,
        positionRatio: 0.1,
        dialogueRatio: 0,
      },
    ],
    characters: [
      {
        name: "咿呀",
        role: "protagonist",
        goal: "推动主线完成",
        traits: ["敏锐"],
      },
    ],
    worldview: [
      {
        name: "世界基调",
        description: "玄幻修仙类型故事。",
      },
    ],
    relationships: [],
  };

  const expanded: FoundationPayload = {
    premise: "咿呀在断崖山场偷学异兽灵纹，却因此被青鳞狼族留下气息标记。",
    styleCard: "莽烈、荒古、带凶险追猎感",
    styleSnapshotId: "snapshot-new",
    styleSnapshotVersion: 4,
    styleDigest: "更新后的风格摘要",
    styleExemplars: [
      {
        id: "new-1",
        sourceId: "src-2",
        sourceTitle: "参考书",
        label: "更新片段",
        tags: ["mechanism", "hook"],
        content: "那道热意先在掌骨里炸开，直到青鳞狼回首嘶吼，咿呀才知道自己偷到了什么。",
        wordCount: 35,
        startOffset: 40,
        endOffset: 75,
        positionRatio: 0.2,
        dialogueRatio: 0,
      },
    ],
    characters: [
      {
        name: "咿呀",
        role: "protagonist",
        goal: "先带着偷学来的第一道灵纹活着逃出断崖山场，并查清那团热意的来历。",
        traits: ["敏锐", "贪胆", "记仇"],
        secrets: ["体内那团热意与更古老的兽道传承有关。"],
      },
      {
        name: "青鳞狼",
        role: "hunter",
        goal: "追回被咿呀窥走的灵纹气息。",
        traits: ["凶悍", "谨慎"],
      },
      {
        name: "乌鳞骨坑",
        role: "shelter",
        goal: "在毒骨泥坑里暂时藏住气息。",
        traits: ["阴毒", "危险"],
      },
    ],
    worldview: [
      {
        name: "断崖山场",
        description: "开篇发生在潮湿断崖与石涧之间，夜里常有重伤异兽伏着疗伤。",
      },
      {
        name: "灵纹偷学",
        description: "只有在异兽天赋灵纹暴露、且咿呀近距离承受反噬时，偷学才可能成功。",
      },
      {
        name: "偷学代价",
        description: "每次强行刻印灵纹，都会引发眼眶刺痛、失血与原主气息反咬。",
      },
    ],
    relationships: [
      {
        source: "咿呀",
        target: "青鳞狼",
        label: "偷学后被追踪",
      },
    ],
  };

  const merged = mergeFoundationPayload(base, expanded);

  assert.equal(merged.characters.length, 3);
  assert.equal(merged.characters[0]?.goal.includes("断崖山场"), true);
  assert.equal(merged.worldview.some((item) => item.name === "世界基调"), false);
  assert.equal(merged.worldview.some((item) => item.name === "灵纹偷学"), true);
  assert.equal(merged.relationships.length, 1);
  assert.equal(merged.premise.includes("气息标记"), true);
  assert.equal(merged.styleSnapshotId, "snapshot-new");
  assert.equal(merged.styleSnapshotVersion, 4);
  assert.equal(merged.styleDigest, "更新后的风格摘要");
  assert.equal(merged.styleExemplars?.[0]?.id, "new-1");
});

test("buildFallbackFoundationExpansion deterministically fills opening story bible gaps", () => {
  const weakFoundation: FoundationPayload = {
    premise: "咿呀能在灵纹暴露时偷学异兽天赋。",
    styleCard: "荒古、凶险、灵性沸腾",
    characters: [
      {
        name: "咿呀",
        role: "protagonist",
        goal: "推动主线完成",
        traits: ["敏锐", "主动"],
      },
    ],
    worldview: [
      {
        name: "世界基调",
        description: "玄幻修仙类型故事，保持 default 风格。",
      },
    ],
    relationships: [],
  };

  const expanded = buildFallbackFoundationExpansion({
    title: "兽神",
    genre: "玄幻修仙",
    premise: weakFoundation.premise,
    foundation: weakFoundation,
  });

  assert.equal(expanded.characters.length >= 3, true);
  assert.equal(expanded.worldview.some((item) => item.name === "灵纹偷学"), true);
  assert.equal(expanded.worldview.some((item) => item.name === "偷学代价"), true);
  assert.equal(expanded.relationships.length >= 2, true);
  assert.equal(expanded.characters[0]?.goal.includes("活着逃出"), true);
  assert.equal(expanded.characters.some((item) => item.name === "裂爪青狼"), false);
  assert.equal(expanded.characters.some((item) => item.name === "黑羽鹫"), false);
});

test("buildFallbackFoundationExpansion keeps non-fantasy projects free of hardcoded mythic world rules", () => {
  const weakFoundation: FoundationPayload = {
    premise: "林晚在催收逼近时发现母亲留下的旧账本。",
    styleCard: "克制、贴地、压迫感",
    characters: [
      {
        name: "林晚",
        role: "protagonist",
        goal: "推动主线完成",
        traits: ["敏锐", "倔强"],
      },
    ],
    worldview: [
      {
        name: "世界基调",
        description: "都市情感类型故事，保持 default 风格。",
      },
    ],
    relationships: [],
  };

  const expanded = buildFallbackFoundationExpansion({
    title: "旧账本",
    genre: "都市情感",
    premise: weakFoundation.premise,
    foundation: weakFoundation,
  });

  const combined = [
    ...expanded.characters.map((item) => `${item.name} ${item.goal}`),
    ...expanded.worldview.map((item) => `${item.name} ${item.description}`),
    ...expanded.relationships.map((item) => `${item.source} ${item.target} ${item.label}`),
  ].join("\n");

  assert.equal(expanded.characters.length >= 3, true);
  assert.equal(expanded.worldview.length >= 4, true);
  assert.equal(expanded.relationships.length >= 2, true);
  assert.doesNotMatch(combined, /灵纹|偷学|异兽|兽道|断崖山场|灵压/u);
  assert.equal(expanded.worldview.some((item) => item.name === "动用代价"), true);
  assert.equal(expanded.characters[0]?.goal.includes("林晚"), true);
});

test("buildFallbackFoundationExpansion reuses explicit premise factions before inventing mythic hunter names", () => {
  const weakFoundation: FoundationPayload = {
    premise:
      "玄幻修仙长篇。墨渊身怀活骨书，挽世巡猎使潜伏暗处搜寻禁忌遗种，墨渊必须在暴露前先活下来。",
    styleCard: "荒古、凶险、灵性沸腾",
    characters: [
      {
        name: "墨渊",
        role: "protagonist",
        goal: "先活下来。",
        traits: ["警惕", "求生欲强"],
      },
    ],
    worldview: [
      {
        name: "世界基调",
        description: "玄幻修仙类型故事，保持 default 风格。",
      },
    ],
    relationships: [],
  };

  const expanded = buildFallbackFoundationExpansion({
    title: "重构1",
    genre: "玄幻修仙",
    premise: weakFoundation.premise,
    foundation: weakFoundation,
  });

  assert.equal(expanded.characters.find((item) => item.role === "hunter")?.name, "挽世巡猎使");
});
