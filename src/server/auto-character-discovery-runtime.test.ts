import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { projectDir } from "./paths.ts";
import { rawDb } from "./db/client.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { createProject } from "./repositories/project.repository.ts";
import { listCards } from "./repositories/card.repository.ts";
import { replaceCanonFactsForChapter } from "./repositories/review.repository.ts";
import { recalculateAutoRecurringCharacterCards } from "./character/auto-character-discovery-runtime.ts";
import type { CanonFact } from "./types.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function makeKeywordOnlyFact(id: string, chapterNo: number, content: string): CanonFact {
  return {
    id,
    type: "character_state",
    chapterNo,
    content,
    // 角色名只出现在 keywords 里（落库时被 join(" ") 成纯文本），不出现在 metadata。
    metadata: {},
    timestamp: "2026-04-05T00:00:00.000Z",
    keywords: ["姜烈", "旧城的影子"],
  };
}

test("recalculateAutoRecurringCharacterCards reads space-joined keywords as discovery evidence", async () => {
  const project = createProject({
    title: "旧城夜行",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "dynamic",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "旧城里有人在暗处反复出现。",
    assignments: [],
    plannedVolumes: 2,
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  try {
    replaceCanonFactsForChapter(project.id, 1, [
      makeKeywordOnlyFact("fact-1", 1, "城门外的影子第一次现出轮廓。"),
    ]);
    replaceCanonFactsForChapter(project.id, 2, [
      makeKeywordOnlyFact("fact-2", 2, "同一道影子又一次挡在巷口。"),
    ]);
    replaceCanonFactsForChapter(project.id, 3, [
      makeKeywordOnlyFact("fact-3", 3, "影子在雨夜里替主角挡下一刀。"),
    ]);
    replaceCanonFactsForChapter(project.id, 4, [
      makeKeywordOnlyFact("fact-4", 4, "影子终于开口报出来历。"),
      makeKeywordOnlyFact("fact-5", 4, "他守在旧城门口，没有离开。"),
    ]);

    const result = recalculateAutoRecurringCharacterCards(project.id);

    assert.equal(result.created, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.deleted, 0);

    const autoCard = listCards(project.id).find((card) => card.name === "姜烈");
    assert.ok(autoCard, "keywords 证据应触发自动常驻角色卡创建");
    assert.equal(autoCard?.meta.origin, "auto_recurring");
    assert.equal(autoCard?.meta.evidence?.length, 5);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
