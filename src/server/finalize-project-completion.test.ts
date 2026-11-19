import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { rawDb } from "./db/client.ts";
import { ensureProjectLayout, readNovelExport, writeFinalChapter } from "./project-files.ts";
import { projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { createProject } from "./repositories/project.repository.ts";
import { getRunState } from "./repositories/run.repository.ts";
import { finalizeProjectCompletion } from "./services/manual-review.service.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("finalizeProjectCompletion marks the run completed and writes a novel export when chapters are ready", async () => {
  const project = createProject({
    title: "Finalized Novel",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 1,
    premise: "收尾测试项目。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });

  const projectId = project?.id;
  assert.equal(Boolean(projectId), true);

  try {
    await ensureProjectLayout(projectId!);
    await writeFinalChapter(projectId!, 1, "第1章终章正文\n");

    await finalizeProjectCompletion(projectId!, "项目自动写作完成", 1);
    const exportRecord = await readNovelExport(projectId!);
    const state = getRunState(projectId!);

    assert.equal(state?.stage, "completed");
    assert.equal(state?.status, "completed");
    assert.equal(state?.currentChapter, 1);
    assert.equal(state?.totalChapters, 1);
    assert.equal(exportRecord.status, "ready");
    assert.equal(exportRecord.chapterCount, 1);
    assert.equal(Boolean(exportRecord.path), true);
  } finally {
    await rm(projectDir(projectId!), { recursive: true, force: true });
    cleanupProject(projectId!);
  }
});
