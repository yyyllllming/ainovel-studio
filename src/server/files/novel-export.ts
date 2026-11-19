import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { sanitizeArtifactName } from "../file-names.ts";
import { withinProject } from "../paths.ts";
import type { NovelExportRecord, NovelPreviewFormat, NovelPreviewPayload, NovelPreviewSection } from "../types.ts";
import { nowIso } from "../utils.ts";
import { safeParseJson } from "../utils/safe-json.ts";

export interface NovelExportChapterInput {
  chapterNo: number;
  content: string | null;
}

export interface BuiltNovelExportResult extends NovelExportRecord {
  text?: string;
}

export function createPendingNovelExportRecord(): NovelExportRecord {
  return {
    exists: false,
    status: "pending",
  };
}

export function shouldGenerateNovelExport(record: NovelExportRecord) {
  return record.status === "pending";
}

export function novelExportDir(projectId: string) {
  return withinProject(projectId, "exports");
}

export function novelExportTextPath(projectId: string, title: string) {
  return withinProject(projectId, "exports", `${sanitizeArtifactName(title, "novel")}.txt`);
}

export function novelExportMetaPath(projectId: string) {
  return withinProject(projectId, "exports", "novel_export.json");
}

function normalizeChapterContent(content: string) {
  return content.trim();
}

function chapterHeading(chapterNo: number) {
  return `========== 第 ${String(chapterNo).padStart(3, "0")} 章 ==========`;
}

function titleDivider(title: string) {
  return "=".repeat(Math.max(24, title.trim().length * 2));
}

function formatMissingChapters(chapterNos: number[]) {
  return chapterNos.map((chapterNo) => `第 ${String(chapterNo).padStart(3, "0")} 章`).join("、");
}

function markdownChapterHeading(chapterNo: number) {
  return `## 第 ${String(chapterNo).padStart(3, "0")} 章`;
}

function sortAndNormalizeChapters(chapters: Array<{ chapterNo: number; content: string }>) {
  return [...chapters]
    .map((chapter) => ({
      chapterNo: chapter.chapterNo,
      content: normalizeChapterContent(chapter.content),
    }))
    .filter((chapter) => chapter.content.length > 0)
    .sort((left, right) => left.chapterNo - right.chapterNo);
}

export function buildNovelPreviewText(input: {
  title: string;
  chapters: Array<{ chapterNo: number; content: string }>;
  format: NovelPreviewFormat;
}) {
  const orderedChapters = sortAndNormalizeChapters(input.chapters);
  const sections = orderedChapters.map((chapter) =>
    [
      input.format === "md" ? markdownChapterHeading(chapter.chapterNo) : chapterHeading(chapter.chapterNo),
      "",
      chapter.content,
    ].join("\n"),
  );

  if (input.format === "md") {
    return [
      `# ${input.title.trim()}`,
      "",
      ...sections,
      "",
    ].join("\n");
  }

  return [
    input.title.trim(),
    titleDivider(input.title),
    "",
    ...sections,
    "",
  ].join("\n");
}

function buildNovelPreviewSections(chapters: Array<{ chapterNo: number; content: string }>): NovelPreviewSection[] {
  return sortAndNormalizeChapters(chapters).map((chapter) => ({
    chapterNo: chapter.chapterNo,
    heading: `第 ${String(chapter.chapterNo).padStart(3, "0")} 章`,
    paragraphs: chapter.content
      .split(/\r?\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean),
  }));
}

export function buildNovelExportText(input: {
  title: string;
  chapters: Array<{ chapterNo: number; content: string }>;
}) {
  return buildNovelPreviewText({
    title: input.title,
    chapters: input.chapters,
    format: "txt",
  });
}

function buildMissingChapterNos(chapterNos: number[]) {
  if (!chapterNos.length) {
    return [] as number[];
  }

  const minChapterNo = chapterNos[0];
  const maxChapterNo = chapterNos[chapterNos.length - 1];
  const existing = new Set(chapterNos);
  const missing: number[] = [];

  for (let chapterNo = minChapterNo; chapterNo <= maxChapterNo; chapterNo += 1) {
    if (!existing.has(chapterNo)) {
      missing.push(chapterNo);
    }
  }

  return missing;
}

export function buildNovelPreviewPayload(input: {
  title: string;
  chapters: NovelExportChapterInput[];
  format: NovelPreviewFormat;
  generatedAt?: string;
}): NovelPreviewPayload {
  const generatedAt = input.generatedAt ?? nowIso();
  const normalizedChapters = sortAndNormalizeChapters(
    input.chapters.map((chapter) => ({
      chapterNo: chapter.chapterNo,
      content: typeof chapter.content === "string" ? chapter.content : "",
    })),
  );
  const chapterNos = normalizedChapters.map((chapter) => chapter.chapterNo);

  return {
    title: input.title.trim(),
    format: input.format,
    generatedAt,
    chapterCount: normalizedChapters.length,
    chapterNos,
    missingChapterNos: buildMissingChapterNos(chapterNos),
    suggestedFileName: `${sanitizeArtifactName(input.title, "novel")}.${input.format}`,
    content: buildNovelPreviewText({
      title: input.title,
      chapters: normalizedChapters,
      format: input.format,
    }),
    sections: buildNovelPreviewSections(normalizedChapters),
  };
}

export function buildNovelExportResult(input: {
  title: string;
  targetChapters?: number;
  outputPath: string;
  chapters: NovelExportChapterInput[];
  generatedAt?: string;
}): BuiltNovelExportResult {
  const generatedAt = input.generatedAt ?? nowIso();
  const normalizedChapters = input.chapters
    .map((chapter) => ({
      chapterNo: chapter.chapterNo,
      content: typeof chapter.content === "string" ? normalizeChapterContent(chapter.content) : "",
    }))
    .filter((chapter) => chapter.content.length > 0)
    .sort((left, right) => left.chapterNo - right.chapterNo);

  const chapterMap = new Map(normalizedChapters.map((chapter) => [chapter.chapterNo, chapter.content] as const));
  const missingChapterNos: number[] = [];

  if (typeof input.targetChapters === "number") {
    for (let chapterNo = 1; chapterNo <= input.targetChapters; chapterNo += 1) {
      if (!chapterMap.get(chapterNo)) {
        missingChapterNos.push(chapterNo);
      }
    }
  }

  if (missingChapterNos.length) {
    return {
      exists: false,
      status: "failed",
      generatedAt,
      chapterCount: normalizedChapters.length,
      error: `缺少最终章节：${formatMissingChapters(missingChapterNos)}`,
    };
  }

  const text = buildNovelExportText({
    title: input.title,
    chapters: normalizedChapters.map((chapter) => ({
      chapterNo: chapter.chapterNo,
      content: chapter.content,
    })),
  });

  return {
    exists: true,
    status: "ready",
    path: input.outputPath,
    generatedAt,
    chapterCount: normalizedChapters.length,
    text,
  };
}

export async function readNovelExportRecord(projectId: string): Promise<NovelExportRecord> {
  const metaPath = novelExportMetaPath(projectId);
  if (!existsSync(metaPath)) {
    return createPendingNovelExportRecord();
  }

  try {
    return safeParseJson<NovelExportRecord>(await readFile(metaPath, "utf8")) ?? {
      exists: false,
      status: "failed",
      error: "小说 TXT 导出元数据损坏，无法读取。",
    };
  } catch {
    return {
      exists: false,
      status: "failed",
      error: "小说 TXT 导出元数据损坏，无法读取。",
    };
  }
}
