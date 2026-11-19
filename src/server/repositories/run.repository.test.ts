import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import { nanoid } from "nanoid";

import { rawDb } from "../db/client.ts";
import { projectDir } from "../paths.ts";
import { PROJECT_PURGE_TABLES } from "../project-trash.ts";
import { nowIso } from "../utils.ts";
import { createProject } from "./project.repository.ts";
import { appendRunStatistic, listRunStatistics, listRunStatisticsByStage, summarizeBlueprintRunHealth } from "./run.repository.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("run statistic queries degrade to empty metrics when a metrics_json row is corrupted", async () => {
  const project = createProject({
    title: "Corrupted Metrics Project",
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

  try {
    appendRunStatistic(project.id, 1, "blueprint", {
      candidateCount: 3,
      selectedCandidateIndex: 1,
      verificationScore: 5,
      repairUsed: false,
      fallbackUsed: false,
      usedRecoveryBlueprint: false,
    });
    // 模拟手工编辑/半写入留下的脏数据。
    rawDb
      .prepare(`
        INSERT INTO run_statistics (id, project_id, chapter_no, stage, metrics_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(nanoid(), project.id, 1, "blueprint", "{not valid json", nowIso());

    const rows = listRunStatistics(project.id, 1);
    assert.equal(rows.length, 2);
    const corrupted = rows.find((row) => Object.keys(row.metrics).length === 0);
    assert.ok(corrupted, "损坏行应降级为空 metrics 而不是抛出 SyntaxError");

    const stageRows = listRunStatisticsByStage(project.id, "blueprint", 20);
    assert.equal(stageRows.length, 2);

    const summary = summarizeBlueprintRunHealth(project.id, 20);
    assert.equal(summary.sampleCount, 2);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
