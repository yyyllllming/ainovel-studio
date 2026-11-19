import test from "node:test";
import assert from "node:assert/strict";
import { buildStylePromptBundle, assertNoRawBookText } from "./writing/style-prompt-guard.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import type { ActiveStylePackage, StyleExcerpt } from "./types.ts";

function createExcerpt(id: string, content: string): StyleExcerpt {
  return {
    id,
    sourceId: "source-1",
    sourceTitle: "测试参考书",
    label: "第1章",
    tags: ["narrative"],
    content,
    wordCount: content.length,
    startOffset: 0,
    endOffset: content.length,
    positionRatio: 0.1,
    dialogueRatio: 0.1,
  };
}

function createActiveStyle(): ActiveStylePackage {
  const exemplarA = createExcerpt("ex-1", "潮气沿着石阶往上涌，他听见风从门缝里一点点挤进来。".repeat(6).slice(0, 180));
  const exemplarB = createExcerpt("ex-2", "她没有回头，只把灯往高处一举，影子就跟着晃出一道冷意。".repeat(6).slice(0, 176));
  const rawExcerpt = createExcerpt("raw-1", "这是不允许直接进 prompt 的抽样正文。".repeat(12));

  return {
    styleSnapshotId: "snapshot-1",
    styleSnapshotVersion: 1,
    styleCard: "风格约束卡\n不要直接照搬原文。",
    styleProfile: buildFallbackStyleProfile({
      references: [],
      manualGuidance: "叙述要克制，动作推动情绪。",
      avoidances: "不要解释腔。",
    }),
    styleDigest: "这份风格摘要重点约束叙述距离、信息露出、对白气口与章末回钩。".repeat(30).slice(0, 1_320),
    styleExemplars: [exemplarA, exemplarB],
    confidence: "high",
    sampledExcerpts: [rawExcerpt, exemplarA, exemplarB],
    sourceIds: ["source-1"],
  };
}

function createStitchedActiveStyle(): ActiveStylePackage {
  const excerptA = createExcerpt("raw-a", "潮气沿着石阶往上涌，他听见风从门缝里一点点挤进来，肩背也跟着发冷。".repeat(3));
  const excerptB = createExcerpt("raw-b", "她没有回头，只把灯往高处一举，影子就跟着晃出一道冷意，像在逼人自己开口。".repeat(3));
  const stitched = createExcerpt("ex-stitched", `${excerptA.content}\n\n${excerptB.content}`.slice(0, 240));
  const extra = createExcerpt("ex-extra", "远处铜铃又响了一声，像有人把更大的麻烦摇给他听，连风都跟着冷了一层。".repeat(5).slice(0, 150));

  return {
    styleSnapshotId: "snapshot-stitched",
    styleSnapshotVersion: 2,
    styleCard: "风格约束卡\n不要直接照搬原文。",
    styleProfile: buildFallbackStyleProfile({
      references: [],
      manualGuidance: "叙述要克制，动作推动情绪。",
      avoidances: "不要解释腔。",
    }),
    styleDigest: "这份风格摘要重点约束叙述距离、信息露出、对白气口与章末回钩。".repeat(30).slice(0, 1_280),
    styleExemplars: [stitched, extra],
    confidence: "medium",
    sampledExcerpts: [excerptA, excerptB],
    sourceIds: ["source-1"],
  };
}

test("buildStylePromptBundle only emits profile, digest, and exemplars for runtime injection", () => {
  const bundle = buildStylePromptBundle("writer", createActiveStyle());
  const joined = bundle.sections.join("\n\n");

  assert.match(joined, /风格画像/);
  assert.match(joined, /风格摘要/);
  assert.match(joined, /风格示例/);
  assert.doesNotMatch(joined, /风格约束卡/);
  assert.doesNotMatch(joined, /这是不允许直接进 prompt 的抽样正文/);
});

test("assertNoRawBookText fails fast when a raw sampled excerpt is mixed into runtime style sections", () => {
  const activeStyle = createActiveStyle();

  assert.throws(() =>
    assertNoRawBookText({
      stage: "writer",
      activeStyle,
      formattedStyleProfile: "这是合法的风格画像",
      styleDigest: activeStyle.styleDigest,
      styleExemplars: activeStyle.styleExemplars,
      extraSections: [activeStyle.sampledExcerpts[0]!.content],
    }),
  );
});

test("assertNoRawBookText rejects incomplete snapshot payloads for runtime prompt assembly", () => {
  const activeStyle = createActiveStyle();

  assert.throws(() =>
    assertNoRawBookText({
      stage: "reviewer",
      activeStyle,
      formattedStyleProfile: "合法画像",
      styleDigest: "",
      styleExemplars: activeStyle.styleExemplars,
    }),
  );
});

test("assertNoRawBookText allows stitched exemplars built from sampled excerpts", () => {
  const activeStyle = createStitchedActiveStyle();

  assert.doesNotThrow(() =>
    assertNoRawBookText({
      stage: "writer",
      activeStyle,
      formattedStyleProfile: "合法画像",
      styleDigest: activeStyle.styleDigest,
      styleExemplars: activeStyle.styleExemplars,
      extraSections: activeStyle.styleExemplars.map((entry) => entry.content),
    }),
  );
});
