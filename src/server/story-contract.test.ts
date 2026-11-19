import test from "node:test";
import assert from "node:assert/strict";
import {
  applyContinuationDecision,
  buildFallbackStoryContract,
  calculateCompletionProgress,
  getCurrentMilestone,
  hydrateStoryContract,
} from "./story/story-contract.ts";
import type { StoryContract } from "./types.ts";

const seedProject = {
  title: "潮汐备忘录",
  genre: "都市悬疑",
  premise: "一个记忆会被海雾吞没的城市里，调查记者追查父亲失踪真相。",
  chapterPlanningMode: "dynamic" as const,
  storyLength: "long" as const,
  plannedVolumes: 2,
  chapterBudgetMin: 14,
  chapterBudgetTarget: 20,
  chapterBudgetMax: 28,
  hardChapterCap: 30,
  completionCriteria: "主线真相揭晓，海雾规则兑现代价，主要人物关系落定",
};

test("buildFallbackStoryContract creates active first volume and forecast", () => {
  const contract = buildFallbackStoryContract(seedProject);

  assert.equal(contract.currentVolume, 1);
  assert.equal(contract.volumes.length, 2);
  assert.equal(contract.volumes[0]?.status, "active");
  assert.equal(contract.volumes[1]?.status, "planned");
  assert.equal(contract.forecast.min, 14);
  assert.equal(contract.forecast.target, 20);
  assert.equal(contract.forecast.max, 28);
});

test("applyContinuationDecision closes the current volume and advances to the next one", () => {
  const contract = buildFallbackStoryContract(seedProject);
  const next = applyContinuationDecision(contract, {
    chapterNo: 10,
    decision: "end_volume",
    summary: "第一卷以真相反转收束，转入第二卷",
    nextPlan: ["第二卷先处理舆论后果", "加速推进海雾来源调查"],
  });

  assert.equal(next.currentVolume, 2);
  assert.equal(next.volumes[0]?.status, "completed");
  assert.equal(next.volumes[0]?.chapterEnd, 10);
  assert.equal(next.volumes[1]?.status, "active");
  assert.deepEqual(next.recentPlan, ["第二卷先处理舆论后果", "加速推进海雾来源调查"]);
});

test("applyContinuationDecision marks final run readiness and completion", () => {
  const contract = buildFallbackStoryContract(seedProject);
  const finalRun = applyContinuationDecision(contract, {
    chapterNo: 18,
    decision: "enter_final_run",
    summary: "主线已接近终局，进入最终收束",
    nextPlan: ["回收黑匣子伏笔", "兑现父亲失踪真相"],
  });
  assert.equal(finalRun.forecast.finalRunReady, true);
  assert.equal(finalRun.forecast.completionProgress, 0.92);

  const completed = applyContinuationDecision(finalRun, {
    chapterNo: 20,
    decision: "complete_story",
    summary: "主线闭环",
    nextPlan: [],
  });

  assert.equal(completed.forecast.completionProgress, 1);
  assert.equal(completed.forecast.nextMilestone, "已满足完结条件");
});

test("calculateCompletionProgress respects hard caps and final-run boosts", () => {
  const contract = buildFallbackStoryContract(seedProject);
  assert.equal(calculateCompletionProgress(1, contract, seedProject.hardChapterCap), 0.05);
  assert.equal(calculateCompletionProgress(10, contract, seedProject.hardChapterCap), 0.5);

  const boosted: StoryContract = {
    ...contract,
    forecast: {
      ...contract.forecast,
      finalRunReady: true,
    },
  };
  assert.equal(calculateCompletionProgress(18, boosted, seedProject.hardChapterCap), 0.92);
  assert.equal(calculateCompletionProgress(30, boosted, seedProject.hardChapterCap), 1);
});

test("hydrateStoryContract backfills extended story contract fields for legacy projects", () => {
  const legacy = buildFallbackStoryContract(seedProject);
  const hydrated = hydrateStoryContract({
    ...legacy,
    segmentPlans: [
      {
        id: "segment-1",
        label: "旧段落",
        startChapter: 1,
        endChapter: 6,
        status: "active",
        trigger: "seed",
        generatedAt: "2026-03-25T00:00:00.000Z",
        items: [
          {
            id: "segment-item-1",
            chapterNo: 1,
            title: "旧推进位",
            intent: "让调查记者先摸到第一层海雾规律。",
            requiredProgressDeltas: ["information_shift"],
            requiredObligations: [],
            focusCharacters: ["主角"],
            arenaHints: ["旧港深处"],
            suggestedActionPattern: null,
            antagonistHint: null,
            forbiddenRecentAxes: [],
          },
        ],
      },
    ] as unknown as StoryContract["segmentPlans"],
    progressState: {
      latestChapter: 2,
      recentPrimaryDeltas: ["information_shift"],
      recentArenaKeys: ["旧港"],
      recentObjectiveKeys: ["查清海雾"],
      stuckDimensions: [],
      mustAdvance: ["objective_shift"],
      recentAntagonistKeys: [],
      recentActionPatterns: [],
      recentEndingMoves: [],
      recentMechanismRevealModes: [],
      recentMotifWindows: [],
      updatedAt: "2026-03-25T00:00:00.000Z",
    },
  } as unknown as StoryContract, {
    genre: seedProject.genre,
    premise: seedProject.premise,
    completionCriteria: seedProject.completionCriteria,
    latestChapter: 2,
  });

  assert.deepEqual(hydrated.arenaClusters, []);
  assert.deepEqual(hydrated.opponentClusters, []);
  assert.equal(hydrated.rewardTypes?.length, 6);
  assert.deepEqual(hydrated.relationshipProgressions, []);
  assert.deepEqual(hydrated.progressState.consumedFutureBeats, []);
  assert.equal(hydrated.segmentPlans[0]?.items[0]?.arenaClusterId, null);
  assert.equal(hydrated.segmentPlans[0]?.items[0]?.opponentClusterId, null);
  assert.equal(hydrated.segmentPlans[0]?.items[0]?.rewardType, null);
  assert.equal(hydrated.segmentPlans[0]?.items[0]?.relationshipBeatId, null);
  assert.deepEqual(hydrated.volumes[0]?.milestones, []);
});

test("getCurrentMilestone prefers the active volume milestone for the current chapter", () => {
  const base = buildFallbackStoryContract(seedProject);
  const contract = hydrateStoryContract({
    ...base,
    volumes: [
      {
        volumeNo: 1,
        label: "第 1 卷",
        goal: "建立海雾规则与主线压力。",
        status: "active",
        chapterStart: 1,
        chapterEnd: null,
        chapterBudgetMin: 7,
        chapterBudgetTarget: 10,
        chapterBudgetMax: 14,
        milestones: [
          {
            id: "m-1",
            label: "摸到第一层海雾规律",
            goal: "确认海雾如何吞没记忆。",
            expectedChapterStart: 1,
            expectedChapterEnd: 4,
            status: "planned",
            notes: "",
          },
          {
            id: "m-2",
            label: "拿到黑匣子线索",
            goal: "让调查线进入下一层。",
            expectedChapterStart: 5,
            expectedChapterEnd: 8,
            status: "planned",
            notes: "",
          },
        ],
      },
    ],
    progressState: {
      ...base.progressState,
      latestChapter: 5,
    },
  }, {
    genre: seedProject.genre,
    premise: seedProject.premise,
    completionCriteria: seedProject.completionCriteria,
    latestChapter: 5,
  });

  const milestone = getCurrentMilestone(contract, 6);
  assert.equal(milestone?.id, "m-2");
});
