import "./server-only.ts";

import { randomUUID } from "node:crypto";
import { copyFile, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, relative } from "node:path";
import YAML from "yaml";
import { sanitizeArtifactName } from "./file-names.ts";
import { rewriteIndexedJsonDirectory } from "./foundation/foundation-file-sync.ts";
import { projectDir, resolveProjectFilePath, withinProject } from "./paths.ts";
import type {
  ChapterBlueprint,
  EditorPatch,
  FoundationPayload,
  PlannerQualitySummary,
  PlannerTraceArtifact,
  QuickAuditVerdict,
  ReviewArtifact,
  ReviewLineage,
  ReviewVerdict,
} from "./types.ts";
import { ensureDir, nowIso, readTextFile, writeTextFile } from "./utils.ts";
import { safeParseJson } from "./utils/safe-json.ts";
import { normalizeChapterContent } from "./files/commit-stage-files.ts";

async function writeJson(path: string, value: unknown) {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function ensureProjectLayout(projectId: string) {
  const base = projectDir(projectId);
  const dirs = [
    base,
    withinProject(projectId, ".staging"),
    withinProject(projectId, ".staging", "commits"),
    withinProject(projectId, ".staging", "author-submissions"),
    withinProject(projectId, "bible"),
    withinProject(projectId, "entities"),
    withinProject(projectId, "structure"),
    withinProject(projectId, "memory"),
    withinProject(projectId, "config"),
    withinProject(projectId, "config", "characters"),
    withinProject(projectId, "config", "worldview"),
    withinProject(projectId, "config", "prompts"),
    withinProject(projectId, "chapters"),
    withinProject(projectId, "chapters", "summaries"),
    withinProject(projectId, "canon"),
    withinProject(projectId, "drafts"),
    withinProject(projectId, "drafts", ".checkpoints"),
    withinProject(projectId, "versions"),
    withinProject(projectId, "reviews"),
    withinProject(projectId, "blueprints"),
    withinProject(projectId, "blueprints", "traces"),
    withinProject(projectId, "patches"),
    withinProject(projectId, "history"),
    withinProject(projectId, "history", "invalidated"),
    withinProject(projectId, "exports"),
    withinProject(projectId, "references"),
    withinProject(projectId, "references", "raw"),
    withinProject(projectId, "references", "normalized"),
    withinProject(projectId, "references", "snapshots"),
    withinProject(projectId, "author-submissions"),
  ];

  await Promise.all(dirs.map((dir) => ensureDir(dir)));

  const canonFiles = [
    withinProject(projectId, "canon", "facts.jsonl"),
    withinProject(projectId, "canon", "foreshadows.jsonl"),
  ];

  await Promise.all(
    canonFiles.map(async (file) => {
      if (!existsSync(file)) {
        await writeFile(file, "", "utf8");
      }
    }),
  );
}

export async function writeProjectMeta(
  projectId: string,
  meta: Record<string, unknown>,
) {
  await ensureProjectLayout(projectId);
  const content = YAML.stringify(meta);
  await writeTextFile(withinProject(projectId, "project.yaml"), content);
}

export async function readProjectMeta(projectId: string) {
  const file = withinProject(projectId, "project.yaml");
  if (!existsSync(file)) {
    return null;
  }
  const raw = await readFile(file, "utf8");
  return YAML.parse(raw) as Record<string, unknown>;
}

export async function writeFoundationFiles(projectId: string, foundation: FoundationPayload) {
  await ensureProjectLayout(projectId);
  await Promise.all([
    writeTextFile(withinProject(projectId, "config", "style.md"), foundation.styleCard),
    writeJson(withinProject(projectId, "config", "style-profile.json"), foundation.styleProfile ?? {}),
    writeTextFile(withinProject(projectId, "config", "style-digest.md"), foundation.styleDigest?.trim() || ""),
    writeJson(withinProject(projectId, "config", "style-exemplars.json"), foundation.styleExemplars ?? []),
    writeJson(
      withinProject(projectId, "bible", "core.json"),
      {
        premise: foundation.premise,
        mainline: foundation.mainline ?? "",
        storyHook: foundation.storyHook ?? "",
        styleCard: foundation.styleCard,
        styleProfile: foundation.styleProfile ?? {},
        styleSnapshotId: foundation.styleSnapshotId ?? null,
        styleSnapshotVersion: foundation.styleSnapshotVersion ?? null,
        styleDigest: foundation.styleDigest ?? "",
        styleExemplars: foundation.styleExemplars ?? [],
        worldview: foundation.worldview,
        relationships: foundation.relationships,
      },
    ),
    rewriteIndexedJsonDirectory({
      dir: withinProject(projectId, "config", "characters"),
      entries: foundation.characters,
      fileName: (character, index) =>
        `${String(index + 1).padStart(2, "0")}_${sanitizeArtifactName(character.name, "character")}.json`,
    }),
    rewriteIndexedJsonDirectory({
      dir: withinProject(projectId, "config", "worldview"),
      entries: foundation.worldview,
      fileName: (entry, index) =>
        `${String(index + 1).padStart(2, "0")}_${sanitizeArtifactName(entry.name, "world")}.json`,
    }),
  ]);
}

export async function writeBlueprintFile(projectId: string, blueprint: ChapterBlueprint) {
  await ensureProjectLayout(projectId);
  await Promise.all([
    writeJson(
      withinProject(projectId, "blueprints", `chapter_${String(blueprint.chapterNo).padStart(3, "0")}_blueprint.json`),
      blueprint,
    ),
    writeJson(
      withinProject(projectId, "structure", `chapter_${String(blueprint.chapterNo).padStart(3, "0")}_scene_brief.json`),
      blueprint,
    ),
  ]);
}

export function plannerTracePath(projectId: string, chapterNo: number) {
  return withinProject(
    projectId,
    "blueprints",
    "traces",
    `chapter_${String(chapterNo).padStart(3, "0")}_planner_trace.json`,
  );
}

export async function writePlannerTraceFile(projectId: string, chapterNo: number, trace: PlannerTraceArtifact) {
  await ensureProjectLayout(projectId);
  const path = plannerTracePath(projectId, chapterNo);
  await writeJson(path, trace);
  return path;
}

export async function readPlannerTraceFile(projectId: string, chapterNo: number) {
  const path = plannerTracePath(projectId, chapterNo);
  if (!existsSync(path)) {
    return null;
  }
  return safeParseJson<PlannerTraceArtifact>(await readTextFile(path));
}

export async function writeReviewFile(input: {
  projectId: string;
  chapterNo: number;
  review: ReviewVerdict | QuickAuditVerdict;
  plannerQuality?: PlannerQualitySummary | null;
  plannerTracePath?: string | null;
  lineage: ReviewLineage;
}) {
  await ensureProjectLayout(input.projectId);
  const path = withinProject(
    input.projectId,
    "reviews",
    `chapter_${String(input.chapterNo).padStart(3, "0")}_review_${Date.now()}_${randomUUID()}.json`,
  );
  const artifact: ReviewArtifact = {
    ...input.review,
    plannerQuality: input.plannerQuality ?? null,
    plannerTracePath: input.plannerTracePath ?? null,
    localFlavorSignals: input.review.localFlavorSignals ?? null,
    recordedAt: nowIso(),
    ...input.lineage,
  };
  await writeJson(path, artifact);
  return path;
}

export async function writePatchFile(projectId: string, chapterNo: number, patch: EditorPatch) {
  const path = withinProject(
    projectId,
    "patches",
    `chapter_${String(chapterNo).padStart(3, "0")}_patch_${Date.now()}.json`,
  );
  await writeJson(path, patch);
  return path;
}

export async function writeVersionFile(
  projectId: string,
  chapterNo: number,
  versionNo: number,
  content: string,
) {
  const path = withinProject(
    projectId,
    "versions",
    `chapter_${String(chapterNo).padStart(3, "0")}_v${versionNo}.md`,
  );
  await writeTextFile(path, normalizeChapterContent(content));
  return path;
}

export async function copyVersionToChapter(versionPath: string, projectId: string, chapterNo: number) {
  const target = withinProject(
    projectId,
    "chapters",
    `chapter_${String(chapterNo).padStart(3, "0")}.md`,
  );
  await ensureDir(dirname(target));
  await copyFile(versionPath, target);
  return target;
}

export async function readVersionFile(path: string) {
  return readTextFile(path);
}

// start/end 是解码后文本的 code unit 偏移；UTF-8 中一个 UTF-16 code unit 最多 3 字节，
// 因此读前 end*3+4 字节即可保证窗口内不含被截断的字符，避免大文件整份读入内存。
async function readTextFilePrefix(path: string, maxChars: number, fileSize: number) {
  const maxBytes = Math.min(fileSize, maxChars * 3 + 4);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function getFileWindow(projectId: string, relativePath: string, start = 0, end?: number) {
  const baseDir = projectDir(projectId);
  const safePath = resolveProjectFilePath(projectId, relativePath);
  const stats = await stat(safePath);
  const content = end === undefined
    ? await readTextFile(safePath)
    : await readTextFilePrefix(safePath, end, stats.size);
  const slice = content.slice(start, end ?? content.length);
  return {
    content: slice,
    start,
    end: start + slice.length,
    size: stats.size,
    path: relative(baseDir, safePath).replace(/\\/g, "/"),
  };
}

export async function deleteLockFile(projectId: string) {
  const path = withinProject(projectId, ".lock");
  if (existsSync(path)) {
    await unlink(path);
  }
}

export * from "./files/chapter-files.ts";
export * from "./files/canon-files.ts";
export * from "./files/style-files.ts";
export * from "./files/commit-stage-files.ts";
export * from "./files/export-files.ts";
export {
  authorSubmissionContentPath,
  authorSubmissionPreviewDir,
  buildSingleSubmissionPreview,
  promoteAuthorSubmission,
} from "./files/author-submission-files.ts";
export type {
  SingleAuthorSubmissionPreview,
  SingleAuthorSubmissionPreviewChapter,
} from "./files/author-submission-files.ts";
