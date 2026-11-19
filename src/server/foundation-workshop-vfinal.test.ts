import test from "node:test";
import assert from "node:assert/strict";
import { rawDb } from "./db/client.ts";
import { createProject } from "./repositories/project.repository.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import {
  getFoundationWorkshopSession,
  saveFoundationWorkshopSession,
  updateFoundationWorkshopSessionIfCurrent,
} from "./repositories/foundation.repository.ts";
import { foundationWorkshopMessageSchema } from "./validation.ts";
import {
  isFoundationWorkshopSessionStale,
  resolveFoundationWorkshopSessionConfig,
  sweepStaleFoundationWorkshopSessions,
} from "./foundation/foundation-workshop.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function createFoundationProject() {
  return createProject({
    title: "Foundation VFinal",
    genre: "奇幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "主角在雨夜捡到一把会说话的钥匙。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });
}

test("foundationWorkshopMessageSchema accepts resumeSessionId string and null", () => {
  assert.deepEqual(
    foundationWorkshopMessageSchema.parse({
      message: "继续完善主角代价。",
      resumeSessionId: "session-1",
    }),
    {
      message: "继续完善主角代价。",
      resumeSessionId: "session-1",
    },
  );

  assert.deepEqual(
    foundationWorkshopMessageSchema.parse({
      message: "这轮改成丢弃。",
      resumeSessionId: null,
    }),
    {
      message: "这轮改成丢弃。",
      resumeSessionId: null,
    },
  );
});

test("updateFoundationWorkshopSessionIfCurrent only updates when updated_at matches the current cursor", () => {
  const project = createFoundationProject();
  const projectId = project?.id;
  assert.equal(Boolean(projectId), true);

  try {
    saveFoundationWorkshopSession({
      projectId: projectId!,
      sessionId: "session-1",
      status: "running",
      stage: "replying",
      progress: 32,
      statusMessage: "设定助手正在续写回复。",
      userMessage: "把主角身上的寄生关系变得更危险。",
      assistantMessage: "它会共享感官。",
      error: null,
      createdAt: "2026-04-07T10:00:00.000Z",
      updatedAt: "2026-04-07T10:00:01.000Z",
    });

    const nextUpdatedAt = updateFoundationWorkshopSessionIfCurrent(
      projectId!,
      "session-1",
      "2026-04-07T10:00:01.000Z",
      {
        progress: 48,
        statusMessage: "正在同步共创草案和下一步焦点。",
        assistantMessage: "它会共享感官，也会吞掉一部分自我边界。",
      },
      "2026-04-07T10:00:02.000Z",
    );
    assert.equal(nextUpdatedAt, "2026-04-07T10:00:02.000Z");

    const stored = getFoundationWorkshopSession(projectId!);
    assert.equal(stored?.progress, 48);
    assert.equal(stored?.statusMessage, "正在同步共创草案和下一步焦点。");
    assert.equal(stored?.assistantMessage, "它会共享感官，也会吞掉一部分自我边界。");
    assert.equal(stored?.updatedAt, "2026-04-07T10:00:02.000Z");

    const rejected = updateFoundationWorkshopSessionIfCurrent(
      projectId!,
      "session-1",
      "2026-04-07T10:00:01.000Z",
      {
        progress: 96,
        statusMessage: "这个写入不该成功。",
      },
      "2026-04-07T10:00:03.000Z",
    );
    assert.equal(rejected, null);
    assert.equal(getFoundationWorkshopSession(projectId!)?.progress, 48);
  } finally {
    cleanupProject(projectId!);
  }
});

test("foundation workshop stale rules only fail sessions after 300000 ms", () => {
  const now = Date.parse("2026-04-07T12:00:00.000Z");
  assert.equal(
    isFoundationWorkshopSessionStale("2026-04-07T11:55:00.001Z", { nowMs: now, staleMs: 300_000 }),
    false,
  );
  assert.equal(
    isFoundationWorkshopSessionStale("2026-04-07T11:55:00.000Z", { nowMs: now, staleMs: 300_000 }),
    false,
  );
  assert.equal(
    isFoundationWorkshopSessionStale("2026-04-07T11:54:59.999Z", { nowMs: now, staleMs: 300_000 }),
    true,
  );
});

test("foundation workshop sweeper is idempotent and only warns when a running session really flips to failed", () => {
  const project = createFoundationProject();
  const projectId = project?.id;
  assert.equal(Boolean(projectId), true);

  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    saveFoundationWorkshopSession({
      projectId: projectId!,
      sessionId: "session-1",
      status: "running",
      stage: "replying",
      progress: 52,
      statusMessage: "设定助手正在续写回复。",
      userMessage: "继续完善主角代价。",
      assistantMessage: "它会吞掉宿主的记忆。",
      error: null,
      createdAt: "2026-04-07T11:40:00.000Z",
      updatedAt: "2026-04-07T11:49:59.999Z",
    });

    const first = sweepStaleFoundationWorkshopSessions({
      now: () => "2026-04-07T11:55:00.000Z",
      staleMs: 300_000,
    });
    assert.equal(first.failedCount, 1);
    assert.equal(getFoundationWorkshopSession(projectId!)?.status, "failed");
    assert.equal(warnings.length, 1);

    const second = sweepStaleFoundationWorkshopSessions({
      now: () => "2026-04-07T11:55:00.000Z",
      staleMs: 300_000,
    });
    assert.equal(second.failedCount, 0);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
    cleanupProject(projectId!);
  }
});

test("foundation workshop session config uses the vFinal defaults", () => {
  const config = resolveFoundationWorkshopSessionConfig({});
  assert.deepEqual(config, {
    heartbeatMs: 10_000,
    staleMs: 300_000,
    enableSweeper: true,
    sweepMs: 600_000,
  });
});
