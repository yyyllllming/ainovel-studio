import "../server-only.ts";

import { z } from "zod";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { appendRunStatistic } from "../repositories/run.repository.ts";
import { getStoryContract, saveStoryContract } from "../repositories/project.repository.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import type { FoundationPayload, SegmentPlanItem, StoryContract } from "../types.ts";
import { nowIso } from "../utils.ts";
import { hydrateStoryContract } from "./story-contract.ts";
import { buildSegmentPlans, normalizeSegmentPlanItem } from "./story-progression.ts";

const pendingNarrativeRewrites = new Map<string, Promise<void>>();

const narrativeRewriteSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    narrativeTitle: z.string().min(1),
    narrativeIntent: z.string().min(1),
    narrativeSummary: z.string().min(1),
    arcConnection: z.string().min(1),
    nextHook: z.string().min(1),
  })).default([]),
});

function nextSegmentStartChapter(contract: StoryContract, latestChapter: number) {
  const existingMax = contract.segmentPlans.reduce((max, segment) => Math.max(max, segment.endChapter), latestChapter);
  return Math.max(latestChapter + 1, existingMax + 1);
}

function trimNarrativeValue(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function hasCompleteNarrativeLayer(item: SegmentPlanItem) {
  return Boolean(
    item.narrativeTitle?.trim()
    && item.narrativeIntent?.trim()
    && item.narrativeSummary?.trim()
    && item.arcConnection?.trim()
    && item.nextHook?.trim(),
  );
}

export function applyNarrativeFieldsToSegmentItem(
  item: SegmentPlanItem,
  narrative: {
    narrativeTitle?: string | null;
    narrativeIntent?: string | null;
    narrativeSummary?: string | null;
    arcConnection?: string | null;
    nextHook?: string | null;
  },
) {
  const normalized = {
    narrativeTitle: trimNarrativeValue(narrative.narrativeTitle),
    narrativeIntent: trimNarrativeValue(narrative.narrativeIntent),
    narrativeSummary: trimNarrativeValue(narrative.narrativeSummary),
    arcConnection: trimNarrativeValue(narrative.arcConnection),
    nextHook: trimNarrativeValue(narrative.nextHook),
  };

  const nextItem = normalizeSegmentPlanItem({
    ...item,
    narrativeTitle: item.userOverridden && item.narrativeTitle?.trim()
      ? item.narrativeTitle
      : normalized.narrativeTitle ?? item.narrativeTitle ?? null,
    narrativeIntent: item.userOverridden && item.narrativeIntent?.trim()
      ? item.narrativeIntent
      : normalized.narrativeIntent ?? item.narrativeIntent ?? null,
    narrativeSummary: item.userOverridden && item.narrativeSummary?.trim()
      ? item.narrativeSummary
      : normalized.narrativeSummary ?? item.narrativeSummary ?? null,
    arcConnection: item.userOverridden && item.arcConnection?.trim()
      ? item.arcConnection
      : normalized.arcConnection ?? item.arcConnection ?? null,
    nextHook: item.userOverridden && item.nextHook?.trim()
      ? item.nextHook
      : normalized.nextHook ?? item.nextHook ?? null,
  });

  return {
    ...nextItem,
    rewriteStatus: "ready" as const,
  };
}

function collectRewriteTargets(contract: StoryContract, chapterNo: number) {
  return contract.segmentPlans
    .filter((segment) => segment.endChapter >= chapterNo)
    .flatMap((segment) => segment.items.map((item) => normalizeSegmentPlanItem(item)))
    .filter((item) => item.chapterNo >= chapterNo && (!hasCompleteNarrativeLayer(item) || item.rewriteStatus === "failed"))
    .slice(0, 8);
}

function patchSegmentNarratives(
  contract: StoryContract,
  patches: Map<string, ReturnType<typeof applyNarrativeFieldsToSegmentItem>>,
) {
  let changed = false;
  const segmentPlans = contract.segmentPlans.map((segment) => ({
    ...segment,
    items: segment.items.map((item) => {
      const patched = patches.get(item.id);
      if (!patched) {
        return item;
      }
      changed = true;
      return patched;
    }),
  }));

  return changed
    ? {
      ...contract,
      segmentPlans,
      updatedAt: nowIso(),
    }
    : contract;
}

function markSegmentNarrativesFailed(contract: StoryContract, itemIds: Set<string>) {
  let changed = false;
  const segmentPlans = contract.segmentPlans.map((segment) => ({
    ...segment,
    items: segment.items.map((item) => {
      if (!itemIds.has(item.id)) {
        return item;
      }
      const normalized = normalizeSegmentPlanItem(item);
      if (normalized.rewriteStatus === "failed") {
        return normalized;
      }
      changed = true;
      return {
        ...normalized,
        rewriteStatus: "failed" as const,
      };
    }),
  }));

  return changed
    ? {
      ...contract,
      segmentPlans,
      updatedAt: nowIso(),
    }
    : contract;
}

async function rewriteSegmentNarratives(input: {
  projectId: string;
  project: {
    title?: string | null;
    genre: string;
    style?: string | null;
    completionCriteria?: string | null;
  };
  foundation: FoundationPayload;
  contract: StoryContract;
  chapterNo: number;
  executionContext?: ProjectExecutionContext;
}) {
  const targets = collectRewriteTargets(input.contract, input.chapterNo);
  if (!targets.length) {
    return;
  }

  if (!input.executionContext && !input.project.style) {
    return;
  }

  const context = input.executionContext
    ?? await getProjectExecutionContext(input.projectId, input.project.style ?? "default");
  const startedAt = Date.now();
  const targetIds = new Set(targets.map((item) => item.id));

  try {
    const result = await chatJsonWithWorkflowPolicy(
      {
        workflow: "segment_rewrite",
        profile: context.agents.planner.profile,
        model: context.agents.planner.assignment.model,
        messages: [
          {
            role: "system",
            content: `${context.prompts.planner}

你负责把 deterministic segment skeleton 改写成更自然的叙事展示层，但绝不能改动骨架真相。
必须输出 JSON，字段只有 items。
每个 item 只允许返回：id / narrativeTitle / narrativeIntent / narrativeSummary / arcConnection / nextHook。`,
          },
          {
            role: "user",
            content: [
              `项目：${input.project.title ?? input.projectId}`,
              `题材：${input.project.genre}`,
              `卷目标：${input.contract.volumes.find((volume) => volume.volumeNo === input.contract.currentVolume)?.goal ?? input.contract.endingPromise}`,
              `主线：${input.contract.globalArc}`,
              `角色：${JSON.stringify(input.foundation.characters, null, 2)}`,
              `待改写 skeleton：\n${JSON.stringify(targets.map((item) => ({
                id: item.id,
                chapterNo: item.chapterNo,
                title: item.title,
                intent: item.intent,
                requiredProgressDeltas: item.requiredProgressDeltas,
                requiredObligations: item.requiredObligations,
                focusCharacters: item.focusCharacters,
                arenaHints: item.arenaHints,
              })), null, 2)}`,
              "规则：",
              "1. narrativeTitle / narrativeIntent 要比 skeleton 更像读者会看到的章节推进描述，但必须忠于原 skeleton。",
              "2. narrativeSummary 只写 1-2 句，不要展开成大纲 prose。",
              "3. arcConnection 只写这一章如何接主线或当前卷目标。",
              "4. nextHook 只写下一章必须接住的扣子。",
              "5. 不允许改写 title / intent 的结构含义，不允许新增章数，不允许合并条目。",
            ].join("\n\n"),
          },
        ],
        assignmentMaxTokens: context.agents.planner.assignment.maxTokens,
        temperature: Math.min(0.55, context.agents.planner.assignment.temperature),
      },
      narrativeRewriteSchema,
    );

    const patches = new Map<string, ReturnType<typeof applyNarrativeFieldsToSegmentItem>>();
    for (const item of result.items) {
      const existing = targets.find((entry) => entry.id === item.id);
      if (!existing) {
        continue;
      }
      patches.set(item.id, applyNarrativeFieldsToSegmentItem(existing, item));
    }

    const latestContract = getStoryContract(input.projectId) ?? input.contract;
    const nextContract = patchSegmentNarratives(latestContract, patches);
    if (JSON.stringify(nextContract) !== JSON.stringify(latestContract)) {
      saveStoryContract(input.projectId, nextContract);
    }

    appendRunStatistic(input.projectId, input.chapterNo, "segment_rewrite", {
      rewriteAttempted: targets.length,
      rewriteSucceeded: patches.size,
      rewriteFailed: Math.max(0, targets.length - patches.size),
      latencyMs: Date.now() - startedAt,
      usedSkeletonFallback: patches.size < targets.length,
    });
  } catch {
    const latestContract = getStoryContract(input.projectId) ?? input.contract;
    const nextContract = markSegmentNarrativesFailed(latestContract, targetIds);
    if (JSON.stringify(nextContract) !== JSON.stringify(latestContract)) {
      saveStoryContract(input.projectId, nextContract);
    }

    appendRunStatistic(input.projectId, input.chapterNo, "segment_rewrite", {
      rewriteAttempted: targets.length,
      rewriteSucceeded: 0,
      rewriteFailed: targets.length,
      latencyMs: Date.now() - startedAt,
      usedSkeletonFallback: true,
    });
  }
}

function queueSegmentNarrativeRewrite(input: Parameters<typeof rewriteSegmentNarratives>[0]) {
  const pending = pendingNarrativeRewrites.get(input.projectId);
  if (pending) {
    return pending;
  }

  const task = rewriteSegmentNarratives(input)
    .catch((error) => { console.warn("[segment-plan] narrative rewrite failed, skipped:", String(error)); })
    .finally(() => {
      pendingNarrativeRewrites.delete(input.projectId);
    });

  pendingNarrativeRewrites.set(input.projectId, task);
  return task;
}

export async function ensureSegmentPlans(
  projectId: string,
  chapterNo: number,
  project: {
    title?: string | null;
    genre: string;
    style?: string | null;
    completionCriteria?: string | null;
  },
  foundation: FoundationPayload,
  contract: StoryContract,
  executionContext?: ProjectExecutionContext,
) {
  const synced = hydrateStoryContract(contract, {
    genre: project.genre,
    premise: foundation.premise,
    completionCriteria: project.completionCriteria ?? contract.endingPromise,
    latestChapter: chapterNo - 1,
    foundation,
  });
  let nextContract = synced;
  const latestChapter = Math.max(0, chapterNo - 1);
  const activeOrQueued = synced.segmentPlans.filter((segment) => segment.endChapter >= chapterNo);

  if (!activeOrQueued.length) {
    nextContract = {
      ...synced,
      segmentPlans: [
        ...synced.segmentPlans,
        ...buildSegmentPlans({
          startingChapter: chapterNo,
          currentVolumeGoal:
            synced.volumes.find((item) => item.volumeNo === synced.currentVolume)?.goal
            ?? synced.endingPromise,
          endingPromise: synced.endingPromise,
          foundation,
          activations: synced.genreObligationPacks,
          existingPlans: synced.segmentPlans,
          trigger: "seed",
        }),
      ],
      updatedAt: nowIso(),
    };
  } else if (activeOrQueued.length < 2) {
    nextContract = {
      ...synced,
      segmentPlans: [
        ...synced.segmentPlans,
        ...buildSegmentPlans({
          startingChapter: nextSegmentStartChapter(synced, latestChapter),
          currentVolumeGoal:
            synced.volumes.find((item) => item.volumeNo === synced.currentVolume)?.goal
            ?? synced.endingPromise,
          endingPromise: synced.endingPromise,
          foundation,
          activations: synced.genreObligationPacks,
          existingPlans: synced.segmentPlans,
          trigger: "refresh",
        }),
      ],
      updatedAt: nowIso(),
    };
  }

  if (JSON.stringify(nextContract) !== JSON.stringify(contract)) {
    saveStoryContract(projectId, nextContract);
  }

  void queueSegmentNarrativeRewrite({
    projectId,
    project,
    foundation,
    contract: nextContract,
    chapterNo,
    executionContext,
  });

  return nextContract;
}
