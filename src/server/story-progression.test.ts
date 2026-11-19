import test from "node:test";
import assert from "node:assert/strict";
import {
  assessBlueprintProgressRisk,
  buildChapterDeltaRecord,
  buildLoopRiskAssessment,
  buildSegmentPlans,
  deriveStoryProgressState,
  getSegmentDisplayIntent,
  getSegmentDisplayTitle,
  inferActionPattern,
  getSegmentPlanItemForChapter,
  normalizeSegmentPlanItem,
  suggestGenreObligationPacks,
} from "./story/story-progression.ts";
import type { ChapterBlueprint, ChapterDeltaRecord, FoundationPayload } from "./types.ts";

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
      name: "祭痕古地",
      description: "石壁会回应血气与旧祭，留下会迁徙的兽纹残光。",
    },
    {
      name: "山海禁则",
      description: "越靠近古地深处，旧时代留下的禁则越会主动回响。",
    },
  ],
  relationships: [
    {
      source: "姜离",
      target: "阿绛",
      label: "互相利用但逐渐建立信任",
    },
  ],
};

test("suggestGenreObligationPacks auto-activates mythic pack for mythic premises", () => {
  const packs = suggestGenreObligationPacks({
    genre: "玄幻修仙",
    premise: "这是一个山海经与洪荒异兽交织的故事，山川有灵。",
    foundation,
  });

  assert.deepEqual(
    packs.map((entry) => entry.id),
    ["core-only", "mythic_beastiary"],
  );
});

test("buildSegmentPlans seeds two six-chapter rolling segments with required deltas", () => {
  const activations = suggestGenreObligationPacks({
    genre: "玄幻修仙",
    premise: foundation.premise,
    foundation,
  });
  const segments = buildSegmentPlans({
    startingChapter: 1,
    currentVolumeGoal: "查清祭痕古地为何主动回应姜离。",
    endingPromise: "掀开古地深处的更高禁忌。",
    foundation,
    activations,
  });

  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.startChapter, 1);
  assert.equal(segments[0]?.endChapter, 6);
  assert.equal(segments[1]?.startChapter, 7);
  assert.equal(segments[0]?.items.length, 6);
  assert.equal(segments[0]?.items.every((item) => item.requiredProgressDeltas.length >= 1), true);
  assert.equal(
    segments[0]?.items.some((item) => item.requiredObligations.includes("introduce_new_mythic_novelty")),
    true,
  );
});

test("assessBlueprintProgressRisk fails cost-only loop chapters", () => {
  const recentDeltaRecords: ChapterDeltaRecord[] = [
    {
      id: "delta-5",
      projectId: "proj",
      chapterNo: 5,
      segmentId: "segment-1-6",
      segmentItemId: "segment-item-5",
      primaryDeltaDelivered: "cost_shift",
      deliveredDeltas: ["cost_shift"],
      storyProgression: {
        risk: "risk",
        score: 28,
        summary: "只在付代价，没有推进。",
        advancements: [],
        stallSignals: ["cost_only_progression"],
        primaryDelta: "cost_shift",
        deliveredDeltas: ["cost_shift"],
      },
      genreFulfillment: null,
      loopRisk: {
        risk: "watch",
        score: 58,
        summary: "开始重复同一目标。",
        repetitionAxes: ["same_objective"],
        stuckDimensions: ["objective_loop"],
      },
      stuckDimensions: ["objective_loop"],
      arenaKey: "断骨山谷",
      objectiveKey: "活着逃出断骨山谷",
      antagonistKey: null,
      actionPattern: null,
      endingMove: null,
      mechanismRevealMode: null,
      motifTokens: [],
      obligationHits: [],
      summary: "只是在逃。",
      createdAt: "2026-03-25T00:00:00.000Z",
    },
    {
      id: "delta-6",
      projectId: "proj",
      chapterNo: 6,
      segmentId: "segment-1-6",
      segmentItemId: "segment-item-6",
      primaryDeltaDelivered: "cost_shift",
      deliveredDeltas: ["cost_shift"],
      storyProgression: {
        risk: "risk",
        score: 20,
        summary: "继续在旧冲突里打转。",
        advancements: [],
        stallSignals: ["cost_only_progression", "objective_loop"],
        primaryDelta: "cost_shift",
        deliveredDeltas: ["cost_shift"],
      },
      genreFulfillment: null,
      loopRisk: {
        risk: "risk",
        score: 28,
        summary: "已经形成循环。",
        repetitionAxes: ["same_arena", "same_objective"],
        stuckDimensions: ["arena_loop", "objective_loop"],
      },
      stuckDimensions: ["arena_loop", "objective_loop"],
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
  const blueprint: ChapterBlueprint = {
    chapterNo: 7,
    sceneGoal: "让姜离继续在断骨山谷里硬扛旧追兵。",
    characters: ["姜离"],
    locations: ["断骨山谷"],
    conflicts: ["姜离必须继续在断骨山谷活下来。"],
    foreshadows: ["后面还有更深的危险。"],
    emotionalTone: "压低声势，逐步绷紧",
    estimatedWords: 2800,
    requiredProgressDelta: "cost_shift",
  };

  const risk = assessBlueprintProgressRisk({
    blueprint,
    recentDeltaRecords,
    activations: suggestGenreObligationPacks({
      genre: "玄幻修仙",
      premise: foundation.premise,
      foundation,
    }),
    mustAdvance: ["world_shift", "information_shift", "objective_shift"],
  });

  assert.equal(risk.severity, "fail");
  assert.equal(risk.storyProgression.risk, "risk");
  assert.equal(risk.loopRisk.risk, "risk");
  assert.equal(risk.notes.some((entry) => entry.includes("不能只写 cost_shift")), true);
});

test("chapter delta records feed story progress state and mustAdvance", () => {
  const firstBlueprint: ChapterBlueprint = {
    chapterNo: 1,
    sceneGoal: "让姜离进入祭痕古地更深处并确认新禁忌。",
    characters: ["姜离", "阿绛"],
    locations: ["祭痕古地"],
    conflicts: ["姜离必须先确认石壁回响的禁则。"],
    foreshadows: ["更深处还有会回应血气的旧祭。"],
    emotionalTone: "压低声势，逐步绷紧",
    estimatedWords: 3000,
    segmentId: "segment-1-6",
    segmentItemId: "segment-item-1",
    requiredProgressDelta: "world_shift",
  };

  const secondBlueprint: ChapterBlueprint = {
    ...firstBlueprint,
    chapterNo: 2,
    segmentItemId: "segment-item-2",
    requiredProgressDelta: "information_shift",
  };

  const first = buildChapterDeltaRecord({
    projectId: "proj",
    chapterNo: 1,
    blueprint: firstBlueprint,
    activations: suggestGenreObligationPacks({
      genre: "玄幻修仙",
      premise: foundation.premise,
      foundation,
    }),
    recentDeltaRecords: [],
  });
  const second = buildChapterDeltaRecord({
    projectId: "proj",
    chapterNo: 2,
    blueprint: secondBlueprint,
    activations: suggestGenreObligationPacks({
      genre: "玄幻修仙",
      premise: foundation.premise,
      foundation,
    }),
    recentDeltaRecords: [first],
  });

  const state = deriveStoryProgressState([first, second]);

  assert.equal(state.latestChapter, 2);
  assert.deepEqual(state.recentPrimaryDeltas, ["world_shift", "information_shift"]);
  assert.equal(state.mustAdvance.includes("information_shift"), true);
  assert.equal(first.genreFulfillment?.activePacks.includes("mythic_beastiary"), true);
  assert.equal(second.storyProgression.primaryDelta, "information_shift");
});

test("getSegmentPlanItemForChapter hydrates missing legacy fields", () => {
  const legacySegment = {
    id: "segment-legacy",
    label: "旧段落",
    startChapter: 1,
    endChapter: 6,
    status: "active" as const,
    trigger: "seed" as const,
    generatedAt: "2026-03-25T00:00:00.000Z",
    items: [
      {
        id: "segment-item-legacy-1",
        chapterNo: 1,
        title: "旧推进位",
        intent: "让姜离先摸清骨鸣来源。",
        requiredProgressDeltas: ["information_shift"],
        requiredObligations: [],
        focusCharacters: ["姜离"],
        arenaHints: ["断骨山谷"],
      },
    ],
  } as unknown as import("./types.ts").SegmentPlan;

  const binding = getSegmentPlanItemForChapter([legacySegment], 1);

  assert.ok(binding);
  assert.equal(binding?.item.suggestedActionPattern, null);
  assert.equal(binding?.item.antagonistHint, null);
  assert.deepEqual(binding?.item.forbiddenRecentAxes, []);
});

test("normalizeSegmentPlanItem backfills new cluster and reward fields", () => {
  const normalized = normalizeSegmentPlanItem({
    id: "segment-item-legacy-2",
    chapterNo: 2,
    title: "旧推进位 2",
    intent: "让姜离换一个路口继续往里探。",
    requiredProgressDeltas: ["information_shift"],
    requiredObligations: [],
    focusCharacters: ["姜离"],
    arenaHints: ["断骨山谷深处"],
    suggestedActionPattern: null,
    antagonistHint: null,
    forbiddenRecentAxes: [],
  } as unknown as import("./types.ts").SegmentPlanItem);

  assert.equal(normalized.arenaClusterId, null);
  assert.equal(normalized.opponentClusterId, null);
  assert.equal(normalized.rewardType, null);
  assert.equal(normalized.relationshipBeatId, null);
  assert.equal(normalized.narrativeTitle, null);
  assert.equal(normalized.narrativeIntent, null);
  assert.equal(normalized.nextHook, null);
  assert.equal(normalized.rewriteStatus, "pending");
  assert.equal(normalized.userOverridden, false);
});

test("segment display helpers prefer narrative fields and fall back to skeleton", () => {
  const rewritten = normalizeSegmentPlanItem({
    id: "segment-item-3",
    chapterNo: 3,
    title: "第 3 章推进位",
    intent: "让姜离改写当前目标。",
    narrativeTitle: "夜里逼近古祭台",
    narrativeIntent: "让姜离先碰见能迫使他改线的真正阻力。",
    narrativeSummary: null,
    arcConnection: null,
    nextHook: "石壁后的旧祭回响会把他推向更深层。",
    requiredProgressDeltas: ["objective_shift"],
    requiredObligations: [],
    focusCharacters: ["姜离"],
    arenaHints: ["古祭台"],
    suggestedActionPattern: null,
    antagonistHint: null,
    forbiddenRecentAxes: [],
  } as unknown as import("./types.ts").SegmentPlanItem);

  assert.equal(getSegmentDisplayTitle(rewritten), "夜里逼近古祭台");
  assert.equal(getSegmentDisplayIntent(rewritten), "让姜离先碰见能迫使他改线的真正阻力。");

  const skeletonOnly = normalizeSegmentPlanItem({
    ...rewritten,
    narrativeTitle: null,
    narrativeIntent: null,
  });
  assert.equal(getSegmentDisplayTitle(skeletonOnly), "第 3 章推进位");
  assert.equal(getSegmentDisplayIntent(skeletonOnly), "让姜离改写当前目标。");
});

test("buildChapterDeltaRecord extracts motif tokens from accepted chapter content", () => {
  const blueprint: ChapterBlueprint = {
    chapterNo: 3,
    sceneGoal: "让姜离确认祭痕古地更深处的禁忌回响。",
    characters: ["姜离", "阿绛"],
    locations: ["祭痕古地"],
    conflicts: ["姜离必须先摸清祭痕回响为何会贴着石壁迁动。"],
    foreshadows: ["更深处还有同样会迁移的祭痕残光。"],
    emotionalTone: "压低声势，逐步绷紧",
    estimatedWords: 3200,
    requiredProgressDelta: "information_shift",
  };

  const record = buildChapterDeltaRecord({
    projectId: "proj",
    chapterNo: 3,
    blueprint,
    activations: suggestGenreObligationPacks({
      genre: "玄幻修仙",
      premise: foundation.premise,
      foundation,
    }),
    recentDeltaRecords: [],
    chapterContent: [
      "祭痕沿着石壁慢慢迁动。",
      "姜离盯着那道祭痕，发现祭痕不是死的。",
      "阿绛低声提醒，祭痕再往里迁动，下面就会牵出更深的回响。",
    ].join(""),
  });

  assert.equal(record.motifTokens.length > 0, true);
  assert.equal(record.motifTokens.some((token) => token.includes("祭痕")), true);
});

test("deriveStoryProgressState populates new window fields from delta records", () => {
  const records: ChapterDeltaRecord[] = [
    {
      id: "d1", projectId: "p", chapterNo: 1, segmentId: null, segmentItemId: null,
      primaryDeltaDelivered: "power_shift", deliveredDeltas: ["power_shift"],
      storyProgression: { risk: "pass", score: 80, summary: "", advancements: [], stallSignals: [], primaryDelta: "power_shift", deliveredDeltas: ["power_shift"] },
      genreFulfillment: null,
      loopRisk: { risk: "pass", score: 85, summary: "", repetitionAxes: [], stuckDimensions: [] },
      stuckDimensions: [], arenaKey: "A", objectiveKey: "O1",
      antagonistKey: "追猎者", actionPattern: "combat", endingMove: "new_risk",
      mechanismRevealMode: "effect_first", motifTokens: ["追猎", "断骨"],
      obligationHits: [], summary: "", createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "d2", projectId: "p", chapterNo: 2, segmentId: null, segmentItemId: null,
      primaryDeltaDelivered: "information_shift", deliveredDeltas: ["information_shift"],
      storyProgression: { risk: "pass", score: 80, summary: "", advancements: [], stallSignals: [], primaryDelta: "information_shift", deliveredDeltas: ["information_shift"] },
      genreFulfillment: null,
      loopRisk: { risk: "pass", score: 85, summary: "", repetitionAxes: [], stuckDimensions: [] },
      stuckDimensions: [], arenaKey: "B", objectiveKey: "O2",
      antagonistKey: "追猎者", actionPattern: "pursuit", endingMove: "new_discovery",
      mechanismRevealMode: "recognition_line", motifTokens: ["断骨", "追猎"],
      obligationHits: [], summary: "", createdAt: "2026-01-01T00:01:00Z",
    },
  ];

  const state = deriveStoryProgressState(records);
  assert.deepEqual(state.recentAntagonistKeys, ["追猎者", "追猎者"]);
  assert.deepEqual(state.recentActionPatterns, ["combat", "pursuit"]);
  assert.deepEqual(state.recentEndingMoves, ["new_risk", "new_discovery"]);
  assert.deepEqual(state.recentMechanismRevealModes, ["effect_first", "recognition_line"]);
  assert.equal(state.recentMotifWindows.length, 2);
});

test("combat_loop detected when same_arena + same_antagonist + combat/pursuit + power_shift", () => {
  const recentRecords: ChapterDeltaRecord[] = [
    {
      id: "d1", projectId: "p", chapterNo: 1, segmentId: null, segmentItemId: null,
      primaryDeltaDelivered: "power_shift", deliveredDeltas: ["power_shift"],
      storyProgression: { risk: "watch", score: 60, summary: "", advancements: [], stallSignals: [], primaryDelta: "power_shift", deliveredDeltas: ["power_shift"] },
      genreFulfillment: null,
      loopRisk: { risk: "watch", score: 58, summary: "", repetitionAxes: ["same_arena"], stuckDimensions: ["arena_loop"] },
      stuckDimensions: ["arena_loop"], arenaKey: "断骨山谷", objectiveKey: "击退追猎者",
      antagonistKey: "追猎者", actionPattern: "combat", endingMove: null,
      mechanismRevealMode: null, motifTokens: [],
      obligationHits: [], summary: "", createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "d2", projectId: "p", chapterNo: 2, segmentId: null, segmentItemId: null,
      primaryDeltaDelivered: "power_shift", deliveredDeltas: ["power_shift"],
      storyProgression: { risk: "watch", score: 60, summary: "", advancements: [], stallSignals: [], primaryDelta: "power_shift", deliveredDeltas: ["power_shift"] },
      genreFulfillment: null,
      loopRisk: { risk: "watch", score: 58, summary: "", repetitionAxes: ["same_arena"], stuckDimensions: ["arena_loop"] },
      stuckDimensions: ["arena_loop"], arenaKey: "断骨山谷", objectiveKey: "击退追猎者",
      antagonistKey: "追猎者", actionPattern: "combat", endingMove: null,
      mechanismRevealMode: null, motifTokens: [],
      obligationHits: [], summary: "", createdAt: "2026-01-01T00:01:00Z",
    },
  ];

  const loopRisk = buildLoopRiskAssessment({
    blueprint: {
      locations: ["断骨山谷"],
      sceneGoal: "继续打追猎者",
      requiredProgressDelta: "power_shift",
      conflicts: ["正面打斗"],
      actionPattern: "combat",
      antagonistHint: "追猎者",
    },
    recentDeltaRecords: recentRecords,
  });

  assert.equal(loopRisk.stuckDimensions.includes("combat_loop"), true);
  assert.equal(loopRisk.risk, "risk");
});

test("combat_loop mustAdvance excludes power_shift", () => {
  const records: ChapterDeltaRecord[] = [
    {
      id: "d1", projectId: "p", chapterNo: 1, segmentId: null, segmentItemId: null,
      primaryDeltaDelivered: "power_shift", deliveredDeltas: ["power_shift"],
      storyProgression: { risk: "pass", score: 80, summary: "", advancements: [], stallSignals: [], primaryDelta: "power_shift", deliveredDeltas: ["power_shift"] },
      genreFulfillment: null,
      loopRisk: { risk: "pass", score: 85, summary: "", repetitionAxes: [], stuckDimensions: [] },
      stuckDimensions: ["combat_loop"], arenaKey: "A", objectiveKey: "O",
      antagonistKey: null, actionPattern: "combat", endingMove: null,
      mechanismRevealMode: null, motifTokens: [],
      obligationHits: [], summary: "", createdAt: "2026-01-01T00:00:00Z",
    },
  ];

  const state = deriveStoryProgressState(records);
  assert.equal(state.mustAdvance.includes("power_shift" as any), false);
  assert.equal(state.mustAdvance.includes("objective_shift"), true);
});

test("consecutive explicit_summary ending moves trigger ending_summary_loop", () => {
  const recentRecords: ChapterDeltaRecord[] = [
    {
      id: "d1", projectId: "p", chapterNo: 1, segmentId: null, segmentItemId: null,
      primaryDeltaDelivered: "situation_shift", deliveredDeltas: ["situation_shift"],
      storyProgression: { risk: "pass", score: 80, summary: "", advancements: [], stallSignals: [], primaryDelta: "situation_shift", deliveredDeltas: ["situation_shift"] },
      genreFulfillment: null,
      loopRisk: { risk: "pass", score: 85, summary: "", repetitionAxes: [], stuckDimensions: [] },
      stuckDimensions: [], arenaKey: "A", objectiveKey: "O1",
      antagonistKey: null, actionPattern: "investigation", endingMove: "explicit_summary",
      mechanismRevealMode: null, motifTokens: [],
      obligationHits: [], summary: "", createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "d2", projectId: "p", chapterNo: 2, segmentId: null, segmentItemId: null,
      primaryDeltaDelivered: "information_shift", deliveredDeltas: ["information_shift"],
      storyProgression: { risk: "pass", score: 80, summary: "", advancements: [], stallSignals: [], primaryDelta: "information_shift", deliveredDeltas: ["information_shift"] },
      genreFulfillment: null,
      loopRisk: { risk: "pass", score: 85, summary: "", repetitionAxes: [], stuckDimensions: [] },
      stuckDimensions: [], arenaKey: "B", objectiveKey: "O2",
      antagonistKey: null, actionPattern: "negotiation", endingMove: "emotional_close",
      mechanismRevealMode: null, motifTokens: [],
      obligationHits: [], summary: "", createdAt: "2026-01-01T00:01:00Z",
    },
  ];

  const loopRisk = buildLoopRiskAssessment({
    blueprint: {
      locations: ["C"],
      sceneGoal: "新场景",
      requiredProgressDelta: "world_shift",
      conflicts: [],
    },
    recentDeltaRecords: recentRecords,
  });

  assert.equal(loopRisk.stuckDimensions.includes("ending_summary_loop"), true);
});

test("buildSegmentPlans splits single arena into sub-arenas", () => {
  const singleArenaFoundation: FoundationPayload = {
    ...foundation,
    worldview: [
      { name: "断骨山谷", description: "唯一场域" },
    ],
  };
  const activations = suggestGenreObligationPacks({
    genre: "玄幻修仙",
    premise: singleArenaFoundation.premise,
    foundation: singleArenaFoundation,
  });

  const segments = buildSegmentPlans({
    startingChapter: 1,
    currentVolumeGoal: "查清禁忌。",
    endingPromise: "掀开禁忌。",
    foundation: singleArenaFoundation,
    activations,
  });

  const arenas = segments[0]!.items.map((item) => item.arenaHints[0]);
  const uniqueArenas = new Set(arenas);
  assert.ok(uniqueArenas.size >= 2, `Expected at least 2 unique arenas but got ${uniqueArenas.size}: ${[...uniqueArenas].join(", ")}`);
});

test("buildSegmentPlans populates new structural fields and avoids single-cluster six-chapter lock", () => {
  const activations = suggestGenreObligationPacks({
    genre: "玄幻修仙",
    premise: foundation.premise,
    foundation,
  });

  const segments = buildSegmentPlans({
    startingChapter: 1,
    currentVolumeGoal: "查清祭痕古地为何主动回应姜离。",
    endingPromise: "掀开古地深处的更高禁忌。",
    foundation,
    activations,
  });

  const firstSegment = segments[0]!;
  const arenaClusters = new Set(firstSegment.items.map((item) => item.arenaClusterId).filter(Boolean));
  const rewardTypes = firstSegment.items.map((item) => item.rewardType).filter(Boolean);

  assert.ok(arenaClusters.size >= 2, `Expected at least 2 arena clusters, got ${[...arenaClusters].join(", ")}`);
  assert.equal(firstSegment.items.every((item) => item.opponentClusterId !== undefined), true);
  assert.equal(firstSegment.items.every((item) => item.rewardType !== null), true);
  assert.equal(rewardTypes.some((value, index) => index > 0 && value === rewardTypes[index - 1]), false);
});

test("buildSegmentPlans does not let one opponent cluster dominate three chapters in a row", () => {
  const activations = suggestGenreObligationPacks({
    genre: "玄幻修仙",
    premise: foundation.premise,
    foundation,
  });

  const segments = buildSegmentPlans({
    startingChapter: 1,
    currentVolumeGoal: "查清祭痕古地为何主动回应姜离。",
    endingPromise: "掀开古地深处的更高禁忌。",
    foundation,
    activations,
  });

  const opponentClusters = segments[0]!.items.map((item) => item.opponentClusterId);
  for (let index = 2; index < opponentClusters.length; index += 1) {
    const trio = opponentClusters.slice(index - 2, index + 1);
    assert.equal(new Set(trio).size > 1, true, `unexpected opponent cluster lock: ${trio.join(", ")}`);
  }
});

test("buildSegmentPlans does not have 3 consecutive identical arenaHints", () => {
  const activations = suggestGenreObligationPacks({
    genre: "玄幻修仙",
    premise: foundation.premise,
    foundation,
  });
  const segments = buildSegmentPlans({
    startingChapter: 1,
    currentVolumeGoal: "查清祭痕古地。",
    endingPromise: "掀开禁忌。",
    foundation,
    activations,
  });

  for (const segment of segments) {
    for (let i = 2; i < segment.items.length; i++) {
      const a = segment.items[i - 2]!.arenaHints[0];
      const b = segment.items[i - 1]!.arenaHints[0];
      const c = segment.items[i]!.arenaHints[0];
      assert.ok(
        !(a === b && b === c),
        `3 consecutive items (${i-2},${i-1},${i}) have same arena: ${a}`,
      );
    }
  }
});

test("inferActionPattern detects combat from conflicts", () => {
  assert.equal(inferActionPattern({ conflicts: ["姜离与追兵正面打斗"], sceneGoal: "" }), "combat");
  assert.equal(inferActionPattern({ conflicts: ["逃命"], sceneGoal: "" }), "pursuit");
  assert.equal(inferActionPattern({ conflicts: ["调查线索"], sceneGoal: "" }), "investigation");
});
