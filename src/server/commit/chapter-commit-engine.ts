import "../server-only.ts";

import { readCanonFacts, readForeshadowEntries, writeLogicStateSnapshot } from "../project-files.ts";
import { listBlueprintContents } from "../repositories/foundation.repository.ts";
import { listHookPlans } from "../repositories/hook-plan.repository.ts";
import { updateHookPlanLifecycle } from "../repositories/hook-plan.repository.ts";
import { buildHookDiagnosticsSnapshot } from "../story/hook-diagnostics.ts";
import type { CausalPromise, HookDiagnosticItem, HookPlan, LogicStateSnapshot } from "../types.ts";
import { nowIso } from "../utils.ts";

function normalizeCausalPromiseStatus(status: unknown): CausalPromise["status"] {
  const value = String(status ?? "").trim().toLowerCase();
  if (["resolved", "done", "closed", "fulfilled", "paid_off", "已回收", "已完成", "关闭"].includes(value)) {
    return "resolved";
  }
  if (["abandoned", "dropped", "failed", "cancelled", "canceled", "废弃", "放弃"].includes(value)) {
    return "abandoned";
  }
  return "open";
}

function resolveNextHookLifecycle(plan: HookPlan, diagnostic: HookDiagnosticItem) {
  if (plan.lifecycleStatus === "resolved" || plan.lifecycleStatus === "cancelled") {
    return {
      lifecycleStatus: plan.lifecycleStatus,
      deferredUntilChapter: plan.deferredUntilChapter ?? null,
    };
  }

  if (diagnostic.payoffState === "resolved") {
    return {
      lifecycleStatus: "resolved" as const,
      deferredUntilChapter: null,
    };
  }

  if (plan.lifecycleStatus === "planned" && diagnostic.setupState === "bound") {
    return {
      lifecycleStatus: "planted" as const,
      deferredUntilChapter: plan.deferredUntilChapter ?? null,
    };
  }

  return {
    lifecycleStatus: plan.lifecycleStatus,
    deferredUntilChapter: plan.deferredUntilChapter ?? null,
  };
}

function syncHookLifecycleStates(input: {
  projectId: string;
  hookPlans: HookPlan[];
  diagnostics: HookDiagnosticItem[];
}) {
  const planById = new Map(input.hookPlans.map((plan) => [plan.id, plan] as const));
  let changed = false;

  for (const diagnostic of input.diagnostics) {
    const plan = planById.get(diagnostic.hookPlanId);
    if (!plan) {
      continue;
    }

    const next = resolveNextHookLifecycle(plan, diagnostic);
    if (
      next.lifecycleStatus === plan.lifecycleStatus
      && (next.deferredUntilChapter ?? null) === (plan.deferredUntilChapter ?? null)
    ) {
      continue;
    }

    updateHookPlanLifecycle(input.projectId, plan.id, {
      lifecycleStatus: next.lifecycleStatus,
      deferredUntilChapter: next.deferredUntilChapter,
      updatedAt: nowIso(),
    });
    changed = true;
  }

  return changed;
}

export async function commitChapterState(projectId: string, chapterNo: number): Promise<LogicStateSnapshot> {
  const [canonFacts, foreshadowEntries] = await Promise.all([
    readCanonFacts(projectId),
    readForeshadowEntries(projectId),
  ]);
  const chapterFacts = canonFacts.filter((fact) => fact.chapterNo === chapterNo);
  const relationshipDeltas = chapterFacts
    .filter((fact) => fact.type === "relationship")
    .map((fact) => {
      const source = String(fact.metadata.source ?? fact.metadata.from ?? "").trim();
      const target = String(fact.metadata.target ?? fact.metadata.to ?? "").trim();
      const change = String(fact.metadata.change ?? fact.metadata.label ?? fact.content).trim();
      if (!source || !target || !change) {
        return null;
      }
      return {
        source,
        target,
        change,
        chapterNo,
      };
    })
    .filter((item): item is LogicStateSnapshot["relationshipDeltas"][number] => Boolean(item));

  const latestTimeFact = canonFacts
    .filter((fact) => fact.chapterNo <= chapterNo && fact.type === "timeline_marker")
    .sort((left, right) => {
      if (left.chapterNo !== right.chapterNo) {
        return right.chapterNo - left.chapterNo;
      }
      return String(right.timestamp).localeCompare(String(left.timestamp));
    })[0];
  const timeMarker = latestTimeFact
    ? String(
      latestTimeFact.metadata.label
      ?? latestTimeFact.metadata.time
      ?? latestTimeFact.metadata.marker
      ?? latestTimeFact.content,
    ).trim()
    : "";

  const unresolvedPromiseMap = new Map<string, CausalPromise>();
  foreshadowEntries
    .filter((entry) => {
      const entryChapter = Number(entry.chapterNo ?? 0);
      return Number.isFinite(entryChapter) && entryChapter > 0 && entryChapter <= chapterNo;
    })
    .sort((left, right) => Number(left.chapterNo ?? 0) - Number(right.chapterNo ?? 0))
    .forEach((entry) => {
      const description = String(entry.content ?? "").trim();
      if (!description) {
        return;
      }
      const plantedChapter = Number(entry.chapterNo ?? chapterNo);
      unresolvedPromiseMap.set(description, {
        description,
        plantedChapter: Number.isFinite(plantedChapter) && plantedChapter > 0 ? plantedChapter : chapterNo,
        status: normalizeCausalPromiseStatus(entry.status),
      });
    });

  const pendingConsequences = Array.from(
    new Set(
      chapterFacts
        .filter((fact) => ["plot_event", "foreshadow", "relationship"].includes(fact.type))
        .map((fact) =>
          String(
            fact.metadata.pendingConsequence
            ?? fact.metadata.followUp
            ?? fact.metadata.afterEffect
            ?? fact.metadata.nextBeat
            ?? fact.content,
          ).trim())
        .filter(Boolean),
    ),
      ).slice(0, 8);
  let hookPlans = listHookPlans(projectId).filter((plan) => plan.chapterNo <= chapterNo);
  let hookDiagnostics = buildHookDiagnosticsSnapshot({
    chapterNo,
    hookPlans,
    blueprints: listBlueprintContents(projectId).filter((blueprint) => blueprint.chapterNo <= chapterNo),
    canonFacts,
    foreshadowEntries,
  });

  if (syncHookLifecycleStates({
    projectId,
    hookPlans,
    diagnostics: hookDiagnostics.items,
  })) {
    hookPlans = listHookPlans(projectId).filter((plan) => plan.chapterNo <= chapterNo);
    hookDiagnostics = buildHookDiagnosticsSnapshot({
      chapterNo,
      hookPlans,
      blueprints: listBlueprintContents(projectId).filter((blueprint) => blueprint.chapterNo <= chapterNo),
      canonFacts,
      foreshadowEntries,
    });
  }

  const snapshot: LogicStateSnapshot = {
    chapterNo,
    relationshipDeltas,
    timeMarker,
    unresolvedPromises: Array.from(unresolvedPromiseMap.values()).sort(
      (left, right) => right.plantedChapter - left.plantedChapter,
    ),
    pendingConsequences,
    hookDiagnostics,
  };

  await writeLogicStateSnapshot(projectId, chapterNo, snapshot);
  return snapshot;
}
