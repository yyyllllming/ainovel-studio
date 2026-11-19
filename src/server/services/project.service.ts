import "../server-only.ts";

import { rm } from "node:fs/promises";
import {
  buildProjectStructureSummary,
  type NarrativePerson,
} from "../domain/project-structure.ts";
import { internalError, notFound } from "../errors.ts";
import { withinProject } from "../paths.ts";
import { getIdea, getIdeaWorkshopState } from "../repositories/idea.repository.ts";
import {
  createProject as createProjectRecord,
  addSteeringNote,
  getAssignments,
  getProject,
  listActiveSteeringNotes,
  listProjects,
  listTrashedProjects,
  purgeProject as purgeProjectRecord,
  restoreProject as restoreProjectRecord,
  saveAssignments as saveAssignmentsRecord,
  saveProjectSettings as saveProjectSettingsRecord,
  softDeleteProject as softDeleteProjectRecord,
} from "../repositories/project.repository.ts";
import {
  getFoundation,
  getFoundationWorkshopState,
  isFoundationLocked,
  listBlueprints,
  lockFoundation,
} from "../repositories/foundation.repository.ts";
import { listChapterInvalidations } from "../repositories/chapter.repository.ts";
import {
  listChapterReviewStates,
  listConflicts,
  listReviewReports,
} from "../repositories/review.repository.ts";
import { getRunState, listRunLogs, summarizeBlueprintRunHealth } from "../repositories/run.repository.ts";
import { listWrittenChapters, readFinalChapter, readNovelExport, readProjectMeta, writeProjectMeta } from "../project-files.ts";
import { buildNovelPreviewPayload } from "../files/novel-export.ts";
import { getRunProgress } from "../run/progress.service.ts";
import { deriveEffectiveRunStage } from "../run/run-state.ts";
import { getFoundationDriftReport } from "./foundation-truth-source.service.ts";
import { listProjectDegradedArtifacts } from "./degradation-diagnostics.service.ts";
import { generateStoryContractMilestones } from "../story/story-contract-engine.ts";
import type { NovelPreviewFormat, ReviewPolicy, SteeringNote } from "../types.ts";
import { listCurrentReviewReports } from "./review-content-identity.service.ts";

async function buildProjectSnapshot(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    return null;
  }

  const rawRunState = getRunState(projectId);
  const runState = rawRunState
    ? {
      ...rawRunState,
      stage: deriveEffectiveRunStage(rawRunState.stage, rawRunState.desiredState, rawRunState.heartbeatAt),
      status: deriveEffectiveRunStage(rawRunState.status, rawRunState.desiredState, rawRunState.heartbeatAt),
    }
    : null;
  const foundationDrift = getFoundationDriftReport(projectId);
  const degradedArtifacts = await listProjectDegradedArtifacts(projectId);

  return {
    project,
    storyContract: project.storyContract,
    steeringNotes: project.steeringNotes,
    resolvedReviewPolicy: project.reviewPolicy,
    assignments: getAssignments(projectId),
    foundation: getFoundation(projectId),
    foundationLocked: isFoundationLocked(projectId),
    coreDrift: foundationDrift.coreDrift,
    blockingReason: foundationDrift.blockingReason,
    foundationWorkshop: getFoundationWorkshopState(projectId),
    degradedArtifacts,
    runState,
    blueprints: listBlueprints(projectId),
    recentReviews: await listCurrentRecentReviews(projectId),
    reviewStates: listChapterReviewStates(projectId),
    invalidatedHistory: listChapterInvalidations(projectId).slice(0, 24),
    conflicts: listConflicts(projectId).slice(0, 10),
    runStatisticsSummary: summarizeBlueprintRunHealth(projectId),
    logs: listRunLogs(projectId, 20).reverse().map((entry) => ({
      level: entry.level,
      message: entry.message,
      createdAt: entry.created_at,
    })),
  };
}

export async function listCurrentRecentReviews(projectId: string, limit = 5) {
  const currentByChapter = new Map<number, Map<string, ReturnType<typeof listReviewReports>[number]>>();
  const currentReports = [] as ReturnType<typeof listReviewReports>;
  const safeLimit = Math.max(1, Math.min(limit, 50));

  for (const report of listReviewReports(projectId)) {
    if (!currentByChapter.has(report.chapterNo)) {
      currentByChapter.set(
        report.chapterNo,
        new Map(
          (await listCurrentReviewReports(projectId, report.chapterNo))
            .filter((candidate) => !candidate.stale)
            .map((candidate) => [candidate.id, candidate]),
        ),
      );
    }
    const current = currentByChapter.get(report.chapterNo)?.get(report.id);
    if (current) {
      currentReports.push(current);
      if (currentReports.length >= safeLimit) {
        break;
      }
    }
  }
  return currentReports;
}

export function listProjectSummaries() {
  return listProjects();
}

export async function createProjectWithMeta(input: Parameters<typeof createProjectRecord>[0]) {
  const project = createProjectRecord(input);
  if (!project) {
    throw internalError("创建项目失败");
  }

  try {
    await writeProjectMeta(project.id, {
      id: project.id,
      title: project.title,
      genre: project.genre,
      style: project.style,
      premise: project.premise,
      sourceIdeaId: project.sourceIdeaId,
      structure: {
        seriesMode: project.seriesMode,
        seriesTitle: project.seriesTitle,
        seriesIndex: project.seriesIndex,
        storyLength: project.storyLength,
        narrativePerson: project.narrativePerson,
        chapterPlanningMode: project.chapterPlanningMode,
        paceProfile: project.paceProfile,
        completionCriteria: project.completionCriteria,
        hasVolumes: project.hasVolumes,
        plannedVolumes: project.plannedVolumes,
        chapterBudgetMin: project.chapterBudgetMin,
        chapterBudgetTarget: project.chapterBudgetTarget,
        chapterBudgetMax: project.chapterBudgetMax,
        hardChapterCap: project.hardChapterCap,
        targetChapters: project.targetChapters,
      },
      storyContract: project.storyContract,
      steeringNotes: project.steeringNotes,
      structureSummary: buildProjectStructureSummary(project),
      updatedAt: project.updatedAt,
    });
  } catch (metaError) {
    console.warn("[projects:create] 写入 project meta 失败", metaError);
  }

  return project;
}

export async function getProjectDetail(projectId: string) {
  const snapshot = await buildProjectSnapshot(projectId);
  if (!snapshot) {
    throw notFound("项目不存在", { projectId });
  }

  const projectMeta = await readProjectMeta(projectId);
  const sourceIdeaSnapshot =
    projectMeta?.sourceIdeaSnapshot
    && typeof projectMeta.sourceIdeaSnapshot === "object"
    && !Array.isArray(projectMeta.sourceIdeaSnapshot)
      ? projectMeta.sourceIdeaSnapshot as {
          id?: unknown;
          title?: unknown;
          draft?: unknown;
        }
      : null;

  const sourceIdea = snapshot.project.sourceIdeaId
    ? (() => {
      const idea = getIdea(snapshot.project.sourceIdeaId!);
      const storedDraft =
        sourceIdeaSnapshot?.draft
        && typeof sourceIdeaSnapshot.draft === "object"
        && !Array.isArray(sourceIdeaSnapshot.draft)
          ? sourceIdeaSnapshot.draft as {
              premise?: unknown;
              mainline?: unknown;
              storyHook?: unknown;
              desiredTone?: unknown;
              characterIdeas?: unknown;
              worldviewIdeas?: unknown;
              relationshipIdeas?: unknown;
              unresolvedQuestions?: unknown;
            }
          : null;
      const storedTitle =
        typeof sourceIdeaSnapshot?.title === "string" && sourceIdeaSnapshot.title.trim()
          ? sourceIdeaSnapshot.title.trim()
          : null;
      if (!idea) {
        return {
          id: snapshot.project.sourceIdeaId,
          title: storedTitle || "来源想法不存在",
          deletedAt: null,
          updatedAt: snapshot.project.updatedAt,
          draft: storedDraft
            ? {
                premise: typeof storedDraft.premise === "string" ? storedDraft.premise : "",
                mainline: typeof storedDraft.mainline === "string" ? storedDraft.mainline : "",
                storyHook: typeof storedDraft.storyHook === "string" ? storedDraft.storyHook : "",
                desiredTone: typeof storedDraft.desiredTone === "string" ? storedDraft.desiredTone : "",
                characterIdeas: Array.isArray(storedDraft.characterIdeas) ? storedDraft.characterIdeas : [],
                worldviewIdeas: Array.isArray(storedDraft.worldviewIdeas) ? storedDraft.worldviewIdeas : [],
                relationshipIdeas: Array.isArray(storedDraft.relationshipIdeas) ? storedDraft.relationshipIdeas : [],
                unresolvedQuestions: Array.isArray(storedDraft.unresolvedQuestions) ? storedDraft.unresolvedQuestions : [],
              }
            : null,
        };
      }
      return {
        id: idea.id,
        title: storedTitle || idea.title,
        deletedAt: idea.deletedAt,
        updatedAt: idea.updatedAt,
        draft: storedDraft
          ? {
              premise: typeof storedDraft.premise === "string" ? storedDraft.premise : "",
              mainline: typeof storedDraft.mainline === "string" ? storedDraft.mainline : "",
              storyHook: typeof storedDraft.storyHook === "string" ? storedDraft.storyHook : "",
              desiredTone: typeof storedDraft.desiredTone === "string" ? storedDraft.desiredTone : "",
              characterIdeas: Array.isArray(storedDraft.characterIdeas) ? storedDraft.characterIdeas : [],
              worldviewIdeas: Array.isArray(storedDraft.worldviewIdeas) ? storedDraft.worldviewIdeas : [],
              relationshipIdeas: Array.isArray(storedDraft.relationshipIdeas) ? storedDraft.relationshipIdeas : [],
              unresolvedQuestions: Array.isArray(storedDraft.unresolvedQuestions) ? storedDraft.unresolvedQuestions : [],
            }
          : getIdeaWorkshopState(idea.id)?.draft ?? null,
      };
    })()
    : null;

  const [novelExport, writtenChapters] = await Promise.all([
    readNovelExport(projectId),
    listWrittenChapters(projectId),
  ]);

  return {
    ...snapshot,
    sourceIdea,
    novelExport,
    writtenChapters,
  };
}

export async function getProjectManuscriptPreview(projectId: string, format: NovelPreviewFormat) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }

  const writtenChapters = await listWrittenChapters(projectId);
  const chapterContents = await Promise.all(
    writtenChapters.map(async (chapterNo) => ({
      chapterNo,
      content: await readFinalChapter(projectId, chapterNo),
    })),
  );

  return buildNovelPreviewPayload({
    title: project.title,
    format,
    chapters: chapterContents,
  });
}

export function updateProjectSettings(projectId: string, input: {
  reviewPolicy?: Partial<ReviewPolicy>;
  narrativePerson?: NarrativePerson;
}) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }

  return saveProjectSettingsRecord(projectId, project.storyLength, input);
}

export function getProjectAssignments(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }

  return getAssignments(projectId);
}

export function updateProjectAssignments(projectId: string, assignments: Parameters<typeof saveAssignmentsRecord>[1]) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }

  saveAssignmentsRecord(projectId, assignments);
  return getAssignments(projectId);
}

export function lockProjectFoundation(projectId: string) {
  if (!getFoundation(projectId)) {
    throw new Error("请先整理出正式设定");
  }

  lockFoundation(projectId);
  return { ok: true };
}

export function addProjectSteeringNote(projectId: string, input: {
  instruction: string;
  scope: SteeringNote["scope"];
}) {
  const progress = getRunProgress(projectId);
  const note = addSteeringNote(projectId, {
    instruction: input.instruction,
    scope: input.scope,
    currentChapter: progress.currentChapter,
  });

  return {
    note,
    activeNotes: listActiveSteeringNotes(projectId, progress.currentChapter),
  };
}

export async function generateProjectMilestones(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }

  const storyContract = await generateStoryContractMilestones(projectId);
  return {
    storyContract,
  };
}

export function listTrashedProjectSummaries() {
  return listTrashedProjects();
}

export function moveProjectToTrash(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }
  softDeleteProjectRecord(projectId);
}

export function restoreProjectFromTrash(projectId: string) {
  return restoreProjectRecord(projectId);
}

export async function purgeProject(projectId: string) {
  purgeProjectRecord(projectId);
  rm(withinProject(projectId), { recursive: true, force: true }).catch((error) =>
    console.warn(`[purge] 磁盘清理失败 ${projectId}:`, error),
  );
}
