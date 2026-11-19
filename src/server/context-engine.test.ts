import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFutureContext, buildObligationCardDeck, buildPlannerContextSummary } from "./run/context-engine.ts";
import type { ChapterPlan, CharacterSnapshot, FoundationPayload, LogicStateSnapshot, StoryContract } from "./types.ts";
import { getDefaultBudget } from "./run/context-engine.ts";

test("default context budget never exceeds the model budget and keeps output reserve outside input", () => {
  const budget = getDefaultBudget();
  const total = Object.values(budget).reduce((sum, value) => sum + value, 0);
  const input = total - budget.outputReserve;
  assert.equal(total <= 128_000, true);
  assert.equal(input <= 128_000 - budget.outputReserve, true);
});

const foundation: FoundationPayload = {
  premise: "姜离误入山海古地，沿着异兽遗痕追查更深的禁忌。",
  styleCard: "荒古、凶险、山川有灵",
  characters: [
    {
      name: "姜离",
      role: "protagonist",
      goal: "追查古地禁忌的源头，并活着带出线索。",
      traits: ["谨慎", "狠劲"],
    },
    {
      name: "阿绛",
      role: "ally",
      goal: "守住部族祭痕，不让古地失控。",
      traits: ["冷静", "敏锐"],
    },
  ],
  worldview: [
    {
      name: "断骨山谷",
      description: "山风会在夜里反向流动，谷中常有异兽骨鸣。",
    },
  ],
  relationships: [],
};

const storyContract: StoryContract = {
  volumes: [],
  currentVolume: 1,
  globalArc: "追查古地禁忌。",
  endingPromise: "掀开古地深处的更高禁忌。",
  completionChecks: ["找到古地源头"],
  storyPromises: [],
  activeProgressionAxes: ["situation_shift", "information_shift", "objective_shift"],
  genreObligationPacks: [
    { id: "core-only", source: "auto", active: true, notes: [] },
    { id: "mythic_beastiary", source: "auto", active: true, notes: [] },
  ],
  segmentPlans: [
    {
      id: "segment-1-6",
      label: "第 1-6 章段落计划",
      startChapter: 1,
      endChapter: 6,
      status: "active",
      trigger: "seed",
      generatedAt: "2026-03-25T00:00:00.000Z",
      items: [
        {
          id: "segment-item-1",
          chapterNo: 1,
          title: "第 1 章推进位",
          intent: "让姜离进入新层面。",
          requiredProgressDeltas: ["world_shift"],
          requiredObligations: ["introduce_new_mythic_novelty"],
          focusCharacters: ["姜离"],
          arenaHints: ["断骨山谷"],
          suggestedActionPattern: null,
          antagonistHint: null,
          forbiddenRecentAxes: [],
        },
        {
          id: "segment-item-2",
          chapterNo: 2,
          title: "第 2 章推进位",
          intent: "让姜离拿到新线索。",
          requiredProgressDeltas: ["information_shift"],
          requiredObligations: [],
          focusCharacters: ["姜离", "阿绛"],
          arenaHints: ["祭痕古地裂缝"],
          suggestedActionPattern: null,
          antagonistHint: null,
          forbiddenRecentAxes: [],
        },
        {
          id: "segment-item-3",
          chapterNo: 3,
          title: "第 3 章推进位",
          intent: "让姜离确认更深禁忌。",
          requiredProgressDeltas: ["world_shift"],
          requiredObligations: ["introduce_new_mythic_novelty"],
          focusCharacters: ["阿绛"],
          arenaHints: ["古地深层"],
          suggestedActionPattern: null,
          antagonistHint: null,
          forbiddenRecentAxes: [],
        },
      ],
    },
  ],
  progressState: {
    latestChapter: 2,
    recentPrimaryDeltas: ["cost_shift", "information_shift"],
    recentArenaKeys: ["断骨山谷", "断骨山谷"],
    recentObjectiveKeys: ["活着逃出断骨山谷", "活着逃出断骨山谷"],
    stuckDimensions: ["arena_loop", "objective_loop", "cost_only_progression"],
    mustAdvance: ["world_shift", "information_shift", "objective_shift"],
    recentAntagonistKeys: [],
    recentActionPatterns: [],
    recentEndingMoves: [],
    recentMechanismRevealModes: [],
    recentMotifWindows: [],
    updatedAt: "2026-03-25T00:00:00.000Z",
  },
  forecast: {
    min: 20,
    target: 50,
    max: 60,
    finalRunReady: false,
    completionProgress: 0.1,
    nextMilestone: "进入古地深层",
  },
  recentPlan: [],
  updatedAt: "2026-03-25T00:00:00.000Z",
};

test("buildFutureContext includes next chapter requirements and avoidance list", () => {
  const result = buildFutureContext({
    storyContract,
    chapterNo: 1,
  });
  const text = result.text;

  assert.match(text, /下一章（第2章）/);
  assert.match(text, /必须推进：information_shift/);
  assert.match(text, /不要再把本章主场景压回「断骨山谷」同一场域/);
  assert.match(text, /不要继续围着「活着逃出断骨山谷」同一目标打转/);
  assert.match(text, /不要只靠受伤、硬撑、逃命或付代价来充当本章推进/);
});

test("buildFutureContext keeps next hook visible without letting narrative fields leak into planning text", () => {
  const narrativeContract: StoryContract = {
    ...storyContract,
    segmentPlans: [
      {
        ...storyContract.segmentPlans[0]!,
        items: storyContract.segmentPlans[0]!.items.map((item) =>
          item.chapterNo === 2
            ? {
                ...item,
                narrativeTitle: "石壁后第一次回响",
                narrativeIntent: "让姜离先撞上会改写判断的新异动。",
                nextHook: "古地更深处的回响会逼他改换路线。",
              }
            : item,
        ),
      },
    ],
  };

  const result = buildFutureContext({
    storyContract: narrativeContract,
    chapterNo: 1,
  });

  assert.doesNotMatch(result.text, /石壁后第一次回响/);
  assert.doesNotMatch(result.text, /让姜离先撞上会改写判断的新异动/);
  assert.match(result.text, /古地更深处的回响会逼他改换路线/);
});

test("buildFutureContext and planner summary keep planning fields on the skeleton layer", () => {
  const narrativeContract: StoryContract = {
    ...storyContract,
    segmentPlans: [
      {
        ...storyContract.segmentPlans[0]!,
        items: storyContract.segmentPlans[0]!.items.map((item) =>
          item.chapterNo === 2
            ? {
                ...item,
                narrativeTitle: "石壁后第一次回响",
                narrativeIntent: "让姜离先撞上会改写判断的新异动。",
                nextHook: "古地更深处的回响会逼他改换路线。",
              }
            : item,
        ),
      },
    ],
  };

  const future = buildFutureContext({
    storyContract: narrativeContract,
    chapterNo: 1,
  });
  const plannerSummary = buildPlannerContextSummary({
    foundation,
    storyContract: narrativeContract,
    chapterNo: 2,
    previousBriefSummary: "姜离顺着裂缝下探，听见石壁回应血气的异响。",
    previousDetailedSummary: null,
    latestSnapshot: null,
    logicState: null,
  });

  assert.match(future.text, /标题：第 2 章推进位/);
  assert.match(future.text, /意图：让姜离拿到新线索/);
  assert.doesNotMatch(future.text, /石壁后第一次回响/);
  assert.doesNotMatch(plannerSummary, /让姜离先撞上会改写判断的新异动/);
  assert.match(plannerSummary, /当前段落意图：让姜离拿到新线索/);
});

test("buildObligationCardDeck keeps skeleton intent while writer compact lines can keep narrative phrasing", () => {
  const narrativeContract: StoryContract = {
    ...storyContract,
    segmentPlans: [
      {
        ...storyContract.segmentPlans[0]!,
        items: storyContract.segmentPlans[0]!.items.map((item) =>
          item.chapterNo === 2
            ? {
                ...item,
                narrativeIntent: "让姜离先撞上会改写判断的新异动。",
              }
            : item,
        ),
      },
    ],
  };

  const future = buildFutureContext({
    storyContract: narrativeContract,
    chapterNo: 1,
  });
  const cards = buildObligationCardDeck({
    storyContract: narrativeContract,
    chapterNo: 1,
    futureContextText: future.text,
  });

  assert.equal(cards.some((card) => card.canHint.includes("让姜离拿到新线索")), true);
  assert.equal(cards.some((card) => card.canHint.includes("让姜离先撞上会改写判断的新异动")), false);
});

test("buildPlannerContextSummary prefers actual events and end-state over review meta", () => {
  const snapshot: CharacterSnapshot = {
    chapterNo: 1,
    characters: {
      姜离: {
        location: "断骨山谷北侧裂缝",
        currentGoal: "摸清石壁回响的来源",
        currentPressure: "被旧追迹者顺着血气逼近",
        emotion: "绷紧",
      },
    },
  };
  const logicState: LogicStateSnapshot = {
    chapterNo: 1,
    relationshipDeltas: [],
    timeMarker: "夜半",
    unresolvedPromises: [
      {
        description: "赤钩热痕真正连着哪一道禁忌",
        plantedChapter: 1,
        status: "open",
      },
    ],
    pendingConsequences: ["血气暴露会引来更深处的东西"],
  };

  const summary = buildPlannerContextSummary({
    foundation,
    storyContract,
    chapterNo: 2,
    previousBriefSummary: "姜离顺着裂缝下探，听见石壁回应血气的异响。",
    previousDetailedSummary: null,
    latestSnapshot: snapshot,
    logicState,
  });

  assert.match(summary, /上一章实际发生：姜离顺着裂缝下探/);
  assert.match(summary, /姜离：位置=断骨山谷北侧裂缝；目标=摸清石壁回响的来源；压力=被旧追迹者顺着血气逼近/);
  assert.match(summary, /待延续后果：血气暴露会引来更深处的东西/);
  assert.doesNotMatch(summary, /quick-audit|审稿结论/u);
});

test("buildPlannerContextSummary injects current ChapterPlan and previous continuation anchor ahead of weak segment text", () => {
  const currentChapterPlan: ChapterPlan = {
    projectId: "project-a",
    chapterNo: 2,
    purpose: "确认石壁异响和赤钩热痕其实指向同一处禁口。",
    plotSummary: "姜离先接住上章血气暴露的后果，再借阿绛的判断把假线索剥开，最终锁定真正禁口。",
    requiredBeats: ["接住血气暴露后果", "剥开假线索", "锁定禁口"],
    keyEvents: ["旧追迹者逼近", "阿绛指出石壁回响的错位", "姜离确认禁口方位"],
    characterFocus: ["姜离", "阿绛"],
    relationshipShift: "姜离开始把关键判断交给阿绛验证。",
    worldRuleUsage: ["石壁回响会错放血气来源"],
    continuationAnchor: "两人带着禁口方位立刻转入更深层裂缝。",
    nextHook: "更深层裂缝里提前有人等着截杀。",
    hookSlots: [
      {
        setupText: "更深层裂缝里提前有人等着截杀。",
        payoffWindow: [3, 5],
        priority: "medium",
        planIntent: "active",
      },
    ],
    payoffTargets: ["第3章揭出截杀者来路"],
    riskFlags: ["hook_debt"],
    riskComment: "",
    status: "ready",
    source: "generated",
    foundationDigest: "foundation",
    storyContractDigest: "story",
    inputDigest: "input",
    generationId: 2,
    generationState: "ready",
    generationToken: null,
    generationStartedAt: null,
    usedSegmentSummaryFallback: false,
    segmentId: "segment-1-6",
    segmentItemId: "segment-item-2",
    createdAt: "2026-04-09T00:00:00.000Z",
    updatedAt: "2026-04-09T00:00:01.000Z",
  };

  const summary = buildPlannerContextSummary({
    foundation,
    storyContract,
    chapterNo: 2,
    previousBriefSummary: "姜离顺着裂缝下探，听见石壁回应血气的异响。",
    previousDetailedSummary: null,
    latestSnapshot: null,
    currentChapterPlan,
    recentChapterPlansSummary: ["第1章 | plot=姜离先活下来，再摸到第一层禁忌边缘 | nextHook=石壁回应血气"],
    previousContinuationAnchor: "血气暴露会立刻把更深处的东西引来。",
    logicState: {
      chapterNo: 1,
      relationshipDeltas: [],
      timeMarker: "",
      unresolvedPromises: [],
      pendingConsequences: [],
      hookDiagnostics: {
        chapterNo: 1,
        plannedCount: 1,
        boundCount: 1,
        missingSetupCount: 0,
        duplicateCount: 0,
        overdueCount: 0,
        deadCount: 0,
        items: [],
      },
    },
  });

  assert.match(summary, /当前章主任务：确认石壁异响和赤钩热痕其实指向同一处禁口/);
  assert.match(summary, /上一章 continuationAnchor：血气暴露会立刻把更深处的东西引来/);
  assert.match(summary, /最近章节规划摘要：第1章 \| plot=姜离先活下来/);
  assert.match(summary, /本章章末承接：两人带着禁口方位立刻转入更深层裂缝/);
  assert.match(summary, /Hook诊断：planned=1 \/ bound=1 \/ debt=0 \/ overdue=0 \/ dead=0/);
});

test("buildPlannerContextSummary surfaces actionable hook diagnostics instead of only aggregate counters", () => {
  const summary = buildPlannerContextSummary({
    foundation,
    storyContract,
    chapterNo: 6,
    previousBriefSummary: "姜离踩进更深层裂缝后，发现卷轴最后一页仍在轻微呼吸。",
    previousDetailedSummary: null,
    latestSnapshot: null,
    logicState: {
      chapterNo: 5,
      relationshipDeltas: [],
      timeMarker: "",
      unresolvedPromises: [],
      pendingConsequences: ["活体封印随时可能挣脱卷轴"],
      hookDiagnostics: {
        chapterNo: 5,
        plannedCount: 3,
        boundCount: 2,
        missingSetupCount: 1,
        duplicateCount: 1,
        overdueCount: 1,
        deadCount: 0,
        items: [
          {
            hookPlanId: "hook-missing",
            setupChapter: 3,
            setupText: "灯塔里的密信会暴露真正的内鬼。",
            priority: "medium",
            payoffWindowStartChapter: 4,
            payoffWindowEndChapter: 5,
            setupState: "missing",
            setupEvidenceChapter: null,
            setupEvidenceText: null,
            setupEvidenceKind: null,
            payoffState: "none",
            payoffEvidenceChapter: null,
            payoffEvidenceText: null,
            payoffEvidenceKind: null,
            duplicateOfHookPlanId: null,
            duplicateEvidenceText: null,
            overdue: false,
            dead: false,
          },
          {
            hookPlanId: "hook-overdue",
            setupChapter: 4,
            setupText: "岚柔带走的骨片其实会反噬持有者。",
            priority: "high",
            payoffWindowStartChapter: 5,
            payoffWindowEndChapter: 5,
            setupState: "bound",
            setupEvidenceChapter: 4,
            setupEvidenceText: "岚柔带走的骨片其实会反噬持有者。",
            setupEvidenceKind: "binding",
            payoffState: "none",
            payoffEvidenceChapter: null,
            payoffEvidenceText: null,
            payoffEvidenceKind: null,
            duplicateOfHookPlanId: null,
            duplicateEvidenceText: null,
            overdue: true,
            dead: false,
          },
          {
            hookPlanId: "hook-candidate",
            setupChapter: 5,
            setupText: "卷轴最后一页的活体封印仍在轻微呼吸。",
            priority: "medium",
            payoffWindowStartChapter: 6,
            payoffWindowEndChapter: 8,
            setupState: "bound",
            setupEvidenceChapter: 5,
            setupEvidenceText: "卷轴最后一页的活体封印仍在轻微呼吸。",
            setupEvidenceKind: "binding",
            payoffState: "candidate",
            payoffEvidenceChapter: 6,
            payoffEvidenceText: "卷轴最后一页真的开始呼吸，并试图挣脱活体封印。",
            payoffEvidenceKind: "canon_fact",
            duplicateOfHookPlanId: "hook-earlier",
            duplicateEvidenceText: "卷轴最后一页的活体封印还在呼吸。",
            overdue: false,
            dead: false,
          },
        ],
      },
    },
  });

  assert.match(summary, /Hook诊断：planned=3 \/ bound=2 \/ debt=1 \/ overdue=1 \/ dead=0/);
  assert.match(summary, /Hook关注项：/);
  assert.match(summary, /还没有稳定 setup evidence/);
  assert.match(summary, /已超过预计回收窗口/);
  assert.match(summary, /疑似回收证据/);
});

test("buildFutureContext tolerates legacy segment items without new planning fields", () => {
  const legacyContract = {
    ...storyContract,
    segmentPlans: [
      {
        ...storyContract.segmentPlans[0]!,
        items: storyContract.segmentPlans[0]!.items.map((item) => {
          const {
            suggestedActionPattern,
            antagonistHint,
            forbiddenRecentAxes,
            ...legacy
          } = item;
          void suggestedActionPattern;
          void antagonistHint;
          void forbiddenRecentAxes;
          return legacy;
        }),
      },
    ],
  } as unknown as StoryContract;

  const result = buildFutureContext({
    storyContract: legacyContract,
    chapterNo: 1,
  });

  assert.match(result.text, /下一章（第2章）/);
  assert.match(result.text, /必须推进：information_shift/);
});

test("buildObligationCardDeck trims future context into obligation cards", () => {
  const future = buildFutureContext({
    storyContract,
    chapterNo: 1,
  });
  const cards = buildObligationCardDeck({
    storyContract,
    chapterNo: 1,
    futureContextText: future.text,
  });

  assert.equal(cards.length > 0, true);
  assert.equal(cards.some((card) => card.mustHold.includes("world_shift") || card.canHint.includes("让姜离拿到新线索")), true);
  assert.equal(cards.some((card) => card.doNotRepeat.includes("不要")), true);
});

test("assembleContextPack uses foreshadow shortlist state lookup instead of preloading the full ledger", async () => {
  const source = await readFile(
    resolve(dirname(fileURLToPath(import.meta.url)), "./run/context-engine.ts"),
    "utf8",
  );

  assert.match(source, /readForeshadowLedgerStateMap/u);
  assert.doesNotMatch(source, /readForeshadowEntries\(projectId\)/u);
});
