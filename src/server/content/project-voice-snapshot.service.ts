import { existsSync } from "node:fs";
import { nanoid } from "nanoid";

import { listWrittenChapters, readFinalChapter, ensureProjectLayout } from "../project-files.ts";
import type { StyleExcerpt } from "../types.ts";
import { withinProject } from "../paths.ts";
import { nowIso, readTextFile, writeTextFile } from "../utils.ts";
import { safeParseJson } from "../utils/safe-json.ts";
import type { ProjectVoiceSnapshot } from "./types.ts";

function splitParagraphs(input: string) {
  return input
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function excerptFromParagraph(chapterNo: number, paragraph: string, index: number): StyleExcerpt {
  return {
    id: `project-voice-${chapterNo}-${index + 1}`,
    sourceId: `chapter-${chapterNo}`,
    sourceTitle: `chapter_${String(chapterNo).padStart(3, "0")}`,
    label: `chapter-${chapterNo}-${index + 1}`,
    tags: ["narrative"],
    content: paragraph,
    wordCount: paragraph.length,
    startOffset: 0,
    endOffset: paragraph.length,
    positionRatio: 0,
    dialogueRatio: paragraph.includes("“") ? 0.2 : 0,
  };
}

function buildPositiveAnchors(paragraphs: string[]) {
  const anchors: string[] = [];
  if (paragraphs.some((paragraph) => /先.+再/u.test(paragraph) || /按住|贴着|听见/u.test(paragraph))) {
    anchors.push("身体反馈先行");
  }
  if (paragraphs.some((paragraph) => /没急着解释|不急着解释|先听/u.test(paragraph))) {
    anchors.push("风险压住解释");
  }
  if (paragraphs.some((paragraph) => /后患|闷响|热痕|回响/u.test(paragraph))) {
    anchors.push("章末只留一个后患");
  }
  return uniqueNonEmpty(anchors);
}

export function projectVoiceSnapshotPath(projectId: string, version = 1) {
  return withinProject(
    projectId,
    "references",
    "snapshots",
    `project_voice_snapshot_v${String(version).padStart(3, "0")}.json`,
  );
}

export async function readProjectVoiceSnapshot(projectId: string, version = 1): Promise<ProjectVoiceSnapshot | null> {
  const path = projectVoiceSnapshotPath(projectId, version);
  if (!existsSync(path)) {
    return null;
  }
  return safeParseJson<ProjectVoiceSnapshot>(await readTextFile(path));
}

export async function updateProjectVoiceSnapshot(projectId: string, options?: {
  chapterNos?: number[];
  version?: number;
}) {
  await ensureProjectLayout(projectId);
  const version = options?.version ?? 1;
  const writtenChapters = (options?.chapterNos?.length ? options.chapterNos : await listWrittenChapters(projectId))
    .slice(0, 6);
  const texts = await Promise.all(
    writtenChapters.map(async (chapterNo) => ({
      chapterNo,
      content: (await readFinalChapter(projectId, chapterNo)) ?? "",
    })),
  );
  const paragraphs = texts.flatMap(({ chapterNo, content }) =>
    splitParagraphs(content)
      .filter((paragraph) => paragraph.length >= 12)
      .slice(0, 2)
      .map((paragraph, index) => ({ chapterNo, paragraph, index })),
  );
  const exemplars = paragraphs
    .slice(0, 4)
    .map(({ chapterNo, paragraph, index }) => excerptFromParagraph(chapterNo, paragraph, index));
  const positiveAnchors = buildPositiveAnchors(paragraphs.map((entry) => entry.paragraph));
  const snapshot: ProjectVoiceSnapshot = {
    id: `project-voice-${nanoid(8)}`,
    version,
    updatedAt: nowIso(),
    sourceChapterNos: writtenChapters,
    digest: positiveAnchors.length
      ? `本书声线：${positiveAnchors.join("，")}。`
      : "本书声线：优先贴着身体反馈、风险和章末单钩推进。",
    positiveAnchors: positiveAnchors.length
      ? positiveAnchors
      : ["身体反馈先行", "风险压住解释", "章末只留一个后患"],
    antiPatterns: ["不要先总结再动作", "不要把解释压过遭遇"],
    exemplars,
  };
  await writeTextFile(projectVoiceSnapshotPath(projectId, version), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}
