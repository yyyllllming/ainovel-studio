import test from "node:test";
import assert from "node:assert/strict";
import { nanoid } from "nanoid";
import { rawDb } from "./db/client.ts";
import { createProject } from "./repositories/project.repository.ts";
import { applyStoredPatch } from "./commit/apply-stored-patch.service.ts";
import { rollbackVersion } from "./commit/rollback-version.service.ts";
import { deleteChapterRange } from "./services/chapter-range-delete.service.ts";
import { generateVersionsForChapter } from "./services/chapter-version-generate.service.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM run_sessions WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM run_states WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM foundation_workshop_messages WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM foundation_workshop_states WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM agent_assignments WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function createGuardedProject() {
  const project = createProject({
    title: "Mutation Guard",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 20,
    premise: "测试 open session guard。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });
  assert.equal(Boolean(project?.id), true);
  return project!.id;
}

test("chapter mutation routes are guarded when an open session exists", async () => {
  const projectId = createGuardedProject();
  rawDb.prepare(`
    INSERT INTO run_sessions (
      session_id,
      project_id,
      session_seq,
      from_chapter,
      target_chapter,
      desired_state,
      lifecycle_status,
      started_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nanoid(),
    projectId,
    1,
    1,
    null,
    "running",
    "paused",
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );

  try {
    const expected = "当前存在未关闭的运行会话（paused），请先停止或关闭后再";

    await assert.rejects(
      () => rollbackVersion(projectId, 1, "version-does-not-matter"),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal((error as Error).message, `${expected}回滚版本`);
        return true;
      },
    );

    await assert.rejects(
      () =>
        applyStoredPatch({
          projectId,
          chapterNo: 1,
          patch: {
            summary: "guarded",
            operations: [],
          },
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal((error as Error).message, `${expected}应用 Patch`);
        return true;
      },
    );

    await assert.rejects(
      () => generateVersionsForChapter(projectId, 1),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal((error as Error).message, `${expected}生成多版本`);
        return true;
      },
    );

    await assert.rejects(
      () => deleteChapterRange(projectId, { startChapter: 1, endChapter: 2 }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal((error as Error).message, `${expected}删除章节`);
        return true;
      },
    );
  } finally {
    cleanupProject(projectId);
  }
});
