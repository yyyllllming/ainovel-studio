import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { appendRunStatistic, listRunStatistics, listRunStatisticsByStage, summarizeBlueprintRunHealth } from "./repositories/run.repository.ts";
import { createProject } from "./repositories/project.repository.ts";
import { projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { rawDb } from "./db/client.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("run statistics append one row per stage event instead of updating a wide record", async () => {
  const project = createProject({
    title: "Run Statistic Project",
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
    appendRunStatistic(project.id, 3, "blueprint", {
      candidateCount: 3,
      selectedCandidateIndex: 1,
      verificationScore: 5,
      repairUsed: false,
      fallbackUsed: false,
      usedRecoveryBlueprint: false,
    });
    appendRunStatistic(project.id, 3, "blueprint", {
      candidateCount: 3,
      selectedCandidateIndex: 2,
      verificationScore: 4,
      repairUsed: true,
      fallbackUsed: false,
      usedRecoveryBlueprint: false,
    });

    const rows = listRunStatistics(project.id, 3);
    const blueprintRows = rows.filter((row) => row.stage === "blueprint");

    assert.equal(blueprintRows.length, 2, JSON.stringify(rows));
    assert.equal(blueprintRows[0]?.metrics.selectedCandidateIndex, 2);
    assert.equal(blueprintRows[1]?.metrics.selectedCandidateIndex, 1);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});

test("run statistics can be filtered by stage and summarized into blueprint health guidance", async () => {
  const project = createProject({
    title: "Run Statistic Summary Project",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "调查员沿着黑匣子线索追查雾灾来源。",
    assignments: [],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  try {
    for (let chapterNo = 1; chapterNo <= 12; chapterNo += 1) {
      appendRunStatistic(project.id, chapterNo, "blueprint", {
        candidateCount: 3,
        selectedCandidateIndex: chapterNo % 3,
        verificationScore: chapterNo % 2 === 0 ? 4 : 5,
        repairUsed: chapterNo <= 2,
        fallbackUsed: false,
        usedRecoveryBlueprint: false,
      });
      appendRunStatistic(project.id, chapterNo, "conflict", {
        hardConflictCount: 0,
        softConflictCount: chapterNo % 4 === 0 ? 1 : 0,
        conflictTypes: chapterNo % 4 === 0 ? ["segment_blueprint_mismatch"] : [],
      });
    }

    appendRunStatistic(project.id, 12, "canon", {
      usedFallback: false,
      factCount: 6,
      snapshotCharacterCount: 2,
      missingCategories: [],
    });

    const blueprintRows = listRunStatisticsByStage(project.id, "blueprint", 20);
    const canonRows = listRunStatisticsByStage(project.id, "canon", 20);
    const summary = summarizeBlueprintRunHealth(project.id, 20);

    assert.equal(blueprintRows.length, 12);
    assert.equal(canonRows.length, 1);
    assert.equal(blueprintRows.every((row) => row.stage === "blueprint"), true);
    assert.equal(summary.windowSize, 20);
    assert.equal(summary.sampleCount, 12);
    assert.equal(summary.repairRate, 0.1667);
    assert.equal(summary.fallbackRate, 0);
    assert.equal(summary.hardConflictRate, 0);
    assert.equal(summary.medianVerificationScore, 4.5);
    assert.equal(summary.recommendation, "safe_to_try_2");
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
