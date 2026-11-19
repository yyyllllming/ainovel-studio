import test from "node:test";
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { projectDir, withinProject } from "./paths.ts";
import {
  commitStageDir,
  ensureProjectLayout,
  getFileWindow,
  inspectCommitStage,
  promoteCommitStage,
  readFinalChapter,
  scanCommitStageResidues,
  writeCommitStage,
  cleanupCommitStage,
  computeChapterContentHash,
  normalizeChapterContent,
} from "./project-files.ts";
import { readTextFile } from "./utils.ts";

function createProjectId() {
  return `project-files-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

test("chapter content hashing uses one trailing-newline normalization", () => {
  assert.equal(normalizeChapterContent("正文\n\n"), "正文\n");
  assert.equal(
    computeChapterContentHash("正文"),
    computeChapterContentHash("正文\n\n"),
  );
});

test("commit stage files can be written, promoted, and verified against final project paths", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  const stageDir = commitStageDir(projectId, "commit-1");

  try {
    const manifest = await writeCommitStage(stageDir, [
      {
        relativePath: "chapters/chapter_007.md",
        content: "chapter seven final\n",
      },
      {
        relativePath: "chapters/summaries/chapter_007_brief.md",
        content: "brief summary\n",
      },
    ]);

    assert.equal(manifest.files.length, 2);

    await promoteCommitStage(projectId, stageDir, manifest);

    assert.equal(await readFinalChapter(projectId, 7), "chapter seven final\n");
    assert.equal(
      await readTextFile(withinProject(projectId, "chapters", "summaries", "chapter_007_brief.md")),
      "brief summary\n",
    );

    const inspection = await inspectCommitStage(projectId, stageDir, manifest);
    assert.equal(inspection.stageDirExists, true);
    assert.equal(inspection.stageReady, true);
    assert.equal(inspection.finalFilesMatchManifest, true);
    assert.deepEqual(inspection.mismatchedFiles, []);
  } finally {
    await cleanupProject(projectId);
  }
});

test("getFileWindow keeps character-offset semantics for multi-byte content without full-file reads", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  const text = `第一章 雪夜${"山海经".repeat(2000)}end`;
  await writeFile(withinProject(projectId, "chapters", "chapter_001.md"), text, "utf8");

  try {
    const window = await getFileWindow(projectId, "chapters/chapter_001.md", 2, 6);
    assert.equal(window.content, text.slice(2, 6));
    assert.equal(window.start, 2);
    assert.equal(window.end, 6);
    assert.equal(window.size, Buffer.byteLength(text, "utf8"));

    // end 超过文件长度时按实际内容截断，不会因 end 过大放大分配
    const capped = await getFileWindow(projectId, "chapters/chapter_001.md", 0, 10_000_000);
    assert.equal(capped.content, text);

    const full = await getFileWindow(projectId, "chapters/chapter_001.md");
    assert.equal(full.content, text);
  } finally {
    await cleanupProject(projectId);
  }
});

test("commit stage residues can be listed and cleaned up", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  const stageDir = commitStageDir(projectId, "commit-2");

  try {
    await writeCommitStage(stageDir, [
      {
        relativePath: "versions/chapter_007_v2.md",
        content: "version two\n",
      },
    ]);

    const residues = await scanCommitStageResidues(projectId);
    assert.equal(residues.some((entry) => entry.stageDir === stageDir), true);

    await cleanupCommitStage(stageDir);

    const nextResidues = await scanCommitStageResidues(projectId);
    assert.equal(nextResidues.some((entry) => entry.stageDir === stageDir), false);
  } finally {
    await cleanupProject(projectId);
  }
});
