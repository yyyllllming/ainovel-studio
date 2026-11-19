import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { appPaths, projectDir, resolveProjectFilePath, resolveReadablePath, withinProject } from "./paths.ts";

test("projectDir rejects path traversal in project ids", () => {
  assert.throws(() => projectDir("../escape"), /projectId 不合法/);
});

test("resolveReadablePath allows project files and blocks files outside allowed roots", () => {
  const chapterPath = withinProject("demo_project", "chapters", "chapter_001.md");
  assert.equal(resolveReadablePath(chapterPath), chapterPath);
  assert.equal(
    resolveReadablePath(`${appPaths.promptsDir}\\foundation-coach.md`),
    `${appPaths.promptsDir}\\foundation-coach.md`,
  );
  assert.equal(
    resolveReadablePath(`${appPaths.stylesDir}\\default.md`),
    `${appPaths.stylesDir}\\default.md`,
  );
  assert.throws(
    () => resolveReadablePath(`${appPaths.configDir}\\llm-profiles.json`),
    /允许范围内/,
  );
  assert.throws(() => resolveReadablePath("..\\README.md"), /允许范围内/);
});

test("resolveProjectFilePath limits patch reads to the current project", () => {
  const patchPath = withinProject("demo_project", "patches", "chapter_001_patch.json");
  assert.equal(resolveProjectFilePath("demo_project", patchPath, ["patches"]), patchPath);
  assert.throws(
    () => resolveProjectFilePath("demo_project", `${appPaths.configDir}\\llm-profiles.json`, ["patches"]),
    /项目文件路径不合法/,
  );
});

test("realpath containment rejects symlink/junction escapes from the project sandbox", (t) => {
  const projectId = `paths-symlink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const base = projectDir(projectId);
  mkdirSync(join(base, "chapters"), { recursive: true });

  try {
    try {
      // junction 在 Windows 上无需管理员权限，其它平台退化为普通目录 symlink
      symlinkSync(appPaths.configDir, join(base, "escape"), "junction");
    } catch {
      t.skip("当前环境无法创建符号链接/junction");
      return;
    }

    assert.throws(() => withinProject(projectId, "escape", "llm-profiles.json"), /项目文件路径不合法/);
    assert.throws(() => resolveProjectFilePath(projectId, "escape/llm-profiles.json"), /项目文件路径不合法/);
    assert.throws(() => resolveReadablePath(join(base, "escape", "llm-profiles.json")), /允许范围内/);

    // 项目内部的链接不受影响
    symlinkSync(join(base, "chapters"), join(base, "internal"), "junction");
    assert.equal(
      resolveProjectFilePath(projectId, "internal/chapter_001.md"),
      join(base, "internal", "chapter_001.md"),
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
