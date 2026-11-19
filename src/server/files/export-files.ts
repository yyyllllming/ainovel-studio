import "../server-only.ts";

import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { withinProject } from "../paths.ts";
import type { NovelExportRecord } from "../types.ts";
import { ensureDir, nowIso, writeTextFile } from "../utils.ts";
import { buildNovelExportResult, novelExportMetaPath, novelExportTextPath, readNovelExportRecord } from "./novel-export.ts";
import { readFinalChapter } from "./chapter-files.ts";

async function unlinkIfExists(path: string) {
  if (existsSync(path)) {
    await unlink(path);
  }
}

export async function writeNovelExport(projectId: string, input: {
  title: string;
  targetChapters: number;
}): Promise<NovelExportRecord> {
  await ensureDir(withinProject(projectId, "exports"));

  const chapters = await Promise.all(
    Array.from({ length: input.targetChapters }, (_, index) => index + 1).map(async (chapterNo) => ({
      chapterNo,
      content: await readFinalChapter(projectId, chapterNo),
    })),
  );

  const result = buildNovelExportResult({
    title: input.title,
    targetChapters: input.targetChapters,
    outputPath: novelExportTextPath(projectId, input.title),
    chapters,
  });

  const record: NovelExportRecord = {
    exists: result.exists,
    status: result.status,
    path: result.path,
    generatedAt: result.generatedAt,
    chapterCount: result.chapterCount,
    error: result.error,
  };
  await writeTextFile(novelExportMetaPath(projectId), `${JSON.stringify(record, null, 2)}\n`);
  if (result.status === "ready" && result.text && result.path) {
    await writeTextFile(result.path, result.text);
  }

  return record;
}

export async function readNovelExport(projectId: string) {
  return readNovelExportRecord(projectId);
}

export async function clearNovelExport(projectId: string) {
  const record = await readNovelExportRecord(projectId);
  await Promise.all([
    unlinkIfExists(novelExportMetaPath(projectId)),
    record.path ? unlinkIfExists(record.path) : Promise.resolve(),
  ]);
}

export async function writeNovelExportFailure(projectId: string, error: string) {
  await ensureDir(withinProject(projectId, "exports"));
  const record: NovelExportRecord = {
    exists: false,
    status: "failed",
    generatedAt: nowIso(),
    error,
  };
  await writeTextFile(novelExportMetaPath(projectId), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
