import "../server-only.ts";

import { z } from "zod";
import { buildProjectPromptSummary } from "../domain/project-structure.ts";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { listWrittenChapters } from "../project-files.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getFoundation } from "../repositories/foundation.repository.ts";
import { getProject, saveStoryContract } from "../repositories/project.repository.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import type { Milestone, StoryContract, StoryContractVolume } from "../types.ts";
import { buildFallbackStoryContract, hydrateStoryContract } from "./story-contract.ts";
import { nowIso } from "../utils.ts";

const storyContractPlanSchema = z.object({
  globalArc: z.string().min(1),
  endingPromise: z.string().min(1),
  completionChecks: z.array(z.string().min(1)).min(1).max(6),
  nextMilestone: z.string().min(1),
  volumes: z.array(
    z.object({
      label: z.string().min(1),
      goal: z.string().min(1),
      milestones: z.array(z.object({
        label: z.string().min(1),
        goal: z.string().min(1),
        expectedChapterStart: z.number().int().positive().nullable().optional(),
        expectedChapterEnd: z.number().int().positive().nullable().optional(),
        notes: z.string().optional().default(""),
      })).optional().default([]),
    }),
  ).min(1).max(12),
});

const milestoneGenerationSchema = z.object({
  volumes: z.array(z.object({
    volumeNo: z.number().int().positive(),
    milestones: z.array(z.object({
      label: z.string().min(1),
      goal: z.string().min(1),
      expectedChapterStart: z.number().int().positive().nullable().optional(),
      expectedChapterEnd: z.number().int().positive().nullable().optional(),
      notes: z.string().optional().default(""),
    })).default([]),
  })).default([]),
});

function buildFallbackMilestonesForVolume(volume: StoryContractVolume) {
  const milestoneCount = volume.chapterBudgetTarget >= 12 ? 3 : volume.chapterBudgetTarget >= 6 ? 2 : 1;
  const span = Math.max(1, Math.ceil(volume.chapterBudgetTarget / milestoneCount));

  return Array.from({ length: milestoneCount }, (_, index) => {
    const start = volume.chapterStart + index * span;
    const end = index === milestoneCount - 1
      ? volume.chapterStart + volume.chapterBudgetTarget - 1
      : Math.min(volume.chapterStart + volume.chapterBudgetTarget - 1, start + span - 1);
    return {
      id: `${volume.volumeNo}-milestone-${index + 1}`,
      label: `${volume.label}里程碑 ${index + 1}`,
      goal: index === milestoneCount - 1
        ? `完成${volume.goal}`
        : `把${volume.goal}推进到下一层。`,
      expectedChapterStart: start,
      expectedChapterEnd: end,
      status: "planned" as const,
      notes: "",
    } satisfies Milestone;
  });
}

function normalizeGeneratedMilestones(
  volume: StoryContractVolume,
  milestones: Array<{
    label: string;
    goal: string;
    expectedChapterStart?: number | null;
    expectedChapterEnd?: number | null;
    notes?: string;
  }> | undefined,
) {
  const source = milestones?.length ? milestones : buildFallbackMilestonesForVolume(volume);
  return source.map((milestone, index) => ({
    id: `${volume.volumeNo}-milestone-${index + 1}`,
    label: milestone.label.trim(),
    goal: milestone.goal.trim(),
    expectedChapterStart: milestone.expectedChapterStart ?? null,
    expectedChapterEnd: milestone.expectedChapterEnd ?? null,
    status: "planned" as const,
    notes: milestone.notes?.trim() ?? "",
  }));
}

async function requestVolumeMilestones(input: {
  projectId: string;
  project: NonNullable<ReturnType<typeof getProject>>;
  foundation: NonNullable<ReturnType<typeof getFoundation>>;
  contract: StoryContract;
  context: ProjectExecutionContext;
  onlyMissing?: boolean;
}) {
  const requestedVolumes = input.contract.volumes
    .filter((volume) => !input.onlyMissing || !volume.milestones?.length)
    .map((volume) => ({
      volumeNo: volume.volumeNo,
      label: volume.label,
      goal: volume.goal,
      chapterStart: volume.chapterStart,
      chapterBudgetTarget: volume.chapterBudgetTarget,
      chapterBudgetMax: volume.chapterBudgetMax,
    }));

  if (!requestedVolumes.length) {
    return input.contract;
  }

  const planned = await chatJsonWithWorkflowPolicy(
    {
      workflow: "story_contract",
      profile: input.context.agents.planner.profile,
      model: input.context.agents.planner.assignment.model,
      messages: [
        {
          role: "system",
          content: `${input.context.prompts.planner}

你负责生成卷级 milestones。必须输出 JSON，字段只有 volumes。`,
        },
        {
          role: "user",
          content: [
            `项目：${input.project.title}`,
            buildProjectPromptSummary(input.project),
            `premise：${input.foundation.premise}`,
            `story contract：\n${JSON.stringify({
              globalArc: input.contract.globalArc,
              endingPromise: input.contract.endingPromise,
              completionChecks: input.contract.completionChecks,
              volumes: requestedVolumes,
            }, null, 2)}`,
            "要求：",
            "1. 每卷给 1-3 个 milestone，属于长期真相层锚点。",
            "2. milestone 必须是阶段目标，不要写展示文案。",
            "3. expectedChapterStart / expectedChapterEnd 只填这一卷内的合理范围。",
            "4. notes 可为空。",
          ].join("\n\n"),
        },
      ],
      assignmentMaxTokens: input.context.agents.planner.assignment.maxTokens,
      temperature: Math.min(0.45, input.context.agents.planner.assignment.temperature),
    },
    milestoneGenerationSchema,
  ).catch((error) => { console.warn("[story-contract] milestone generation failed:", String(error)); return null; });

  const plannedByVolume = new Map(
    (planned?.volumes ?? []).map((volume) => [volume.volumeNo, volume.milestones] as const),
  );

  const nextContract: StoryContract = {
    ...input.contract,
    volumes: input.contract.volumes.map((volume) => (
      input.onlyMissing && volume.milestones?.length
        ? volume
        : {
          ...volume,
          milestones: normalizeGeneratedMilestones(volume, plannedByVolume.get(volume.volumeNo)),
        }
    )),
    updatedAt: nowIso(),
  };

  return nextContract;
}

export async function ensureStoryContract(projectId: string, executionContext?: ProjectExecutionContext) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  if (!project || !foundation) {
    throw new Error("缺少生成 story contract 所需的项目或设定");
  }
  if (project.storyContract) {
    const writtenChapters = await listWrittenChapters(projectId);
    const hydrated = hydrateStoryContract(project.storyContract, {
      genre: project.genre,
      premise: foundation.premise,
      completionCriteria: project.completionCriteria,
      latestChapter: writtenChapters.length,
      foundation,
    });
    if (JSON.stringify(hydrated) !== JSON.stringify(project.storyContract)) {
      saveStoryContract(projectId, hydrated);
    }
    return hydrated;
  }

  const baseContract = buildFallbackStoryContract({
    title: project.title,
    genre: project.genre,
    premise: foundation.premise,
    chapterPlanningMode: project.chapterPlanningMode,
    storyLength: project.storyLength,
    plannedVolumes: project.plannedVolumes,
    chapterBudgetMin: project.chapterBudgetMin,
    chapterBudgetTarget: project.chapterBudgetTarget,
    chapterBudgetMax: project.chapterBudgetMax,
    hardChapterCap: project.hardChapterCap,
    completionCriteria: project.completionCriteria,
  });

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const plan = await chatJsonWithWorkflowPolicy(
    {
      workflow: "story_contract",
      profile: context.agents.planner.profile,
      model: context.agents.planner.assignment.model,
      messages: [
        {
          role: "system",
          content: `${context.prompts.planner}

你现在负责创建小说的 story contract，不是固定大纲。你的目标是给出多卷目标、整体主线、完结承诺和完成检查项。必须输出 JSON。`,
        },
        {
          role: "user",
          content: [
            `项目：${project.title}`,
            buildProjectPromptSummary(project),
            `premise：${foundation.premise}`,
            `风格卡：\n${context.styleCard}`,
            `角色：\n${JSON.stringify(foundation.characters, null, 2)}`,
            `世界观：\n${JSON.stringify(foundation.worldview, null, 2)}`,
            `默认 fallback contract：\n${JSON.stringify(baseContract, null, 2)}`,
            "请保持卷数不变，但把每卷职责、整体主线和完结承诺说清楚。",
          ].join("\n\n"),
        },
      ],
      assignmentMaxTokens: context.agents.planner.assignment.maxTokens,
      temperature: context.agents.planner.assignment.temperature,
    },
    storyContractPlanSchema,
  ).catch((error) => { console.warn("[story-contract] contract plan generation failed:", String(error)); return null; });

  const nextContract: StoryContract = {
    ...baseContract,
    globalArc: plan?.globalArc || baseContract.globalArc,
    endingPromise: plan?.endingPromise || baseContract.endingPromise,
    completionChecks: plan?.completionChecks?.length ? plan.completionChecks : baseContract.completionChecks,
    forecast: {
      ...baseContract.forecast,
      nextMilestone: plan?.nextMilestone || baseContract.forecast.nextMilestone,
    },
    volumes: baseContract.volumes.map((volume, index) => ({
      ...volume,
      label: plan?.volumes[index]?.label || volume.label,
      goal: plan?.volumes[index]?.goal || volume.goal,
      milestones: normalizeGeneratedMilestones({
        ...volume,
        label: plan?.volumes[index]?.label || volume.label,
        goal: plan?.volumes[index]?.goal || volume.goal,
      }, plan?.volumes[index]?.milestones),
    })),
    updatedAt: nowIso(),
  };

  const hydrated = hydrateStoryContract(nextContract, {
    genre: project.genre,
    premise: foundation.premise,
    completionCriteria: project.completionCriteria,
    latestChapter: (await listWrittenChapters(projectId)).length,
    foundation,
  });
  saveStoryContract(projectId, hydrated);
  appendRunLog(projectId, "info", "已生成 story contract");
  return hydrated;
}

export async function generateStoryContractMilestones(projectId: string, executionContext?: ProjectExecutionContext) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  if (!project || !foundation) {
    throw new Error("缺少生成卷级里程碑所需的项目或设定");
  }

  const contract = project.storyContract ?? await ensureStoryContract(projectId, executionContext);
  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const nextContract = await requestVolumeMilestones({
    projectId,
    project,
    foundation,
    contract,
    context,
    onlyMissing: true,
  });

  saveStoryContract(projectId, nextContract);
  appendRunLog(projectId, "info", "已补齐卷级 milestones");
  return nextContract;
}
