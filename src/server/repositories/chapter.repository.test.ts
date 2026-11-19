import test from "node:test";
import assert from "node:assert/strict";
import { rawDb } from "../db/client.ts";
import { deleteChapterRangeRecords, saveChapterVersion } from "./chapter.repository.ts";

function createProjectId() {
  return `chapter-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function seedChapterPlan(projectId: string, chapterNo: number) {
  rawDb.prepare(`
    INSERT INTO chapter_plans (id, project_id, chapter_no, purpose, plot_summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `plan-${projectId}-${chapterNo}`,
    projectId,
    chapterNo,
    "推进主线",
    `第 ${chapterNo} 章概要`,
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
}

function seedHookPlan(projectId: string, chapterNo: number) {
  rawDb.prepare(`
    INSERT INTO hook_plans (
      id, project_id, chapter_no, source_plan_generation_id, setup_text,
      payoff_window_start_chapter, payoff_window_end_chapter, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `hook-${projectId}-${chapterNo}`,
    projectId,
    chapterNo,
    1,
    `第 ${chapterNo} 章钩子`,
    chapterNo + 1,
    chapterNo + 3,
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
}

function seedCommit(projectId: string, chapterNo: number, state: string) {
  const commitId = `commit-${projectId}-${chapterNo}`;
  rawDb.prepare(`
    INSERT INTO chapter_commits (
      commit_id, project_id, chapter_no, session_id, source_kind, accepted_version_id,
      idempotency_key, state, manifest_json, stage_dir, content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    commitId,
    projectId,
    chapterNo,
    null,
    "run",
    `version-${chapterNo}`,
    `${projectId}:${chapterNo}:version-${chapterNo}:run`,
    state,
    "{}",
    `.staging/commits/${commitId}`,
    `hash-${chapterNo}`,
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
  rawDb.prepare(`
    INSERT INTO artifact_outbox (
      job_id, commit_id, project_id, chapter_no, job_type, state, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'chapter_artifact_sync', 'pending', '{}', ?, ?)
  `).run(
    `job-${projectId}-${chapterNo}`,
    commitId,
    projectId,
    chapterNo,
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
}

function countRows(table: string, projectId: string, chapterNo: number) {
  const row = rawDb
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ? AND chapter_no = ?`)
    .get(projectId, chapterNo) as { count: number };
  return row.count;
}

function cleanupProjectRows(projectId: string) {
  for (const table of ["chapter_plans", "hook_plans", "artifact_outbox", "chapter_commits", "chapter_versions"]) {
    rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
  }
}

test("deleteChapterRangeRecords removes plans, hooks, and outbox jobs and fails commits in range", () => {
  const projectId = createProjectId();

  try {
    for (const chapterNo of [1, 2, 3]) {
      saveChapterVersion({
        projectId,
        chapterNo,
        versionNo: 1,
        temperature: 0.7,
        path: `versions/chapter_${String(chapterNo).padStart(3, "0")}_v1.md`,
        excerpt: "excerpt",
        selected: true,
        source: "final",
      });
      seedChapterPlan(projectId, chapterNo);
      seedHookPlan(projectId, chapterNo);
      seedCommit(projectId, chapterNo, chapterNo === 1 ? "committed" : "prepared");
    }

    deleteChapterRangeRecords(projectId, 2, 3);

    for (const table of ["chapter_versions", "chapter_plans", "hook_plans", "artifact_outbox"]) {
      assert.equal(countRows(table, projectId, 1), 1, `${table} chapter 1 should survive`);
      assert.equal(countRows(table, projectId, 2), 0, `${table} chapter 2 should be deleted`);
      assert.equal(countRows(table, projectId, 3), 0, `${table} chapter 3 should be deleted`);
    }

    const survivingCommit = rawDb
      .prepare("SELECT state FROM chapter_commits WHERE project_id = ? AND chapter_no = 1")
      .get(projectId) as { state: string };
    assert.equal(survivingCommit.state, "committed");

    const deletedCommits = rawDb
      .prepare("SELECT state, last_error_code FROM chapter_commits WHERE project_id = ? AND chapter_no IN (2, 3)")
      .all(projectId) as Array<{ state: string; last_error_code: string }>;
    assert.equal(deletedCommits.length, 2);
    for (const commit of deletedCommits) {
      assert.equal(commit.state, "failed");
      assert.equal(commit.last_error_code, "chapter_deleted");
    }
  } finally {
    cleanupProjectRows(projectId);
  }
});
