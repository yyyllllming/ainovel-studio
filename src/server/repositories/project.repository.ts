import "../server-only.ts";

import { notFound } from "../errors.ts";
import { nanoid } from "nanoid";
import { normalizeProjectAssignments } from "../domain/agent-assignments.ts";
import {
  normalizeProjectStructureInput,
  type NarrativePerson,
  type StoryLength,
} from "../domain/project-structure.ts";
import { rawDb } from "../db/client.ts";
import { createFoundationCoreEnvelope } from "../foundation/foundation-core-state.ts";
import { canTrashProjectForRunState, PROJECT_PURGE_TABLES } from "../project-trash.ts";
import { resolveReviewPolicy } from "../run/review-policy.ts";
import { getCurrentMilestone } from "../story/story-contract.ts";
import type {
  AgentAssignmentInput,
  ChapterBlueprint,
  FoundationPayload,
  FoundationWorkshopDraft,
  ReviewPolicy,
  SteeringNote,
  StoryContract,
  RunProgressPayload,
} from "../types.ts";
import { nowIso, unique } from "../utils.ts";
import { getDefaultWorkshopDraft, type ProjectRecord, toProjectRecord } from "./shared.ts";

export function listProjects() {
  const stmt = rawDb.prepare("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC");
  return (stmt.all() as Record<string, unknown>[]).map(toProjectRecord);
}

export function getProject(projectId: string) {
  const stmt = rawDb.prepare("SELECT * FROM projects WHERE id = ?");
  const row = stmt.get(projectId) as Record<string, unknown> | undefined;
  return row ? toProjectRecord(row) : null;
}

export function getStoryContract(projectId: string) {
  return getProject(projectId)?.storyContract ?? null;
}

export function saveStoryContract(projectId: string, storyContract: StoryContract) {
  const now = nowIso();
  rawDb
    .prepare("UPDATE projects SET story_contract_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(storyContract), now, projectId);
  return getStoryContract(projectId);
}

function saveSteeringNotes(projectId: string, notes: SteeringNote[]) {
  const now = nowIso();
  rawDb
    .prepare("UPDATE projects SET steering_notes_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(notes), now, projectId);
}

function normalizeSteeringInstruction(instruction: string) {
  return instruction.replace(/\s+/g, " ").trim();
}

function extractQuotedSteeringTarget(instruction: string) {
  const match =
    instruction.match(/当前“([^”]*)”+已经重复/u)
    ?? instruction.match(/重复以“([^”]*)”+起头/u);
  return match?.[1]?.trim() ?? null;
}

function isInvalidSteeringInstruction(instruction: string) {
  const normalized = normalizeSteeringInstruction(instruction);
  if (!normalized) {
    return true;
  }

  const target = extractQuotedSteeringTarget(normalized);
  if (target === null) {
    return false;
  }

  return !/[\p{Script=Han}A-Za-z0-9]/u.test(target);
}

function resolveSteeringInstructionBucket(instruction: string) {
  const normalized = normalizeSteeringInstruction(instruction);
  if (normalized.includes("代词起句")) {
    return "subject_pronoun";
  }
  if (normalized.includes("同一主体名词起句不要超过")) {
    return "subject_dominant";
  }
  if (normalized.includes("显性比喻")) {
    return "simile";
  }
  if (normalized.includes("不是……而是……")) {
    return "transition_contrast";
  }
  if (normalized.includes("少用“忽然”")) {
    return "transition_abrupt";
  }
  if (normalized.includes("母题复用预算继续收紧") || normalized.includes("同一意象不要原词原意反复敲回")) {
    return "motif_reuse";
  }
  if (normalized.includes("机制露出策略继续收紧")) {
    return "mechanism";
  }
  if (normalized.includes("章末策略继续收紧")) {
    return "ending";
  }
  return null;
}

function buildSteeringScopeKey(note: Pick<SteeringNote, "scope" | "instruction">) {
  const bucket = resolveSteeringInstructionBucket(note.instruction);
  return bucket ? `${note.scope}:${bucket}` : null;
}

export function listActiveSteeringNotes(projectId: string, currentChapter?: number) {
  const notes = getProject(projectId)?.steeringNotes ?? [];
  const visible = notes
    .filter((note) =>
      note.active
      && !isInvalidSteeringInstruction(note.instruction)
      && (note.applyUntilChapter === null || currentChapter === undefined || currentChapter <= note.applyUntilChapter),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const seenExact = new Set<string>();
  const seenScopedBuckets = new Set<string>();
  const deduped: SteeringNote[] = [];

  for (const note of visible) {
    const normalized = normalizeSteeringInstruction(note.instruction);
    const scopedBucket = buildSteeringScopeKey(note);
    if (seenExact.has(normalized)) {
      continue;
    }
    if (scopedBucket && seenScopedBuckets.has(scopedBucket)) {
      continue;
    }
    seenExact.add(normalized);
    if (scopedBucket) {
      seenScopedBuckets.add(scopedBucket);
    }
    deduped.push(note);
  }

  return deduped.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function addSteeringNote(projectId: string, input: {
  instruction: string;
  scope: SteeringNote["scope"];
  currentChapter?: number;
}) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const normalizedInstruction = normalizeSteeringInstruction(input.instruction);
  if (!normalizedInstruction || isInvalidSteeringInstruction(normalizedInstruction)) {
    throw new Error("追加指令为空或不合法");
  }

  const nextNote: SteeringNote = {
    id: nanoid(),
    instruction: normalizedInstruction,
    scope: input.scope,
    createdAt: nowIso(),
    active: true,
    applyUntilChapter:
      input.scope === "next_arc"
        ? (input.currentChapter ?? 1) + 3
        : null,
  };
  const nextScopedBucket = buildSteeringScopeKey(nextNote);
  const notes = [
    ...project.steeringNotes.filter((note) => {
      if (isInvalidSteeringInstruction(note.instruction)) {
        return false;
      }

      const normalized = normalizeSteeringInstruction(note.instruction);
      if (normalized === normalizedInstruction && note.scope === input.scope) {
        return false;
      }

      if (!nextScopedBucket) {
        return true;
      }

      return buildSteeringScopeKey(note) !== nextScopedBucket;
    }),
    nextNote,
  ];
  saveSteeringNotes(projectId, notes);
  return nextNote;
}

export function createProject(input: {
  title: string;
  genre: string;
  style: string;
  seriesMode: ProjectRecord["seriesMode"];
  seriesTitle?: string;
  seriesIndex?: number;
  storyLength: StoryLength;
  narrativePerson?: NarrativePerson;
  hasVolumes?: boolean;
  plannedVolumes?: number;
  chapterPlanningMode?: ProjectRecord["chapterPlanningMode"];
  paceProfile?: ProjectRecord["paceProfile"];
  completionCriteria?: string;
  chapterBudgetMin?: number;
  chapterBudgetTarget?: number;
  chapterBudgetMax?: number;
  hardChapterCap?: number;
  targetChapters?: number;
  premise: string;
  assignments: AgentAssignmentInput[];
  reviewPolicy?: Partial<ReviewPolicy>;
  sourceIdeaId?: string | null;
  workshopSeed?: {
    draft: FoundationWorkshopDraft;
    messages: Array<{
      role: "assistant" | "user";
      content: string;
      createdAt: string;
    }>;
  };
}) {
  const projectId = nanoid();
  const now = nowIso();
  const structure = normalizeProjectStructureInput(input);

  const insertProject = rawDb.prepare(`
    INSERT INTO projects (
      id, title, genre, style, target_chapters, premise,
      series_mode, series_title, series_index, story_length, narrative_person,
      chapter_planning_mode, pace_profile, completion_criteria,
      chapter_budget_min, chapter_budget_target, chapter_budget_max, hard_chapter_cap,
      story_contract_json, steering_notes_json,
      review_policy_json, has_volumes, planned_volumes,
      source_idea_id, status, created_at, updated_at
    )
    VALUES (
      @id, @title, @genre, @style, @targetChapters, @premise,
      @seriesMode, @seriesTitle, @seriesIndex, @storyLength, @narrativePerson,
      @chapterPlanningMode, @paceProfile, @completionCriteria,
      @chapterBudgetMin, @chapterBudgetTarget, @chapterBudgetMax, @hardChapterCap,
      @storyContractJson, @steeringNotesJson,
      @reviewPolicyJson, @hasVolumes, @plannedVolumes, @sourceIdeaId,
      'ideation', @createdAt, @updatedAt
    )
  `);

  const deleteAssignments = rawDb.prepare("DELETE FROM agent_assignments WHERE project_id = ?");
  const insertAssignment = rawDb.prepare(`
    INSERT INTO agent_assignments (id, project_id, role, profile_id, model, temperature, max_tokens, updated_at)
    VALUES (@id, @projectId, @role, @profileId, @model, @temperature, @maxTokens, @updatedAt)
  `);

  const upsertRunState = rawDb.prepare(`
    INSERT INTO run_states (
      project_id, status, stage, desired_state, run_session_id, heartbeat_at, current_chapter, total_chapters, retry_count, confidence,
      last_error, draft_file, current_position, word_count, stage_details_json, started_at, updated_at
    ) VALUES (
      @projectId, 'idle', 'idle', 'idle', NULL, NULL, 1, @totalChapters, 0, 0,
      NULL, NULL, 0, 0, '{}', @startedAt, @updatedAt
    )
    ON CONFLICT(project_id) DO UPDATE SET
      total_chapters = excluded.total_chapters,
      updated_at = excluded.updated_at
  `);

  const insertWorkshopState = rawDb.prepare(`
    INSERT INTO foundation_workshop_states (project_id, draft_json, ready_to_generate, updated_at)
    VALUES (@projectId, @draftJson, 0, @updatedAt)
    ON CONFLICT(project_id) DO UPDATE SET
      draft_json = excluded.draft_json,
      updated_at = excluded.updated_at
  `);

  const insertWorkshopMessage = rawDb.prepare(`
    INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at)
    VALUES (@id, @projectId, @role, @content, @createdAt)
  `);

  rawDb.transaction(() => {
    const resolvedReviewPolicy = resolveReviewPolicy(structure.storyLength, input.reviewPolicy);
    const seedDraft = input.workshopSeed?.draft;
    const seedMessages = input.workshopSeed?.messages ?? [];
    insertProject.run({
      id: projectId,
      title: input.title,
      genre: input.genre,
      style: input.style,
      targetChapters: structure.targetChapters,
      premise: input.premise,
      seriesMode: structure.seriesMode,
      seriesTitle: structure.seriesTitle,
      seriesIndex: structure.seriesIndex,
      storyLength: structure.storyLength,
      narrativePerson: structure.narrativePerson,
      chapterPlanningMode: structure.chapterPlanningMode,
      paceProfile: structure.paceProfile,
      completionCriteria: structure.completionCriteria,
      chapterBudgetMin: structure.chapterBudgetMin,
      chapterBudgetTarget: structure.chapterBudgetTarget,
      chapterBudgetMax: structure.chapterBudgetMax,
      hardChapterCap: structure.hardChapterCap,
      storyContractJson: "{}",
      steeringNotesJson: "[]",
      reviewPolicyJson: JSON.stringify(resolvedReviewPolicy),
      hasVolumes: structure.hasVolumes ? 1 : 0,
      plannedVolumes: structure.plannedVolumes,
      sourceIdeaId: input.sourceIdeaId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    deleteAssignments.run(projectId);
    for (const assignment of input.assignments) {
      insertAssignment.run({
        id: nanoid(),
        projectId,
        role: assignment.role,
        profileId: assignment.profileId,
        model: assignment.model,
        temperature: assignment.temperature,
        maxTokens: assignment.maxTokens,
        updatedAt: now,
      });
    }

    upsertRunState.run({
      projectId,
      totalChapters: structure.chapterBudgetTarget,
      startedAt: now,
      updatedAt: now,
    });

    insertWorkshopState.run({
      projectId,
      draftJson: JSON.stringify(
        createFoundationCoreEnvelope(
          seedDraft ?? getDefaultWorkshopDraft({
            title: input.title,
            genre: input.genre,
            style: input.style,
            premise: input.premise,
            storyLength: structure.storyLength,
          }),
          {
            lastAppliedAt: now,
          },
        ),
      ),
      updatedAt: now,
    });

    for (const message of seedMessages) {
      insertWorkshopMessage.run({
        id: nanoid(),
        projectId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
      });
    }
  })();

  return getProject(projectId);
}

export function listProjectsBySourceIdea(sourceIdeaId: string) {
  const stmt = rawDb.prepare(`
    SELECT * FROM projects
    WHERE source_idea_id = ?
    ORDER BY updated_at DESC
  `);
  return (stmt.all(sourceIdeaId) as Record<string, unknown>[]).map(toProjectRecord);
}

export function getAssignments(projectId: string): AgentAssignmentInput[] {
  const stmt = rawDb.prepare(`
    SELECT role, profile_id, model, temperature, max_tokens
    FROM agent_assignments
    WHERE project_id = ?
    ORDER BY role ASC
  `);
  return normalizeProjectAssignments(
    (stmt.all(projectId) as Array<Record<string, unknown>>).map((row) => ({
      role: String(row.role) as AgentAssignmentInput["role"],
      profileId: String(row.profile_id),
      model: String(row.model),
      temperature: Number(row.temperature),
      maxTokens: Number(row.max_tokens),
    })),
  );
}

export function saveAssignments(projectId: string, assignments: AgentAssignmentInput[]) {
  const deleteStmt = rawDb.prepare("DELETE FROM agent_assignments WHERE project_id = ?");
  const insertStmt = rawDb.prepare(`
    INSERT INTO agent_assignments (id, project_id, role, profile_id, model, temperature, max_tokens, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = nowIso();

  rawDb.transaction(() => {
    deleteStmt.run(projectId);
    for (const assignment of assignments) {
      insertStmt.run(
        nanoid(),
        projectId,
        assignment.role,
        assignment.profileId,
        assignment.model,
        assignment.temperature,
        assignment.maxTokens,
        now,
      );
    }
  })();
}

export function saveProjectSettings(
  projectId: string,
  storyLength: StoryLength,
  input: {
    reviewPolicy?: Partial<ReviewPolicy>;
    narrativePerson?: NarrativePerson;
  },
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const now = nowIso();
  const resolved = input.reviewPolicy
    ? resolveReviewPolicy(storyLength, input.reviewPolicy)
    : project.reviewPolicy;
  const narrativePerson = input.narrativePerson ?? project.narrativePerson;
  rawDb
    .prepare("UPDATE projects SET review_policy_json = ?, narrative_person = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(resolved), narrativePerson, now, projectId);
  return getProject(projectId);
}

export function listTrashedProjects(): ProjectRecord[] {
  const stmt = rawDb.prepare("SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
  return (stmt.all() as Record<string, unknown>[]).map(toProjectRecord);
}

export function softDeleteProject(projectId: string): void {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const runStateRow = rawDb
    .prepare("SELECT status, stage, desired_state, heartbeat_at FROM run_states WHERE project_id = ?")
    .get(projectId) as Record<string, unknown> | undefined;
  const activeRun = runStateRow
    ? !canTrashProjectForRunState({
        status: runStateRow.status ? String(runStateRow.status) : null,
        stage: runStateRow.stage ? String(runStateRow.stage) as RunProgressPayload["stage"] : null,
        desiredState: runStateRow.desired_state ? String(runStateRow.desired_state) : null,
        heartbeatAt: runStateRow.heartbeat_at ? String(runStateRow.heartbeat_at) : null,
      })
    : project.status === "running";
  if (activeRun) {
    throw new Error("运行中的项目不能删除，请先暂停或等待完成");
  }
  if (project.deletedAt) {
    return;
  }
  const now = nowIso();
  rawDb.prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, projectId);
}

export function restoreProject(projectId: string): ProjectRecord {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  if (!project.deletedAt) {
    return project;
  }
  const now = nowIso();
  rawDb.prepare("UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(now, projectId);
  const restored = getProject(projectId);
  if (!restored) {
    throw notFound("项目不存在");
  }
  return restored;
}

export function purgeProject(projectId: string): void {
  const row = rawDb.prepare("SELECT deleted_at FROM projects WHERE id = ?").get(projectId) as Record<string, unknown> | undefined;
  if (!row) {
    throw notFound("项目不存在");
  }
  if (!row.deleted_at) {
    throw new Error("只有回收站中的项目才能永久删除");
  }

  rawDb.transaction(() => {
    // run_checkpoints/run_events/run_config_snapshots 只有 session_id 没有 project_id，
    // 必须在 run_sessions 行被删除前按会话归属清理，否则会留下孤儿行。
    for (const sessionBoundTable of ["run_checkpoints", "run_events", "run_config_snapshots"]) {
      rawDb
        .prepare(`
          DELETE FROM ${sessionBoundTable}
          WHERE session_id IN (SELECT session_id FROM run_sessions WHERE project_id = ?)
        `)
        .run(projectId);
    }
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

export function buildContextKeywords(
  project: ProjectRecord,
  blueprint: ChapterBlueprint,
  foundation: FoundationPayload,
  storyContract?: StoryContract | null,
) {
  const currentMilestone = storyContract ? getCurrentMilestone(storyContract, blueprint.chapterNo) : null;
  const currentVolumeGoal = storyContract
    ? storyContract.volumes.find((volume) => volume.volumeNo === storyContract.currentVolume)?.goal ?? storyContract.endingPromise
    : null;
  const pushLines = (prefix: "P1" | "P2" | "P3" | "ENTITY", values: Array<string | null | undefined>) =>
    unique(values.map((value) => value?.trim() ?? "").filter(Boolean))
      .map((value) => `${prefix}|${value}`);

  return [
    ...pushLines("P1", [
      blueprint.sceneGoal,
      ...blueprint.conflicts,
      currentMilestone?.label,
      currentMilestone?.goal,
      blueprint.requiredProgressDelta ?? "",
    ]),
    ...pushLines("P2", [
      ...blueprint.characters,
      ...blueprint.locations,
      currentVolumeGoal,
      storyContract?.globalArc,
    ]),
    ...pushLines("P3", [
      project.title,
      project.seriesTitle ?? "",
      project.genre,
      project.style,
      project.storyLength,
      ...blueprint.foreshadows,
    ]),
    ...pushLines("ENTITY", [
      ...blueprint.characters,
      ...blueprint.locations,
      ...foundation.characters.map((character) => character.name),
    ]),
  ].join("\n");
}
