import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackCanonArtifacts,
  detectContextConflicts,
  extractCanonArtifacts,
} from "./story/canon.ts";
import type { ChapterBlueprint, FoundationPayload, SegmentPlanItem } from "./types.ts";

const foundation: FoundationPayload = {
  premise: "旧港雾灾里，调查员必须追查黑匣子的来历。",
  styleCard: "冷峻、克制",
  characters: [
    {
      name: "林舟",
      role: "调查员",
      goal: "查清黑匣子与雾灾的关联。",
      traits: ["冷静", "执拗"],
    },
    {
      name: "顾南",
      role: "同伴",
      goal: "看住黑匣子，不让它再失控。",
      traits: ["谨慎", "敏锐"],
    },
  ],
  worldview: [
    {
      name: "旧港",
      description: "夜里会被军警封锁，雾会吃掉部分声音。",
    },
  ],
  relationships: [
    {
      source: "林舟",
      target: "顾南",
      label: "互相提防但暂时结伴",
    },
  ],
};

const blueprint: ChapterBlueprint = {
  chapterNo: 8,
  sceneGoal: "林舟必须在旧港确认黑匣子的真正主人。",
  characters: ["林舟", "顾南"],
  locations: ["旧港"],
  conflicts: ["林舟必须先绕开巡逻队，再摸到黑匣子的来源。"],
  foreshadows: ["黑匣子的真正主人正在逼近旧港。"],
  emotionalTone: "压抑、紧绷",
  estimatedWords: 3200,
  requiredProgressDelta: "information_shift",
};

const profile = {
  id: "canon-test",
  name: "Canon Test",
  providerId: "custom",
  protocol: "openai_compatible" as const,
  baseUrl: "https://example.invalid/v1",
  apiKey: "test",
  defaultModel: "test",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type CanonTestExtractors = NonNullable<Parameters<typeof extractCanonArtifacts>[0]["componentExtractors"]>;
type CanonTestCoverage = Awaited<ReturnType<NonNullable<CanonTestExtractors["facts"]>>>;
const coverageCategories = [
  "character_state", "location_change", "item_acquired", "plot_event",
  "foreshadow", "world_rule", "relationship", "timeline_marker",
] as const;

const coverage: CanonTestCoverage = {
  categories: coverageCategories.map((category) => ({
    category,
    present: category === "plot_event",
    facts: category === "plot_event"
      ? [{ type: "plot_event" as const, content: "SENTINEL_FACT", metadata: {}, keywords: ["sentinel"] }]
      : [],
  })),
  missingCategories: [
    "character_state", "location_change", "item_acquired", "foreshadow",
    "world_rule", "relationship", "timeline_marker",
  ],
};

function canonInput(componentExtractors: CanonTestExtractors, previousArtifacts?: Awaited<ReturnType<typeof extractCanonArtifacts>>) {
  return {
    profile,
    model: "test",
    chapterNo: 8,
    blueprint,
    foundation,
    chapterContent: "林舟在旧港确认了 SENTINEL_FACT。",
    prompts: { summaryPrompt: "summary", archivistPrompt: "archivist" },
    componentExtractors,
    previousArtifacts,
  };
}

function successfulExtractors(calls?: Record<string, number>) {
  return {
    summaries: async () => {
      if (calls) calls.summaries += 1;
      return { brief: "SENTINEL_BRIEF", detailed: "SENTINEL_DETAILED", full: "SENTINEL_FULL" };
    },
    facts: async () => {
      if (calls) calls.facts += 1;
      return coverage;
    },
    snapshot: async () => {
      if (calls) calls.snapshot += 1;
      return {
        characters: {
          林舟: {
            currentGoal: {
              value: "SENTINEL_GOAL",
              evidence: "林舟在旧港确认了 SENTINEL_FACT",
            },
          },
        },
      };
    },
  };
}

test("buildFallbackCanonArtifacts keeps structured canon output and diagnostics", () => {
  const artifacts = buildFallbackCanonArtifacts(
    8,
    [
      "林舟在旧港货栈里逼问顾南，确认黑匣子会回应旧雾频率。",
      "顾南没有退开，只说自己早就知道黑匣子还会失控。",
    ].join("\n\n"),
    blueprint,
    foundation,
  );

  assert.equal(artifacts.facts.some((fact) => fact.type === "plot_event"), true);
  assert.equal(artifacts.facts.some((fact) => fact.type === "character_state"), true);
  assert.equal(artifacts.facts.some((fact) => fact.type === "location_change"), true);
  assert.equal(artifacts.facts.some((fact) => fact.type === "foreshadow"), true);
  assert.equal(artifacts.diagnostics.usedFallback, true);
  assert.equal(Array.isArray(artifacts.diagnostics.missingCategories), true);
});

test("buildFallbackCanonArtifacts keeps every summary tier within its context budget", () => {
  const longChapter = "林舟在旧港核对黑匣子记录，并把能够复核的事实逐项写进值班册。".repeat(160);
  const artifacts = buildFallbackCanonArtifacts(8, longChapter, blueprint, foundation);

  assert.ok(artifacts.summaries.brief.length <= 100);
  assert.ok(artifacts.summaries.detailed.length <= 500);
  assert.ok(artifacts.summaries.full.length <= 1200);
});

test("extractCanonArtifacts degrades summaries that exceed the three-tier context contract", async () => {
  const extractors = successfulExtractors();
  extractors.summaries = async () => ({
    brief: "短".repeat(101),
    detailed: "中".repeat(501),
    full: "长".repeat(1201),
  });

  const artifacts = await extractCanonArtifacts(canonInput(extractors));

  assert.equal(artifacts.diagnostics.components.summaries, "degraded");
  assert.ok(artifacts.summaries.brief.length <= 100);
  assert.ok(artifacts.summaries.detailed.length <= 500);
  assert.ok(artifacts.summaries.full.length <= 1200);
});

test("buildFallbackCanonArtifacts does not turn blueprint goals into current chapter state", () => {
  const artifacts = buildFallbackCanonArtifacts(
    8,
    "林舟独自走进旧港货栈，确认黑匣子还在原处。",
    blueprint,
    foundation,
  );

  assert.deepEqual(artifacts.snapshot.characters.林舟, {});
  assert.equal(artifacts.snapshot.characters.顾南, undefined);
});

test("extractCanonArtifacts keeps only snapshot fields backed by exact chapter evidence", async () => {
  const chapterContent = "林舟把黑匣子压进帆布包，低声说：先离开旧港。";
  const artifacts = await extractCanonArtifacts({
    ...canonInput({}),
    chapterContent,
    componentExtractors: {
      ...successfulExtractors(),
      snapshot: async () => ({
        characters: {
          林舟: {
            currentGoal: {
              value: "离开旧港",
              evidence: "林舟把黑匣子压进帆布包，低声说：先离开旧港",
            },
          },
          顾南: {
            hiddenIntent: {
              value: "暗中保护林舟",
              evidence: "顾南一直想保护林舟",
            },
          },
        },
      }) as never,
    },
  });

  assert.equal(artifacts.snapshot.characters.林舟?.currentGoal, "离开旧港");
  assert.deepEqual(artifacts.snapshot.characters.林舟?.evidence, [
    {
      field: "currentGoal",
      quote: "林舟把黑匣子压进帆布包，低声说：先离开旧港",
    },
  ]);
  assert.equal(artifacts.snapshot.characters.顾南, undefined);
});

test("extractCanonArtifacts accepts evidence-backed relationship status aliases", async () => {
  const chapterContent = "林舟把黑匣子递给顾南，顾南接住后第一次说：我信你。";
  const artifacts = await extractCanonArtifacts({
    ...canonInput({}),
    chapterContent,
    componentExtractors: {
      ...successfulExtractors(),
      snapshot: async () => ({
        characters: {
          林舟: {
            relationships: {
              顾南: {
                status: "信任加深",
                evidence: "林舟把黑匣子递给顾南",
              },
            },
          },
        },
      }) as never,
    },
  });

  assert.equal(artifacts.snapshot.characters.林舟?.relationships?.顾南, "信任加深");
});

test("extractCanonArtifacts drops unknown placeholder snapshot values", async () => {
  const artifacts = await extractCanonArtifacts({
    ...canonInput({}),
    chapterContent: "顾南暂时联系不上。",
    componentExtractors: {
      ...successfulExtractors(),
      snapshot: async () => ({
        characters: {
          顾南: {
            currentGoal: { value: "未知（本章未出场）", evidence: "顾南暂时联系不上" },
            hiddenIntent: { value: "N/A", evidence: "顾南暂时联系不上" },
          },
        },
      }) as never,
    },
  });

  assert.equal(artifacts.snapshot.characters.顾南, undefined);
});

for (const failedComponent of ["summaries", "facts", "snapshot"] as const) {
  test(`extractCanonArtifacts retains successful components when ${failedComponent} fails and retries only that component`, async () => {
    const firstExtractors = successfulExtractors();
    if (failedComponent === "summaries") firstExtractors.summaries = async () => { throw new Error("summaries failed"); };
    if (failedComponent === "facts") firstExtractors.facts = async () => { throw new Error("facts failed"); };
    if (failedComponent === "snapshot") firstExtractors.snapshot = async () => { throw new Error("snapshot failed"); };
    const partial = await extractCanonArtifacts(canonInput(firstExtractors));

    assert.equal(partial.diagnostics.aggregateStatus, "partial_success");
    assert.equal(partial.diagnostics.components[failedComponent], "degraded");
    for (const component of ["summaries", "facts", "snapshot"] as const) {
      if (component !== failedComponent) assert.equal(partial.diagnostics.components[component], "success");
    }
    if (failedComponent !== "summaries") assert.equal(partial.summaries.brief, "SENTINEL_BRIEF");
    if (failedComponent !== "facts") assert.equal(partial.facts.some((fact) => fact.content === "SENTINEL_FACT"), true);
    if (failedComponent !== "snapshot") assert.equal(partial.snapshot.characters.林舟?.currentGoal, "SENTINEL_GOAL");

    const calls = { summaries: 0, facts: 0, snapshot: 0 };
    const recovered = await extractCanonArtifacts(canonInput(successfulExtractors(calls), partial));
    assert.equal(recovered.diagnostics.aggregateStatus, "success");
    if (failedComponent !== "summaries") assert.deepEqual(recovered.summaries, partial.summaries);
    if (failedComponent !== "facts") assert.deepEqual(recovered.facts, partial.facts);
    if (failedComponent !== "snapshot") assert.deepEqual(recovered.snapshot, partial.snapshot);
    assert.deepEqual(calls, {
      summaries: failedComponent === "summaries" ? 1 : 0,
      facts: failedComponent === "facts" ? 1 : 0,
      snapshot: failedComponent === "snapshot" ? 1 : 0,
    });
  });
}

test("detectContextConflicts returns unified hard and soft conflicts", () => {
  const segmentItem: SegmentPlanItem = {
    id: "segment-item-8",
    chapterNo: 8,
    title: "第 8 章推进位",
    intent: "让林舟拿到会改写下一步的新线索。",
    requiredProgressDeltas: ["information_shift"],
    requiredObligations: [],
    focusCharacters: ["林舟"],
    arenaHints: ["旧港"],
    suggestedActionPattern: null,
    antagonistHint: null,
    forbiddenRecentAxes: [],
    narrativeTitle: null,
    narrativeIntent: null,
    narrativeSummary: null,
    arcConnection: null,
    nextHook: null,
    rewriteStatus: "pending",
    userOverridden: false,
  };

  const conflicts = detectContextConflicts({
    chapterNo: 8,
    blueprint: {
      ...blueprint,
      characters: ["林舟", "已死角色"],
      requiredProgressDelta: "world_shift",
    },
    facts: [
      {
        id: "fact-death",
        type: "character_state",
        chapterNo: 4,
        content: "已死角色在码头枪战中死亡。",
        metadata: {
          character: "已死角色",
          value: "确认死亡",
        },
        timestamp: "2026-04-05T00:00:00.000Z",
        keywords: ["已死角色", "死亡"],
      },
    ],
    foreshadows: [
      {
        id: "thread-1",
        chapterNo: 1,
        content: "黑匣子的真正主人",
        status: "active",
      },
    ],
    segmentItem,
  });

  assert.equal(conflicts.some((conflict) => conflict.severity === "hard"), true);
  assert.equal(conflicts.some((conflict) => conflict.type === "segment_blueprint_mismatch"), true);
  assert.equal(conflicts.some((conflict) => conflict.severity === "soft"), true);
});
