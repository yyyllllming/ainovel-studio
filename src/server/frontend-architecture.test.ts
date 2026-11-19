import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const sharedTypeFiles = [
  "src/lib/types/card.ts",
  "src/lib/types/chapter.ts",
  "src/lib/types/project.ts",
  "src/lib/types/foundation.ts",
  "src/lib/types/index.ts",
];

const splitComponents = [
  "src/components/project/run-control-panel.tsx",
  "src/components/project/chapter-cleanup-panel.tsx",
  "src/components/project/steering-notes-panel.tsx",
  "src/components/project/model-assignment-section.tsx",
  "src/components/project/chapter-outline-grid.tsx",
  "src/components/cards/card-list-sidebar.tsx",
  "src/components/cards/card-detail-panel.tsx",
  "src/components/cards/card-editor-utils.ts",
  "src/components/foundation/style-reference-selector.tsx",
  "src/components/foundation/workshop-conversation.tsx",
  "src/components/foundation/foundation-preview.tsx",
  "src/components/dashboard/project-creation-form.tsx",
];

const lineBudgets = [
  { path: "src/components/project-detail-client.tsx", max: 850 },
  { path: "src/components/card-library-client.tsx", max: 650 },
  { path: "src/components/foundation-workshop-client.tsx", max: 750 },
  { path: "src/components/dashboard-client.tsx", max: 650 },
];

const inlineTypeTargets = [
  "src/components/project-detail-client.tsx",
  "src/components/card-library-client.tsx",
  "src/components/dashboard-client.tsx",
  "src/components/chapter-workshop-client.tsx",
];

test("frontend shared type modules exist", async () => {
  await Promise.all(sharedTypeFiles.map((relativePath) => access(resolve(platformRoot, relativePath))));
});

test("large frontend components are split into focused subcomponents", async () => {
  await Promise.all(splitComponents.map((relativePath) => access(resolve(platformRoot, relativePath))));
});

test("large frontend components shrink below the architecture budget", async () => {
  for (const target of lineBudgets) {
    const source = await readFile(resolve(platformRoot, target.path), "utf8");
    const lineCount = source.split(/\r?\n/).length;
    assert.ok(lineCount <= target.max, `${target.path} should be <= ${target.max} lines, got ${lineCount}`);
  }
});

test("frontend entry components stop carrying many inline interfaces", async () => {
  for (const relativePath of inlineTypeTargets) {
    const source = await readFile(resolve(platformRoot, relativePath), "utf8");
    const interfaceCount = (source.match(/^interface\s+\w+/gm) ?? []).length;
    assert.ok(interfaceCount <= 3, `${relativePath} should define at most 3 inline interfaces, got ${interfaceCount}`);
  }
});
