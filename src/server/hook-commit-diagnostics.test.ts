import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { commitChapterState } from "./commit/chapter-commit-engine.ts";
import { rawDb } from "./db/client.ts";
import { ensureProjectLayout, replaceCanonFacts, replaceForeshadowEntries } from "./project-files.ts";
import { saveBlueprint } from "./repositories/foundation.repository.ts";
import { replaceHookPlansForChapter } from "./repositories/hook-plan.repository.ts";
import {
  buildHookDiagnosticPlannerNotes,
  buildHookDiagnosticsSnapshot,
  buildHookDiagnosticsSummaryLine,
} from "./story/hook-diagnostics.ts";
import { listHookPlans } from "./repositories/hook-plan.repository.ts";
import type { CanonFact, ChapterBlueprint, HookPlan } from "./types.ts";

function makeBlueprint(input: Partial<ChapterBlueprint> & { chapterNo: number }): ChapterBlueprint {
  return {
    chapterNo: input.chapterNo,
    sceneGoal: input.sceneGoal ?? "确认当前章的推进链条。",
    characters: input.characters ?? ["姜离"],
    locations: input.locations ?? ["断骨山谷"],
    conflicts: input.conflicts ?? ["更深处的危险逼近"],
    foreshadows: input.foreshadows ?? [],
    hookGuidanceMode: input.hookGuidanceMode ?? "unguided",
    hookBindings: input.hookBindings ?? [],
    emotionalTone: input.emotionalTone ?? "压迫",
    estimatedWords: input.estimatedWords ?? 2600,
    sourcePlanGenerationId: input.sourcePlanGenerationId ?? 1,
  };
}

function makeHookPlan(input: Partial<HookPlan> & {
  id: string;
  chapterNo: number;
  setupText: string;
  payoffWindowEndChapter: number;
}): HookPlan {
  return {
    id: input.id,
    projectId: input.projectId ?? "project-hook-commit",
    chapterNo: input.chapterNo,
    sourcePlanGenerationId: input.sourcePlanGenerationId ?? 1,
    setupText: input.setupText,
    payoffWindowStartChapter: input.payoffWindowStartChapter ?? input.chapterNo + 1,
    payoffWindowEndChapter: input.payoffWindowEndChapter,
    priority: input.priority ?? "medium",
    slotIndex: input.slotIndex ?? 0,
    lifecycleStatus: input.lifecycleStatus ?? "planned",
    deferredUntilChapter: input.deferredUntilChapter ?? null,
    createdAt: input.createdAt ?? "2026-04-09T10:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-09T10:00:00.000Z",
  };
}

function makeFact(input: Partial<CanonFact> & { id: string; chapterNo: number; type: CanonFact["type"]; content: string }): CanonFact {
  return {
    id: input.id,
    chapterNo: input.chapterNo,
    type: input.type,
    content: input.content,
    metadata: input.metadata ?? {},
    timestamp: input.timestamp ?? `2026-04-09T10:0${input.chapterNo}:00.000Z`,
    keywords: input.keywords ?? [],
  };
}

test("buildHookDiagnosticsSnapshot marks hook debt when planned hook has no binding or planted foreshadow evidence", () => {
  const hookPlans = [
    makeHookPlan({
      id: "hook-missing",
      chapterNo: 4,
      setupText: "姜离摸到暗格中的密信，暗示师门内鬼已经提前布子。",
      payoffWindowEndChapter: 7,
    }),
  ];
  const blueprints = [
    makeBlueprint({
      chapterNo: 4,
      foreshadows: ["旧灯塔角落有一枚陌生徽记。"],
      hookGuidanceMode: "unguided",
    }),
  ];

  const diagnostics = buildHookDiagnosticsSnapshot({
    chapterNo: 4,
    hookPlans,
    blueprints,
    canonFacts: [],
    foreshadowEntries: [],
  });

  assert.equal(diagnostics.missingSetupCount, 1);
  assert.equal(diagnostics.boundCount, 0);
  assert.equal(diagnostics.items[0]?.setupState, "missing");
});

test("buildHookDiagnosticsSnapshot marks overdue and dead for planted hooks that pass the payoff window without payoff evidence", () => {
  const hookPlans = [
    makeHookPlan({
      id: "hook-overdue",
      chapterNo: 2,
      setupText: "岚柔偷走的异兽骨里还封着会反噬持有者的活性残片。",
      payoffWindowEndChapter: 3,
    }),
  ];
  const blueprints = [
    makeBlueprint({
      chapterNo: 2,
      hookGuidanceMode: "guided",
      hookBindings: [
        {
          hookPlanId: "hook-overdue",
          foreshadowText: "岚柔偷走的异兽骨里还封着会反噬持有者的活性残片。",
        },
      ],
      foreshadows: ["岚柔偷走的异兽骨里还封着会反噬持有者的活性残片。"],
    }),
  ];

  const diagnostics = buildHookDiagnosticsSnapshot({
    chapterNo: 6,
    hookPlans,
    blueprints,
    canonFacts: [],
    foreshadowEntries: [],
  });

  assert.equal(diagnostics.overdueCount, 1);
  assert.equal(diagnostics.deadCount, 1);
  assert.equal(diagnostics.items[0]?.setupState, "bound");
  assert.equal(diagnostics.items[0]?.overdue, true);
  assert.equal(diagnostics.items[0]?.dead, true);
});

test("buildHookDiagnosticsSnapshot marks high-similarity nearby hooks as duplicate candidates", () => {
  const hookPlans = [
    makeHookPlan({
      id: "hook-a",
      chapterNo: 5,
      setupText: "卷轴最后一页的活体封印还在呼吸。",
      payoffWindowEndChapter: 8,
    }),
    makeHookPlan({
      id: "hook-b",
      chapterNo: 6,
      setupText: "卷轴最后一页的活体封印仍在轻微呼吸。",
      payoffWindowEndChapter: 9,
    }),
  ];
  const blueprints = [
    makeBlueprint({
      chapterNo: 5,
      hookGuidanceMode: "guided",
      hookBindings: [{ hookPlanId: "hook-a", foreshadowText: "卷轴最后一页的活体封印还在呼吸。" }],
      foreshadows: ["卷轴最后一页的活体封印还在呼吸。"],
    }),
    makeBlueprint({
      chapterNo: 6,
      hookGuidanceMode: "guided",
      hookBindings: [{ hookPlanId: "hook-b", foreshadowText: "卷轴最后一页的活体封印仍在轻微呼吸。" }],
      foreshadows: ["卷轴最后一页的活体封印仍在轻微呼吸。"],
    }),
  ];

  const diagnostics = buildHookDiagnosticsSnapshot({
    chapterNo: 6,
    hookPlans,
    blueprints,
    canonFacts: [],
    foreshadowEntries: [],
  });

  assert.equal(diagnostics.duplicateCount, 1);
  assert.equal(diagnostics.items.find((item) => item.hookPlanId === "hook-b")?.duplicateOfHookPlanId, "hook-a");
});

test("hook diagnostic planner notes expose missing, overdue, candidate payoff and duplicate items for blueprint steering", () => {
  const diagnostics = buildHookDiagnosticsSnapshot({
    chapterNo: 8,
    hookPlans: [
      makeHookPlan({
        id: "hook-missing",
        chapterNo: 4,
        setupText: "姜离在灯塔暗层摸到一份写给内鬼的密信。",
        payoffWindowEndChapter: 6,
      }),
      makeHookPlan({
        id: "hook-overdue",
        chapterNo: 5,
        setupText: "岚柔带走的骨片其实会反噬持有者。",
        payoffWindowEndChapter: 6,
      }),
      makeHookPlan({
        id: "hook-candidate",
        chapterNo: 6,
        setupText: "卷轴最后一页的活体封印仍在轻微呼吸。",
        payoffWindowEndChapter: 9,
      }),
      makeHookPlan({
        id: "hook-duplicate",
        chapterNo: 7,
        setupText: "卷轴最后一页的活体封印还在呼吸。",
        payoffWindowEndChapter: 10,
      }),
    ],
    blueprints: [
      makeBlueprint({
        chapterNo: 5,
        hookGuidanceMode: "guided",
        hookBindings: [{ hookPlanId: "hook-overdue", foreshadowText: "岚柔带走的骨片其实会反噬持有者。" }],
        foreshadows: ["岚柔带走的骨片其实会反噬持有者。"],
      }),
      makeBlueprint({
        chapterNo: 6,
        hookGuidanceMode: "guided",
        hookBindings: [{ hookPlanId: "hook-candidate", foreshadowText: "卷轴最后一页的活体封印仍在轻微呼吸。" }],
        foreshadows: ["卷轴最后一页的活体封印仍在轻微呼吸。"],
      }),
      makeBlueprint({
        chapterNo: 7,
        hookGuidanceMode: "guided",
        hookBindings: [{ hookPlanId: "hook-duplicate", foreshadowText: "卷轴最后一页的活体封印还在呼吸。" }],
        foreshadows: ["卷轴最后一页的活体封印还在呼吸。"],
      }),
    ],
    canonFacts: [
      makeFact({
        id: "fact-candidate",
        chapterNo: 8,
        type: "plot_event",
        content: "卷轴最后一页的活体封印仍在轻微呼吸，并开始挣脱卷轴。",
      }),
    ],
    foreshadowEntries: [],
  });

  const summary = buildHookDiagnosticsSummaryLine(diagnostics);
  const notes = buildHookDiagnosticPlannerNotes({
    diagnostics,
    maxItems: 4,
  });

  assert.match(summary, /planned=4 \/ bound=3 \/ debt=1 \/ overdue=1 \/ dead=1/);
  assert.equal(notes.length, 4);
  assert.match(notes[0] ?? "", /还没有稳定 setup evidence/);
  assert.equal(notes.some((note) => /已超过预计回收窗口|超窗且持续悬挂/.test(note)), true);
  assert.equal(notes.some((note) => /疑似回收证据/.test(note)), true);
  assert.equal(notes.some((note) => /高度相似/.test(note)), true);
});

test("commitChapterState writes hook diagnostics into logic_state snapshots", async () => {
  const projectId = `hook-commit-${Date.now()}`;
  try {
    await ensureProjectLayout(projectId);

    replaceHookPlansForChapter(projectId, 4, [
      makeHookPlan({
        id: `${projectId}:hook:4`,
        projectId,
        chapterNo: 4,
        setupText: "皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。",
        payoffWindowEndChapter: 6,
      }),
    ]);

    saveBlueprint(projectId, makeBlueprint({
      chapterNo: 4,
      hookGuidanceMode: "guided",
      hookBindings: [
        {
          hookPlanId: `${projectId}:hook:4`,
          foreshadowText: "皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。",
        },
      ],
      foreshadows: ["皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。"],
    }));

    await replaceCanonFacts(projectId, [
      makeFact({
        id: `${projectId}:fact:4`,
        chapterNo: 4,
        type: "foreshadow",
        content: "皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。",
        metadata: { status: "active" },
      }),
    ]);
    await replaceForeshadowEntries(projectId, [
      {
        id: `${projectId}:ledger:4`,
        chapterNo: 4,
        content: "皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。",
        status: "active",
        timestamp: "2026-04-09T10:04:00.000Z",
      },
    ]);

    const snapshot = await commitChapterState(projectId, 4);

    assert.equal(snapshot.hookDiagnostics?.plannedCount, 1);
    assert.equal(snapshot.hookDiagnostics?.boundCount, 1);
    assert.equal(snapshot.hookDiagnostics?.items[0]?.setupState, "bound");
  } finally {
    rawDb.prepare("DELETE FROM hook_plans WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM blueprints WHERE project_id = ?").run(projectId);
    await rm(`D:/ainote/ainovel-cli/platform/projects/${projectId}`, { recursive: true, force: true });
  }
});

test("commitChapterState promotes bound hook plans from planned to planted", async () => {
  const projectId = `hook-lifecycle-planted-${Date.now()}`;
  try {
    await ensureProjectLayout(projectId);

    replaceHookPlansForChapter(projectId, 4, [
      makeHookPlan({
        id: `${projectId}:hook:4:0`,
        projectId,
        chapterNo: 4,
        setupText: "皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。",
        payoffWindowEndChapter: 6,
      }),
    ]);

    saveBlueprint(projectId, makeBlueprint({
      chapterNo: 4,
      hookGuidanceMode: "guided",
      hookBindings: [
        {
          hookPlanId: `${projectId}:hook:4:0`,
          foreshadowText: "皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。",
        },
      ],
      foreshadows: ["皮肤浮现的鳞片纹路其实在指向旧契约的真正主人。"],
    }));

    const snapshot = await commitChapterState(projectId, 4);
    const [updated] = listHookPlans(projectId, 4);

    assert.equal(updated?.lifecycleStatus, "planted");
    assert.equal(snapshot.hookDiagnostics?.plannedCount, 1);
    assert.equal(snapshot.hookDiagnostics?.boundCount, 1);
  } finally {
    rawDb.prepare("DELETE FROM hook_plans WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM blueprints WHERE project_id = ?").run(projectId);
    await rm(`D:/ainote/ainovel-cli/platform/projects/${projectId}`, { recursive: true, force: true });
  }
});

test("commitChapterState resolves hook plans when foreshadow ledger marks the payoff resolved", async () => {
  const projectId = `hook-lifecycle-resolved-${Date.now()}`;
  try {
    await ensureProjectLayout(projectId);

    replaceHookPlansForChapter(projectId, 2, [
      makeHookPlan({
        id: `${projectId}:hook:2:0`,
        projectId,
        chapterNo: 2,
        setupText: "旧契约真正主人的名字会在塔楼暗层被揭出。",
        payoffWindowStartChapter: 3,
        payoffWindowEndChapter: 5,
        lifecycleStatus: "planted",
      }),
    ]);

    saveBlueprint(projectId, makeBlueprint({
      chapterNo: 2,
      hookGuidanceMode: "guided",
      hookBindings: [
        {
          hookPlanId: `${projectId}:hook:2:0`,
          foreshadowText: "旧契约真正主人的名字会在塔楼暗层被揭出。",
        },
      ],
      foreshadows: ["旧契约真正主人的名字会在塔楼暗层被揭出。"],
    }));

    await replaceForeshadowEntries(projectId, [
      {
        id: `${projectId}:ledger:4`,
        chapterNo: 4,
        content: "旧契约真正主人的名字会在塔楼暗层被揭出。",
        status: "resolved",
        timestamp: "2026-04-09T10:04:00.000Z",
      },
    ]);

    const snapshot = await commitChapterState(projectId, 4);
    const [updated] = listHookPlans(projectId, 2);

    assert.equal(updated?.lifecycleStatus, "resolved");
    assert.equal(snapshot.hookDiagnostics?.plannedCount ?? 0, 0);
  } finally {
    rawDb.prepare("DELETE FROM hook_plans WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM blueprints WHERE project_id = ?").run(projectId);
    await rm(`D:/ainote/ainovel-cli/platform/projects/${projectId}`, { recursive: true, force: true });
  }
});
