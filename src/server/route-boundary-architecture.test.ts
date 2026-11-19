import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const restrictedImports = [
  "@/server/repository",
  "@/server/project-files",
  "@/server/run-manager",
  "@/server/idea-workshop",
  "@/server/character/auto-character-discovery-runtime",
  "@/server/profiles",
];

const restrictedImportPatterns = [
  /from\s+["'][^"']*\/repository(?:\.ts)?["']/u,
  /from\s+["'][^"']*\/project-files(?:\.ts)?["']/u,
  /from\s+["'][^"']*\/run-manager(?:\.ts)?["']/u,
  // 不匹配已迁移的 foundation/idea-workshop，仅拦截遗留的根级 idea-workshop barrel
  /from\s+["'][^"']*(?<!foundation)\/idea-workshop(?:\.ts)?["']/u,
  /from\s+["'][^"']*\/character\/auto-character-discovery-runtime(?:\.ts)?["']/u,
  /from\s+["'][^"']*\/profiles(?:\.ts)?["']/u,
];

async function collectBoundaryTargets(relativeDir: string): Promise<string[]> {
  const rootDir = resolve(platformRoot, relativeDir);
  const collected: string[] = [];
  const pending = [rootDir];

  while (pending.length) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }

      if (entry.name === "route.ts" || entry.name === "page.tsx") {
        collected.push(absolutePath);
      }
    }
  }

  return collected
    .map((absolutePath) => absolutePath.slice(platformRoot.length + 1).replace(/\\/g, "/"))
    .sort((left, right) => left.localeCompare(right));
}

test("route and page layers avoid restricted legacy server imports", async () => {
  const boundaryTargets = await collectBoundaryTargets("src/app");
  assert.ok(boundaryTargets.length > 0, "expected to discover route/page entrypoints under src/app");

  for (const relativePath of boundaryTargets) {
    const source = await readFile(resolve(platformRoot, relativePath), "utf8");
    for (const restrictedImport of restrictedImports) {
      assert.ok(
        !source.includes(restrictedImport),
        `${relativePath} still imports ${restrictedImport}`,
      );
    }
    for (const pattern of restrictedImportPatterns) {
      assert.ok(
        !pattern.test(source),
        `${relativePath} still imports a restricted server boundary via ${pattern}`,
      );
    }
  }
});

test("eslint config removes legacy boundary bridge exemptions", async () => {
  const source = await readFile(resolve(platformRoot, "eslint.config.mjs"), "utf8");
  assert.ok(!source.includes("legacyBoundaryBridgeFiles"), "legacy boundary bridge exemptions should be removed");
});
