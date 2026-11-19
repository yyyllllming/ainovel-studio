import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import Database from "better-sqlite3";

import { ensureDatabase } from "./db/init.ts";
import { rawDb } from "./db/client.ts";
import { projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { createProject } from "./repositories/project.repository.ts";
import { getBlueprint, saveBlueprint } from "./repositories/foundation.repository.ts";
import { createChapterPlanRepository } from "./repositories/chapter-plan.repository.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

test("chapter plan repository round-trips generation metadata and degraded sources", () => {
  const db = createMemoryDb();
  const repository = createChapterPlanRepository({ db });

  try {
    repository.upsertReady({
      projectId: "project-a",
      chapterNo: 47,
      purpose: "让主角确认这章必须先稳住队伍，再追查锈海灯塔。",
      plotSummary: "主角在撤离混乱中先止血，再从假线索里剥出真正的灯塔坐标。",
      requiredBeats: ["稳住队伍", "剥离假线索"],
      keyEvents: ["临时结盟", "识破诱饵"],
      characterFocus: ["沈夜", "陆停"],
      relationshipShift: "沈夜开始信任陆停的判断。",
      worldRuleUsage: ["锈潮夜行会放大感官误判"],
      continuationAnchor: "队伍带着真正坐标踏入封锁区边缘。",
      nextHook: "灯塔里有人提前等着他们。",
      hookSlots: [
        {
          setupText: "灯塔里有人提前等着他们。",
          payoffWindow: [48, 50],
          priority: "medium",
          planIntent: "active",
        },
      ],
      payoffTargets: ["第48章揭露等候者身份"],
      riskFlags: ["hook_debt", "focus_scatter"],
      riskComment: "降级回填先保剧情骨架，后续应升级成完整计划。",
      status: "ready",
      source: "degraded_backfill",
      foundationDigest: "foundation-digest",
      storyContractDigest: "story-digest",
      inputDigest: "input-digest",
      generationId: 3,
      segmentId: "segment-8",
      segmentItemId: "segment-item-47",
      generationState: "ready",
      generationToken: "token-47",
      generationStartedAt: "2026-04-09T10:00:00.000Z",
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:01.000Z",
    });

    const saved = repository.get("project-a", 47);
    assert.ok(saved);
    assert.equal(saved?.generationId, 3);
    assert.equal(saved?.source, "degraded_backfill");
    assert.equal(saved?.generationState, "ready");
    assert.deepEqual(saved?.riskFlags, ["hook_debt", "focus_scatter"]);
    assert.equal(saved?.usedSegmentSummaryFallback, true);
    assert.equal(saved?.hookSlots.length, 1);
    assert.equal(saved?.hookSlots[0]?.setupText, "灯塔里有人提前等着他们。");
  } finally {
    db.close();
  }
});

test("chapter plan repository synthesizes hookSlots from legacy nextHook rows on read", () => {
  const db = createMemoryDb();
  const repository = createChapterPlanRepository({ db });

  try {
    db.prepare(`
      INSERT INTO chapter_plans (
        id, project_id, chapter_no, purpose, plot_summary, required_beats_json, key_events_json,
        character_focus_json, relationship_shift, world_rule_usage_json, continuation_anchor, next_hook,
        payoff_targets_json, risk_flags_json, risk_comment, status, source, foundation_digest,
        story_contract_digest, input_digest, generation_id, generation_state, generation_token,
        generation_started_at, used_segment_summary_fallback, segment_id, segment_item_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "legacy-plan-1",
      "project-legacy",
      8,
      "先确认谁在塔楼里等人。",
      "本章先确认敌人布局，再把真正危险留到下一章。",
      JSON.stringify(["确认敌人布局"]),
      JSON.stringify(["摸到塔楼暗门"]),
      JSON.stringify(["沈夜"]),
      "",
      JSON.stringify([]),
      "沈夜带着暗门后的真线索撤离。",
      "塔楼顶层有人提前等着他们。",
      JSON.stringify([]),
      JSON.stringify(["hook_debt"]),
      null,
      "ready",
      "generated",
      "foundation",
      "story",
      "input",
      2,
      "ready",
      null,
      null,
      0,
      null,
      null,
      "2026-04-09T10:00:00.000Z",
      "2026-04-09T10:00:00.000Z",
    );

    const saved = repository.get("project-legacy", 8);
    assert.ok(saved);
    assert.equal(saved?.hookSlots.length, 1);
    assert.equal(saved?.hookSlots[0]?.setupText, "塔楼顶层有人提前等着他们。");
    assert.deepEqual(saved?.hookSlots[0]?.payoffWindow, [9, 11]);
    assert.equal(saved?.hookSlots[0]?.planIntent, "active");
  } finally {
    db.close();
  }
});

test("blueprint repository keeps sourcePlanGenerationId for stale checks", async () => {
  const project = createProject({
    title: "Blueprint Plan Generation Source Project",
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
    saveBlueprint(project.id, {
      chapterNo: 4,
      sceneGoal: "先确认假线索的来源，再把灯塔坐标抢回来。",
      characters: ["林砚", "苏澈"],
      locations: ["雾港旧仓库"],
      conflicts: ["对手抛出假坐标拖延时间"],
      foreshadows: ["旧仓库角落里留下灯塔维护员的徽记"],
      emotionalTone: "压迫中带一点反击的兴奋",
      estimatedWords: 3400,
      sourcePlanGenerationId: 7,
    });

    const blueprint = getBlueprint(project.id, 4);
    assert.ok(blueprint);
    assert.equal(blueprint?.sourcePlanGenerationId, 7);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
