import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import {
  ensureProjectLayout,
  readCanonFacts,
  replaceCanonFactEntriesForChapter,
  replaceCanonFacts,
  writeConflictNote,
} from "../project-files.ts";
import { projectDir, withinProject } from "../paths.ts";
import { readTextFile } from "../utils.ts";
import type { CanonFact, ConflictRecord } from "../types.ts";

function createProjectId() {
  return `canon-files-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

function buildFact(chapterNo: number, content: string): CanonFact {
  return {
    id: `fact-${chapterNo}-${content}`,
    type: "plot_event",
    chapterNo,
    content,
    metadata: {},
    timestamp: "2026-04-01T00:00:00.000Z",
    keywords: [content],
  };
}

test("replaceCanonFacts rewrites the facts file atomically without tmp residue", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    await replaceCanonFacts(projectId, [buildFact(1, "alpha"), buildFact(2, "beta")]);

    const facts = await readCanonFacts(projectId);
    assert.deepEqual(facts.map((fact) => fact.content), ["alpha", "beta"]);

    const canonEntries = await readdir(withinProject(projectId, "canon"));
    assert.deepEqual(canonEntries.filter((entry) => entry.endsWith(".tmp")), []);

    const raw = await readTextFile(withinProject(projectId, "canon", "facts.jsonl"));
    assert.equal(raw.trim().split("\n").length, 2);
  } finally {
    await cleanupProject(projectId);
  }
});

test("replaceCanonFactEntriesForChapter merges per chapter and survives concurrent writers", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    await replaceCanonFacts(projectId, [buildFact(1, "chapter-one"), buildFact(2, "chapter-two-old")]);

    // 并发对不同章节做 read-modify-write：进程内互斥应保证两章的结果都落盘。
    await Promise.all([
      replaceCanonFactEntriesForChapter(projectId, 2, [buildFact(2, "chapter-two-new")]),
      replaceCanonFactEntriesForChapter(projectId, 3, [buildFact(3, "chapter-three")]),
    ]);

    const facts = await readCanonFacts(projectId);
    assert.deepEqual(
      facts.map((fact) => fact.content).sort(),
      ["chapter-one", "chapter-three", "chapter-two-new"],
    );
  } finally {
    await cleanupProject(projectId);
  }
});

test("writeConflictNote clears the conflict file when given an empty list", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    const conflict: ConflictRecord = {
      id: "conflict-1",
      type: "fact",
      severity: "soft",
      message: "矛盾的事实",
    };

    const path = await writeConflictNote(projectId, 4, [conflict]);
    assert.ok(path);
    assert.equal(existsSync(path!), true);

    const cleared = await writeConflictNote(projectId, 4, []);
    assert.equal(cleared, null);
    assert.equal(existsSync(path!), false);
  } finally {
    await cleanupProject(projectId);
  }
});
