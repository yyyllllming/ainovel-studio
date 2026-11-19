import { existsSync } from "node:fs";

import {
  ensureProjectLayout,
} from "../project-files.ts";
import { withinProject } from "../paths.ts";
import { buildStructuredAvoidanceList, normalizeArenaKey } from "./story-progression.ts";
import type {
  ChapterDeltaRecord,
  PlannerAvoidanceDirectives,
  ProjectStorySeedPatch,
  SegmentPlanItem,
  StoryArenaCluster,
  StoryContract,
  StoryOpponentCluster,
  StoryRewardType,
  StoryProgressState,
} from "../types.ts";
import { readTextFile, writeTextFile } from "../utils.ts";
import { safeParseJson } from "../utils/safe-json.ts";

function inferRewardTypeFromDelta(item: Pick<SegmentPlanItem, "requiredProgressDeltas">) {
  const delta = item.requiredProgressDeltas?.[0];
  switch (delta) {
    case "information_shift":
      return "clue";
    case "objective_shift":
    case "situation_shift":
      return "access";
    case "power_shift":
      return "resource";
    case "world_shift":
      return "rule_insight";
    case "relationship_shift":
      return "relation_shift";
    case "cost_shift":
      return "debt_mark";
    default:
      return null;
  }
}

function findArenaClusterByHint(clusters: StoryArenaCluster[] | undefined, hint: string | null | undefined) {
  const normalizedHint = normalizeArenaKey(hint);
  if (!clusters?.length || !normalizedHint) {
    return null;
  }
  return clusters.find((cluster) =>
    cluster.hints.some((entry) => {
      const normalizedEntry = normalizeArenaKey(entry);
      return normalizedEntry === normalizedHint || normalizedHint.includes(normalizedEntry) || normalizedEntry.includes(normalizedHint);
    })
  ) ?? null;
}

function findOpponentClusterByHint(clusters: StoryOpponentCluster[] | undefined, hint: string | null | undefined) {
  const normalizedHint = hint?.trim();
  if (!clusters?.length || !normalizedHint) {
    return null;
  }
  return clusters.find((cluster) =>
    cluster.hints.some((entry) => entry.trim() === normalizedHint || normalizedHint.includes(entry.trim()))
  ) ?? null;
}

function findRewardTypeBySignal(types: StoryRewardType[] | undefined, signal: string | null | undefined) {
  const normalizedSignal = signal?.trim();
  if (!types?.length || !normalizedSignal) {
    return null;
  }
  return types.find((entry) => normalizedSignal.includes(entry.label) || normalizedSignal.includes(entry.id)) ?? null;
}

function findArenaClusterLabel(clusterId: string, patch?: ProjectStorySeedPatch | null, contract?: StoryContract | null) {
  return patch?.arenaClusters.find((entry) => entry.id === clusterId)?.label
    ?? contract?.arenaClusters?.find((entry) => entry.id === clusterId)?.label
    ?? clusterId;
}

function findOpponentClusterLabel(clusterId: string, patch?: ProjectStorySeedPatch | null, contract?: StoryContract | null) {
  return patch?.opponentClusters.find((entry) => entry.id === clusterId)?.label
    ?? contract?.opponentClusters?.find((entry) => entry.id === clusterId)?.label
    ?? clusterId;
}

function findRewardTypeLabel(rewardType: string, patch?: ProjectStorySeedPatch | null, contract?: StoryContract | null) {
  return patch?.rewardTypes.find((entry) => entry.id === rewardType)?.label
    ?? contract?.rewardTypes?.find((entry) => entry.id === rewardType)?.label
    ?? rewardType;
}

export function projectSeedPatchPath(projectId: string) {
  return withinProject(projectId, "patches", "story-seed-patch.json");
}

export async function writeProjectSeedPatchFile(projectId: string, patch: ProjectStorySeedPatch) {
  await ensureProjectLayout(projectId);
  const path = projectSeedPatchPath(projectId);
  await writeTextFile(path, `${JSON.stringify(patch, null, 2)}\n`);
  return path;
}

export async function readProjectSeedPatchFile(projectId: string) {
  const path = projectSeedPatchPath(projectId);
  if (!existsSync(path)) {
    return null;
  }
  return safeParseJson<ProjectStorySeedPatch>(await readTextFile(path));
}

export function resolveSegmentRuntimeMetadata(input: {
  item: SegmentPlanItem;
  patch?: ProjectStorySeedPatch | null;
  storyContract?: StoryContract | null;
}) {
  const patch = input.patch ?? null;
  const explicitArenaId = input.item.arenaHints
    .map((hint) => patch?.explicitMappings?.arenaHints[hint])
    .find(Boolean)
    ?? null;
  const explicitOpponentId = input.item.antagonistHint
    ? patch?.explicitMappings?.antagonists[input.item.antagonistHint] ?? null
    : null;
  const explicitRewardType = Object.entries(patch?.explicitMappings?.rewardSignals ?? {}).find(([signal]) =>
    input.item.intent.includes(signal)
  )?.[1] ?? null;

  const arenaClusterId = explicitArenaId
    ?? input.item.arenaClusterId
    ?? findArenaClusterByHint(patch?.arenaClusters ?? input.storyContract?.arenaClusters, input.item.arenaHints[0])?.id
    ?? null;
  const opponentClusterId = explicitOpponentId
    ?? input.item.opponentClusterId
    ?? findOpponentClusterByHint(patch?.opponentClusters ?? input.storyContract?.opponentClusters, input.item.antagonistHint)?.id
    ?? null;
  const rewardType = explicitRewardType
    ?? input.item.rewardType
    ?? findRewardTypeBySignal(patch?.rewardTypes ?? input.storyContract?.rewardTypes, input.item.intent)?.id
    ?? inferRewardTypeFromDelta(input.item);

  return {
    arenaClusterId,
    opponentClusterId,
    rewardType,
    relationshipBeatId: input.item.relationshipBeatId ?? null,
  };
}

function collectRepeatedRewardType(recentDeltaRecords: ChapterDeltaRecord[]) {
  if (recentDeltaRecords.length < 2) {
    return null;
  }
  const last = recentDeltaRecords.at(-1)?.rewardType ?? null;
  const prev = recentDeltaRecords.at(-2)?.rewardType ?? null;
  return last && prev && last === prev ? last : null;
}

export function buildPlannerAvoidanceDirectives(input: {
  progressState: StoryProgressState;
  patch?: ProjectStorySeedPatch | null;
  storyContract?: StoryContract | null;
  recentDeltaRecords: ChapterDeltaRecord[];
}): PlannerAvoidanceDirectives {
  const structured = buildStructuredAvoidanceList(input.progressState);
  const hardAvoid: string[] = [];
  const softAvoid: string[] = [];

  if (input.progressState.stuckDimensions.includes("arena_loop")) {
    const clusterLabels = structured.avoidArenaKeys
      .map((arenaKey) =>
        resolveSegmentRuntimeMetadata({
          item: {
            id: "runtime-arena",
            chapterNo: 0,
            title: "",
            intent: "",
            requiredProgressDeltas: [],
            requiredObligations: [],
            focusCharacters: [],
            arenaHints: [arenaKey],
            suggestedActionPattern: null,
            antagonistHint: null,
            forbiddenRecentAxes: [],
          },
          patch: input.patch,
          storyContract: input.storyContract,
        }).arenaClusterId
      )
      .filter(Boolean)
      .map((clusterId) => findArenaClusterLabel(clusterId!, input.patch, input.storyContract));
    if (clusterLabels.length) {
      hardAvoid.push(`禁止回到「${[...new Set(clusterLabels)].join("、")}」这类同场域簇。`);
    }
  }

  if (input.progressState.stuckDimensions.includes("antagonist_loop")) {
    const clusterLabels = structured.avoidAntagonistKeys
      .map((name) =>
        resolveSegmentRuntimeMetadata({
          item: {
            id: "runtime-opponent",
            chapterNo: 0,
            title: "",
            intent: "",
            requiredProgressDeltas: [],
            requiredObligations: [],
            focusCharacters: [],
            arenaHints: [],
            suggestedActionPattern: null,
            antagonistHint: name,
            forbiddenRecentAxes: [],
          },
          patch: input.patch,
          storyContract: input.storyContract,
        }).opponentClusterId
      )
      .filter(Boolean)
      .map((clusterId) => findOpponentClusterLabel(clusterId!, input.patch, input.storyContract));
    if (clusterLabels.length) {
      hardAvoid.push(`禁止让「${[...new Set(clusterLabels)].join("、")}」继续独占主压迫。`);
    }
  }

  if (input.progressState.stuckDimensions.includes("objective_loop") && structured.avoidObjectiveKeys.length) {
    hardAvoid.push(`禁止继续围着「${structured.avoidObjectiveKeys.join("、")}」同一目标打转。`);
  }

  const repeatedRewardType = collectRepeatedRewardType(input.recentDeltaRecords);
  if (repeatedRewardType) {
    hardAvoid.push(`禁止继续把主收益锁死在「${findRewardTypeLabel(repeatedRewardType, input.patch, input.storyContract)}」。`);
  }

  if (structured.avoidActionPatterns.length >= 2) {
    softAvoid.push(`建议换掉最近连续复用的行动模式：${structured.avoidActionPatterns.join("、")}。`);
  }
  if (structured.avoidMotifTokens.length) {
    softAvoid.push(`避开高频回钉意象词：${structured.avoidMotifTokens.join("、")}。`);
  }

  return {
    hardAvoid,
    softAvoid,
    promptLines: [...hardAvoid, ...softAvoid],
  };
}
