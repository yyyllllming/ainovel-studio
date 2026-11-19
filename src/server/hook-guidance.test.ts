import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { createProject } from "./repositories/project.repository.ts";
import { getBlueprint, saveBlueprint } from "./repositories/foundation.repository.ts";
import { listHookPlans, replaceHookPlansForChapter } from "./repositories/hook-plan.repository.ts";
import { projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { rawDb } from "./db/client.ts";
import {
  applyHookGuidanceToBlueprint,
  deriveHookPlansFromChapterPlan,
  normalizeHookBindingDrafts,
} from "./story/hook-plan.ts";
import type { ChapterBlueprint, ChapterPlan } from "./types.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function createChapterPlan(overrides?: Partial<ChapterPlan>): ChapterPlan {
  return {
    projectId: "project-hook",
    chapterNo: 12,
    purpose: "让主角先确认线索真假，再把危险留给下一章接住。",
    plotSummary: "主角在旧仓库里剥掉假线索，确认真正敌人已经提前布网。",
    requiredBeats: ["识破假线索"],
    keyEvents: ["发现暗格"],
    characterFocus: ["林砚"],
    relationshipShift: "林砚开始怀疑同伴内部有人泄密。",
    worldRuleUsage: ["雾潮会干扰嗅觉判断"],
    continuationAnchor: "林砚带着真坐标离开仓库。",
    nextHook: "主角发现暗格里的密信，暗示师门内鬼的存在。",
    hookSlots: [
      {
        setupText: "主角发现暗格里的密信，暗示师门内鬼的存在。",
        payoffWindow: [13, 15],
        priority: "medium",
        planIntent: "active",
      },
    ],
    payoffTargets: ["尽快兑现这封密信背后的内鬼身份"],
    riskFlags: ["hook_debt"],
    riskComment: null,
    status: "ready",
    source: "generated",
    foundationDigest: "foundation-digest",
    storyContractDigest: "story-digest",
    inputDigest: "input-digest",
    generationId: 4,
    generationState: "ready",
    generationToken: null,
    generationStartedAt: null,
    usedSegmentSummaryFallback: false,
    segmentId: "segment-12",
    segmentItemId: "segment-item-12",
    createdAt: "2026-04-09T12:00:00.000Z",
    updatedAt: "2026-04-09T12:00:00.000Z",
    ...overrides,
  };
}

function createBlueprint(overrides?: Partial<ChapterBlueprint>): ChapterBlueprint {
  return {
    chapterNo: 12,
    sceneGoal: "先确认假线索是谁放出来的，再带着真坐标离开旧仓库。",
    characters: ["林砚", "苏澈"],
    locations: ["旧仓库"],
    conflicts: ["仓库内有人故意留下假坐标拖延时间"],
    foreshadows: ["旧仓库角落里留着一枚陌生徽记"],
    emotionalTone: "压迫里带一点反击感",
    estimatedWords: 3200,
    sourcePlanGenerationId: 4,
    ...overrides,
  };
}

test("deriveHookPlansFromChapterPlan returns no hook plan when nextHook is empty", () => {
  const plans = deriveHookPlansFromChapterPlan(
    createChapterPlan({ nextHook: "   ", hookSlots: [] }),
    "2026-04-09T12:30:00.000Z",
  );

  assert.deepEqual(plans, []);
});

test("deriveHookPlansFromChapterPlan derives 0-N hook plans from hookSlots", () => {
  const plans = deriveHookPlansFromChapterPlan(
    createChapterPlan({
      hookSlots: [
        {
          setupText: "主角发现暗格里的密信，暗示师门内鬼的存在。",
          payoffWindow: [13, 15],
          priority: "high",
          planIntent: "active",
        },
        {
          setupText: "仓库外墙的旧徽记其实指向第二个接头人。",
          payoffWindow: [14, 17],
          priority: "low",
          planIntent: "deferred",
          deferredUntilChapter: 14,
        },
        {
          setupText: "这条被取消，不应再生成 hook plan。",
          payoffWindow: [13, 16],
          priority: "medium",
          planIntent: "cancelled",
        },
      ],
    }),
    "2026-04-09T12:30:00.000Z",
  );

  assert.equal(plans.length, 2);
  assert.equal(plans[0]?.chapterNo, 12);
  assert.equal(plans[0]?.id, "project-hook:hook:12:0");
  assert.equal(plans[0]?.setupText, "主角发现暗格里的密信，暗示师门内鬼的存在。");
  assert.equal(plans[0]?.sourcePlanGenerationId, 4);
  assert.equal(plans[0]?.payoffWindowStartChapter, 13);
  assert.equal(plans[0]?.payoffWindowEndChapter, 15);
  assert.equal(plans[0]?.priority, "high");
  assert.equal(plans[0]?.slotIndex, 0);
  assert.equal(plans[0]?.lifecycleStatus, "planned");
  assert.equal(plans[1]?.id, "project-hook:hook:12:1");
  assert.equal(plans[1]?.slotIndex, 1);
  assert.equal(plans[1]?.lifecycleStatus, "deferred");
  assert.equal(plans[1]?.deferredUntilChapter, 14);
});

test("applyHookGuidanceToBlueprint upgrades to guided when hook bindings are valid", () => {
  const hookPlans = deriveHookPlansFromChapterPlan(
    createChapterPlan(),
    "2026-04-09T12:30:00.000Z",
  );
  const guided = applyHookGuidanceToBlueprint(
    createBlueprint({
      hookBindings: [
        {
          hookPlanId: hookPlans[0]!.id,
          foreshadowText: "林砚在暗格里摸到一封被火漆封住的密信，上面印着师门旧印。",
        },
      ],
    }),
    hookPlans,
  );

  assert.equal(guided.hookGuidanceMode, "guided");
  assert.deepEqual(guided.foreshadows, [
    "林砚在暗格里摸到一封被火漆封住的密信，上面印着师门旧印。",
  ]);
  assert.deepEqual(guided.hookBindings, [
    {
      hookPlanId: hookPlans[0]!.id,
      foreshadowText: "林砚在暗格里摸到一封被火漆封住的密信，上面印着师门旧印。",
    },
  ]);
});

test("applyHookGuidanceToBlueprint keeps guided mode and backfills unmatched hook slots", () => {
  const hookPlans = deriveHookPlansFromChapterPlan(
    createChapterPlan({
      hookSlots: [
        {
          setupText: "第一条钩子：密信会指向内鬼。",
          payoffWindow: [13, 15],
          priority: "medium",
          planIntent: "active",
        },
        {
          setupText: "第二条钩子：旧徽记其实指向第二个接头人。",
          payoffWindow: [14, 16],
          priority: "medium",
          planIntent: "active",
        },
      ],
      nextHook: "第一条钩子：密信会指向内鬼。",
    }),
    "2026-04-09T12:30:00.000Z",
  );
  const guided = applyHookGuidanceToBlueprint(
    createBlueprint({
      foreshadows: ["旧仓库角落里留着一枚陌生徽记"],
      hookBindings: [
        {
          hookPlanId: hookPlans[0]!.id,
          foreshadowText: "林砚在暗格里摸到一封被火漆封住的密信。",
        },
      ],
    }),
    hookPlans,
  );

  assert.equal(guided.hookGuidanceMode, "guided");
  assert.deepEqual(guided.hookBindings, [
    {
      hookPlanId: hookPlans[0]!.id,
      foreshadowText: "林砚在暗格里摸到一封被火漆封住的密信。",
    },
    {
      hookPlanId: hookPlans[1]!.id,
      foreshadowText: "第二条钩子：旧徽记其实指向第二个接头人。",
    },
  ]);
  assert.deepEqual(guided.foreshadows, [
    "林砚在暗格里摸到一封被火漆封住的密信。",
    "第二条钩子：旧徽记其实指向第二个接头人。",
  ]);
});

test("normalizeHookBindingDrafts accepts fallback text keys from planner output", () => {
  const normalized = normalizeHookBindingDrafts([
    {
      hookPlanId: "hook-1",
      setupText: "第一条用 setupText 回填。",
    },
    {
      hookPlanId: "hook-2",
      bindingText: "第二条用 bindingText 回填。",
    },
    {
      hookPlanId: "hook-3",
      payoffText: "第三条用 payoffText 回填。",
    },
  ]);

  assert.deepEqual(normalized, [
    { hookPlanId: "hook-1", foreshadowText: "第一条用 setupText 回填。" },
    { hookPlanId: "hook-2", foreshadowText: "第二条用 bindingText 回填。" },
    { hookPlanId: "hook-3", foreshadowText: "第三条用 payoffText 回填。" },
  ]);
});

test("blueprint repository round-trips hook guidance metadata", async () => {
  const project = createProject({
    title: "Hook Guidance Blueprint Project",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 8,
    premise: "调查员沿着黑匣子线索追查雾灾来源。",
    assignments: [],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  try {
    saveBlueprint(project.id, {
      ...createBlueprint({ chapterNo: 4, sourcePlanGenerationId: 7 }),
      hookGuidanceMode: "guided",
      hookBindings: [
        {
          hookPlanId: `${project.id}:hook:4:0`,
          foreshadowText: "林砚在废弃灯塔底层发现了一封被烧过边角的密信。",
        },
      ],
    });

    const blueprint = getBlueprint(project.id, 4);
    assert.ok(blueprint);
    assert.equal(blueprint?.hookGuidanceMode, "guided");
    assert.deepEqual(blueprint?.hookBindings, [
      {
        hookPlanId: `${project.id}:hook:4:0`,
        foreshadowText: "林砚在废弃灯塔底层发现了一封被烧过边角的密信。",
      },
    ]);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});

test("hook plan repository replaces chapter hook slots with the latest ChapterPlan-derived records", async () => {
  const project = createProject({
    title: "Hook Guidance Repository Project",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 10,
    premise: "调查员沿着黑匣子线索追查雾灾来源。",
    assignments: [],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  try {
    const first = deriveHookPlansFromChapterPlan(
      createChapterPlan({
        projectId: project.id,
        chapterNo: 6,
        generationId: 2,
        nextHook: "第一版钩子：暗格里有一封写给内鬼的密信。",
        hookSlots: [
          {
            setupText: "第一版钩子：暗格里有一封写给内鬼的密信。",
            payoffWindow: [7, 9],
            priority: "medium",
            planIntent: "active",
          },
          {
            setupText: "第一版第二钩：灯塔外还藏着另一个接应暗号。",
            payoffWindow: [8, 10],
            priority: "low",
            planIntent: "active",
          },
        ],
      }),
      "2026-04-09T13:00:00.000Z",
    );
    replaceHookPlansForChapter(project.id, 6, first);

    const second = deriveHookPlansFromChapterPlan(
      createChapterPlan({
        projectId: project.id,
        chapterNo: 6,
        generationId: 3,
        nextHook: "第二版钩子：密信背后其实指向灯塔外的接头人。",
        hookSlots: [
          {
            setupText: "第二版钩子：密信背后其实指向灯塔外的接头人。",
            payoffWindow: [7, 10],
            priority: "high",
            planIntent: "active",
          },
        ],
      }),
      "2026-04-09T13:05:00.000Z",
    );
    replaceHookPlansForChapter(project.id, 6, second);

    const plans = listHookPlans(project.id, 6);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.sourcePlanGenerationId, 3);
    assert.equal(plans[0]?.setupText, "第二版钩子：密信背后其实指向灯塔外的接头人。");
    assert.equal(plans[0]?.slotIndex, 0);
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});
