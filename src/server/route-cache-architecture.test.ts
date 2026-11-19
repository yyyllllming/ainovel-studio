import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const dynamicPageTargets = [
  "src/app/projects/[projectId]/page.tsx",
  "src/app/projects/[projectId]/chapters/[chapterNo]/page.tsx",
];

test("project workspace pages opt out of static route caching", async () => {
  for (const relativePath of dynamicPageTargets) {
    const source = await readFile(resolve(platformRoot, relativePath), "utf8");
    assert.match(source, /export const dynamic = "force-dynamic";/);
    assert.match(source, /export const revalidate = 0;/);
  }
});
