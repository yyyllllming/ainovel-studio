import "../server-only.ts";

import { readPlannerTraceFile } from "../project-files.ts";
import { createChapterPlanRepository } from "../repositories/chapter-plan.repository.ts";
import { getFoundationWorkshopState, listBlueprints } from "../repositories/foundation.repository.ts";

export type ProjectDegradedArtifactKind =
  | "chapter_plan_degraded_backfill"
  | "blueprint_recovery"
  | "foundation_style_ai_fallback"
  | "context_missing_segment_plan"
  | "foundation_workshop_fallback_reply"
  | "import_parser_window_fallback";

export interface ProjectDegradedArtifact {
  kind: ProjectDegradedArtifactKind;
  chapterNo?: number;
  source: string;
  autoUpgradeable: boolean;
  userVisible: boolean;
  message: string;
  detectedAt?: string | null;
}

function buildChapterPlanDegradedArtifacts(projectId: string): ProjectDegradedArtifact[] {
  const repository = createChapterPlanRepository();
  return repository
    .list(projectId)
    .filter((plan) => plan.status === "ready" && plan.source === "degraded_backfill")
    .map((plan) => ({
      kind: "chapter_plan_degraded_backfill" as const,
      chapterNo: plan.chapterNo,
      source: plan.source,
      autoUpgradeable: true,
      userVisible: true,
      detectedAt: plan.updatedAt,
      message: `第 ${plan.chapterNo} 章仍在使用 degraded_backfill 章节计划，应升级为完整 ChapterPlan。`,
    }));
}

async function buildBlueprintRecoveryArtifacts(projectId: string): Promise<ProjectDegradedArtifact[]> {
  const chapterNos = new Set<number>();
  for (const plan of createChapterPlanRepository().list(projectId)) {
    chapterNos.add(plan.chapterNo);
  }
  for (const chapterNo of listBlueprints(projectId)) {
    chapterNos.add(chapterNo);
  }

  const artifacts: ProjectDegradedArtifact[] = [];
  for (const chapterNo of [...chapterNos].sort((left, right) => left - right)) {
    const trace = await readPlannerTraceFile(projectId, chapterNo);
    if (!trace?.fallbackUsed) {
      continue;
    }
    artifacts.push({
      kind: "blueprint_recovery" as const,
      chapterNo,
      source: trace.usedRecoveryBlueprint ? "recovery_blueprint" : "planner_fallback",
      autoUpgradeable: true,
      userVisible: true,
      detectedAt: trace.recordedAt,
      message: trace.usedRecoveryBlueprint
        ? `第 ${chapterNo} 章蓝图由 recovery blueprint 兜底生成，应在后续升级为正常规划结果。`
        : `第 ${chapterNo} 章蓝图触发了 fallback 规划路径，应检查是否还能回到正常规划主路径。`,
    });
  }

  return artifacts;
}

function buildFoundationStyleFallbackArtifacts(projectId: string): ProjectDegradedArtifact[] {
  const workshop = getFoundationWorkshopState(projectId);
  const fallbackReferences = (workshop?.draft.styleReferences ?? []).filter((entry) => entry.source === "ai_fallback");
  if (!fallbackReferences.length) {
    return [];
  }

  const labels = fallbackReferences
    .slice(0, 3)
    .map((entry) => entry.label.trim())
    .filter(Boolean);

  return [{
    kind: "foundation_style_ai_fallback",
    source: "ai_fallback",
    autoUpgradeable: true,
    userVisible: true,
    detectedAt: workshop?.updatedAt ?? null,
    message: `设定工坊仍包含 AI fallback 风格参考${labels.length ? `：${labels.join("、")}` : ""}，建议后续补成正式来源。`,
  }];
}

export async function listProjectDegradedArtifacts(projectId: string): Promise<ProjectDegradedArtifact[]> {
  const [blueprintArtifacts] = await Promise.all([
    buildBlueprintRecoveryArtifacts(projectId),
  ]);

  return [
    ...buildChapterPlanDegradedArtifacts(projectId),
    ...blueprintArtifacts,
    ...buildFoundationStyleFallbackArtifacts(projectId),
  ].sort((left, right) => {
    const leftChapter = left.chapterNo ?? Number.MAX_SAFE_INTEGER;
    const rightChapter = right.chapterNo ?? Number.MAX_SAFE_INTEGER;
    if (leftChapter !== rightChapter) {
      return leftChapter - rightChapter;
    }
    return left.kind.localeCompare(right.kind);
  });
}
