import "../server-only.ts";

import { readFinalChapter } from "../project-files.ts";
import { getFoundation } from "../repositories/foundation.repository.ts";
import { getProject, getStoryContract, saveStoryContract } from "../repositories/project.repository.ts";
import { getBlueprint } from "../repositories/foundation.repository.ts";
import { listChapterDeltaRecords, saveChapterDeltaRecord } from "../repositories/review.repository.ts";
import { type ProjectExecutionContext } from "../services/project-execution-context.ts";
import type { FoundationPayload } from "../types.ts";
import { nowIso } from "../utils.ts";
import { hydrateStoryContract } from "./story-contract.ts";
import { buildChapterDeltaRecord, deriveStoryProgressState } from "./story-progression.ts";
import { ensureStoryContract } from "./story-contract-engine.ts";

function getRecentDeltaRecords(projectId: string, chapterNo: number) {
  return listChapterDeltaRecords(projectId, { uptoChapter: Math.max(0, chapterNo - 1) }).slice(-4);
}

async function resolveActiveStoryContract(
  projectId: string,
  project: NonNullable<ReturnType<typeof getProject>>,
  foundation: FoundationPayload,
  executionContext?: ProjectExecutionContext,
) {
  return hydrateStoryContract(
    project.storyContract ?? getStoryContract(projectId) ?? await ensureStoryContract(projectId, executionContext),
    {
      genre: project.genre,
      premise: foundation.premise,
      completionCriteria: project.completionCriteria,
      latestChapter: Math.max(
        project.storyContract?.progressState?.latestChapter
          ?? getStoryContract(projectId)?.progressState?.latestChapter
          ?? 0,
        0,
      ),
      foundation,
    },
  );
}

export async function syncAcceptedChapterStoryProgressState(
  projectId: string,
  chapterNo: number,
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  const blueprint = getBlueprint(projectId, chapterNo);
  if (!project || !foundation || !blueprint) {
    return null;
  }

  const storyContract = await resolveActiveStoryContract(projectId, project, foundation, executionContext);
  const recentDeltaRecords = getRecentDeltaRecords(projectId, chapterNo + 1);
  const chapterContent = await readFinalChapter(projectId, chapterNo);
  const deltaRecord = buildChapterDeltaRecord({
    projectId,
    chapterNo,
    blueprint,
    activations: storyContract.genreObligationPacks,
    recentDeltaRecords,
    chapterContent,
  });
  saveChapterDeltaRecord(deltaRecord);

  const progressState = deriveStoryProgressState(listChapterDeltaRecords(projectId));
  const nextContract = hydrateStoryContract(
    {
      ...storyContract,
      progressState,
      updatedAt: nowIso(),
    },
    {
      genre: project.genre,
      premise: foundation.premise,
      completionCriteria: project.completionCriteria,
      latestChapter: progressState.latestChapter,
      foundation,
    },
  );
  saveStoryContract(projectId, nextContract);
  return {
    deltaRecord,
    storyContract: nextContract,
  };
}
