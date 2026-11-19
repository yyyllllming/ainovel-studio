import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const expectedFileModules = [
  "src/server/files/chapter-files.ts",
  "src/server/files/canon-files.ts",
  "src/server/files/style-files.ts",
  "src/server/files/commit-stage-files.ts",
  "src/server/files/export-files.ts",
];

test("project file helpers are split into focused domain modules", async () => {
  await Promise.all(
    expectedFileModules.map(async (relativePath) => {
      await access(resolve(platformRoot, relativePath));
    }),
  );
});

test("project-files.ts shrinks to a compatibility layer", async () => {
  const source = await readFile(resolve(platformRoot, "src/server/project-files.ts"), "utf8");
  const lineCount = source.split(/\r?\n/).length;
  assert.ok(lineCount <= 350, `project-files.ts should be <= 350 lines after the split, got ${lineCount}`);
  assert.ok(source.includes('export * from "./files/chapter-files.ts";'), "project-files.ts should re-export chapter files");
  assert.ok(source.includes('export * from "./files/canon-files.ts";'), "project-files.ts should re-export canon files");
  assert.ok(source.includes('export * from "./files/style-files.ts";'), "project-files.ts should re-export style files");
  assert.ok(source.includes('export * from "./files/commit-stage-files.ts";'), "project-files.ts should re-export commit-stage files");
  assert.ok(source.includes('export * from "./files/export-files.ts";'), "project-files.ts should re-export export files");
});
