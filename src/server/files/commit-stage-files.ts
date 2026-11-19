import "../server-only.ts";

import { createHash } from "node:crypto";
import { copyFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { resolveProjectFilePath, withinProject } from "../paths.ts";
import { ensureDir, writeTextFile } from "../utils.ts";

function withinProjectFromDir(dir: string, file: string) {
  return join(dir, file);
}

export interface CommitStageManifestFile {
  relativePath: string;
  contentHash: string;
  artifactFamily?: ArtifactManifestFamily | null;
}

export interface CommitStageManifest {
  files: CommitStageManifestFile[];
}

export type ArtifactManifestFamily = "chapter" | "blueprint" | "review";

export const commitStageManifestSchema = z.object({
  files: z.array(z.object({
    relativePath: z.string(),
    contentHash: z.string(),
    artifactFamily: z.enum(["chapter", "blueprint", "review"]).nullable().optional(),
  })),
});

export function classifyArtifactManifestFamily(relativePath: string): ArtifactManifestFamily | null {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  if (/^chapters\/chapter_\d+\.md$/u.test(normalizedPath)) {
    return "chapter";
  }
  if (/^blueprints\/chapter_\d+_blueprint\.json$/u.test(normalizedPath)) {
    return "blueprint";
  }
  if (/^reviews\/chapter_\d+_review_[^/]+\.json$/u.test(normalizedPath)) {
    return "review";
  }
  return null;
}

export function commitStageDir(projectId: string, commitId: string) {
  return withinProject(projectId, ".staging", "commits", commitId);
}

function hashBuffer(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export function computeContentHash(content: string | Buffer) {
  return hashBuffer(content);
}

export function normalizeChapterContent(content: string) {
  return `${content.trimEnd()}\n`;
}

export function computeChapterContentHash(content: string) {
  return computeContentHash(normalizeChapterContent(content));
}

export function reviewWindowKey(startChapter: number, endChapter: number) {
  return `${startChapter}:${endChapter}`;
}

export function computeReviewWindowContentHash(
  chapters: Array<{ chapterNo: number; content: string }>,
) {
  return computeContentHash(JSON.stringify(
    chapters.map((chapter) => ({
      chapterNo: chapter.chapterNo,
      contentHash: computeChapterContentHash(chapter.content),
    })),
  ));
}

function stageFilePath(stageDir: string, relativePath: string) {
  return join(stageDir, relativePath.replace(/\\/g, "/"));
}

export async function writeCommitStage(
  stageDir: string,
  files: Array<{ relativePath: string; content: string }>,
): Promise<CommitStageManifest> {
  await ensureDir(stageDir);

  const manifestFiles = await Promise.all(
    files.map(async (file) => {
      const path = stageFilePath(stageDir, file.relativePath);
      await writeTextFile(path, file.content);
      return {
        relativePath: file.relativePath.replace(/\\/g, "/"),
        contentHash: hashBuffer(file.content),
        artifactFamily: classifyArtifactManifestFamily(file.relativePath),
      } satisfies CommitStageManifestFile;
    }),
  );

  return {
    files: manifestFiles,
  };
}

async function readFileHash(path: string) {
  return hashBuffer(await readFile(path));
}

export async function promoteCommitStage(projectId: string, stageDir: string, manifest: CommitStageManifest) {
  await Promise.all(
    manifest.files.map(async (file) => {
      const sourcePath = stageFilePath(stageDir, file.relativePath);
      const targetPath = resolveProjectFilePath(projectId, file.relativePath);
      await ensureDir(dirname(targetPath));
      await copyFile(sourcePath, targetPath);
    }),
  );
}

export async function inspectCommitStage(projectId: string, stageDir: string, manifest: CommitStageManifest) {
  const stageDirExists = existsSync(stageDir);
  const stageChecks = await Promise.all(
    manifest.files.map(async (file) => {
      const stagedPath = stageFilePath(stageDir, file.relativePath);
      const finalPath = resolveProjectFilePath(projectId, file.relativePath);
      const stageExists = existsSync(stagedPath);
      const finalExists = existsSync(finalPath);
      const stageHash = stageExists ? await readFileHash(stagedPath) : null;
      const finalHash = finalExists ? await readFileHash(finalPath) : null;
      const expectedHash = file.contentHash;

      return {
        relativePath: file.relativePath,
        stageReady: stageExists && stageHash === expectedHash,
        finalMatches: finalExists && finalHash === expectedHash,
      };
    }),
  );

  return {
    stageDirExists,
    stageReady: stageChecks.every((entry) => entry.stageReady),
    finalFilesMatchManifest: stageChecks.every((entry) => entry.finalMatches),
    missingFiles: stageChecks
      .filter((entry) => !entry.stageReady)
      .map((entry) => entry.relativePath),
    mismatchedFiles: stageChecks
      .filter((entry) => !entry.finalMatches)
      .map((entry) => entry.relativePath),
  };
}

export async function cleanupCommitStage(stageDir: string) {
  await rm(stageDir, { recursive: true, force: true });
}

export async function scanCommitStageResidues(projectId: string) {
  const commitsDir = withinProject(projectId, ".staging", "commits");
  if (!existsSync(commitsDir)) {
    return [] as Array<{ stageDir: string; commitId: string }>;
  }

  const entries = await readdir(commitsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      commitId: entry.name,
      stageDir: withinProjectFromDir(commitsDir, entry.name),
    }));
}
