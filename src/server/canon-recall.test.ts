import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { projectDir } from "./paths.ts";
import { rawDb } from "./db/client.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { buildContextKeywords, createProject } from "./repositories/project.repository.ts";
import { replaceCanonFactsForChapter, searchCanonFacts } from "./repositories/review.repository.ts";
import { buildFallbackStoryContract } from "./story/story-contract.ts";
import type { ChapterBlueprint, FoundationPayload } from "./types.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("searchCanonFacts uses one FTS query plus rerank filters for foreshadow recall", async () => {
  const project = createProject({
    title: "雾港夜巡",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "dynamic",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "调查员沿着黑匣子线索追查雾灾来源。",
    assignments: [],
    plannedVolumes: 2,
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  const foundation: FoundationPayload = {
    premise: project.premise,
    styleCard: "冷峻、克制",
    characters: [
      { name: "林舟", role: "调查员", goal: "查清黑匣子来历", traits: ["冷静"] },
      { name: "顾南", role: "同伴", goal: "看住黑匣子", traits: ["谨慎"] },
    ],
    worldview: [
      { name: "旧港", description: "夜里会被封锁" },
    ],
    relationships: [],
  };
  const storyContract = buildFallbackStoryContract({
    title: project.title,
    genre: project.genre,
    premise: foundation.premise,
    chapterPlanningMode: "dynamic",
    storyLength: "medium",
    plannedVolumes: 2,
    chapterBudgetMin: 10,
    chapterBudgetTarget: 12,
    chapterBudgetMax: 14,
    hardChapterCap: 14,
    completionCriteria: project.completionCriteria,
  });
  const blueprint: ChapterBlueprint = {
    chapterNo: 8,
    sceneGoal: "林舟必须在旧港确认黑匣子的真正主人。",
    characters: ["林舟", "顾南"],
    locations: ["旧港"],
    conflicts: ["林舟必须先避开巡逻队，再确认黑匣子主人。"],
    foreshadows: ["黑匣子的真正主人"],
    emotionalTone: "压抑、紧绷",
    estimatedWords: 3200,
    requiredProgressDelta: "information_shift",
  };

  try {
    replaceCanonFactsForChapter(project.id, 2, [
      {
        id: "fact-1",
        type: "foreshadow",
        chapterNo: 2,
        content: "黑匣子的真正主人",
        metadata: { status: "active" },
        timestamp: "2026-04-05T00:00:00.000Z",
        keywords: ["黑匣子", "真正主人", "旧港"],
      },
      {
        id: "fact-2",
        type: "plot_event",
        chapterNo: 7,
        content: "林舟在旧港货栈确认了巡逻队换岗时间。",
        metadata: {},
        timestamp: "2026-04-05T00:00:00.000Z",
        keywords: ["林舟", "旧港", "巡逻队"],
      },
      {
        id: "fact-3",
        type: "foreshadow",
        chapterNo: 9,
        content: "不该被 beforeChapter 命中的未来伏笔",
        metadata: { status: "active" },
        timestamp: "2026-04-05T00:00:00.000Z",
        keywords: ["未来", "伏笔"],
      },
    ]);

    const query = buildContextKeywords(project, blueprint, foundation, storyContract);
    const results = searchCanonFacts(project.id, query, 8, 5, {
      beforeChapter: 8,
      types: ["foreshadow"],
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.content, "黑匣子的真正主人");
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
