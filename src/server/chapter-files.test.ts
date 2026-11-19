import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { projectDir } from "./paths.ts";
import {
  checkpointFilePath,
  draftFilePath,
  recoverDraft,
  writeCheckpoint,
} from "./files/chapter-files.ts";
import { writeTextFile } from "./utils.ts";

function createProjectId() {
  return `chapter-files-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

function longBody(marker: string) {
  return `${marker}：${"正文内容".repeat(80)}。`;
}

function completedDraftRaw(marker: string) {
  return [
    "<!-- DRAFT_META",
    "chapterNo: 1",
    "-->",
    "",
    longBody(marker),
    "",
    "<!-- DRAFT_END wordCount: 320 completedAt: 2026-01-01T00:10:00.000Z -->",
    "",
  ].join("\n");
}

function interruptedDraftRaw(marker: string) {
  return [
    "<!-- DRAFT_META",
    "chapterNo: 1",
    "-->",
    "",
    longBody(marker),
  ].join("\n");
}

test("recoverDraft marks DRAFT_END drafts as completed so they are not resumed as interrupted drafts", async () => {
  const projectId = createProjectId();
  try {
    await writeTextFile(
      draftFilePath(projectId, 1, "2026-01-01T00:00:00.000Z"),
      completedDraftRaw("完整稿"),
    );

    const recovered = await recoverDraft(projectId, 1);
    assert.equal(recovered?.source, "draft");
    assert.equal(recovered?.completed, true);
    assert.equal(recovered?.content.includes("完整稿"), true);
    assert.equal(recovered?.content.includes("DRAFT_END"), false);
  } finally {
    await cleanupProject(projectId);
  }
});

test("recoverDraft resumes the newest interrupted draft instead of an older completed draft", async () => {
  const projectId = createProjectId();
  try {
    await writeTextFile(
      draftFilePath(projectId, 1, "2026-01-01T00:00:00.000Z"),
      completedDraftRaw("旧完整稿"),
    );
    await writeTextFile(
      draftFilePath(projectId, 1, "2026-01-02T00:00:00.000Z"),
      interruptedDraftRaw("新中断稿"),
    );

    const recovered = await recoverDraft(projectId, 1);
    assert.equal(recovered?.source, "draft");
    assert.equal(recovered?.completed, false);
    assert.equal(recovered?.content.includes("新中断稿"), true);
    assert.equal(recovered?.content.includes("旧完整稿"), false);
  } finally {
    await cleanupProject(projectId);
  }
});

test("recoverDraft picks the checkpoint with the numerically largest word count, not the lexicographic one", async () => {
  const projectId = createProjectId();
  try {
    await writeCheckpoint(checkpointFilePath(projectId, 1, 9988), 9988, longBody("较早checkpoint"));
    await writeCheckpoint(checkpointFilePath(projectId, 1, 10100), 10100, longBody("最新checkpoint"));

    const recovered = await recoverDraft(projectId, 1);
    assert.equal(recovered?.source, "checkpoint");
    assert.equal(recovered?.completed, false);
    assert.equal(recovered?.content.includes("最新checkpoint"), true);
  } finally {
    await cleanupProject(projectId);
  }
});

test("recoverDraft skips near-empty drafts and falls back to the checkpoint", async () => {
  const projectId = createProjectId();
  try {
    await writeTextFile(
      draftFilePath(projectId, 1, "2026-01-02T00:00:00.000Z"),
      "<!-- DRAFT_META\nchapterNo: 1\n-->\n刚开了个头",
    );
    await writeCheckpoint(checkpointFilePath(projectId, 1, 1200), 1200, longBody("可用checkpoint"));

    const recovered = await recoverDraft(projectId, 1);
    assert.equal(recovered?.source, "checkpoint");
    assert.equal(recovered?.content.includes("可用checkpoint"), true);
  } finally {
    await cleanupProject(projectId);
  }
});
