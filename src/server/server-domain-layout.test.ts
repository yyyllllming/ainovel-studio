import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const movedFiles = {
  writing: [
    "prose-rescue.ts",
    "prose-normalizer.ts",
    "draft-quality.ts",
    "writing-dna.ts",
    "quick-audit.ts",
    "style-pass.ts",
    "style-prompt-guard.ts",
  ],
  style: [
    "style-steering.ts",
    "style-snapshot.ts",
    "style-reference-import.ts",
    "foundation-style.ts",
  ],
  foundation: [
    "foundation-workshop.ts",
    "foundation-enrichment.ts",
    "foundation-workshop-rules.ts",
    "foundation-workshop-copy.ts",
    "foundation-card-sync.ts",
    "foundation-file-sync.ts",
  ],
  story: [
    "story-progression.ts",
    "story-contract.ts",
    "story-memory.ts",
    "story-lorebook.ts",
    "story-seed-patch.ts",
  ],
  character: [
    "auto-character-discovery.ts",
    "auto-character-discovery-runtime.ts",
    "character-name-normalization.ts",
    "card-progressions.ts",
    "card-workshop.ts",
  ],
} as const;

const allowedFlatFiles = new Set<string>([
]);

test("server files are regrouped into domain subdirectories", async () => {
  for (const [directory, files] of Object.entries(movedFiles)) {
    await Promise.all(
      files.map(async (fileName) => {
        await access(resolve(platformRoot, "src/server", directory, fileName));
      }),
    );
  }
});

test("old flat server files are removed after regrouping", () => {
  for (const files of Object.values(movedFiles)) {
    for (const fileName of files) {
      if (allowedFlatFiles.has(fileName)) {
        continue;
      }
      assert.equal(
        existsSync(resolve(platformRoot, "src/server", fileName)),
        false,
        `src/server/${fileName} should be moved into a domain subdirectory`,
      );
    }
  }
});
