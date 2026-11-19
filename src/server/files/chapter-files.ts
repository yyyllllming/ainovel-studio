import "../server-only.ts";

import { readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { resolveProjectFilePath, withinProject } from "../paths.ts";
import { ensureDir, nowIso, readTextFile, writeTextFile } from "../utils.ts";
import { normalizeChapterContent } from "./commit-stage-files.ts";

async function unlinkIfExists(path: string) {
  if (existsSync(path)) {
    await unlink(path);
  }
}

async function deleteFilesWithPrefix(dir: string, prefix: string, extension?: string) {
  if (!existsSync(dir)) {
    return;
  }
  const files = await readdir(dir);
  await Promise.all(
    files
      .filter((file) => file.startsWith(prefix) && (!extension || extname(file) === extension))
      .map((file) => unlink(join(dir, file))),
  );
}

export function draftFilePath(projectId: string, chapterNo: number, timestamp = nowIso()) {
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  return withinProject(
    projectId,
    "drafts",
    `chapter_${String(chapterNo).padStart(3, "0")}_draft_${safeTimestamp}.md`,
  );
}

export function checkpointFilePath(projectId: string, chapterNo: number, wordCount: number) {
  return withinProject(
    projectId,
    "drafts",
    ".checkpoints",
    `chapter_${String(chapterNo).padStart(3, "0")}_checkpoint_${wordCount}.md`,
  );
}

export async function createDraftFile(
  projectId: string,
  chapterNo: number,
  meta: Record<string, unknown>,
) {
  const path = draftFilePath(projectId, chapterNo);
  const header = [
    "<!-- DRAFT_META",
    ...Object.entries(meta).map(([key, value]) => `${key}: ${String(value)}`),
    "-->",
    "",
  ].join("\n");
  await writeTextFile(path, header);
  return path;
}

export async function appendDraftChunk(path: string, chunk: string) {
  await ensureDir(dirname(path));
  await writeFile(path, chunk, { encoding: "utf8", flag: "a" });
}

export async function writeCheckpoint(path: string, wordCount: number, content: string) {
  const checkpoint = `${content}\n\n<!-- DRAFT_CHECKPOINT wordCount: ${wordCount} -->\n`;
  await writeTextFile(path, checkpoint);
}

export async function finalizeDraft(path: string, wordCount: number) {
  await writeFile(
    path,
    `\n\n<!-- DRAFT_END wordCount: ${wordCount} completedAt: ${nowIso()} -->\n`,
    { encoding: "utf8", flag: "a" },
  );
}

export async function replaceDraftWithFinalContent(path: string, content: string, wordCount: number) {
  const raw = existsSync(path) ? await readTextFile(path) : "";
  const header = raw.match(/^<!-- DRAFT_META[\s\S]*?-->\s*/)?.[0] ?? "";
  const nextContent = `${header}${content.trimEnd()}\n\n<!-- DRAFT_END wordCount: ${wordCount} completedAt: ${nowIso()} -->\n`;
  await writeTextFile(path, nextContent);
}

export async function validateDraft(path: string) {
  if (!existsSync(path)) {
    return { valid: false, reason: "草稿文件不存在" };
  }
  const content = await readTextFile(path);
  if (!content.includes("<!-- DRAFT_END")) {
    return { valid: false, reason: "草稿缺少结束标记" };
  }
  const text = stripDraftMarkers(content).trim();
  if (text.length < 200) {
    return { valid: false, reason: "草稿内容过短" };
  }
  return { valid: true };
}

function stripDraftMarkers(content: string) {
  return content
    .replace(/<!-- DRAFT_META[\s\S]*?-->\s*/g, "")
    .replace(/<!-- DRAFT_CHECKPOINT[\s\S]*?-->\s*/g, "")
    .replace(/<!-- DRAFT_END[\s\S]*?-->\s*/g, "")
    .trim();
}

export async function readDraftSnapshot(projectId: string, draftPath: string) {
  const safePath = resolveProjectFilePath(projectId, draftPath, ["drafts"]);
  if (!existsSync(safePath)) {
    return null;
  }

  const raw = await readTextFile(safePath);
  return {
    path: safePath,
    content: stripDraftMarkers(raw),
    completed: raw.includes("<!-- DRAFT_END"),
  };
}

function parseCheckpointWordCount(file: string) {
  return Number(file.match(/_checkpoint_(\d+)/u)?.[1] ?? 0);
}

export async function recoverDraft(projectId: string, chapterNo: number) {
  const draftDir = withinProject(projectId, "drafts");
  if (!existsSync(draftDir)) {
    return null;
  }

  const files = (await readdir(draftDir))
    .filter((file) => file.includes(`chapter_${String(chapterNo).padStart(3, "0")}_draft_`) && extname(file) === ".md")
    .sort()
    .reverse();

  for (const file of files) {
    const fullPath = withinProject(projectId, "drafts", file);
    const raw = await readTextFile(fullPath);
    const content = stripDraftMarkers(raw);
    if (content.length < 200) {
      continue;
    }
    return {
      path: fullPath,
      content,
      source: "draft" as const,
      // 含 DRAFT_END 的草稿写作阶段已结束，调用方不能再把它当成续写基底。
      completed: raw.includes("<!-- DRAFT_END"),
    };
  }

  const checkpointDir = withinProject(projectId, "drafts", ".checkpoints");
  if (!existsSync(checkpointDir)) {
    return null;
  }
  // 文件名按 wordCount 数值排序，避免字典序把 9988 排在 10100 前面。
  const checkpoints = (await readdir(checkpointDir))
    .filter((file) => file.includes(`chapter_${String(chapterNo).padStart(3, "0")}_checkpoint_`))
    .sort((left, right) => parseCheckpointWordCount(right) - parseCheckpointWordCount(left));

  if (!checkpoints.length) {
    return null;
  }

  const checkpointPath = withinProject(projectId, "drafts", ".checkpoints", checkpoints[0]);
  return {
    path: checkpointPath,
    content: stripDraftMarkers(await readTextFile(checkpointPath)),
    source: "checkpoint" as const,
    completed: false,
  };
}

export async function writeFinalChapter(projectId: string, chapterNo: number, content: string) {
  const path = withinProject(
    projectId,
    "chapters",
    `chapter_${String(chapterNo).padStart(3, "0")}.md`,
  );
  await writeTextFile(path, normalizeChapterContent(content));
  return path;
}

export async function readFinalChapter(projectId: string, chapterNo: number) {
  const path = withinProject(
    projectId,
    "chapters",
    `chapter_${String(chapterNo).padStart(3, "0")}.md`,
  );
  if (!existsSync(path)) {
    return null;
  }
  return readTextFile(path);
}

export async function archiveInvalidatedChapter(
  projectId: string,
  chapterNo: number,
  input: {
    reason: string;
    invalidatedAt?: string;
    content?: string | null;
  },
) {
  const content = input.content ?? await readFinalChapter(projectId, chapterNo);
  if (!content) {
    return null;
  }
  const stamp = (input.invalidatedAt ?? nowIso()).replace(/[:.]/g, "-");
  const path = withinProject(
    projectId,
    "history",
    "invalidated",
    `chapter_${String(chapterNo).padStart(3, "0")}_${stamp}.md`,
  );
  const archived = [
    `<!-- INVALIDATED reason: ${input.reason.replace(/\s+/g, " ").trim()} -->`,
    "",
    content.trimEnd(),
    "",
  ].join("\n");
  await writeTextFile(path, archived);
  return {
    path,
    excerpt: content.trim().slice(0, 180),
  };
}

export async function listWrittenChapters(projectId: string) {
  const chaptersDir = withinProject(projectId, "chapters");
  if (!existsSync(chaptersDir)) {
    return [] as number[];
  }

  const files = await readdir(chaptersDir);
  return files
    .map((file) => file.match(/^chapter_(\d+)\.md$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right);
}

export async function saveSummaryFiles(
  projectId: string,
  chapterNo: number,
  summaries: { brief: string; detailed: string; full: string },
) {
  const prefix = withinProject(projectId, "chapters", "summaries");
  const entries = [
    ["brief", summaries.brief],
    ["detailed", summaries.detailed],
    ["full", summaries.full],
  ] as const;

  await Promise.all(
    entries.map(([level, content]) =>
      writeTextFile(
        join(prefix, `chapter_${String(chapterNo).padStart(3, "0")}_${level}.md`),
        `${content.trim()}\n`,
      ),
    ),
  );
}

export async function deleteChapterArtifactsInRange(
  projectId: string,
  startChapter: number,
  endChapter: number,
  options?: { preserveInvalidatedHistory?: boolean },
) {
  for (let chapterNo = startChapter; chapterNo <= endChapter; chapterNo += 1) {
    const chapterId = String(chapterNo).padStart(3, "0");
    await Promise.all([
      unlinkIfExists(withinProject(projectId, "chapters", `chapter_${chapterId}.md`)),
      unlinkIfExists(withinProject(projectId, "chapters", "summaries", `chapter_${chapterId}_brief.md`)),
      unlinkIfExists(withinProject(projectId, "chapters", "summaries", `chapter_${chapterId}_detailed.md`)),
      unlinkIfExists(withinProject(projectId, "chapters", "summaries", `chapter_${chapterId}_full.md`)),
      unlinkIfExists(withinProject(projectId, "canon", `character_snapshot_${chapterId}.json`)),
      unlinkIfExists(withinProject(projectId, "canon", `logic_state_${chapterId}.json`)),
      unlinkIfExists(withinProject(projectId, "canon", `artifact_status_${chapterId}.json`)),
      unlinkIfExists(withinProject(projectId, "blueprints", `chapter_${chapterId}_blueprint.json`)),
      unlinkIfExists(withinProject(projectId, "structure", `chapter_${chapterId}_scene_brief.json`)),
      unlinkIfExists(withinProject(projectId, "reviews", `chapter_${chapterId}_conflicts.json`)),
      deleteFilesWithPrefix(withinProject(projectId, "blueprints", "traces"), `chapter_${chapterId}_`, ".json"),
      deleteFilesWithPrefix(withinProject(projectId, "drafts"), `chapter_${chapterId}_draft_`, ".md"),
      deleteFilesWithPrefix(withinProject(projectId, "drafts", ".checkpoints"), `chapter_${chapterId}_checkpoint_`, ".md"),
      deleteFilesWithPrefix(withinProject(projectId, "reviews"), `chapter_${chapterId}_review_`, ".json"),
      deleteFilesWithPrefix(withinProject(projectId, "patches"), `chapter_${chapterId}_patch_`, ".json"),
      deleteFilesWithPrefix(withinProject(projectId, "versions"), `chapter_${chapterId}_v`, ".md"),
      ...(options?.preserveInvalidatedHistory
        ? []
        : [deleteFilesWithPrefix(withinProject(projectId, "history", "invalidated"), `chapter_${chapterId}_`, ".md")]),
    ]);
  }
}
