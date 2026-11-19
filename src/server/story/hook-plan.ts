import "../server-only.ts";

import type { ChapterBlueprint, ChapterPlan, HookPlan } from "../types.ts";
import { nowIso } from "../utils.ts";

export function buildHookPlanId(projectId: string, chapterNo: number, slotIndex = 0) {
  return `${projectId}:hook:${chapterNo}:${slotIndex}`;
}

export function deriveHookPlansFromChapterPlan(
  chapterPlan: Pick<ChapterPlan, "projectId" | "chapterNo" | "nextHook" | "hookSlots" | "generationId">,
  now = nowIso(),
): HookPlan[] {
  const slots = Array.isArray(chapterPlan.hookSlots) && chapterPlan.hookSlots.length
    ? chapterPlan.hookSlots
    : chapterPlan.nextHook.trim()
      ? [{
        setupText: chapterPlan.nextHook.trim(),
        payoffWindow: [chapterPlan.chapterNo + 1, chapterPlan.chapterNo + 3] as [number, number],
        priority: "medium" as const,
        planIntent: "active" as const,
      }]
      : [];

  return slots
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(({ slot }) => slot.planIntent !== "cancelled" && slot.setupText.trim())
    .map(({ slot, slotIndex }) => ({
      id: buildHookPlanId(chapterPlan.projectId, chapterPlan.chapterNo, slotIndex),
      projectId: chapterPlan.projectId,
      chapterNo: chapterPlan.chapterNo,
      slotIndex,
      sourcePlanGenerationId: chapterPlan.generationId,
      setupText: slot.setupText.trim(),
      payoffWindowStartChapter: slot.payoffWindow[0],
      payoffWindowEndChapter: slot.payoffWindow[1],
      priority: slot.priority,
      lifecycleStatus: slot.planIntent === "deferred" ? "deferred" : "planned",
      deferredUntilChapter: slot.planIntent === "deferred" ? slot.deferredUntilChapter ?? null : null,
      createdAt: now,
      updatedAt: now,
    }));
}

export function normalizeHookBindingDrafts(
  bindings: Array<{
    hookPlanId?: string | null;
    foreshadowText?: string | null;
    bindingText?: string | null;
    setupText?: string | null;
    payoffText?: string | null;
  }> | null | undefined,
) {
  if (!Array.isArray(bindings)) {
    return [];
  }

  return bindings
    .map((binding) => ({
      hookPlanId: binding?.hookPlanId?.trim() ?? "",
      foreshadowText:
        binding?.foreshadowText?.trim()
        || binding?.bindingText?.trim()
        || binding?.payoffText?.trim()
        || binding?.setupText?.trim()
        || "",
    }))
    .filter((binding) => binding.hookPlanId && binding.foreshadowText);
}

export function applyHookGuidanceToBlueprint(
  blueprint: ChapterBlueprint,
  hookPlans: HookPlan[],
): ChapterBlueprint {
  if (!hookPlans.length) {
    return {
      ...blueprint,
      hookGuidanceMode: "unguided",
      hookBindings: [],
    };
  }

  const normalized = normalizeHookBindingDrafts(blueprint.hookBindings);
  const bindingById = new Map<string, { hookPlanId: string; foreshadowText: string }>();
  for (const binding of normalized) {
    if (!hookPlans.some((plan) => plan.id === binding.hookPlanId)) {
      continue;
    }
    if (bindingById.has(binding.hookPlanId)) {
      continue;
    }
    bindingById.set(binding.hookPlanId, binding);
  }

  const bindings = hookPlans.map((plan) =>
    bindingById.get(plan.id) ?? {
      hookPlanId: plan.id,
      foreshadowText: plan.setupText,
    }
  );

  return {
    ...blueprint,
    hookGuidanceMode: "guided",
    hookBindings: bindings,
    foreshadows: bindings.map((binding) => binding.foreshadowText),
  };
}
