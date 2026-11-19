import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { buildFallbackStoryContract } from "./story/story-contract.ts";
import { buildDefaultRuntimeReviewSignals, buildSegmentPlans, deriveStoryProgressState } from "./story/story-progression.ts";
import { projectDir, withinProject } from "./paths.ts";
import { createProject, getProject, saveStoryContract } from "./repositories/project.repository.ts";
import { getRunState, upsertRunState } from "./repositories/run.repository.ts";
import { listChapterDeltaRecords, saveChapterDeltaRecord } from "./repositories/review.repository.ts";
import {
  appendFoundationWorkshopMessage,
  getFoundation,
  getFoundationWorkshopState,
  listFoundationWorkshopMessages,
  lockFoundation,
  saveFoundation,
  upsertFoundationWorkshopState,
} from "./repositories/foundation.repository.ts";
import { rawDb } from "./db/client.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { deleteChapterRange } from "./services/chapter-range-delete.service.ts";
import { resetProjectToFoundationWorkshop } from "./services/foundation-reset.service.ts";
import { softInvalidateChapterRange } from "./services/run-restart.service.ts";
import { listChapterInvalidations } from "./repositories/chapter.repository.ts";
import type { FoundationPayload } from "./types.ts";
import { nowIso } from "./utils.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("deleteChapterRange resets story progression state and removes archived chapter history", async () => {
  const project = createProject({
    title: "Chapter Reset",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "少年误入古地，主线不断抬升。",
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
    const foundation: FoundationPayload = {
      premise: "少年误入古地，主线不断抬升。",
      styleCard: "冷静推进",
      characters: [{ name: "姜离", role: "protagonist", goal: "活下来", secrets: [], traits: ["谨慎"] }],
      worldview: [{ name: "断崖古地", description: "危险场域" }],
      relationships: [],
    };
    const baseContract = buildFallbackStoryContract({
      title: "Chapter Reset",
      genre: "玄幻",
      premise: "少年误入古地，主线不断抬升。",
      chapterPlanningMode: "fixed",
      storyLength: "long",
      plannedVolumes: 1,
      chapterBudgetMin: 12,
      chapterBudgetTarget: 12,
      chapterBudgetMax: 12,
      hardChapterCap: 12,
      completionCriteria: "主线闭环",
    });

    const chapterOneSignals = buildDefaultRuntimeReviewSignals("situation_shift");
    const chapterTwoSignals = buildDefaultRuntimeReviewSignals("information_shift");

    saveChapterDeltaRecord({
      id: nanoid(),
      projectId: projectId!,
      chapterNo: 1,
      segmentId: null,
      segmentItemId: null,
      primaryDeltaDelivered: "situation_shift",
      deliveredDeltas: ["situation_shift"],
      storyProgression: chapterOneSignals.storyProgression,
      genreFulfillment: chapterOneSignals.genreFulfillment,
      loopRisk: chapterOneSignals.loopRisk,
      summary: "第1章完成局面切换。",
      arenaKey: "断崖古地",
      objectiveKey: "逃离古地",
      stuckDimensions: [],
      antagonistKey: null,
      actionPattern: null,
      endingMove: null,
      mechanismRevealMode: null,
      motifTokens: [],
      obligationHits: [],
      createdAt: nowIso(),
    });
    saveChapterDeltaRecord({
      id: nanoid(),
      projectId: projectId!,
      chapterNo: 2,
      segmentId: null,
      segmentItemId: null,
      primaryDeltaDelivered: "information_shift",
      deliveredDeltas: ["information_shift"],
      storyProgression: chapterTwoSignals.storyProgression,
      genreFulfillment: chapterTwoSignals.genreFulfillment,
      loopRisk: chapterTwoSignals.loopRisk,
      summary: "第2章拿到新线索。",
      arenaKey: "断崖古地",
      objectiveKey: "找出古地真相",
      stuckDimensions: [],
      antagonistKey: null,
      actionPattern: null,
      endingMove: null,
      mechanismRevealMode: null,
      motifTokens: [],
      obligationHits: [],
      createdAt: nowIso(),
    });

    saveStoryContract(projectId!, {
      ...baseContract,
      segmentPlans: buildSegmentPlans({
        startingChapter: 1,
        currentVolumeGoal: baseContract.endingPromise,
        endingPromise: baseContract.endingPromise,
        foundation,
        activations: baseContract.genreObligationPacks,
      }),
      progressState: deriveStoryProgressState(listChapterDeltaRecords(projectId!)),
      forecast: {
        ...baseContract.forecast,
        completionProgress: 0.45,
        finalRunReady: true,
        nextMilestone: "进入下一层古地秘密",
      },
    });

    await mkdir(withinProject(projectId!, "chapters"), { recursive: true });
    await mkdir(withinProject(projectId!, "history", "invalidated"), { recursive: true });
    await writeFile(withinProject(projectId!, "chapters", "chapter_001.md"), "第1章", "utf8");
    await writeFile(withinProject(projectId!, "chapters", "chapter_002.md"), "第2章", "utf8");
    await writeFile(
      withinProject(projectId!, "history", "invalidated", "chapter_002_2026-03-25T00-00-00-000Z.md"),
      "旧版本",
      "utf8",
    );

    await deleteChapterRange(projectId!, { startChapter: 1, endChapter: 2 });

    const nextProject = getProject(projectId!);
    if (!nextProject?.storyContract) {
      throw new Error("删除后应保留并重置 story contract");
    }

    assert.equal(listChapterDeltaRecords(projectId!).length, 0);
    assert.equal(nextProject.storyContract.progressState.latestChapter, 0);
    assert.deepEqual(nextProject.storyContract.progressState.stuckDimensions, []);
    assert.equal(nextProject.storyContract.segmentPlans.length, 0);
    assert.equal(nextProject.storyContract.forecast.completionProgress, 0);
    assert.equal(nextProject.storyContract.forecast.finalRunReady, false);
    assert.equal(existsSync(withinProject(projectId!, "chapters", "chapter_001.md")), false);
    assert.equal(existsSync(withinProject(projectId!, "chapters", "chapter_002.md")), false);
    assert.equal(
      existsSync(withinProject(projectId!, "history", "invalidated", "chapter_002_2026-03-25T00-00-00-000Z.md")),
      false,
    );
  } finally {
    await rm(projectDir(projectId!), { recursive: true, force: true });
    cleanupProject(projectId!);
  }
});

test("softInvalidateChapterRange archives future chapters and resets the active run state", async () => {
  const project = createProject({
    title: "Soft Invalidate",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "上游章节被改写后，需要软失效后续时间线。",
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
    await mkdir(withinProject(projectId!, "chapters"), { recursive: true });
    await mkdir(withinProject(projectId!, "history", "invalidated"), { recursive: true });
    await writeFile(withinProject(projectId!, "chapters", "chapter_002.md"), "第2章正文", "utf8");
    await writeFile(withinProject(projectId!, "chapters", "chapter_003.md"), "第3章正文", "utf8");
    upsertRunState(projectId!, {
      stage: "manual_review",
      status: "manual_review",
      desiredState: "running",
      heartbeatAt: "2026-04-01T00:00:00.000Z",
      currentChapter: 3,
      totalChapters: 12,
      retryCount: 2,
      confidence: 0.42,
      lastError: "window mismatch",
    });

    const result = await softInvalidateChapterRange(projectId!, {
      fromChapter: 2,
      reason: "manual review retry",
      reviewReason: "deep review failed",
    });

    assert.deepEqual(result, {
      startChapter: 2,
      endChapter: 3,
      invalidatedChapters: [2, 3],
    });
    assert.equal(existsSync(withinProject(projectId!, "chapters", "chapter_002.md")), false);
    assert.equal(existsSync(withinProject(projectId!, "chapters", "chapter_003.md")), false);

    const state = getRunState(projectId!);
    assert.equal(state?.stage, "paused");
    assert.equal(state?.desiredState, "idle");
    assert.equal(state?.currentChapter, 2);
  } finally {
    await rm(projectDir(projectId!), { recursive: true, force: true });
    cleanupProject(projectId!);
  }
});

test("softInvalidateChapterRange replay archives each future chapter exactly once", async () => {
  const project = createProject({
    title: "Reentrant Soft Invalidate",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 8,
    premise: "上游正文修改后重建时间线。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });
  const projectId = project!.id;
  try {
    await mkdir(withinProject(projectId, "chapters"), { recursive: true });
    await writeFile(withinProject(projectId, "chapters", "chapter_002.md"), "第2章正文", "utf8");
    await writeFile(withinProject(projectId, "chapters", "chapter_003.md"), "第3章正文", "utf8");
    upsertRunState(projectId, {
      stage: "manual_review",
      status: "manual_review",
      desiredState: "running",
      currentChapter: 3,
      totalChapters: 8,
      retryCount: 0,
      confidence: 0.5,
    });
    const input = {
      fromChapter: 2,
      reason: "replay test",
      operationKey: "operation-replay-1",
      invalidatedAt: "2026-04-01T00:00:00.000Z",
    };
    const first = await softInvalidateChapterRange(projectId, input);
    const second = await softInvalidateChapterRange(projectId, input);
    assert.deepEqual(first.invalidatedChapters, [2, 3]);
    assert.deepEqual(second.invalidatedChapters, [2, 3]);
    const rows = listChapterInvalidations(projectId).filter((row) => row.operationKey === input.operationKey);
    assert.equal(rows.length, 2);
    const archives = await readdir(withinProject(projectId, "history", "invalidated"));
    assert.equal(archives.filter((file) => file.includes("2026-04-01T00-00-00-000Z")).length, 2);
  } finally {
    await rm(projectDir(projectId), { recursive: true, force: true });
    cleanupProject(projectId);
  }
});

test("resetProjectToFoundationWorkshop preserves workshop context and removes writing outputs", async () => {
  const project = createProject({
    title: "Reset To Workshop",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "锁定设定后已经写了几章，现在要回到设定工坊重来。",
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
    const styleExcerpt = {
      id: "excerpt-1",
      sourceId: "source-1",
      sourceTitle: "完美世界",
      label: "短句推进",
      tags: ["narrative"] as Array<"narrative">,
      content: "山风压着碎石一路滚落，主角没有回头。",
      wordCount: 22,
      startOffset: 0,
      endOffset: 22,
      positionRatio: 0.1,
      dialogueRatio: 0,
    };
    const foundation: FoundationPayload = {
      premise: "锁定设定后已经写了几章，现在要回到设定工坊重来。",
      styleCard: "冷静克制",
      styleDigest: "偏冷、偏硬、少解释。",
      styleExemplars: [styleExcerpt],
      characters: [{ name: "姜离", role: "protagonist", goal: "活下来", secrets: [], traits: ["谨慎"] }],
      worldview: [{ name: "古地", description: "危险且会吞噬记忆的区域。" }],
      relationships: [],
    };
    saveFoundation(projectId!, foundation);
    lockFoundation(projectId!);
    upsertFoundationWorkshopState(
      projectId!,
      {
        premise: "锁定设定后已经写了几章，现在要回到设定工坊重来。",
        mainline: "少年闯入古地，追索异兽来源。",
        storyHook: "异兽会吞噬章节里的名字。",
        desiredTone: "冷静克制",
        characterIdeas: [{ name: "姜离", role: "protagonist", goal: "活下来", traits: ["谨慎"], secrets: [] }],
        worldviewIdeas: [{ name: "古地吞名机制", description: "名字被吞噬后，会影响存在痕迹。" }],
        relationshipIdeas: [],
        unresolvedQuestions: ["异兽为什么盯上主角"],
        styleReferences: [
          { kind: "book", label: "完美世界", author: "辰东", source: "network", relation: "primary" },
        ],
        styleManualGuidance: "保留压迫感",
        styleAvoidances: "不要长篇解释",
        styleSteeringCard: "冷静克制，少解释。",
        styleSamples: ["第一章样本文本"],
        styleSnapshotId: "snapshot-1",
        styleSnapshotVersion: 1,
        styleDigest: "偏冷、偏硬、少解释。",
        styleExemplars: [styleExcerpt],
      },
      true,
    );
    appendFoundationWorkshopMessage(projectId!, "user", "先把世界观再压一压。");
    appendFoundationWorkshopMessage(projectId!, "assistant", "我会把危险感再提前。");

    rawDb.prepare("UPDATE projects SET story_contract_json = ?, steering_notes_json = ?, status = ? WHERE id = ?").run(
      JSON.stringify({
        volumes: [],
        currentVolume: 1,
        globalArc: "异兽主线",
        endingPromise: "主角揭开古地真相",
        completionChecks: ["主线闭环"],
        forecast: {
          min: 10,
          target: 12,
          max: 12,
          finalRunReady: false,
          completionProgress: 0.4,
          nextMilestone: "拿到第二条线索",
        },
        recentPlan: ["推进古地异兽线"],
        updatedAt: nowIso(),
      }),
      JSON.stringify([
        {
          id: "note-1",
          instruction: "减少解释",
          scope: "next_arc",
          createdAt: nowIso(),
          active: true,
          applyUntilChapter: 4,
        },
      ]),
      "foundation_locked",
      projectId!,
    );

    await mkdir(withinProject(projectId!, "chapters", "summaries"), { recursive: true });
    await mkdir(withinProject(projectId!, "drafts", ".checkpoints"), { recursive: true });
    await mkdir(withinProject(projectId!, "reviews"), { recursive: true });
    await mkdir(withinProject(projectId!, "blueprints", "traces"), { recursive: true });
    await mkdir(withinProject(projectId!, "history", "invalidated"), { recursive: true });
    await mkdir(withinProject(projectId!, "exports"), { recursive: true });
    await mkdir(withinProject(projectId!, "canon"), { recursive: true });
    await writeFile(withinProject(projectId!, "chapters", "chapter_001.md"), "第一章正文", "utf8");
    await writeFile(withinProject(projectId!, "chapters", "summaries", "chapter_001_brief.md"), "摘要", "utf8");
    await writeFile(withinProject(projectId!, "drafts", "chapter_001_draft_2026-04-05.md"), "草稿", "utf8");
    await writeFile(withinProject(projectId!, "drafts", ".checkpoints", "chapter_001_checkpoint_900.md"), "检查点", "utf8");
    await writeFile(withinProject(projectId!, "reviews", "chapter_001_review_1.json"), "{\"score\":80}", "utf8");
    await writeFile(withinProject(projectId!, "blueprints", "chapter_001_blueprint.json"), "{\"chapterNo\":1}", "utf8");
    await writeFile(withinProject(projectId!, "blueprints", "traces", "chapter_001_planner_trace.json"), "{\"trace\":true}", "utf8");
    await writeFile(withinProject(projectId!, "history", "invalidated", "chapter_001_2026-04-05.md"), "旧版本", "utf8");
    await writeFile(withinProject(projectId!, "exports", "novel_export.json"), "{\"status\":\"ready\"}", "utf8");
    await writeFile(withinProject(projectId!, "canon", "facts.jsonl"), "{\"chapterNo\":1}\n", "utf8");
    await writeFile(withinProject(projectId!, "canon", "foreshadows.jsonl"), "{\"chapterNo\":1}\n", "utf8");

    rawDb.prepare("INSERT INTO blueprints (id, project_id, chapter_no, scene_goal, characters_json, locations_json, conflicts_json, foreshadows_json, emotional_tone, estimated_words, segment_id, segment_item_id, required_progress_delta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "blueprint-1",
      projectId!,
      1,
      "推进",
      "[]",
      "[]",
      "[]",
      "[]",
      "压迫",
      2000,
      null,
      null,
      null,
      nowIso(),
      nowIso(),
    );
    rawDb.prepare("INSERT INTO run_logs (id, project_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "run-log-1",
      projectId!,
      "info",
      "生成第一章",
      nowIso(),
    );
    rawDb.prepare(`
      INSERT INTO project_cards (
        id, project_id, card_type, name, draft_json, meta_json, status, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "world-card-1",
      projectId!,
      "world",
      "断崖山场",
      "{}",
      "{}",
      "confirmed",
      nowIso(),
      nowIso(),
      nowIso(),
    );

    upsertRunState(projectId!, {
      stage: "paused",
      status: "paused",
      desiredState: "idle",
      heartbeatAt: null,
      currentChapter: 3,
      totalChapters: 12,
      retryCount: 1,
      confidence: 0.6,
      lastError: "manual reset pending",
      draftFile: withinProject(projectId!, "drafts", "chapter_001_draft_2026-04-05.md"),
      currentPosition: 3200,
      wordCount: 3500,
      stageDetails: { lifecycle: { lastActiveStage: "review" } },
    });

    const result = await resetProjectToFoundationWorkshop(projectId!);

    assert.equal(result.stage, "idle");
    assert.equal(result.currentChapter, 1);
    assert.equal(result.desiredState, "idle");

    const nextProject = getProject(projectId!);
    assert.equal(nextProject?.status, "ideation");
    assert.deepEqual(nextProject?.storyContract, null);
    assert.deepEqual(nextProject?.steeringNotes, []);

    assert.equal(getFoundation(projectId!), null);

    assert.equal(
      (rawDb.prepare("SELECT COUNT(*) AS count FROM foundations WHERE project_id = ?").get(projectId!) as { count: number }).count,
      0,
    );
    assert.equal(
      (rawDb.prepare("SELECT COUNT(*) AS count FROM foundation_workshop_states WHERE project_id = ?").get(projectId!) as { count: number }).count,
      0,
    );
    assert.equal(
      (rawDb.prepare("SELECT COUNT(*) AS count FROM agent_assignments WHERE project_id = ?").get(projectId!) as { count: number }).count,
      0,
    );

    const workshopState = getFoundationWorkshopState(projectId!);
    assert.equal(workshopState?.draft.styleSteeringCard, "");
    assert.equal(workshopState?.readyToGenerate, false);
    assert.equal(listFoundationWorkshopMessages(projectId!).length, 2);

    const runState = getRunState(projectId!);
    assert.equal(runState?.stage, "idle");
    assert.equal(runState?.currentChapter, 1);
    assert.equal(runState?.runSessionId, null);
    assert.equal(runState?.lastError, null);
    assert.equal(runState?.draftFile, null);
    assert.deepEqual(runState?.stageDetails, {});

    assert.equal(existsSync(withinProject(projectId!, "chapters", "chapter_001.md")), false);
    assert.equal(existsSync(withinProject(projectId!, "drafts", "chapter_001_draft_2026-04-05.md")), false);
    assert.equal(existsSync(withinProject(projectId!, "reviews", "chapter_001_review_1.json")), false);
    assert.equal(existsSync(withinProject(projectId!, "blueprints", "chapter_001_blueprint.json")), false);
    assert.equal(existsSync(withinProject(projectId!, "blueprints", "traces", "chapter_001_planner_trace.json")), false);
    assert.equal(existsSync(withinProject(projectId!, "history", "invalidated", "chapter_001_2026-04-05.md")), false);
    assert.equal(existsSync(withinProject(projectId!, "exports", "novel_export.json")), false);
    assert.equal(existsSync(withinProject(projectId!, "bible", "core.json")), false);
    assert.equal(existsSync(withinProject(projectId!, "config", "characters", "01_纪渊.json")), false);

    assert.equal(
      (rawDb.prepare("SELECT COUNT(*) AS count FROM project_cards WHERE project_id = ?").get(projectId!) as { count: number }).count,
      0,
    );
    assert.equal(
      (rawDb.prepare("SELECT COUNT(*) AS count FROM blueprints WHERE project_id = ?").get(projectId!) as { count: number }).count,
      0,
    );
    assert.equal(
      (rawDb.prepare("SELECT COUNT(*) AS count FROM run_logs WHERE project_id = ?").get(projectId!) as { count: number }).count,
      0,
    );
  } finally {
    await rm(projectDir(projectId!), { recursive: true, force: true });
    cleanupProject(projectId!);
  }
});
