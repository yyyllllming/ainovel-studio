import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// 这些路由归属其他模块负责人，迁移到 readJsonBody 之前临时豁免。
const bareJsonBodyAllowlist = new Set([
  "src/app/api/settings/llm-profiles/save/route.ts",
  "src/app/api/settings/llm-profiles/test/route.ts",
  "src/app/api/settings/llm-profiles/fetch-models/route.ts",
  "src/app/api/projects/[projectId]/foundation/workshop/style-steering/route.ts",
  "src/app/api/ideas/[ideaId]/workshop/route.ts",
]);

async function collectApiRoutes(): Promise<string[]> {
  const rootDir = resolve(platformRoot, "src/app/api");
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
      if (entry.name === "route.ts") {
        collected.push(absolutePath);
      }
    }
  }

  return collected
    .map((absolutePath) => absolutePath.slice(platformRoot.length + 1).replace(/\\/g, "/"))
    .sort((left, right) => left.localeCompare(right));
}

async function readRouteSource(relativePath: string) {
  return await readFile(resolve(platformRoot, relativePath), "utf8");
}

test("API 路由不直接裸 await request.json()，统一走 readJsonBody 或 .catch 兜底", async () => {
  const routes = await collectApiRoutes();
  assert.ok(routes.length > 0, "expected to discover route entrypoints under src/app/api");

  const bareJsonPattern = /await request\.json\(\)(?!\.catch\()/u;
  for (const relativePath of routes) {
    if (bareJsonBodyAllowlist.has(relativePath)) {
      continue;
    }
    const source = await readRouteSource(relativePath);
    assert.ok(
      !bareJsonPattern.test(source),
      `${relativePath} 仍在裸调用 await request.json()，请改用 readJsonBody(request)`,
    );
  }
});

test("chapterNo 动态段路由必须经 chapterNoSchema/projectIdSchema 校验", async () => {
  const targets = [
    "src/app/api/projects/[projectId]/chapters/[chapterNo]/review/route.ts",
    "src/app/api/projects/[projectId]/chapters/[chapterNo]/versions/route.ts",
    "src/app/api/projects/[projectId]/chapters/[chapterNo]/generate-versions/route.ts",
  ];
  for (const relativePath of targets) {
    const source = await readRouteSource(relativePath);
    assert.ok(source.includes("projectIdSchema.parse("), `${relativePath} 缺少 projectIdSchema 校验`);
    assert.ok(source.includes("chapterNoSchema.parse("), `${relativePath} 缺少 chapterNoSchema 校验`);
    assert.ok(!source.includes("Number(chapterNo)"), `${relativePath} 不应裸用 Number(chapterNo)`);
  }
});

test("canon 路由在路由层完成 projectId 校验", async () => {
  const targets = [
    "src/app/api/projects/[projectId]/canon/facts/route.ts",
    "src/app/api/projects/[projectId]/canon/conflicts/route.ts",
  ];
  for (const relativePath of targets) {
    const source = await readRouteSource(relativePath);
    assert.ok(source.includes("projectIdSchema.parse("), `${relativePath} 缺少 projectIdSchema 校验`);
  }
});

test("demo 路由在生产构建中被短路为 404", async () => {
  const source = await readRouteSource("src/app/api/demo/route.ts");
  assert.ok(
    source.includes("process.env.NODE_ENV === \"production\""),
    "demo 路由必须按 NODE_ENV 短路生产请求",
  );
});

test("author submission routes validate every dynamic segment and keep client file names out of paths", async () => {
  const routes = [
    "src/app/api/projects/[projectId]/author-submissions/route.ts",
    "src/app/api/projects/[projectId]/author-submissions/preview/route.ts",
    "src/app/api/projects/[projectId]/author-submissions/import/route.ts",
    "src/app/api/projects/[projectId]/author-submissions/[submissionId]/review/route.ts",
    "src/app/api/projects/[projectId]/author-submissions/[submissionId]/revise/route.ts",
    "src/app/api/projects/[projectId]/author-submissions/[submissionId]/approve/route.ts",
  ];
  for (const relativePath of routes) {
    const source = await readRouteSource(relativePath);
    assert.ok(source.includes("projectIdSchema.parse("), `${relativePath} 缺少 projectIdSchema 校验`);
    if (relativePath.includes("[submissionId]")) {
      assert.ok(source.includes("submissionIdSchema.parse("), `${relativePath} 缺少 submissionIdSchema 校验`);
    }
  }
  const preview = await readRouteSource("src/app/api/projects/[projectId]/author-submissions/preview/route.ts");
  assert.match(preview, /\\\.\(\?:md\|txt\)\$/);
  assert.doesNotMatch(preview, /withinProject\([^)]*file\.name/);
});
