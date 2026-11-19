import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNovelPreviewPayload,
  buildNovelExportResult,
  shouldGenerateNovelExport,
} from "./files/novel-export.ts";

test("buildNovelExportResult joins chapters in order with book title and strong separators", () => {
  const result = buildNovelExportResult({
    title: "雾海档案",
    targetChapters: 2,
    outputPath: "D:/novel.txt",
    generatedAt: "2026-03-18T00:00:00.000Z",
    chapters: [
      { chapterNo: 2, content: "第二章正文" },
      { chapterNo: 1, content: "第一章正文" },
    ],
  });

  assert.equal(result.status, "ready");
  assert.match(result.text ?? "", /^雾海档案\r?\n=+/);
  assert.match(result.text ?? "", /========== 第 001 章 ==========/);
  assert.match(result.text ?? "", /第一章正文[\s\S]*========== 第 002 章 ==========[\s\S]*第二章正文/);
});

test("buildNovelExportResult trims chapter edges but preserves inner paragraphs", () => {
  const result = buildNovelExportResult({
    title: "灰烬夜航",
    targetChapters: 1,
    outputPath: "D:/novel.txt",
    chapters: [
      {
        chapterNo: 1,
        content: "\n\n第一段。\n\n第二段。\n\n",
      },
    ],
  });

  assert.equal(result.status, "ready");
  assert.match(result.text ?? "", /第一段。\r?\n\r?\n第二段。/);
  assert.doesNotMatch(result.text ?? "", /\n{4,}$/);
});

test("buildNovelExportResult fails when any expected chapter is missing", () => {
  const result = buildNovelExportResult({
    title: "无名之书",
    targetChapters: 3,
    outputPath: "D:/novel.txt",
    chapters: [
      { chapterNo: 1, content: "第一章" },
      { chapterNo: 3, content: "第三章" },
    ],
  });

  assert.equal(result.status, "failed");
  assert.equal(result.exists, false);
  assert.match(result.error ?? "", /第 002 章/);
});

test("buildNovelExportResult can export dynamic projects from the actual chapter list", () => {
  const result = buildNovelExportResult({
    title: "潮痕",
    outputPath: "D:/novel.txt",
    chapters: [
      { chapterNo: 1, content: "第一章" },
      { chapterNo: 2, content: "第二章" },
      { chapterNo: 3, content: "第三章" },
    ],
  });

  assert.equal(result.status, "ready");
  assert.equal(result.chapterCount, 3);
});

test("shouldGenerateNovelExport only allows the first completion attempt", () => {
  assert.equal(shouldGenerateNovelExport({ exists: false, status: "pending" }), true);
  assert.equal(shouldGenerateNovelExport({ exists: true, status: "ready", path: "D:/novel.txt" }), false);
  assert.equal(shouldGenerateNovelExport({ exists: false, status: "failed", error: "缺少章节" }), false);
});

test("buildNovelPreviewPayload renders markdown chapters and reports missing gaps", () => {
  const preview = buildNovelPreviewPayload({
    title: "潮痕",
    format: "md",
    generatedAt: "2026-03-25T00:00:00.000Z",
    chapters: [
      { chapterNo: 3, content: "第三章正文" },
      { chapterNo: 1, content: "第一章正文" },
    ],
  });

  assert.equal(preview.chapterCount, 2);
  assert.deepEqual(preview.chapterNos, [1, 3]);
  assert.deepEqual(preview.missingChapterNos, [2]);
  assert.equal(preview.suggestedFileName, "潮痕.md");
  assert.equal(preview.sections.length, 2);
  assert.equal(preview.sections[0]?.heading, "第 001 章");
  assert.match(preview.content, /^# 潮痕\r?\n\r?\n## 第 001 章/);
  assert.match(preview.content, /第一章正文[\s\S]*## 第 003 章[\s\S]*第三章正文/);
});

test("buildNovelPreviewPayload keeps txt preview continuous for written chapters", () => {
  const preview = buildNovelPreviewPayload({
    title: "雾海档案",
    format: "txt",
    chapters: [
      { chapterNo: 2, content: "\n\n第二章正文\n\n" },
      { chapterNo: 1, content: "第一章正文" },
    ],
  });

  assert.deepEqual(preview.missingChapterNos, []);
  assert.deepEqual(preview.sections[1]?.paragraphs, ["第二章正文"]);
  assert.match(preview.content, /^雾海档案\r?\n=+/);
  assert.match(preview.content, /========== 第 001 章 ==========[\s\S]*第一章正文[\s\S]*========== 第 002 章 ==========[\s\S]*第二章正文/);
});
