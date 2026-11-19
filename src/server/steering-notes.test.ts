import test from "node:test";
import assert from "node:assert/strict";
import { createProject, addSteeringNote, listActiveSteeringNotes } from "./repositories/project.repository.ts";
import { rawDb } from "./db/client.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("listActiveSteeringNotes drops invalid prose notes and keeps only the newest note per bucket", () => {
  const project = createProject({
    title: "Steering Notes",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 20,
    premise: "测试 prose note 去重。",
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
    addSteeringNote(projectId!, {
      instruction: "连续 6 句叙述里，同一主体名词起句不要超过 2 次；当前“姜离”已经重复 12 次。相邻两句不要重复以“姜离”起头，优先改成环境承接、动作结果、身体反馈或视线落点分散句首，并把“姜离”句首压到 6 次以内。",
      scope: "next_arc",
      currentChapter: 12,
    });
    addSteeringNote(projectId!, {
      instruction: "连续 6 句叙述里，同一主体名词起句不要超过 2 次；当前“黑羽”已经重复 8 次。相邻两句不要重复以“黑羽”起头，优先改成环境承接、动作结果、身体反馈或视线落点分散句首，并把“黑羽”句首压到 6 次以内。",
      scope: "next_arc",
      currentChapter: 13,
    });
    addSteeringNote(projectId!, {
      instruction: "显性比喻（像/仿佛/如同/宛如/似乎）尽量压到 4 处以内；当前已有 9 处，同一段只保留 1 处关键比喻，优先用动作、感官和结果直接显形。",
      scope: "next_arc",
      currentChapter: 13,
    });

    rawDb.prepare("UPDATE projects SET steering_notes_json = ? WHERE id = ?").run(
      JSON.stringify([
        ...((rawDb.prepare("SELECT steering_notes_json FROM projects WHERE id = ?").get(projectId!) as { steering_notes_json: string }).steering_notes_json
          ? JSON.parse((rawDb.prepare("SELECT steering_notes_json FROM projects WHERE id = ?").get(projectId!) as { steering_notes_json: string }).steering_notes_json)
          : []),
        {
          id: "bad-note",
          instruction: "连续 6 句叙述里，同一主体名词起句不要超过 2 次；当前“””已经重复 8 次。相邻两句不要重复以“””起头，优先改成环境承接。",
          scope: "next_arc",
          createdAt: new Date().toISOString(),
          active: true,
          applyUntilChapter: 15,
        },
      ]),
      projectId!,
    );

    const active = listActiveSteeringNotes(projectId!, 13);

    assert.equal(active.some((note) => note.instruction.includes("“””")), false);
    assert.equal(active.filter((note) => note.instruction.includes("同一主体名词起句不要超过 2 次")).length, 1);
    assert.equal(active.some((note) => note.instruction.includes("当前“黑羽”已经重复 8 次")), true);
    assert.equal(active.some((note) => note.instruction.includes("显性比喻")), true);
  } finally {
    cleanupProject(projectId!);
  }
});
