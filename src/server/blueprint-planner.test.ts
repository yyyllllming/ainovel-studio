import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPlannerAvoidanceDirectives,
  buildDiversityRequirements,
  buildPlannerQualitySummary,
  buildRecoveryBlueprint,
  verifyBlueprintCandidate,
} from "./story/blueprint-planner.ts";
import type {
  BlueprintVerification,
  ChapterBlueprint,
  ChapterDeltaRecord,
  FoundationPayload,
  ProjectStorySeedPatch,
  SegmentPlan,
  StoryProgressState,
} from "./types.ts";

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
    {
      name: "祭痕古地裂缝",
      description: "石壁会回应血气与旧祭。",
    },
  ],
  relationships: [],
};

const segment: SegmentPlan = {
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
      intent: "让姜离闯进祭痕古地裂缝并确认新禁忌。",
      requiredProgressDeltas: ["world_shift"],
      requiredObligations: ["introduce_new_mythic_novelty"],
      focusCharacters: ["姜离"],
      arenaHints: ["祭痕古地裂缝"],
      suggestedActionPattern: null,
      antagonistHint: null,
      forbiddenRecentAxes: [],
    },
    {
      id: "segment-item-2",
      chapterNo: 2,
      title: "第 2 章推进位",
      intent: "让姜离拿到会改写下一步的新线索。",
      requiredProgressDeltas: ["information_shift"],
      requiredObligations: [],
      focusCharacters: ["阿绛"],
      arenaHints: ["古地深层"],
      suggestedActionPattern: null,
      antagonistHint: null,
      forbiddenRecentAxes: [],
    },
    {
      id: "segment-item-3",
      chapterNo: 3,
      title: "第 3 章推进位",
      intent: "让姜离改写当前目标。",
      requiredProgressDeltas: ["objective_shift"],
      requiredObligations: [],
      focusCharacters: ["姜离", "阿绛"],
      arenaHints: ["古祭台"],
      suggestedActionPattern: null,
      antagonistHint: null,
      forbiddenRecentAxes: [],
    },
  ],
};

const recentDeltaRecords: ChapterDeltaRecord[] = [
  {
    id: "delta-1",
    projectId: "proj",
    chapterNo: 1,
    segmentId: segment.id,
    segmentItemId: segment.items[0]?.id ?? null,
    primaryDeltaDelivered: "cost_shift",
    deliveredDeltas: ["cost_shift"],
    storyProgression: {
      risk: "risk",
      score: 20,
      summary: "只有代价，没有推进。",
      advancements: [],
      stallSignals: ["cost_only_progression"],
      primaryDelta: "cost_shift",
      deliveredDeltas: ["cost_shift"],
    },
    genreFulfillment: {
      risk: "watch",
      score: 60,
      summary: "有一点洪荒气，但不够实。",
      present: ["出现怪地气息"],
      missing: ["缺少新的异兽或山海层级抬升"],
      activePacks: ["mythic_beastiary"],
    },
    loopRisk: {
      risk: "watch",
      score: 58,
      summary: "同场景开始重复。",
      repetitionAxes: ["same_arena"],
      stuckDimensions: ["arena_loop"],
    },
    stuckDimensions: ["arena_loop", "cost_only_progression"],
    arenaKey: "断骨山谷",
    objectiveKey: "活着逃出断骨山谷",
    antagonistKey: null,
    actionPattern: null,
    endingMove: null,
    mechanismRevealMode: null,
    motifTokens: [],
    obligationHits: [],
    summary: "还是在逃。",
    createdAt: "2026-03-25T00:00:00.000Z",
  },
  {
    id: "delta-2",
    projectId: "proj",
    chapterNo: 2,
    segmentId: segment.id,
    segmentItemId: segment.items[1]?.id ?? null,
    primaryDeltaDelivered: "cost_shift",
    deliveredDeltas: ["cost_shift"],
    storyProgression: {
      risk: "risk",
      score: 18,
      summary: "继续拖长旧冲突。",
      advancements: [],
      stallSignals: ["cost_only_progression", "arena_loop"],
      primaryDelta: "cost_shift",
      deliveredDeltas: ["cost_shift"],
    },
    genreFulfillment: {
      risk: "risk",
      score: 30,
      summary: "洪荒履约缺失。",
      present: [],
      missing: ["缺少新的异兽、怪地、禁忌生态或山海层级抬升"],
      activePacks: ["mythic_beastiary"],
    },
    loopRisk: {
      risk: "risk",
      score: 26,
      summary: "已经形成循环。",
      repetitionAxes: ["same_arena", "same_objective"],
      stuckDimensions: ["arena_loop", "objective_loop", "cost_only_progression"],
    },
    stuckDimensions: ["arena_loop", "objective_loop", "cost_only_progression"],
    arenaKey: "断骨山谷",
    objectiveKey: "活着逃出断骨山谷",
    antagonistKey: null,
    actionPattern: null,
    endingMove: null,
    mechanismRevealMode: null,
    motifTokens: [],
    obligationHits: [],
    summary: "还是在逃。",
    createdAt: "2026-03-25T00:01:00.000Z",
  },
];

const patch: ProjectStorySeedPatch = {
  arenaClusters: [
    { id: "rim_hunt", label: "外沿猎场", summary: "断崖外沿与猎迹压迫层", hints: ["断骨山谷", "断崖外围"] },
    { id: "living_rule", label: "活山规则层", summary: "会主动收纹、改道、吞响的活山层", hints: ["古祭台", "古地深层"] },
  ],
  opponentClusters: [
    { id: "hunters", label: "追猎者", summary: "沿痕追压的活物或猎手", hints: ["巡山罴影", "攫光妖鹫"] },
    { id: "rules", label: "规则本身", summary: "古禁与环境规则直接施压", hints: ["旧门规则"] },
  ],
  rewardTypes: [
    { id: "clue", label: "线索", description: "拿到会改写下一步的新认知" },
    { id: "access", label: "通行权", description: "获得通路、位置或门槛上的松动" },
  ],
  relationshipProgressions: [],
  badPatterns: [],
  explicitMappings: {
    arenaHints: {
      "断骨山谷": "rim_hunt",
      "古祭台": "living_rule",
      "古地深层": "living_rule",
    },
    antagonists: {
      "巡山罴影": "hunters",
    },
    rewardSignals: {
      "新线索": "clue",
      "改写当前目标": "access",
    },
  },
};

test("verifyBlueprintCandidate rejects generic looping blueprints", () => {
  const blueprint: ChapterBlueprint = {
    chapterNo: 3,
    sceneGoal: "继续推进并活下来",
    characters: ["姜离"],
    locations: ["断骨山谷"],
    conflicts: ["姜离必须继续活下来。"],
    foreshadows: ["后面还有更深的危险。"],
    emotionalTone: "压低声势，逐步绷紧",
    estimatedWords: 2800,
    requiredProgressDelta: "cost_shift",
  };

  const verification = verifyBlueprintCandidate({
    blueprint,
    segmentBinding: { segment, item: segment.items[2]! },
    nextItem: null,
    nextNextItem: null,
    mustAdvance: ["world_shift", "information_shift", "objective_shift"],
    activations: [
      { id: "core-only", source: "auto", active: true, notes: [] },
      { id: "mythic_beastiary", source: "auto", active: true, notes: [] },
    ],
    recentDeltaRecords,
  });

  assert.equal(verification.pass, false);
  assert.equal(verification.reasons.some((reason) => reason.includes("sceneGoal")), true);
  assert.equal(verification.reasons.some((reason) => reason.includes("cost_shift")), true);
  assert.equal(verification.reasons.some((reason) => reason.includes("题材义务")), true);
});

test("buildDiversityRequirements derives structural differences from prior candidates and verifier failures", () => {
  const candidates: ChapterBlueprint[] = [
    {
      chapterNo: 3,
      sceneGoal: "让姜离在断骨山谷继续硬扛追兵。",
      characters: ["姜离"],
      locations: ["断骨山谷"],
      conflicts: ["姜离与追兵正面打斗。"],
      foreshadows: [],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2800,
      requiredProgressDelta: "cost_shift",
    },
    {
      chapterNo: 3,
      sceneGoal: "让姜离在断骨山谷继续夺路硬逃。",
      characters: ["姜离"],
      locations: ["断骨山谷"],
      conflicts: ["姜离继续在旧场景里逃命。"],
      foreshadows: [],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2800,
      requiredProgressDelta: "cost_shift",
    },
  ];
  const verifierResults: BlueprintVerification[] = [
    {
      pass: false,
      score: 1,
      reasons: ["打斗拖长", "同地追逃", "sceneGoal 太泛"],
      futureHookCompleteness: 0,
      loopRiskScore: 1,
      obligationScore: 0,
    },
    {
      pass: false,
      score: 1,
      reasons: ["机缘空壳", "同地追逃"],
      futureHookCompleteness: 0,
      loopRiskScore: 1,
      obligationScore: 0,
    },
  ];

  const diversity = buildDiversityRequirements(candidates, verifierResults, segment.items[2]!);

  assert.deepEqual(diversity.bannedLocations, ["断骨山谷"]);
  assert.equal(diversity.avoidPatterns.includes("打斗拖长"), true);
  assert.equal(diversity.avoidPatterns.includes("同地追逃"), true);
  assert.equal(diversity.requiredFocusCharacter, "阿绛");
  assert.equal(diversity.promptLines.some((line) => line.includes("主冲突类型不能再重复")), true);
});

test("buildPlannerAvoidanceDirectives is available from blueprint-planner and keeps patched labels", () => {
  const progressState: StoryProgressState = {
    latestChapter: 2,
    recentPrimaryDeltas: ["information_shift", "objective_shift"],
    recentArenaKeys: ["断骨山谷", "断骨山谷"],
    recentObjectiveKeys: ["保命脱困", "保命脱困"],
    stuckDimensions: ["arena_loop", "objective_loop", "antagonist_loop"],
    mustAdvance: ["world_shift", "information_shift", "objective_shift"],
    recentAntagonistKeys: ["巡山罴影", "巡山罴影"],
    recentActionPatterns: ["pursuit", "pursuit"],
    recentEndingMoves: [],
    recentMechanismRevealModes: [],
    recentMotifWindows: [["骨壁", "残印"], ["骨壁", "残印"]],
    consumedFutureBeats: [],
    updatedAt: "2026-03-25T00:00:00.000Z",
  };

  const directives = buildPlannerAvoidanceDirectives({
    progressState,
    patch,
    recentDeltaRecords,
  });

  assert.equal(directives.hardAvoid.some((line) => line.includes("外沿猎场")), true);
  assert.equal(directives.hardAvoid.some((line) => line.includes("追猎者")), true);
  assert.equal(directives.softAvoid.some((line) => line.includes("骨壁")), true);
});

test("buildRecoveryBlueprint inherits segment item constraints instead of generic survival shell", () => {
  const { blueprint: fallback } = buildRecoveryBlueprint({
    chapterNo: 3,
    foundation,
    segmentBinding: { segment, item: segment.items[2]! },
    leadCharacterName: "姜离",
    currentVolumeGoal: "改写当前目标",
    estimatedWords: 3000,
    defaultProgressDelta: "information_shift",
  });

  assert.equal(fallback.segmentId, segment.id);
  assert.equal(fallback.segmentItemId, segment.items[2]?.id);
  assert.equal(fallback.requiredProgressDelta, "objective_shift");
  assert.deepEqual(fallback.locations, ["古祭台"]);
  assert.match(fallback.sceneGoal, /改写当前目标|objective_shift/);
  assert.doesNotMatch(fallback.sceneGoal, /活下来|带出去|追逃/u);
});

test("buildPlannerQualitySummary condenses traceable planner metrics", () => {
  const summary = buildPlannerQualitySummary({
    candidateAttempts: [
      {
        attemptNo: 1,
        promptSummary: "candidate 1",
        rawContent: "{}",
        candidate: null,
        verification: {
          pass: false,
          score: 1,
          reasons: ["sceneGoal 太泛"],
          futureHookCompleteness: 0,
          loopRiskScore: 0,
          obligationScore: 0,
        },
        diversityRequirements: null,
      },
      {
        attemptNo: 2,
        promptSummary: "candidate 2",
        rawContent: "{}",
        candidate: {
          chapterNo: 3,
          sceneGoal: "让姜离闯进古祭台并改写目标。",
          characters: ["姜离", "阿绛"],
          locations: ["古祭台"],
          conflicts: ["姜离必须先确认古祭台会如何回应血气。"],
          foreshadows: ["更深处还有会回响的禁则。"],
          emotionalTone: "压低声势，逐步绷紧",
          estimatedWords: 3000,
          requiredProgressDelta: "objective_shift",
        },
        verification: {
          pass: true,
          score: 5,
          reasons: [],
          futureHookCompleteness: 2,
          loopRiskScore: 2,
          obligationScore: 1,
        },
        diversityRequirements: null,
      },
    ],
    selectedScore: 5,
    selectedReason: "score=5 / futureHook=2",
    repairUsed: true,
    fallbackUsed: false,
  });

  assert.deepEqual(summary, {
    candidateAttempts: 2,
    selectedScore: 5,
    selectedReason: "score=5 / futureHook=2",
    repairUsed: true,
    fallbackUsed: false,
    usedRecoveryBlueprint: false,
    failureReasons: ["sceneGoal 太泛"],
  });
});

test("buildRecoveryBlueprint avoids arena_loop arena when progressState signals loop", () => {
  const { blueprint: fallback } = buildRecoveryBlueprint({
    chapterNo: 3,
    foundation,
    segmentBinding: null,
    leadCharacterName: "姜离",
    currentVolumeGoal: "改写当前目标",
    estimatedWords: 3000,
    defaultProgressDelta: "information_shift",
    progressState: {
      latestChapter: 2,
      recentPrimaryDeltas: ["cost_shift", "cost_shift"],
      recentArenaKeys: ["断骨山谷", "断骨山谷"],
      recentObjectiveKeys: ["活着逃出断骨山谷", "活着逃出断骨山谷"],
      stuckDimensions: ["arena_loop", "objective_loop"],
      mustAdvance: ["world_shift", "information_shift", "objective_shift"],
      recentAntagonistKeys: [],
      recentActionPatterns: [],
      recentEndingMoves: [],
      recentMechanismRevealModes: [],
      recentMotifWindows: [],
      updatedAt: "2026-03-25T00:00:00.000Z",
    },
  });

  assert.notEqual(fallback.locations[0], "断骨山谷");
  assert.equal(
    ["world_shift", "information_shift", "objective_shift"].includes(fallback.requiredProgressDelta!),
    true,
    `requiredProgressDelta should be one of mustAdvance, got: ${fallback.requiredProgressDelta}`,
  );
});

test("buildRecoveryBlueprint switches action when combat_loop", () => {
  const { blueprint: fallback } = buildRecoveryBlueprint({
    chapterNo: 3,
    foundation,
    segmentBinding: { segment, item: { ...segment.items[2]!, suggestedActionPattern: "combat", antagonistHint: null, forbiddenRecentAxes: [] } },
    leadCharacterName: "姜离",
    currentVolumeGoal: "改写当前目标",
    estimatedWords: 3000,
    defaultProgressDelta: "power_shift",
    progressState: {
      latestChapter: 2,
      recentPrimaryDeltas: ["power_shift", "power_shift"],
      recentArenaKeys: ["断骨山谷"],
      recentObjectiveKeys: [],
      stuckDimensions: ["combat_loop", "action_loop"],
      mustAdvance: ["objective_shift", "world_shift", "information_shift"],
      recentAntagonistKeys: [],
      recentActionPatterns: ["combat"],
      recentEndingMoves: [],
      recentMechanismRevealModes: [],
      recentMotifWindows: [],
      updatedAt: "2026-03-25T00:00:00.000Z",
    },
  });

  assert.notEqual(fallback.actionPattern, "combat");
  assert.notEqual(fallback.requiredProgressDelta, "power_shift");
});

test("buildRecoveryBlueprint can borrow a later beat and record recovery shifts", () => {
  const fallback = buildRecoveryBlueprint({
    chapterNo: 3,
    foundation,
    segmentBinding: {
      segment,
      item: {
        ...segment.items[0]!,
        arenaClusterId: "outer_hunt",
        opponentClusterId: "hunters",
        rewardType: "clue",
      },
    },
    nextItem: {
      ...segment.items[1]!,
      arenaClusterId: "living_rule",
      opponentClusterId: "environment_rule",
      rewardType: "access",
    },
    nextNextItem: null,
    leadCharacterName: "姜离",
    currentVolumeGoal: "改写当前目标",
    estimatedWords: 3000,
    defaultProgressDelta: "information_shift",
    progressState: {
      latestChapter: 2,
      recentPrimaryDeltas: ["cost_shift", "cost_shift"],
      recentArenaKeys: ["断骨山谷", "断骨山谷"],
      recentObjectiveKeys: ["活着逃出断骨山谷", "活着逃出断骨山谷"],
      stuckDimensions: ["arena_loop", "antagonist_loop", "objective_loop"],
      mustAdvance: ["world_shift", "information_shift", "objective_shift"],
      recentAntagonistKeys: ["巡山罴影", "巡山罴影"],
      recentActionPatterns: [],
      recentEndingMoves: [],
      recentMechanismRevealModes: [],
      recentMotifWindows: [],
      consumedFutureBeats: [],
      updatedAt: "2026-03-25T00:00:00.000Z",
    },
  });

  assert.equal(fallback.blueprint.segmentItemId, segment.items[1]!.id);
  assert.equal(fallback.blueprint.arenaClusterId, "living_rule");
  assert.equal(fallback.blueprint.rewardType, "access");
  assert.equal(fallback.recoveryShifts.some((entry) => entry === "arena:outer_hunt->living_rule"), true);
  assert.equal(fallback.recoveryShifts.some((entry) => entry === "opponent:hunters->environment_rule"), true);
  assert.equal(fallback.recoveryShifts.some((entry) => entry === "reward:clue->access"), true);
  assert.equal(fallback.recoveryShifts.some((entry) => entry === `consume:${segment.items[1]!.id}`), true);
});
