import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import {
  buildPlanningRepairBlueprintReason,
  buildPlanningRepairPrompt,
  executePlanningRepair,
  MAX_PLANNING_REPAIR_ATTEMPTS,
  shouldEscalatePlanningRepairToManualReview,
} from "./run/planning-repair.ts";
import { projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { createProject } from "./repositories/project.repository.ts";
import { getRunState, listRunStatisticsByStage } from "./repositories/run.repository.ts";
import { rawDb } from "./db/client.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("buildPlanningRepairPrompt folds review diagnosis into a planner-facing brief", () => {
  const prompt = buildPlanningRepairPrompt({
    reason: "本章主线推进停滞，章末钩子没有成立。",
    fixInstructions: "重建主任务并把章末承接改成可直接接续的动作。",
    failureCategory: "planning_failure",
    repairStrategy: "planning_repair",
    issues: [
      { type: "story_progression", location: "中段", severity: "major" },
      { type: "continuation_anchor_miss", location: "结尾", severity: "major" },
    ],
  }, {
    hookSummary: "Hook诊断：planned=2 / bound=1 / debt=1 / overdue=1 / dead=0",
    hookNotes: [
      "第4章的「灯塔里的密信会暴露真正的内鬼」还没有稳定 setup evidence；若仍保留，当前章必须补 setup 或明确取消。",
      "第5章的「岚柔带走的骨片其实会反噬持有者」已超过预计回收窗口；若本章不回收，必须在新规划里解释延后。",
    ],
  });

  assert.match(prompt, /失败分类：planning_failure/);
  assert.match(prompt, /story_progression@中段:major/);
  assert.match(prompt, /continuation_anchor_miss@结尾:major/);
  assert.match(prompt, /Hook诊断：planned=2 \/ bound=1 \/ debt=1 \/ overdue=1 \/ dead=0/);
  assert.match(prompt, /Hook修复重点：第4章的「灯塔里的密信会暴露真正的内鬼」/);
  assert.match(prompt, /优先修正 ChapterPlan 的主任务/);
});

test("buildPlanningRepairBlueprintReason tells blueprint generation to trust the new ChapterPlan", () => {
  const reason = buildPlanningRepairBlueprintReason({
    repairAttempt: 2,
    review: {
      reason: "旧蓝图沿用了弱 segment 兜底，导致本章推进失焦。",
      fixInstructions: "新蓝图必须围绕最新 ChapterPlan 的 requiredBeats 重排。",
    },
    hookSummary: "Hook诊断：planned=1 / bound=0 / debt=1 / overdue=0 / dead=0",
    hookNotes: ["第6章的「卷轴最后一页的活体封印仍在轻微呼吸」还没有稳定 setup evidence；若仍保留，当前章必须补 setup 或明确取消。"],
  });

  assert.match(reason, /第 2 次 planning_repair/);
  assert.match(reason, /Hook诊断：planned=1 \/ bound=0 \/ debt=1 \/ overdue=0 \/ dead=0/);
  assert.match(reason, /Hook重规划提醒：第6章的「卷轴最后一页的活体封印仍在轻微呼吸」/);
  assert.match(reason, /不要沿用旧的 scene goal 或弱 segment 兜底/);
  assert.match(reason, /requiredBeats/);
});

test("shouldEscalatePlanningRepairToManualReview trips at the configured ceiling", () => {
  assert.equal(
    shouldEscalatePlanningRepairToManualReview({
      attemptsUsed: MAX_PLANNING_REPAIR_ATTEMPTS - 1,
    }),
    false,
  );
  assert.equal(
    shouldEscalatePlanningRepairToManualReview({
      attemptsUsed: MAX_PLANNING_REPAIR_ATTEMPTS,
    }),
    true,
  );
});

test("executePlanningRepair completes with regenerated ChapterPlan and blueprint before rewrite resumes", async () => {
  const project = createProject({
    title: "Planning Repair Terminal",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "调查员在失焦的章节规划后需要重建主任务。",
    assignments: [],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  let blueprintReason = "";

  try {
    const result = await executePlanningRepair(
      {
        projectId: project.id,
        chapterNo: 6,
        retryCount: 1,
        repairAttempt: 1,
        review: {
          reason: "旧计划只剩情绪铺陈，没有兑现 requiredBeats。",
          fixInstructions: "围绕新主任务重排 requiredBeats，并把章末承接改成直接动作。",
          failureCategory: "planning_failure",
          repairStrategy: "planning_repair",
          issues: [
            { type: "story_progression", location: "中段", severity: "major" },
          ],
        },
        executionContext: {} as never,
      },
      {
        regenerateChapterPlan: async () => ({
          generationId: 8,
          hookSlots: [
            {
              setupText: "塔楼栏杆上提前留下接续线索",
              payoffWindow: [7, 9],
              priority: "medium",
              planIntent: "active",
            },
          ],
        }) as never,
        regenerateBlueprint: async (_projectId, _chapterNo, reason) => {
          blueprintReason = reason ?? "";
          return {
            chapterNo: 6,
            sceneGoal: "围绕重建后的主任务推进本章。",
            characters: ["沈夜"],
            locations: ["旧港塔楼"],
            conflicts: ["必须在假线索扩散前锁定真正目标"],
            foreshadows: ["塔楼栏杆上提前留下接续线索"],
            emotionalTone: "压迫中重新收束",
            estimatedWords: 3200,
            sourcePlanGenerationId: 8,
            hookGuidanceMode: "guided",
            hookBindings: [{ hookPlanId: "hook-6-1", foreshadowText: "塔楼栏杆上提前留下接续线索" }],
          };
        },
      },
    );

    assert.equal(result.chapterPlanGenerationId, 8);
    assert.equal(result.blueprintSourcePlanGenerationId, 8);
    assert.equal(result.hookGuidanceMode, "guided");
    assert.match(blueprintReason, /最新 ChapterPlan 为唯一章节主计划/);

    const state = getRunState(project.id);
    assert.equal(state?.stage, "planning_repair");
    assert.deepEqual(state?.stageDetails.planningRepair, {
      applied: true,
      strategy: "planning_repair",
      regeneratedChapterPlan: true,
      regeneratedBlueprint: true,
      completed: true,
      nextAction: "rewrite_with_fresh_blueprint",
      chapterPlanGenerationId: 8,
      blueprintSourcePlanGenerationId: 8,
    });

    const stats = listRunStatisticsByStage(project.id, "planning_repair", 5);
    assert.equal(stats.length, 1);
    assert.equal(stats[0]?.metrics.regeneratedChapterPlan, true);
    assert.equal(stats[0]?.metrics.regeneratedBlueprint, true);
    assert.equal(stats[0]?.metrics.blueprintSourcePlanGenerationId, 8);
    assert.equal(stats[0]?.metrics.boundHookCount, 1);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});

test("executePlanningRepair rejects repaired ChapterPlan payloads that still omit hookSlots", async () => {
  await assert.rejects(
    () =>
      executePlanningRepair(
        {
          projectId: "project-missing-slots",
          chapterNo: 6,
          retryCount: 1,
          repairAttempt: 1,
          review: {
            reason: "旧计划只剩情绪铺陈，没有兑现 requiredBeats。",
            fixInstructions: "围绕新主任务重排 requiredBeats，并把章末承接改成直接动作。",
            failureCategory: "planning_failure",
            repairStrategy: "planning_repair",
            issues: [
              { type: "story_progression", location: "中段", severity: "major" },
            ],
          },
          executionContext: {} as never,
        },
        {
          regenerateChapterPlan: async () => ({
            generationId: 8,
          }) as never,
          regenerateBlueprint: async () => ({
            chapterNo: 6,
            sceneGoal: "围绕重建后的主任务推进本章。",
            characters: ["沈夜"],
            locations: ["旧港塔楼"],
            conflicts: ["必须在假线索扩散前锁定真正目标"],
            foreshadows: ["塔楼栏杆上提前留下接续线索"],
            emotionalTone: "压迫中重新收束",
            estimatedWords: 3200,
            sourcePlanGenerationId: 8,
          }),
        },
      ),
    /hookSlots/i,
  );
});
