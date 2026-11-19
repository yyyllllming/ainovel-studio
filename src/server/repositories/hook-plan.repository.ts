import "../server-only.ts";

import { rawDb } from "../db/client.ts";
import type { HookPlan } from "../types.ts";

function toHookPlan(row: Record<string, unknown>): HookPlan {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    slotIndex: Number(row.slot_index ?? 0),
    sourcePlanGenerationId: Number(row.source_plan_generation_id),
    setupText: String(row.setup_text ?? ""),
    payoffWindowStartChapter: Number(row.payoff_window_start_chapter),
    payoffWindowEndChapter: Number(row.payoff_window_end_chapter),
    priority: String(row.priority ?? "medium") as HookPlan["priority"],
    lifecycleStatus: String(row.lifecycle_status ?? "planned") as HookPlan["lifecycleStatus"],
    deferredUntilChapter:
      row.deferred_until_chapter === null || row.deferred_until_chapter === undefined
        ? null
        : Number(row.deferred_until_chapter),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export function listHookPlans(projectId: string, chapterNo?: number) {
  const rows = chapterNo === undefined
    ? rawDb
      .prepare("SELECT * FROM hook_plans WHERE project_id = ? ORDER BY chapter_no ASC")
      .all(projectId)
    : rawDb
      .prepare("SELECT * FROM hook_plans WHERE project_id = ? AND chapter_no = ? ORDER BY chapter_no ASC")
      .all(projectId, chapterNo);

  return (rows as Array<Record<string, unknown>>).map(toHookPlan);
}

export function replaceHookPlansForChapter(projectId: string, chapterNo: number, plans: HookPlan[]) {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM hook_plans WHERE project_id = ? AND chapter_no = ?").run(projectId, chapterNo);

    const insert = rawDb.prepare(`
      INSERT INTO hook_plans (
        id, project_id, chapter_no, slot_index, source_plan_generation_id, setup_text,
        payoff_window_start_chapter, payoff_window_end_chapter, priority,
        lifecycle_status, deferred_until_chapter, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const plan of plans) {
      insert.run(
        plan.id,
        plan.projectId,
        plan.chapterNo,
        plan.slotIndex,
        plan.sourcePlanGenerationId,
        plan.setupText,
        plan.payoffWindowStartChapter,
        plan.payoffWindowEndChapter,
        plan.priority,
        plan.lifecycleStatus,
        plan.deferredUntilChapter ?? null,
        plan.createdAt,
        plan.updatedAt,
      );
    }
  })();

  return plans;
}

export function updateHookPlanLifecycle(projectId: string, hookPlanId: string, patch: Pick<HookPlan, "lifecycleStatus" | "deferredUntilChapter" | "updatedAt">) {
  rawDb.prepare(`
    UPDATE hook_plans
    SET lifecycle_status = ?, deferred_until_chapter = ?, updated_at = ?
    WHERE project_id = ? AND id = ?
  `).run(
    patch.lifecycleStatus,
    patch.deferredUntilChapter ?? null,
    patch.updatedAt,
    projectId,
    hookPlanId,
  );

  return rawDb
    .prepare("SELECT * FROM hook_plans WHERE project_id = ? AND id = ? LIMIT 1")
    .get(projectId, hookPlanId) as Record<string, unknown> | undefined;
}
