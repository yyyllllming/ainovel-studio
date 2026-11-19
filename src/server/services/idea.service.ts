import "../server-only.ts";

import { notFound } from "../errors.ts";
import { writeIdeaMirror } from "../library-files.ts";
import { readProjectMeta, writeProjectMeta } from "../project-files.ts";
import { getIdeaWorkshopSnapshot, streamIdeaWorkshopMessage } from "../foundation/idea-workshop.ts";
import {
  createIdea,
  getIdea,
  getIdeaWorkshopState,
  listIdeaWorkshopMessages,
  listIdeas,
  listTrashedIdeas,
  restoreIdea,
  softDeleteIdea,
  updateIdea,
} from "../repositories/idea.repository.ts";
import { listProjectsBySourceIdea } from "../repositories/project.repository.ts";
import { createProjectWithMeta } from "./project.service.ts";
import { getDefaultWorkshopDraft } from "../repositories/shared.ts";

function buildIdeaSummary(ideaId: string) {
  const idea = getIdea(ideaId);
  if (!idea) {
    return null;
  }
  const state = getIdeaWorkshopState(ideaId);
  const projects = listProjectsBySourceIdea(ideaId).filter((project) => !project.deletedAt);
  return {
    idea,
    preview:
      state?.draft.premise.trim()
      || state?.draft.mainline.trim()
      || state?.draft.storyHook.trim()
      || "",
    updatedAt: state?.updatedAt ?? idea.updatedAt,
    projectCount: projects.length,
  };
}

async function syncIdeaMirror(ideaId: string) {
  const idea = getIdea(ideaId);
  if (!idea) {
    return;
  }
  await writeIdeaMirror({
    idea,
    state: getIdeaWorkshopState(ideaId),
    messages: listIdeaWorkshopMessages(ideaId),
  });
}

export function listIdeaSummaries() {
  return listIdeas()
    .map((entry) => buildIdeaSummary(entry.id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export function listTrashedIdeaSummaries() {
  return listTrashedIdeas()
    .map((entry) => buildIdeaSummary(entry.id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

export async function createIdeaWithMeta(input?: { title?: string }) {
  const idea = createIdea(input);
  if (!idea) {
    throw new Error("创建想法失败");
  }
  await syncIdeaMirror(idea.id);
  return buildIdeaSummary(idea.id);
}

export async function updateIdeaWithMeta(ideaId: string, input: { title?: string; deleted?: boolean }) {
  if (input.deleted === true) {
    softDeleteIdea(ideaId);
  } else if (input.deleted === false) {
    restoreIdea(ideaId);
  }

  if (input.title !== undefined) {
    updateIdea(ideaId, { title: input.title });
  }

  await syncIdeaMirror(ideaId);
  return buildIdeaSummary(ideaId);
}

export async function getIdeaDetail(ideaId: string) {
  const snapshot = getIdeaWorkshopSnapshot(ideaId);
  const projects = listProjectsBySourceIdea(ideaId);
  return {
    ...snapshot,
    projects,
  };
}

export function getWorkshopSnapshot(ideaId: string) {
  return getIdeaWorkshopSnapshot(ideaId);
}

export async function streamWorkshopMessage(
  ideaId: string,
  input: { message: string; baseUpdatedAt?: string; profileId?: string },
  emit: (event: Record<string, unknown>) => Promise<void> | void,
) {
  return streamIdeaWorkshopMessage(ideaId, input, emit);
}

export async function createProjectFromIdeaWithMeta(
  ideaId: string,
  input: Parameters<typeof createProjectWithMeta>[0],
) {
  const idea = getIdea(ideaId);
  if (!idea) {
    throw notFound("想法不存在", { ideaId });
  }
  const state = getIdeaWorkshopState(ideaId);
  const messages = listIdeaWorkshopMessages(ideaId);
  const draft = state?.draft ?? getDefaultWorkshopDraft({
    title: idea.title,
    genre: input.genre,
    style: input.style,
    premise: input.premise,
    storyLength: input.storyLength,
  });
  const seedDraft = {
    ...getDefaultWorkshopDraft({
      title: input.title,
      genre: input.genre,
      style: input.style,
      premise: draft.premise || input.premise,
      storyLength: input.storyLength,
    }),
    premise: draft.premise || input.premise,
    mainline: draft.mainline,
    storyHook: draft.storyHook,
    desiredTone: draft.desiredTone || input.style,
    characterIdeas: draft.characterIdeas,
    worldviewIdeas: draft.worldviewIdeas,
    relationshipIdeas: draft.relationshipIdeas,
    unresolvedQuestions: draft.unresolvedQuestions,
  };

  const project = await createProjectWithMeta({
    ...input,
    premise: draft.premise || input.premise,
    sourceIdeaId: ideaId,
    workshopSeed: {
      draft: seedDraft,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      })),
    },
  });

  const existingMeta = await readProjectMeta(project.id);
  await writeProjectMeta(project.id, {
    ...(existingMeta ?? {}),
    sourceIdeaId: ideaId,
    sourceIdeaSnapshot: {
      id: idea.id,
      title: idea.title,
      draft: {
        premise: seedDraft.premise,
        mainline: seedDraft.mainline,
        storyHook: seedDraft.storyHook,
        desiredTone: seedDraft.desiredTone,
        characterIdeas: seedDraft.characterIdeas,
        worldviewIdeas: seedDraft.worldviewIdeas,
        relationshipIdeas: seedDraft.relationshipIdeas,
        unresolvedQuestions: seedDraft.unresolvedQuestions,
      },
    },
  });

  return project;
}
