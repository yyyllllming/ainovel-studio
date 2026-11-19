import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";

import { rawDb } from "../db/client.ts";
import { projectDir } from "../paths.ts";
import { PROJECT_PURGE_TABLES } from "../project-trash.ts";
import { createProject } from "../repositories/project.repository.ts";
import { nowIso } from "../utils.ts";
import { PROJECT_RESET_TABLES, resetProjectToFoundationWorkshop } from "./foundation-reset.service.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function countRows(table: string, projectId: string) {
  const row = rawDb.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`).get(projectId) as {
    count: number;
  };
  return row.count;
}

test("PROJECT_RESET_TABLES clears chapter plan and hook plan leftovers", () => {
  assert.equal(PROJECT_RESET_TABLES.includes("chapter_plans"), true);
  assert.equal(PROJECT_RESET_TABLES.includes("hook_plans"), true);
});

test("every table cleared on foundation reset is also cleared on permanent purge", () => {
  for (const table of PROJECT_RESET_TABLES) {
    assert.equal(
      (PROJECT_PURGE_TABLES as readonly string[]).includes(table),
      true,
      `PROJECT_PURGE_TABLES 缺少 ${table}，永久删除会残留孤儿行`,
    );
  }
});

test("resetProjectToFoundationWorkshop removes stale chapter plans and hook plans", async () => {
  const project = createProject({
    title: "Foundation Reset Project",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 8,
    premise: "调查员沿着黑匣子线索追查雾灾来源。",
    assignments: [],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  const now = nowIso();
  try {
    rawDb
      .prepare(`
        INSERT INTO chapter_plans (id, project_id, chapter_no, purpose, plot_summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run("plan-reset-1", project.id, 1, "推进主线", "旧故事的章节规划", now, now);
    rawDb
      .prepare(`
        INSERT INTO hook_plans (
          id, project_id, chapter_no, slot_index, source_plan_generation_id, setup_text,
          payoff_window_start_chapter, payoff_window_end_chapter, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run("hook-reset-1", project.id, 1, 0, 1, "旧故事的钩子铺垫", 2, 4, now, now);

    assert.equal(countRows("chapter_plans", project.id), 1);
    assert.equal(countRows("hook_plans", project.id), 1);

    await resetProjectToFoundationWorkshop(project.id);

    assert.equal(countRows("chapter_plans", project.id), 0);
    assert.equal(countRows("hook_plans", project.id), 0);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
