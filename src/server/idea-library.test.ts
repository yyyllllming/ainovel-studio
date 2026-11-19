import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { rawDb } from "./db/client.ts";
import { AppError, isAppError } from "./errors.ts";
import { streamIdeaWorkshopMessage } from "./foundation/idea-workshop.ts";
import { ideaDir, withinIdea, projectDir } from "./paths.ts";
import { readProjectMeta } from "./project-files.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { appendIdeaWorkshopMessage, getIdeaWorkshopState, softDeleteIdea, upsertIdeaWorkshopState } from "./repositories/idea.repository.ts";
import { getFoundationWorkshopState, listFoundationWorkshopMessages } from "./repositories/foundation.repository.ts";
import { createProjectFromIdeaWithMeta, createIdeaWithMeta } from "./services/idea.service.ts";
import { getProjectDetail } from "./services/project.service.ts";

function createAssignments() {
  return [
    { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
    { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
    { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
    { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
  ] as const;
}

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function cleanupIdea(ideaId: string) {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM idea_workshop_messages WHERE idea_id = ?").run(ideaId);
    rawDb.prepare("DELETE FROM idea_workshop_states WHERE idea_id = ?").run(ideaId);
    rawDb.prepare("DELETE FROM ideas WHERE id = ?").run(ideaId);
  })();
}

test("createProjectFromIdeaWithMeta copies idea snapshots into a seeded project and keeps them isolated", async () => {
  const createdIdeaIds: string[] = [];
  const createdProjectIds: string[] = [];

  try {
    const summary = await createIdeaWithMeta({ title: "会失忆的骗子" });
    if (!summary) {
      throw new Error("应当返回已创建的想法摘要");
    }
    const ideaId = summary.idea.id;
    createdIdeaIds.push(ideaId);

    assert.equal(existsSync(withinIdea(ideaId, "idea.json")), true);
    assert.equal(existsSync(withinIdea(ideaId, "draft.json")), true);
    assert.equal(existsSync(withinIdea(ideaId, "messages.json")), true);

    const seededState = upsertIdeaWorkshopState(ideaId, {
      ...getIdeaWorkshopState(ideaId)!.draft,
      premise: "一个每说一次谎就会丢掉一段真实记忆的骗子，被迫潜入夜禁城市找回自己的名字。",
      mainline: "主角为了找回失去的记忆，必须不断说谎、潜入、背叛，再承受每次代价。",
      storyHook: "第一次说谎后，他忘掉了母亲的名字。",
      desiredTone: "冷峻、压迫、带一点命运追猎感。",
      characterIdeas: [
        {
          name: "林霁",
          role: "主角",
          goal: "找回失去的真实记忆",
          traits: ["嘴硬", "敏感", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "谎言代价",
          description: "每说一次谎都会失去一段真实记忆，越重要的谎失去得越重。",
        },
      ],
      relationshipIdeas: [
        {
          source: "林霁",
          target: "守夜人",
          label: "互相利用",
        },
      ],
      unresolvedQuestions: ["主角最早失去的那段记忆是谁动的手脚？"],
    });

    appendIdeaWorkshopMessage(ideaId, "assistant", "先把最扎心的代价钉住。", "2026-03-25T00:00:00.000Z");
    appendIdeaWorkshopMessage(ideaId, "user", "他第一次说谎后就忘了母亲的名字。", "2026-03-25T00:00:01.000Z");

    const project = await createProjectFromIdeaWithMeta(ideaId, {
      title: "夜禁失名录",
      genre: "玄幻悬疑",
      style: "default",
      seriesMode: "standalone",
      storyLength: "medium",
      narrativePerson: "third",
      chapterPlanningMode: "fixed",
      paceProfile: "medium",
      completionCriteria: "主线闭环，关键伏笔回收。",
      targetChapters: 10,
      premise: "",
      assignments: [...createAssignments()],
    });
    createdProjectIds.push(project.id);

    assert.equal(project.sourceIdeaId, ideaId);
    assert.equal(existsSync(projectDir(project.id)), true);

    const projectState = getFoundationWorkshopState(project.id);
    const projectMessages = listFoundationWorkshopMessages(project.id);
    assert.equal(projectState?.draft.premise, seededState?.draft.premise);
    assert.equal(projectState?.draft.mainline, seededState?.draft.mainline);
    assert.deepEqual(
      projectMessages.map((entry) => ({ role: entry.role, content: entry.content })),
      [
        { role: "assistant", content: "先把最扎心的代价钉住。" },
        { role: "user", content: "他第一次说谎后就忘了母亲的名字。" },
      ],
    );

    upsertIdeaWorkshopState(ideaId, {
      ...seededState!.draft,
      premise: "后来想法区把 premise 改成了另一条路线。",
      mainline: "这条新主线不应该回写项目。",
    });

    const isolatedProjectState = getFoundationWorkshopState(project.id);
    assert.equal(
      isolatedProjectState?.draft.premise,
      "一个每说一次谎就会丢掉一段真实记忆的骗子，被迫潜入夜禁城市找回自己的名字。",
    );
    assert.equal(
      isolatedProjectState?.draft.mainline,
      "主角为了找回失去的记忆，必须不断说谎、潜入、背叛，再承受每次代价。",
    );

    const meta = await readProjectMeta(project.id);
    assert.equal(
      (meta?.sourceIdeaSnapshot as { draft?: { premise?: string } } | undefined)?.draft?.premise,
      "一个每说一次谎就会丢掉一段真实记忆的骗子，被迫潜入夜禁城市找回自己的名字。",
    );

    const detailBeforeArchive = await getProjectDetail(project.id);
    assert.equal(detailBeforeArchive.sourceIdea?.title, "会失忆的骗子");
    assert.equal(
      detailBeforeArchive.sourceIdea?.draft?.premise,
      "一个每说一次谎就会丢掉一段真实记忆的骗子，被迫潜入夜禁城市找回自己的名字。",
    );

    softDeleteIdea(ideaId);
    const detailAfterArchive = await getProjectDetail(project.id);
    assert.equal(Boolean(detailAfterArchive.sourceIdea?.deletedAt), true);
    assert.equal(
      detailAfterArchive.sourceIdea?.draft?.premise,
      "一个每说一次谎就会丢掉一段真实记忆的骗子，被迫潜入夜禁城市找回自己的名字。",
    );
  } finally {
    for (const projectId of createdProjectIds) {
      cleanupProject(projectId);
      await rm(projectDir(projectId), { recursive: true, force: true });
    }
    for (const ideaId of createdIdeaIds) {
      cleanupIdea(ideaId);
      await rm(ideaDir(ideaId), { recursive: true, force: true });
    }
  }
});

test("streamIdeaWorkshopMessage returns a 409 conflict when baseUpdatedAt is stale", async () => {
  const createdIdeaIds: string[] = [];

  try {
    const summary = await createIdeaWithMeta({ title: "冲突测试想法" });
    if (!summary) {
      throw new Error("应当返回已创建的想法摘要");
    }
    const ideaId = summary.idea.id;
    createdIdeaIds.push(ideaId);

    upsertIdeaWorkshopState(ideaId, {
      ...getIdeaWorkshopState(ideaId)!.draft,
      premise: "已经有人先一步把 premise 改掉了。",
    });

    await assert.rejects(
      streamIdeaWorkshopMessage(
        ideaId,
        {
          message: "我想继续补充主角的动机。",
          baseUpdatedAt: "stale-updated-at",
        },
        async () => {},
      ),
      (error: unknown) => {
        assert.equal(isAppError(error), true);
        const appError = error as AppError;
        assert.equal(appError.status, 409);
        assert.equal(appError.code, "CONFLICT");
        assert.equal(
          (appError.details as {
            state?: { draft?: { premise?: string } };
          }).state?.draft?.premise,
          "已经有人先一步把 premise 改掉了。",
        );
        return true;
      },
    );
  } finally {
    for (const ideaId of createdIdeaIds) {
      cleanupIdea(ideaId);
      await rm(ideaDir(ideaId), { recursive: true, force: true });
    }
  }
});
