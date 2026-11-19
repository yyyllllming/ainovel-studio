import "../server-only.ts";

import { writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { sanitizeArtifactName } from "../file-names.ts";
import { withinProject } from "../paths.ts";
import type { StyleCardSnapshot } from "../types.ts";
import { ensureDir, writeTextFile } from "../utils.ts";

async function writeJson(path: string, value: unknown) {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function styleImportRawPath(projectId: string, importId: string, originalFileName: string) {
  const extension = extname(originalFileName) || ".txt";
  return withinProject(
    projectId,
    "references",
    "raw",
    `${importId}_${sanitizeArtifactName(originalFileName.replace(/\.[^.]+$/u, ""), "reference")}${extension}`,
  );
}

export function styleImportNormalizedPath(projectId: string, importId: string, title: string) {
  return withinProject(
    projectId,
    "references",
    "normalized",
    `${importId}_${sanitizeArtifactName(title, "reference")}.txt`,
  );
}

export function styleSnapshotPath(projectId: string, version: number, mode: StyleCardSnapshot["mode"]) {
  return withinProject(
    projectId,
    "references",
    "snapshots",
    `style_snapshot_v${String(version).padStart(3, "0")}_${mode}.json`,
  );
}

export async function writeStyleReferenceImportFiles(input: {
  projectId: string;
  importId: string;
  originalFileName: string;
  title: string;
  rawBuffer: Buffer;
  normalizedText: string;
}) {
  const rawPath = styleImportRawPath(input.projectId, input.importId, input.originalFileName);
  const normalizedPath = styleImportNormalizedPath(input.projectId, input.importId, input.title);
  await Promise.all([ensureDir(dirname(rawPath)), ensureDir(dirname(normalizedPath))]);

  await Promise.all([
    writeFile(rawPath, input.rawBuffer),
    writeTextFile(normalizedPath, `${input.normalizedText.trim()}\n`),
  ]);

  return {
    rawPath,
    normalizedPath,
  };
}

export async function writeStyleSnapshotFile(projectId: string, snapshot: StyleCardSnapshot) {
  const path = styleSnapshotPath(projectId, snapshot.version, snapshot.mode);
  await ensureDir(dirname(path));
  await writeJson(path, snapshot);
  return path;
}
