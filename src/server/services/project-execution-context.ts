import "../server-only.ts";

import { resolveProjectAgents } from "../agent-resolver.ts";
import { getFoundationWorkshopSnapshot } from "../foundation/foundation-workshop.ts";
import { getPrompt, getStyleCard } from "../prompts.ts";
import { getFoundation } from "../repositories/foundation.repository.ts";
import { getActiveStylePackage, getStyleReferenceImportsByIds } from "../repositories/style.repository.ts";
import { buildFallbackStyleProfile, normalizeStyleProfile } from "../style/style-steering.ts";
import type { ActiveStylePackage, FoundationPayload } from "../types.ts";
import { clamp } from "../utils.ts";

type ResolvedProjectAgents = Awaited<ReturnType<typeof resolveProjectAgents>>;

export interface ProjectExecutionContext {
  agents: ResolvedProjectAgents;
  prompts: {
    planner: string;
    writer: string;
    reviewerQuick: string;
    reviewerDeep: string;
    editor: string;
    archivist: string;
  };
  activeStyle: ActiveStylePackage;
  styleCard: string;
  styleProfile: NonNullable<FoundationPayload["styleProfile"]>;
  chapterWordTarget: {
    sourceAverage: number | null;
    min: number;
    target: number;
    max: number;
    sourceLabel: string;
  };
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

export async function getProjectExecutionContext(
  projectId: string,
  projectStyle: string,
  existing?: ProjectExecutionContext,
) {
  if (existing) {
    return existing;
  }

  const [
    agents,
    plannerPrompt,
    writerPrompt,
    reviewerQuickPrompt,
    reviewerDeepPrompt,
    editorPrompt,
    archivistPrompt,
    foundation,
    workshop,
    activeStylePackage,
    fallbackStyleCard,
  ] =
    await Promise.all([
      resolveProjectAgents(projectId),
      getPrompt("planner"),
      getPrompt("writer"),
      getPrompt("reviewer-quick"),
      getPrompt("reviewer-deep"),
      getPrompt("editor"),
      getPrompt("archivist"),
      Promise.resolve(getFoundation(projectId)),
      Promise.resolve(getFoundationWorkshopSnapshot(projectId)),
      Promise.resolve(getActiveStylePackage(projectId)),
      getStyleCard(projectStyle).catch(() => getStyleCard("default")), // fallback to default style
    ]);
  const fallbackStyleProfile = buildFallbackStyleProfile({
    references: workshop.state?.draft?.styleReferences ?? [],
    manualGuidance: workshop.state?.draft?.styleManualGuidance,
    avoidances: workshop.state?.draft?.styleAvoidances,
    draft: workshop.state?.draft ?? undefined,
    worldContext: foundation?.worldview.map((item) => `${item.name}:${item.description}`).join("；"),
  });
  const styleCard = activeStylePackage.styleCard.trim()
    || workshop.state?.draft?.styleSteeringCard?.trim()
    || foundation?.styleCard
    || fallbackStyleCard;
  const styleProfileSource = activeStylePackage.styleSnapshotId
    ? activeStylePackage.styleProfile
    : foundation?.styleProfile
      ?? workshop.state?.draft?.styleProfile
      ?? fallbackStyleProfile;
  const styleProfile = normalizeStyleProfile(styleProfileSource);
  const activeStyle: ActiveStylePackage = {
    ...activeStylePackage,
    styleCard,
    styleProfile,
  };
  const chapterWordTarget = deriveChapterWordTarget(projectId, activeStyle);

  return {
    agents,
    prompts: {
      planner: plannerPrompt,
      writer: writerPrompt,
      reviewerQuick: reviewerQuickPrompt,
      reviewerDeep: reviewerDeepPrompt,
      editor: editorPrompt,
      archivist: archivistPrompt,
    },
    activeStyle,
    styleCard,
    styleProfile,
    chapterWordTarget,
  } satisfies ProjectExecutionContext;
}

export function deriveChapterWordTarget(projectId: string, activeStyle: ActiveStylePackage) {
  const imports = activeStyle.sourceIds.length
    ? getStyleReferenceImportsByIds(projectId, activeStyle.sourceIds)
    : [];
  const chapterAverages = imports
    .map((entry) => {
      if (!entry.chapterCount || entry.chapterCount <= 0) {
        return 0;
      }
      return Math.round(entry.wordCount / entry.chapterCount);
    })
    .filter((value) => value > 0);
  const sourceAverage = chapterAverages.length
    ? Math.round(chapterAverages.reduce((sum, value) => sum + value, 0) / chapterAverages.length)
    : null;
  let target = clamp(sourceAverage ?? 2800, 2400, 4200);
  if (activeStyle.confidence === "high") {
    target = Math.max(target, 2800);
  } else if (activeStyle.confidence === "medium") {
    target = Math.max(target, 2600);
  }
  const min = Math.max(2200, Math.round(target * 0.9));
  const max = Math.min(5000, Math.round(target * 1.18));
  const sourceLabel = uniqueNonEmpty([
    ...imports.map((entry) => (entry.author ? `${entry.author}《${entry.title}》` : `《${entry.title}》`)),
    activeStyle.styleProfile.referenceAnchor.primary,
  ])[0] ?? "当前风格锚点";

  return {
    sourceAverage,
    min,
    target,
    max,
    sourceLabel,
  };
}
