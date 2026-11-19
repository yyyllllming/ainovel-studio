import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import Database from "better-sqlite3";

import { ensureDatabase } from "./db/init.ts";
import { rawDb } from "./db/client.ts";
import { projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { createProject, saveStoryContract } from "./repositories/project.repository.ts";
import { lockFoundation, saveFoundation } from "./repositories/foundation.repository.ts";
import type { ProjectExecutionContext } from "./services/project-execution-context.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";
import { createChapterPlanRepository } from "./repositories/chapter-plan.repository.ts";
import { buildChapterPlanStoryDigest, CHAPTER_PLAN_LEASE_TIMEOUT_MS, ensureChapterPlan } from "./story/chapter-plan-engine.ts";
import type { FoundationPayload, StoryContract } from "./types.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function createExecutionContext(): ProjectExecutionContext {
  const profile = {
    id: "profile-test",
    name: "Test Profile",
    providerId: "custom",
    protocol: "openai_compatible" as const,
    baseUrl: "https://relay.example.com/v1",
    apiKey: "test-key",
    defaultModel: "test-model",
    enabled: true,
    createdAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
  const plannerAssignment = {
    role: "planner" as const,
    profileId: profile.id,
    model: profile.defaultModel,
    temperature: 0.2,
    maxTokens: 4096,
  };

  return {
    agents: {
      coauthor: {
        profile,
        assignment: {
          ...plannerAssignment,
          role: "coauthor",
        },
      },
      planner: {
        profile,
        assignment: plannerAssignment,
      },
      writer: {
        profile,
        assignment: {
          role: "writer",
          profileId: profile.id,
          model: profile.defaultModel,
          temperature: 0.4,
          maxTokens: 8192,
        },
      },
      reviewer: {
        profile,
        assignment: {
          role: "reviewer",
          profileId: profile.id,
          model: profile.defaultModel,
          temperature: 0.1,
          maxTokens: 4096,
        },
      },
    },
    prompts: {
      planner: "你是测试用 planner。",
      writer: "你是测试用 writer。",
      reviewerQuick: "你是测试用 reviewer quick。",
      reviewerDeep: "你是测试用 reviewer deep。",
      editor: "你是测试用 editor。",
      archivist: "你是测试用 archivist。",
    },
    activeStyle: {
      styleSnapshotId: "style-snapshot-test",
      styleSnapshotVersion: 1,
      styleCard: "短句推进，章末留一个钩子。",
      styleProfile: createDefaultStyleProfile(),
      styleDigest: "测试风格摘要",
      styleExemplars: [],
      confidence: "high",
      sampledExcerpts: [],
      sourceIds: [],
    },
    styleCard: "短句推进，章末留一个钩子。",
    styleProfile: createDefaultStyleProfile(),
    chapterWordTarget: {
      sourceAverage: null,
      min: 2200,
      target: 2800,
      max: 3200,
      sourceLabel: "测试风格锚点",
    },
  };
}

function createStoryContract(): StoryContract {
  return {
    volumes: [
      {
        volumeNo: 1,
        label: "第一卷",
        goal: "查清雾海灯塔为何提前亮起。",
        chapterStart: 1,
        chapterEnd: 12,
        chapterBudgetMin: 10,
        chapterBudgetTarget: 12,
        chapterBudgetMax: 14,
        status: "active",
        milestones: [],
      },
    ],
    currentVolume: 1,
    globalArc: "雾海灯塔背后藏着更大的封锁阴谋。",
    endingPromise: "主角会摸到灯塔与封锁线的真正关系。",
    completionChecks: ["主线闭环"],
    storyPromises: [
      {
        id: "promise-1",
        label: "灯塔会在中段前露出真正用途",
        type: "mainline",
        description: "灯塔会在中段前露出真正用途。",
      },
    ],
    activeProgressionAxes: ["information_shift"],
    genreObligationPacks: [
      {
        id: "core-only",
        source: "manual",
        active: true,
        notes: ["逐步揭露真相"],
      },
    ],
    segmentPlans: [
      {
        id: "segment-1",
        label: "卷内骨架",
        startChapter: 1,
        endChapter: 6,
        status: "active",
        trigger: "seed",
        generatedAt: "2026-04-09T00:00:00.000Z",
        items: [
          {
            id: "item-4",
            chapterNo: 4,
            title: "旧仓库探线",
            intent: "逼近灯塔假线索",
            narrativeTitle: null,
            narrativeIntent: null,
            narrativeSummary: null,
            arcConnection: null,
            nextHook: null,
            rewriteStatus: "ready",
            userOverridden: false,
            requiredProgressDeltas: ["information_shift"],
            requiredObligations: ["逐步揭露真相"],
            focusCharacters: ["林砚"],
            arenaHints: ["旧仓库"],
            suggestedActionPattern: null,
            antagonistHint: "假联络员",
            forbiddenRecentAxes: [],
            arenaClusterId: "warehouse",
            opponentClusterId: "liaison",
            rewardType: null,
            relationshipBeatId: null,
          },
          {
            id: "item-5",
            chapterNo: 5,
            title: "灯塔坐标反夺",
            intent: "把真假坐标彻底分开",
            narrativeTitle: null,
            narrativeIntent: null,
            narrativeSummary: null,
            arcConnection: null,
            nextHook: "有人在灯塔先一步等着",
            rewriteStatus: "ready",
            userOverridden: false,
            requiredProgressDeltas: ["information_shift"],
            requiredObligations: ["逐步揭露真相"],
            focusCharacters: ["林砚", "苏澈"],
            arenaHints: ["雾港码头"],
            suggestedActionPattern: null,
            antagonistHint: "码头盯梢者",
            forbiddenRecentAxes: [],
            arenaClusterId: "dock",
            opponentClusterId: "tail",
            rewardType: null,
            relationshipBeatId: null,
          },
          {
            id: "item-7",
            chapterNo: 7,
            title: "封锁区夜渡",
            intent: "穿过封锁区",
            narrativeTitle: null,
            narrativeIntent: null,
            narrativeSummary: null,
            arcConnection: null,
            nextHook: null,
            rewriteStatus: "ready",
            userOverridden: false,
            requiredProgressDeltas: ["world_shift"],
            requiredObligations: ["逐步揭露真相"],
            focusCharacters: ["林砚"],
            arenaHints: ["封锁区水道"],
            suggestedActionPattern: null,
            antagonistHint: "夜渡巡哨",
            forbiddenRecentAxes: [],
            arenaClusterId: "canal",
            opponentClusterId: "patrol",
            rewardType: null,
            relationshipBeatId: null,
          },
        ],
      },
    ],
    progressState: {
      latestChapter: 4,
      recentPrimaryDeltas: ["information_shift"],
      recentArenaKeys: ["warehouse"],
      recentObjectiveKeys: ["trace"],
      stuckDimensions: [],
      mustAdvance: ["information_shift"],
      recentAntagonistKeys: ["liaison"],
      recentActionPatterns: [],
      recentEndingMoves: [],
      recentMechanismRevealModes: [],
      recentMotifWindows: [],
      updatedAt: "2026-04-09T00:00:00.000Z",
    },
    forecast: {
      min: 10,
      target: 12,
      max: 14,
      finalRunReady: false,
      completionProgress: 0.3,
      nextMilestone: "锁定灯塔真实坐标",
    },
    recentPlan: [],
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
}

function createLockedProjectForChapterPlanTest() {
  const premise = "姜离必须在雾海灯塔亮起前查清谁在篡改海防图。";
  const foundation: FoundationPayload = {
    premise,
    styleCard: "冷、硬、章末留钩。",
    characters: [
      {
        name: "姜离",
        role: "protagonist",
        goal: "查清海防图被篡改的源头。",
        traits: ["谨慎", "狠"],
        secrets: [],
      },
    ],
    worldview: [
      {
        name: "雾海灯塔",
        description: "潮雾最重时会提前亮起，意味着有人在改写航线。",
      },
    ],
    relationships: [],
  };
  const storyContract: StoryContract = {
    volumes: [
      {
        volumeNo: 1,
        label: "第一卷",
        goal: "锁定真正的海防图去向。",
        chapterStart: 1,
        chapterEnd: 12,
        chapterBudgetMin: 10,
        chapterBudgetTarget: 12,
        chapterBudgetMax: 14,
        status: "active",
        milestones: [],
      },
    ],
    currentVolume: 1,
    globalArc: "有人借雾海灯塔篡改海防图并掩盖真正的航道意图。",
    endingPromise: "姜离会找到真正的海防图，并确认灯塔为何提前亮起。",
    completionChecks: ["主线闭环"],
    storyPromises: [
      {
        id: "promise-1",
        label: "灯塔提前亮起的真相会被揭开",
        type: "mainline",
        description: "灯塔会在卷中期前暴露异常机制。",
      },
    ],
    activeProgressionAxes: ["information_shift"],
    genreObligationPacks: [
      {
        id: "core-only",
        source: "manual",
        active: true,
        notes: ["逐步揭露真相"],
      },
    ],
    segmentPlans: [
      {
        id: "segment-1",
        label: "卷内骨架 1",
        startChapter: 1,
        endChapter: 6,
        status: "active",
        trigger: "seed",
        generatedAt: "2026-04-09T00:00:00.000Z",
        items: [
          {
            id: "segment-item-2",
            chapterNo: 2,
            title: "码头验图",
            intent: "确认哪张海防图是伪造诱饵。",
            narrativeTitle: "码头验图",
            narrativeIntent: "让姜离在码头里排除一张假图，并被迫背下真正的航线线索。",
            narrativeSummary: "姜离在码头验图时发现有人故意放出一张假图误导追查方向。",
            arcConnection: "这章把灯塔异常和海防图失真第一次正面绑定。",
            nextHook: "有人在灯塔脚下提前埋好了接应暗号。",
            rewriteStatus: "ready",
            userOverridden: false,
            requiredProgressDeltas: ["information_shift"],
            requiredObligations: ["逐步揭露真相"],
            focusCharacters: ["姜离"],
            arenaHints: ["旧码头"],
            suggestedActionPattern: null,
            antagonistHint: "港口盯梢者",
            forbiddenRecentAxes: [],
            arenaClusterId: "dock",
            opponentClusterId: "tail",
            rewardType: null,
            relationshipBeatId: null,
          },
        ],
      },
      {
        id: "segment-2",
        label: "卷内骨架 2",
        startChapter: 7,
        endChapter: 12,
        status: "queued",
        trigger: "refresh",
        generatedAt: "2026-04-09T00:00:00.000Z",
        items: [
          {
            id: "segment-item-7",
            chapterNo: 7,
            title: "灯塔内层",
            intent: "把灯塔异常推进到不可回避的层面。",
            narrativeTitle: "灯塔内层",
            narrativeIntent: "让姜离发现灯塔异常不是孤立事件，而是更大改图行动的一环。",
            narrativeSummary: "姜离进入灯塔内层，发现异常光源和海防图缺页直接连在一起。",
            arcConnection: "为卷中期揭开灯塔真相铺路。",
            nextHook: "灯塔最深处传来第二组错误航标。",
            rewriteStatus: "ready",
            userOverridden: false,
            requiredProgressDeltas: ["world_shift"],
            requiredObligations: ["逐步揭露真相"],
            focusCharacters: ["姜离"],
            arenaHints: ["灯塔内层"],
            suggestedActionPattern: null,
            antagonistHint: "值守影子",
            forbiddenRecentAxes: [],
            arenaClusterId: "tower",
            opponentClusterId: "warden",
            rewardType: null,
            relationshipBeatId: null,
          },
        ],
      },
    ],
    progressState: {
      latestChapter: 1,
      recentPrimaryDeltas: ["information_shift"],
      recentArenaKeys: ["旧码头"],
      recentObjectiveKeys: ["查图"],
      stuckDimensions: [],
      mustAdvance: ["information_shift"],
      recentAntagonistKeys: ["tail"],
      recentActionPatterns: [],
      recentEndingMoves: [],
      recentMechanismRevealModes: [],
      recentMotifWindows: [],
      updatedAt: "2026-04-09T00:00:00.000Z",
    },
    forecast: {
      min: 10,
      target: 12,
      max: 14,
      finalRunReady: false,
      completionProgress: 0.2,
      nextMilestone: "锁定假图来源",
    },
    recentPlan: [],
    updatedAt: "2026-04-09T00:00:00.000Z",
  };
  const project = createProject({
    title: "Chapter Plan Upgrade Fallback Project",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise,
    assignments: [
      { role: "coauthor", profileId: "profile-test", model: "test-model", temperature: 0.4, maxTokens: 4096 },
      { role: "planner", profileId: "profile-test", model: "test-model", temperature: 0.2, maxTokens: 4096 },
      { role: "writer", profileId: "profile-test", model: "test-model", temperature: 0.5, maxTokens: 8192 },
      { role: "reviewer", profileId: "profile-test", model: "test-model", temperature: 0.1, maxTokens: 4096 },
    ],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  saveFoundation(project.id, foundation);
  lockFoundation(project.id);
  saveStoryContract(project.id, storyContract);

  return { project, foundation, storyContract };
}

test("chapter plan repository claimGeneration respects fresh and expired leases", () => {
  const db = createMemoryDb();
  const repository = createChapterPlanRepository({ db });

  try {
    repository.upsertReady({
      projectId: "project-a",
      chapterNo: 5,
      purpose: "purpose",
      plotSummary: "summary",
      requiredBeats: [],
      keyEvents: [],
      characterFocus: [],
      relationshipShift: "",
      worldRuleUsage: [],
      continuationAnchor: "",
      nextHook: "",
      hookSlots: [],
      payoffTargets: [],
      riskFlags: [],
      foundationDigest: "foundation",
      storyContractDigest: "story",
      inputDigest: "input",
      generationId: 2,
      generationState: "generating",
      generationToken: "fresh-token",
      generationStartedAt: "2026-04-09T10:00:00.000Z",
      createdAt: "2026-04-09T10:00:00.000Z",
      updatedAt: "2026-04-09T10:00:00.000Z",
    });

    const blocked = repository.claimGeneration({
      projectId: "project-a",
      chapterNo: 5,
      foundationDigest: "foundation-2",
      storyContractDigest: "story-2",
      inputDigest: "input-2",
      generationToken: "new-token",
      now: "2026-04-09T10:01:00.000Z",
      leaseTimeoutMs: CHAPTER_PLAN_LEASE_TIMEOUT_MS,
    });
    assert.equal(blocked.claimed, false);

    const stolen = repository.claimGeneration({
      projectId: "project-a",
      chapterNo: 5,
      foundationDigest: "foundation-3",
      storyContractDigest: "story-3",
      inputDigest: "input-3",
      generationToken: "stolen-token",
      now: "2026-04-09T10:03:01.000Z",
      leaseTimeoutMs: CHAPTER_PLAN_LEASE_TIMEOUT_MS,
    });
    assert.equal(stolen.claimed, true);
    assert.equal(stolen.plan?.generationId, 3);
    assert.equal(stolen.plan?.generationToken, "stolen-token");
  } finally {
    db.close();
  }
});

test("buildChapterPlanStoryDigest ignores future segment skeleton changes beyond current chapter", () => {
  const base = createStoryContract();
  const baseDigest = buildChapterPlanStoryDigest({
    storyContract: base,
    chapterNo: 5,
  });

  const futureChanged = createStoryContract();
  futureChanged.segmentPlans[0]!.items[2]!.title = "封锁区黎明偷渡";
  const futureDigest = buildChapterPlanStoryDigest({
    storyContract: futureChanged,
    chapterNo: 5,
  });

  const currentChanged = createStoryContract();
  currentChanged.segmentPlans[0]!.items[1]!.intent = "把假坐标和真坐标背后的势力一起钉死";
  const currentDigest = buildChapterPlanStoryDigest({
    storyContract: currentChanged,
    chapterNo: 5,
  });

  assert.equal(baseDigest, futureDigest);
  assert.notEqual(baseDigest, currentDigest);
});

test("ensureChapterPlan restores degraded_backfill rows to ready when upgrade generation fails", async () => {
  const { project, storyContract } = createLockedProjectForChapterPlanTest();
  const repository = createChapterPlanRepository();
  const executionContext = createExecutionContext();
  const originalFetch = globalThis.fetch;

  try {
    const foundationDigest = "foundation-digest-test";
    const storyContractDigest = buildChapterPlanStoryDigest({
      storyContract,
      chapterNo: 2,
    });
    const inputDigest = "input-digest-test";

    repository.upsertReady({
      projectId: project.id,
      chapterNo: 2,
      purpose: "先守住码头验图，再把假图背后的盯梢者逼出来。",
      plotSummary: "姜离在码头验图时先压住盯梢者，再确认真正被换走的是哪一页海防图。",
      requiredBeats: ["排除假图", "确认盯梢者"],
      keyEvents: ["码头验图", "盯梢者现身"],
      characterFocus: ["姜离"],
      relationshipShift: "",
      worldRuleUsage: ["雾海灯塔会提前亮起"],
      continuationAnchor: "姜离确认灯塔脚下有人提前留下接应暗号。",
      nextHook: "灯塔脚下的接应暗号指向了第二个内应。",
      hookSlots: [
        {
          setupText: "灯塔脚下的接应暗号指向了第二个内应。",
          payoffWindow: [3, 5],
          priority: "medium",
          planIntent: "active",
        },
      ],
      payoffTargets: ["第3章尽快确认接应暗号是谁留下的"],
      riskFlags: ["hook_debt"],
      riskComment: "先保住降级骨架，等待后续升级。",
      status: "ready",
      source: "degraded_backfill",
      foundationDigest,
      storyContractDigest,
      inputDigest,
      generationId: 1,
      generationState: "ready",
      generationToken: null,
      generationStartedAt: null,
      usedSegmentSummaryFallback: true,
      segmentId: "segment-1",
      segmentItemId: "segment-item-2",
      createdAt: "2026-04-09T00:00:00.000Z",
      updatedAt: "2026-04-09T00:00:00.000Z",
    });

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  purpose: "让姜离确认新情报。",
                  plotSummary: "推进海防图主线。",
                  requiredBeats: ["确认假图"],
                  keyEvents: ["验图", "追击"],
                  characterFocus: ["姜离"],
                  relationshipShift: "",
                  worldRuleUsage: ["雾海灯塔异常"],
                  continuationAnchor: "姜离带着线索离开码头。",
                  nextHook: "灯塔脚下还有第二组暗号。",
                  hookSlots: [
                    {
                      setupText: "灯塔脚下还有第二组暗号。",
                      payoffWindow: [3, 5],
                      priority: "medium",
                      planIntent: "active",
                    },
                  ],
                  payoffTargets: ["尽快兑现暗号来源"],
                  riskFlags: ["hook_debt"],
                  riskComment: "",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const reused = await ensureChapterPlan(project.id, 2, executionContext);
    const saved = repository.get(project.id, 2);

    assert.equal(reused.source, "degraded_backfill");
    assert.equal(saved?.status, "ready");
    assert.equal(saved?.source, "degraded_backfill");
    assert.equal(saved?.generationState, "ready");
    assert.equal(saved?.generationToken, null);
    assert.equal(saved?.usedSegmentSummaryFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});

test("ensureChapterPlan normalizes loose risk flag labels instead of degrading the whole plan", async () => {
  const { project } = createLockedProjectForChapterPlanTest();
  const repository = createChapterPlanRepository();
  const executionContext = createExecutionContext();
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  purpose: "让姜离确认假图为何会出现在码头。",
                  plotSummary: "姜离在旧码头确认假图只是诱饵，并意识到真正的接应暗号藏在灯塔脚下。",
                  requiredBeats: ["确认假图", "逼出盯梢者", "带走真线索"],
                  keyEvents: ["验图", "识别盯梢者", "带走线索"],
                  characterFocus: ["姜离"],
                  relationshipShift: "",
                  worldRuleUsage: ["雾海灯塔会提前亮起"],
                  continuationAnchor: "姜离确认灯塔脚下埋着第二组暗号。",
                  nextHook: "第二组暗号指向了更深的内应。",
                  hookSlots: [
                    {
                      setupText: "第二组暗号指向了更深的内应。",
                      payoffWindow: [3, 6],
                      priority: "medium",
                      planIntent: "active",
                    },
                  ],
                  payoffTargets: ["尽快兑现第二组暗号的真正主人"],
                  riskFlags: ["loop_risk", "focus_loss", "hook_debt"],
                  riskComment: "先把循环风险压回去，不要让焦点散掉。",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const plan = await ensureChapterPlan(project.id, 2, executionContext);
    const saved = repository.get(project.id, 2);

    assert.equal(plan.source, "generated");
    assert.equal(plan.status, "ready");
    assert.deepEqual(plan.riskFlags, ["scene_loop", "focus_scatter", "hook_debt"]);
    assert.equal(saved?.source, "generated");
    assert.equal(saved?.generationState, "ready");
    assert.deepEqual(saved?.riskFlags, ["scene_loop", "focus_scatter", "hook_debt"]);
  } finally {
    globalThis.fetch = originalFetch;
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
