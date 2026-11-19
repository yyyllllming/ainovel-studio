import "../server-only.ts";

import { writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { sanitizeArtifactName } from "../file-names.ts";
import { withinAuthorCard } from "../paths.ts";
import { ensureDir, writeTextFile } from "../utils.ts";

export function authorTextImportRawPath(authorCardId: string, importId: string, originalFileName: string) {
  const extension = extname(originalFileName) || ".txt";
  return withinAuthorCard(
    authorCardId,
    "imports",
    "raw",
    `${importId}_${sanitizeArtifactName(originalFileName.replace(/\.[^.]+$/u, ""), "reference")}${extension}`,
  );
}

export function authorTextImportNormalizedPath(authorCardId: string, importId: string, title: string) {
  return withinAuthorCard(
    authorCardId,
    "imports",
    "normalized",
    `${importId}_${sanitizeArtifactName(title, "reference")}.txt`,
  );
}

export function authorBookImportPreviewDir(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId);
}

export function authorBookImportPreviewSourcePath(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId, "source.bin");
}

export function authorBookImportPreviewNormalizedPath(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId, "normalized.txt");
}

export function authorBookImportPreviewManifestPath(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId, "chapters.manifest.json");
}

export async function writeAuthorTextImportFiles(input: {
  authorCardId: string;
  importId: string;
  originalFileName: string;
  title: string;
  rawBuffer: Buffer;
  normalizedText: string;
}) {
  const rawPath = authorTextImportRawPath(input.authorCardId, input.importId, input.originalFileName);
  const normalizedPath = authorTextImportNormalizedPath(input.authorCardId, input.importId, input.title);
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

export async function writeAuthorBookImportPreviewFiles(input: {
  authorCardId: string;
  previewId: string;
  rawBuffer: Buffer;
  normalizedText: string;
  manifestJson: string;
}) {
  const sourcePath = authorBookImportPreviewSourcePath(input.authorCardId, input.previewId);
  const normalizedPath = authorBookImportPreviewNormalizedPath(input.authorCardId, input.previewId);
  const manifestPath = authorBookImportPreviewManifestPath(input.authorCardId, input.previewId);

  await Promise.all([ensureDir(dirname(sourcePath)), ensureDir(dirname(normalizedPath)), ensureDir(dirname(manifestPath))]);
  await Promise.all([
    writeFile(sourcePath, input.rawBuffer),
    writeTextFile(normalizedPath, `${input.normalizedText.trim()}\n`),
    writeTextFile(manifestPath, input.manifestJson),
  ]);

  return {
    sourcePath,
    normalizedPath,
    manifestPath,
  };
}
