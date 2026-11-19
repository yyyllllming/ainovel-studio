import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createAuthorSubmissionService } from "./services/author-submission.service.ts";
import { createProject } from "./repositories/project.repository.ts";
import { rawDb } from "./db/client.ts";
import { projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import type { DeepReviewVerdict, QuickAuditVerdict } from "./types.ts";

function quickVerdict(): QuickAuditVerdict {
  return {
    reviewMode: "quick",
    verdict: "escalate",
    confidence: 0.8,
    reason: "进入深审",
    fixInstructions: "交给深审",
    issues: [],
    triggerReasons: ["manual_checkpoint"],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: { risk: "pass", score: 90, summary: "推进", advancements: [], stallSignals: [], primaryDelta: "information_shift", deliveredDeltas: ["information_shift"] },
    genreFulfillment: null,
    loopRisk: { risk: "pass", score: 90, summary: "无循环", repetitionAxes: [], stuckDimensions: [] },
    primaryDeltaDelivered: "information_shift",
    stuckDimensions: [],
  };
}

function deepVerdict(verdict: "pass" | "rewrite_current"): DeepReviewVerdict {
  return {
    ...quickVerdict(),
    reviewMode: "deep",
    verdict,
    reason: verdict === "pass" ? "审查通过" : "需要修订",
    fixInstructions: verdict === "pass" ? "无需修订" : "补足人物动机",
    windowStartChapter: 1,
    windowEndChapter: 1,
    earliestAffectedChapter: 1,
  };
}

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("author submission import-review-revise-approve commits with zero Writer calls and replays idempotently", async () => {
  const previousDisableWorkers = process.env.AINOVEL_DISABLE_DETACHED_WORKERS;
  process.env.AINOVEL_DISABLE_DETACHED_WORKERS = "1";
  const project = createProject({
    title: "Author Submission Integration",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 80,
    premise: "失物招领员追查雾城被抹去的名字。",
    assignments: [
      { role: "coauthor", profileId: "unused", model: "unused", temperature: 0, maxTokens: 1 },
      { role: "planner", profileId: "unused", model: "unused", temperature: 0, maxTokens: 1 },
      { role: "writer", profileId: "unused", model: "unused", temperature: 0, maxTokens: 1 },
      { role: "reviewer", profileId: "unused", model: "unused", temperature: 0, maxTokens: 1 },
    ],
  });
  const projectId = project!.id;
  let deepCalls = 0;
  let writerCalls = 0;
  const reviewOrder: string[] = [];
  const service = createAuthorSubmissionService({
    ensureAuthorReviewBlueprint: async (_projectId, input) => {
      reviewOrder.push(`baseline:${input.chapterNo}`);
      assert.match(input.content, /旧伞/u);
      return {} as never;
    },
    assembleContextPack: async () => {
      reviewOrder.push("context");
      return {} as never;
    },
    quickAuditChapter: async () => quickVerdict(),
    deepReviewChapter: async () => {
      deepCalls += 1;
      return deepVerdict(deepCalls === 1 ? "rewrite_current" : "pass");
    },
  });

  try {
    const preview = await service.preview(projectId, {
      kind: "single",
      chapterNo: 1,
      title: "第一章 雾里的旧伞",
      content: "林雾在雨棚下接过一把没人认领的旧伞。",
      source: "codex",
    });
    const imported = await service.importPreview(projectId, { previewId: preview.previewId! });
    const first = imported.results[0]!.submission!;
    const rejected = await service.review(projectId, first.id);
    assert.equal(rejected.submission.status, "needs_revision");

    const revision = await service.revise(projectId, first.id, {
      title: "第一章 雾里的旧伞",
      content: "林雾在雨棚下接过一把没人认领的旧伞，并从伞骨夹层发现了被划掉的名字。",
      source: "codex",
    });
    const approved = await service.review(projectId, revision.id);
    assert.equal(approved.submission.status, "approved");
    const committed = await service.approve(projectId, revision.id);
    assert.equal(committed.submission.status, "committed");

    const artifactStatusPath = join(projectDir(projectId), "canon", "artifact_status_001.json");
    await mkdir(join(projectDir(projectId), "canon"), { recursive: true });
    await writeFile(artifactStatusPath, '{"aggregateStatus":"success"}\n', "utf8");
    rawDb.prepare("UPDATE artifact_outbox SET state = 'failed' WHERE commit_id = ?").run(committed.commitId);
    const replay = await service.approve(projectId, revision.id);
    assert.equal(replay.versionId, committed.versionId);
    assert.equal(replay.commitId, committed.commitId);
    assert.equal((rawDb.prepare("SELECT state FROM artifact_outbox WHERE commit_id = ?").get(committed.commitId) as { state: string }).state, "pending");
    assert.equal(Number((rawDb.prepare("SELECT COUNT(*) AS count FROM chapter_versions WHERE project_id = ? AND chapter_no = 1").get(projectId) as { count: number }).count), 1);
    assert.equal(Number((rawDb.prepare("SELECT COUNT(*) AS count FROM chapter_commits WHERE project_id = ? AND chapter_no = 1").get(projectId) as { count: number }).count), 1);
    assert.equal((rawDb.prepare("SELECT source FROM chapter_versions WHERE id = ?").get(committed.versionId) as { source: string }).source, "author_submission");
    await assert.rejects(() => readFile(artifactStatusPath, "utf8"), { code: "ENOENT" });
    assert.equal(writerCalls, 0);
    assert.deepEqual(reviewOrder, ["baseline:1", "context", "baseline:1", "context"]);
  } finally {
    writerCalls += 0;
    await rm(projectDir(projectId), { recursive: true, force: true });
    cleanupProject(projectId);
    if (previousDisableWorkers === undefined) delete process.env.AINOVEL_DISABLE_DETACHED_WORKERS;
    else process.env.AINOVEL_DISABLE_DETACHED_WORKERS = previousDisableWorkers;
  }
});

test("author submission service has no Writer generation path", async () => {
  const source = await readFile(new URL("./services/author-submission.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /writeDraftFromContext|rewriteChapterFromReview|finalizeAcceptedChapter/);
  assert.match(source, /quickAuditChapter/);
  assert.match(source, /deepReviewChapter/);
});
