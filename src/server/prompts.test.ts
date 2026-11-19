import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appPaths } from "./paths.ts";

async function writeWithMtime(path: string, content: string, mtime: Date) {
  await writeFile(path, content, "utf8");
  await utimes(path, mtime, mtime);
}

test("getPrompt re-reads prompt files after they change on disk", async () => {
  const originalPromptsDir = appPaths.promptsDir;
  const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-prompts-"));
  appPaths.promptsDir = tempRoot;

  try {
    const { getPrompt } = await import("./prompts.ts");
    const promptFile = join(tempRoot, "writer.md");

    await writeWithMtime(promptFile, "第一版提示词", new Date("2026-06-01T00:00:00Z"));
    assert.equal(await getPrompt("writer"), "第一版提示词");
    // 未修改时命中缓存
    assert.equal(await getPrompt("writer"), "第一版提示词");

    await writeWithMtime(promptFile, "第二版提示词", new Date("2026-06-02T00:00:00Z"));
    assert.equal(await getPrompt("writer"), "第二版提示词");
  } finally {
    appPaths.promptsDir = originalPromptsDir;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("getStyleCard re-reads style cards after they change on disk", async () => {
  const originalStylesDir = appPaths.stylesDir;
  const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-styles-"));
  appPaths.stylesDir = tempRoot;

  try {
    const { getStyleCard } = await import("./prompts.ts");
    const styleFile = join(tempRoot, "default.md");

    await writeWithMtime(styleFile, "旧风格卡", new Date("2026-06-01T00:00:00Z"));
    assert.equal(await getStyleCard(), "旧风格卡");

    await writeWithMtime(styleFile, "新风格卡", new Date("2026-06-02T00:00:00Z"));
    assert.equal(await getStyleCard(), "新风格卡");
  } finally {
    appPaths.stylesDir = originalStylesDir;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
