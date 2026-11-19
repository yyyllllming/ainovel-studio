import test from "node:test";
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { appPaths, projectDir, withinProject } from "./paths.ts";
import { ensureProjectLayout } from "./project-files.ts";

function createProjectId() {
  return `file-access-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

test("readProjectFileWindow reads a project-scoped file and keeps the response path logical", async () => {
  const projectId = createProjectId();
  const chapterPath = withinProject(projectId, "chapters", "chapter_001.md");

  await ensureProjectLayout(projectId);
  await writeFile(chapterPath, "line 1\nline 2\nline 3\n", "utf8");

  try {
    const { readProjectFileWindow } = await import("./services/file-access.service.ts");

    const result = await readProjectFileWindow({
      projectId,
      relativePath: "chapters/chapter_001.md",
      start: 0,
      end: 6,
    });

    assert.equal(result.content, "line 1");
    assert.equal(result.path, "chapters/chapter_001.md");
    assert.equal(result.path.includes(projectDir(projectId)), false);
  } finally {
    await cleanupProject(projectId);
  }
});

test("readProjectFileWindow rejects traversal, absolute paths, and legacy config reads", async () => {
  const projectId = createProjectId();
  const chapterPath = withinProject(projectId, "chapters", "chapter_001.md");

  try {
    const { readProjectFileWindow } = await import("./services/file-access.service.ts");

    await assert.rejects(
      () =>
        readProjectFileWindow({
          projectId,
          relativePath: "../config/llm-profiles.json",
        }),
      /项目文件路径不合法|relativePath/,
    );

    await assert.rejects(
      () =>
        readProjectFileWindow({
          projectId,
          relativePath: chapterPath,
        }),
      /relativePath/,
    );

    await assert.rejects(
      () =>
        readProjectFileWindow({
          projectId,
          relativePath: `${appPaths.configDir}\\llm-profiles.json`,
        }),
      /项目文件路径不合法|relativePath/,
    );

    await assert.rejects(
      () =>
        readProjectFileWindow({
          path: "config/llm-profiles.json",
        }),
      /projects\//,
    );

    await assert.rejects(
      () =>
        readProjectFileWindow({
          projectId,
          relativePath: "chapters/chap\u0000ter.md",
        }),
      /非法字符/,
    );

    await assert.rejects(
      () =>
        readProjectFileWindow({
          path: `projects/${projectId}/chapters/chap\u001fter.md`,
        }),
      /非法字符/,
    );
  } finally {
    await cleanupProject(projectId);
  }
});
