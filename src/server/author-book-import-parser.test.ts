import test from "node:test";
import assert from "node:assert/strict";

import { authorBookImportLimits, parseAuthorBookImportBuffer } from "./author-book-import-parser.ts";

function buildSourceHash(input: string) {
  return `test-${input.length}`;
}

test("parseAuthorBookImportBuffer accepts large TXT previews beyond the old 10MB ceiling", () => {
  const body = "山海古路，潮声连夜。".repeat(600_000);
  const text = `第一章 大荒开场\n\n${body}`;
  const buffer = Buffer.from(text, "utf8");

  assert.equal(buffer.length > 10 * 1024 * 1024, true);
  assert.equal(buffer.length < authorBookImportLimits.maxBytes, true);

  const parsed = parseAuthorBookImportBuffer({
    buffer,
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.chapterCount, 1);
    assert.equal(parsed.parserMode, "heading_strict");
  }
});

test("parseAuthorBookImportBuffer accepts long-form novels above 1200 chapters within the raised limit", () => {
  const text = Array.from(
    { length: 1_500 },
    (_, index) => `第${index + 1}章 风起\n\n山门外雨声压得很低，少年沿着石阶往上走。`,
  ).join("\n\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.chapterCount, 1_500);
    assert.equal(parsed.chapterCount < authorBookImportLimits.maxChapters, true);
    assert.equal(parsed.parserMode, "heading_strict");
    assert.equal(parsed.samplePlan.indexes.length >= 9, true);
  }
});

test("parseAuthorBookImportBuffer skips catalog-style front matter before chapter one", () => {
  const text = [
    "------------ 章节目录 ------------",
    "新书即将开始了",
    "以下是啃书小说网KenShu.CC收集并整理,版权归作者或出版社。",
    "遮天结束时跟大家说，8月26ri上传新书。",
    "",
    "第一章 朝气蓬勃",
    "",
    "山风贴着石壁往下压，少年沿着山道继续往前走。",
  ].join("\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.chapterCount, 1);
    assert.equal(parsed.chapters[0]?.title, "第一章 朝气蓬勃");
  }
});

test("parseAuthorBookImportBuffer uses repeated markdown heading levels as chapter boundaries and ignores the top title heading", () => {
  const text = [
    "# 完美世界",
    "",
    "## 第一章 朝气蓬勃",
    "",
    "山风贴着石壁往下压，少年沿着山道继续往前走。",
    "",
    "## 第二章 骨文",
    "",
    "老人抬起手杖，示意孩子们把呼吸再压稳一点。",
  ].join("\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.parserMode, "marker");
    assert.equal(parsed.chapterCount, 2);
    assert.equal(parsed.chapters[0]?.title, "第一章 朝气蓬勃");
    assert.equal(parsed.chapters[1]?.title, "第二章 骨文");
  }
});

test("parseAuthorBookImportBuffer preserves UTF-8 markdown headings with Chinese chapter numerals", () => {
  const text = [
    "# 雨城遗事",
    "",
    "## 第七章 雨夜遗物",
    "",
    "纸伞沿滴下来的水，在门槛前汇成一道细流。",
    "",
    "## 第八章 灯下旧信",
    "",
    "她拆开旧信，墨迹仍带着潮湿巷口的气味。",
  ].join("\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.parserMode, "marker");
    assert.equal(parsed.chapterCount, 2);
    assert.equal(parsed.chapters[0]?.title, "第七章 雨夜遗物");
    assert.equal(parsed.chapters[1]?.title, "第八章 灯下旧信");
  }
});

test("parseAuthorBookImportBuffer previews an 80 chapter manuscript without collapsing chapters", () => {
  const text = Array.from(
    { length: 80 },
    (_, index) => `第${index + 1}章 雨城旧事\n\n第${index + 1}盏灯在长街尽头亮起。`,
  ).join("\n\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.parserMode, "heading_strict");
    assert.equal(parsed.chapterCount, 80);
    assert.equal(parsed.samplePlan.total, 80);
    assert.equal(parsed.chapters[79]?.title, "第80章 雨城旧事");
  }
});

test("parseAuthorBookImportBuffer normalizes Arabic and Chinese duplicate chapter numbers", () => {
  const text = [
    "第7章 雨夜遗物",
    "",
    "纸伞沿滴下来的水，在门槛前汇成一道细流。",
    "",
    "第七章 旧信",
    "",
    "旧信压在木匣底部，边角已经被潮气卷起。",
  ].join("\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.chapterCount, 2);
    const warning = parsed.warnings.find((entry) => entry.code === "duplicate_chapter_number");
    assert.equal(parsed.warnings.some((entry) => entry.code === "duplicate_title"), false);
    assert.match(warning?.message ?? "", /第7章/u);
    assert.match(warning?.message ?? "", /第7章 雨夜遗物/u);
    assert.match(warning?.message ?? "", /第七章 旧信/u);
  }
});

test("parseAuthorBookImportBuffer does not guess distinct, special, volume, or out-of-range headings as duplicate chapter numbers", () => {
  const text = [
    "序章",
    "风从旧城门外吹来。",
    "第七卷 雨城",
    "纸伞在檐下排成一线。",
    "第八章 灯下旧信",
    "她拆开第一封旧信。",
    "第九章 长街尽头",
    "他沿着长街向北走去。",
    "第三千零一章 不应猜测",
    "门外只剩一盏熄灭的灯。",
    "终章",
    "雨终于停了。",
  ].join("\n\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.warnings.some((entry) => entry.code === "duplicate_chapter_number"), false);
  }
});

test("parseAuthorBookImportBuffer recognizes common webnovel markers like 序章 and 终章", () => {
  const text = [
    "序章",
    "",
    "他站在门外，听见风把更早以前的名字吹回来。",
    "",
    "第一章 朝气蓬勃",
    "",
    "山风贴着石壁往下压，少年沿着山道继续往前走。",
    "",
    "终章",
    "",
    "尘埃落定之后，只剩那枚旧铃还在极轻地晃。",
  ].join("\n");

  const parsed = parseAuthorBookImportBuffer({
    buffer: Buffer.from(text, "utf8"),
    explicitEncoding: "utf-8",
    sourceHash: buildSourceHash(text),
  });

  assert.equal(parsed.needsEncodingChoice, false);
  if (!parsed.needsEncodingChoice) {
    assert.equal(parsed.chapterCount, 3);
    assert.equal(parsed.chapters[0]?.title, "序章");
    assert.equal(parsed.chapters[2]?.title, "终章");
  }
});
