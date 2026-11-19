import "../server-only.ts";

import { notFound } from "../errors.ts";
import { nanoid } from "nanoid";
import { validateCharacterName } from "../../lib/character-name-policy.ts";
import { rawDb } from "../db/client.ts";
import { normalizeBlueprintCharacterReferences, normalizeFoundationCharacterReferences } from "../character/character-name-normalization.ts";
import {
  buildFoundationCoreFactsHash,
  createFoundationCoreEnvelope,
  parseFoundationCoreEnvelope,
} from "../foundation/foundation-core-state.ts";
import {
  sanitizeFoundationPayload,
  sanitizeFoundationWorkshopDraft,
} from "../foundation/foundation-summary-sanitizer.ts";
import { createDefaultStyleProfile, normalizeStyleProfile } from "../style/style-steering.ts";
import type {
  ChapterBlueprint,
  FoundationCoreEnvelope,
  FoundationPayload,
  FoundationStructuredSuggestions,
  FoundationWorkshopDraft,
  FoundationWorkshopMessage,
  FoundationWorkshopSession,
  StyleProfile,
} from "../types.ts";
import { nowIso, safeJsonParse } from "../utils.ts";
import { getProject } from "./project.repository.ts";
import {
  getDefaultWorkshopDraft,
  normalizeStoredFoundation,
  toChapterBlueprint,
  type FoundationWorkshopStateRecord,
} from "./shared.ts";

function normalizeWorkshopDraft(
  draft: FoundationWorkshopDraft,
): FoundationWorkshopDraft {
  return {
    ...draft,
    styleProfile: normalizeStyleProfile(draft.styleProfile),
    styleSnapshotId: draft.styleSnapshotId ?? null,
    styleSnapshotVersion:
      typeof draft.styleSnapshotVersion === "number" ? draft.styleSnapshotVersion : null,
    styleDigest: draft.styleDigest ?? "",
    styleExemplars: Array.isArray(draft.styleExemplars) ? draft.styleExemplars : [],
  };
}

function normalizeWorkshopEnvelope(envelope: FoundationCoreEnvelope): FoundationCoreEnvelope {
  const normalizedDraft = normalizeWorkshopDraft(envelope.draft);
  return {
    ...envelope,
    draft: normalizedDraft,
    syncMeta: {
      ...envelope.syncMeta,
      revision: typeof envelope.syncMeta.revision === "number" ? envelope.syncMeta.revision : 0,
      coreFactsHash: envelope.syncMeta.coreFactsHash ?? "",
      conflictLog: Array.isArray(envelope.syncMeta.conflictLog) ? envelope.syncMeta.conflictLog : [],
      lockedFields: Array.isArray(envelope.syncMeta.lockedFields) ? envelope.syncMeta.lockedFields : [],
      latestIntentDigest: envelope.syncMeta.latestIntentDigest ?? "",
      lastAppliedAt: envelope.syncMeta.lastAppliedAt ?? "",
      lastAppliedChangeSet: envelope.syncMeta.lastAppliedChangeSet ?? null,
      syncStatus: envelope.syncMeta.syncStatus ?? {
        status: "skipped",
        mode: "delta",
        reason: null,
        coreFactsHashBefore: envelope.syncMeta.coreFactsHash ?? "",
        coreFactsHashAfter: envelope.syncMeta.coreFactsHash ?? "",
      },
    },
  };
}

function getWorkshopDraftFallback(projectId: string) {
  const project = getProject(projectId);
  return project
    ? getDefaultWorkshopDraft(project)
    : getDefaultWorkshopDraft({
      title: "",
      genre: "",
      style: "default",
      premise: "",
      storyLength: "long",
    });
}

export function getFoundationWorkshopEnvelopeState(projectId: string): (FoundationWorkshopStateRecord & {
  envelope: FoundationCoreEnvelope;
  legacyBareDraftJson: boolean;
}) | null {
  const row = rawDb.prepare("SELECT * FROM foundation_workshop_states WHERE project_id = ?").get(projectId) as
    | Record<string, unknown>
    | undefined;
  const project = getProject(projectId);
  if (!row) {
    if (!project) {
      return null;
    }

    const envelope = normalizeWorkshopEnvelope(createFoundationCoreEnvelope(getDefaultWorkshopDraft(project)));
    return {
      projectId,
      draft: envelope.draft,
      structuredSuggestions: null,
      envelope,
      legacyBareDraftJson: false,
      readyToGenerate: false,
      updatedAt: project.updatedAt,
    };
  }

  const parsed = parseFoundationCoreEnvelope(String(row.draft_json), {
    fallbackDraft: getWorkshopDraftFallback(projectId),
  });
  const envelope = normalizeWorkshopEnvelope({
    ...parsed.envelope,
    draft: sanitizeFoundationWorkshopDraft(parsed.envelope.draft) ?? parsed.envelope.draft,
  });

  return {
    projectId: String(row.project_id),
    draft: envelope.draft,
    structuredSuggestions: safeJsonParse(
      String(row.structured_suggestions_json ?? "null"),
      null,
    ) as FoundationStructuredSuggestions | null,
    envelope,
    legacyBareDraftJson: parsed.wasLegacyBareDraft,
    readyToGenerate: Boolean(row.ready_to_generate),
    updatedAt: String(row.updated_at),
  };
}

export function saveFoundationStyleCard(projectId: string, styleCard: string, styleProfile?: StyleProfile) {
  const existing = getFoundation(projectId);
  const now = nowIso();
  rawDb
    .prepare(`
      UPDATE foundations
      SET style_card = ?, style_profile_json = ?, style_digest = ?, style_exemplars_json = ?, updated_at = ?
      WHERE project_id = ?
    `)
    .run(
      styleCard,
      JSON.stringify(normalizeStyleProfile(styleProfile ?? existing?.styleProfile ?? createDefaultStyleProfile())),
      existing?.styleDigest ?? "",
      JSON.stringify(existing?.styleExemplars ?? []),
      now,
      projectId,
    );
}

export function saveFoundation(projectId: string, foundation: FoundationPayload) {
  const sanitizedFoundation = sanitizeFoundationPayload(foundation) ?? foundation;
  const sanitizedCharacters = sanitizedFoundation.characters
    .map((character) => {
      const validation = validateCharacterName(character.name);
      if (!validation.accepted || !validation.canonical) {
        return null;
      }
      return {
        ...character,
        name: validation.canonical,
      };
    })
    .filter((character): character is FoundationPayload["characters"][number] => Boolean(character));
  const normalizedFoundation = normalizeFoundationCharacterReferences({
    ...sanitizedFoundation,
    characters: sanitizedCharacters,
  });
  const styleProfile = normalizeStyleProfile(
    normalizedFoundation.styleProfile ?? createDefaultStyleProfile(),
  );
  const now = nowIso();
  const existingLockState = rawDb
    .prepare("SELECT locked_at FROM foundations WHERE project_id = ?")
    .get(projectId) as Record<string, unknown> | undefined;
  const nextProjectStatus = existingLockState?.locked_at ? "foundation_locked" : "foundation_ready";
  const stmt = rawDb.prepare(`
    INSERT INTO foundations (
      project_id, premise_text, mainline_text, story_hook_text, style_card, style_profile_json, style_snapshot_id, style_snapshot_version,
      style_digest, style_exemplars_json, characters_json, worldview_json, relationships_json, locked_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      premise_text = excluded.premise_text,
      mainline_text = excluded.mainline_text,
      story_hook_text = excluded.story_hook_text,
      style_card = excluded.style_card,
      style_profile_json = excluded.style_profile_json,
      style_snapshot_id = excluded.style_snapshot_id,
      style_snapshot_version = excluded.style_snapshot_version,
      style_digest = excluded.style_digest,
      style_exemplars_json = excluded.style_exemplars_json,
      characters_json = excluded.characters_json,
      worldview_json = excluded.worldview_json,
      relationships_json = excluded.relationships_json,
      updated_at = excluded.updated_at
  `);
  stmt.run(
    projectId,
    normalizedFoundation.premise,
    normalizedFoundation.mainline ?? "",
    normalizedFoundation.storyHook ?? "",
    normalizedFoundation.styleCard,
    JSON.stringify(styleProfile),
    normalizedFoundation.styleSnapshotId ?? null,
    normalizedFoundation.styleSnapshotVersion ?? null,
    normalizedFoundation.styleDigest ?? "",
    JSON.stringify(normalizedFoundation.styleExemplars ?? []),
    JSON.stringify(normalizedFoundation.characters),
    JSON.stringify(normalizedFoundation.worldview),
    JSON.stringify(normalizedFoundation.relationships),
    now,
  );

  rawDb
    .prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
    .run(nextProjectStatus, now, projectId);

  return {
    ...normalizedFoundation,
    styleProfile,
  };
}

export function getFoundation(projectId: string): FoundationPayload | null {
  const stmt = rawDb.prepare("SELECT * FROM foundations WHERE project_id = ?");
  const row = stmt.get(projectId) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return sanitizeFoundationPayload(normalizeFoundationCharacterReferences(normalizeStoredFoundation(row)));
}

export function lockFoundation(projectId: string) {
  const now = nowIso();
  rawDb
    .prepare("UPDATE foundations SET locked_at = ?, updated_at = ? WHERE project_id = ?")
    .run(now, now, projectId);
  rawDb.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run("foundation_locked", now, projectId);
}

export function unlockFoundation(projectId: string) {
  const now = nowIso();
  rawDb
    .prepare("UPDATE foundations SET locked_at = NULL, updated_at = ? WHERE project_id = ?")
    .run(now, projectId);
}

export function isFoundationLocked(projectId: string) {
  const row = rawDb
    .prepare("SELECT locked_at FROM foundations WHERE project_id = ?")
    .get(projectId) as Record<string, unknown> | undefined;
  return Boolean(row?.locked_at);
}

export function saveBlueprint(projectId: string, blueprint: ChapterBlueprint) {
  const normalizedBlueprint = normalizeBlueprintCharacterReferences(blueprint, getFoundation(projectId));
  const now = nowIso();
  rawDb
    .prepare(`
      INSERT INTO blueprints (
        id, project_id, chapter_no, scene_goal, characters_json, locations_json, conflicts_json,
        foreshadows_json, emotional_tone, estimated_words, segment_id, segment_item_id, required_progress_delta,
        source_plan_generation_id, hook_guidance_mode, hook_bindings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, chapter_no) DO UPDATE SET
        scene_goal = excluded.scene_goal,
        characters_json = excluded.characters_json,
        locations_json = excluded.locations_json,
        conflicts_json = excluded.conflicts_json,
        foreshadows_json = excluded.foreshadows_json,
        emotional_tone = excluded.emotional_tone,
        estimated_words = excluded.estimated_words,
        segment_id = excluded.segment_id,
        segment_item_id = excluded.segment_item_id,
        required_progress_delta = excluded.required_progress_delta,
        source_plan_generation_id = excluded.source_plan_generation_id,
        hook_guidance_mode = excluded.hook_guidance_mode,
        hook_bindings_json = excluded.hook_bindings_json,
        updated_at = excluded.updated_at
    `)
    .run(
      nanoid(),
      projectId,
      normalizedBlueprint.chapterNo,
      normalizedBlueprint.sceneGoal,
      JSON.stringify(normalizedBlueprint.characters),
      JSON.stringify(normalizedBlueprint.locations),
      JSON.stringify(normalizedBlueprint.conflicts),
      JSON.stringify(normalizedBlueprint.foreshadows),
      normalizedBlueprint.emotionalTone,
      normalizedBlueprint.estimatedWords,
      normalizedBlueprint.segmentId ?? null,
      normalizedBlueprint.segmentItemId ?? null,
      normalizedBlueprint.requiredProgressDelta ?? null,
      normalizedBlueprint.sourcePlanGenerationId ?? null,
      normalizedBlueprint.hookGuidanceMode ?? "unguided",
      JSON.stringify(normalizedBlueprint.hookBindings ?? []),
      now,
      now,
    );

  return normalizedBlueprint;
}

export function getBlueprint(projectId: string, chapterNo: number): ChapterBlueprint | null {
  const row = rawDb
    .prepare("SELECT * FROM blueprints WHERE project_id = ? AND chapter_no = ?")
    .get(projectId, chapterNo) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return normalizeBlueprintCharacterReferences(toChapterBlueprint(row), getFoundation(projectId));
}

export function listBlueprints(projectId: string) {
  const stmt = rawDb.prepare("SELECT chapter_no FROM blueprints WHERE project_id = ? ORDER BY chapter_no ASC");
  return (stmt.all(projectId) as Array<Record<string, unknown>>).map((row) => Number(row.chapter_no));
}

export function listBlueprintContents(projectId: string): ChapterBlueprint[] {
  const stmt = rawDb.prepare("SELECT * FROM blueprints WHERE project_id = ? ORDER BY chapter_no ASC");
  const foundation = getFoundation(projectId);
  return (stmt.all(projectId) as Array<Record<string, unknown>>).map((row) =>
    normalizeBlueprintCharacterReferences(toChapterBlueprint(row), foundation),
  );
}

export function getFoundationWorkshopState(projectId: string): FoundationWorkshopStateRecord | null {
  const record = getFoundationWorkshopEnvelopeState(projectId);
  if (!record) {
    return null;
  }
  return {
    projectId: record.projectId,
    draft: record.draft,
    structuredSuggestions: record.structuredSuggestions ?? null,
    readyToGenerate: record.readyToGenerate,
    updatedAt: record.updatedAt,
  };
}

export function upsertFoundationWorkshopState(
  projectId: string,
  draft: FoundationWorkshopDraft,
  readyToGenerate: boolean,
) {
  const now = nowIso();
  const existing = getFoundationWorkshopEnvelopeState(projectId);
  const sanitizedDraft = sanitizeFoundationWorkshopDraft(draft) ?? draft;
  return upsertFoundationWorkshopEnvelopeState(
    projectId,
    existing
      ? {
        ...existing.envelope,
        draft: sanitizedDraft,
        syncMeta: {
          ...existing.envelope.syncMeta,
          revisionId: nanoid(),
          revision: (existing.envelope.syncMeta.revision ?? 0) + 1,
          coreFactsHash: buildFoundationCoreFactsHash(sanitizedDraft),
          lastAppliedAt: now,
          syncStatus: {
            status: "applied",
            mode: "deterministic",
            reason: null,
            coreFactsHashBefore: existing.envelope.syncMeta.coreFactsHash ?? buildFoundationCoreFactsHash(existing.envelope.draft),
            coreFactsHashAfter: buildFoundationCoreFactsHash(sanitizedDraft),
          },
        },
      }
      : createFoundationCoreEnvelope(sanitizedDraft, {
        revisionId: nanoid(),
        lastAppliedAt: now,
      }),
    readyToGenerate,
  );
}

export function upsertFoundationWorkshopEnvelopeState(
  projectId: string,
  envelope: FoundationCoreEnvelope,
  readyToGenerate: boolean,
  structuredSuggestions?: FoundationStructuredSuggestions | null,
  options?: { expectedRevisionId?: string | null },
) {
  const now = nowIso();
  const existing = getFoundationWorkshopEnvelopeState(projectId);
  if (options && options.expectedRevisionId !== undefined) {
    // CAS：本回合基于的 revision 已被其他写入方（Runner 补强、style steering、并发回合）
    // 推进时拒绝盲写，返回 null 让调用方重读最新 envelope 后 rebase 再试。
    const currentRevisionId = existing?.envelope.syncMeta.revisionId ?? null;
    if (currentRevisionId !== options.expectedRevisionId) {
      return null;
    }
  }
  const sanitizedDraft = sanitizeFoundationWorkshopDraft(envelope.draft) ?? envelope.draft;
  const nextEnvelope = normalizeWorkshopEnvelope(
    existing
      ? {
        ...existing.envelope,
        ...envelope,
        draft: sanitizedDraft,
        syncMeta: {
          ...existing.envelope.syncMeta,
          ...envelope.syncMeta,
          revisionId: envelope.syncMeta.revisionId || nanoid(),
          coreFactsHash: envelope.syncMeta.coreFactsHash || buildFoundationCoreFactsHash(sanitizedDraft),
          lastAppliedAt: envelope.syncMeta.lastAppliedAt || now,
        },
      }
      : createFoundationCoreEnvelope(sanitizedDraft, {
        ...envelope.syncMeta,
        revisionId: envelope.syncMeta.revisionId || nanoid(),
        lastAppliedAt: envelope.syncMeta.lastAppliedAt || now,
      }),
  );
  rawDb
    .prepare(`
      INSERT INTO foundation_workshop_states (project_id, draft_json, structured_suggestions_json, ready_to_generate, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        draft_json = excluded.draft_json,
        structured_suggestions_json = excluded.structured_suggestions_json,
        ready_to_generate = excluded.ready_to_generate,
        updated_at = excluded.updated_at
    `)
    .run(
      projectId,
      JSON.stringify(nextEnvelope),
      JSON.stringify(structuredSuggestions ?? existing?.structuredSuggestions ?? null),
      readyToGenerate ? 1 : 0,
      now,
    );

  return getFoundationWorkshopState(projectId);
}

export function saveFoundationStructuredSuggestions(
  projectId: string,
  suggestions: FoundationStructuredSuggestions | null,
) {
  const existing = getFoundationWorkshopEnvelopeState(projectId);
  if (!existing) {
    throw notFound("设定工坊状态不存在");
  }

  const now = nowIso();
  rawDb
    .prepare(`
      UPDATE foundation_workshop_states
      SET structured_suggestions_json = ?, updated_at = ?
      WHERE project_id = ?
    `)
    .run(JSON.stringify(suggestions), now, projectId);

  return getFoundationWorkshopState(projectId);
}

export function listFoundationWorkshopMessages(projectId: string): FoundationWorkshopMessage[] {
  const rows = rawDb
    .prepare(`
      SELECT * FROM foundation_workshop_messages
      WHERE project_id = ?
      ORDER BY created_at ASC
    `)
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    role: row.role as FoundationWorkshopMessage["role"],
    content: String(row.content),
    createdAt: String(row.created_at),
  }));
}

export function getFoundationWorkshopSession(projectId: string): FoundationWorkshopSession | null {
  const row = rawDb
    .prepare("SELECT * FROM foundation_workshop_sessions WHERE project_id = ?")
    .get(projectId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    projectId: String(row.project_id),
    sessionId: String(row.session_id),
    status: row.status as FoundationWorkshopSession["status"],
    stage: String(row.stage),
    progress: Number(row.progress ?? 0),
    statusMessage: String(row.status_message ?? ""),
    userMessage: String(row.user_message ?? ""),
    assistantMessage: String(row.assistant_message ?? ""),
    error: typeof row.error === "string" ? row.error : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

type FoundationWorkshopSessionPatch = Partial<Pick<
  FoundationWorkshopSession,
  "status" | "stage" | "progress" | "statusMessage" | "userMessage" | "assistantMessage" | "error" | "createdAt"
>>;

export function updateFoundationWorkshopSessionIfCurrent(
  projectId: string,
  sessionId: string,
  expectedUpdatedAt: string,
  patch: FoundationWorkshopSessionPatch,
  nextUpdatedAt = nowIso(),
) {
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];

  if (patch.status !== undefined) {
    assignments.push("status = ?");
    values.push(patch.status);
  }
  if (patch.stage !== undefined) {
    assignments.push("stage = ?");
    values.push(patch.stage);
  }
  if (patch.progress !== undefined) {
    assignments.push("progress = ?");
    values.push(patch.progress);
  }
  if (patch.statusMessage !== undefined) {
    assignments.push("status_message = ?");
    values.push(patch.statusMessage);
  }
  if (patch.userMessage !== undefined) {
    assignments.push("user_message = ?");
    values.push(patch.userMessage);
  }
  if (patch.assistantMessage !== undefined) {
    assignments.push("assistant_message = ?");
    values.push(patch.assistantMessage);
  }
  if (patch.error !== undefined) {
    assignments.push("error = ?");
    values.push(patch.error);
  }
  if (patch.createdAt !== undefined) {
    assignments.push("created_at = ?");
    values.push(patch.createdAt);
  }

  assignments.push("updated_at = ?");
  values.push(nextUpdatedAt);

  const result = rawDb
    .prepare(`
      UPDATE foundation_workshop_sessions
      SET ${assignments.join(", ")}
      WHERE project_id = ? AND session_id = ? AND updated_at = ?
    `)
    .run(...values, projectId, sessionId, expectedUpdatedAt);

  return result.changes > 0 ? nextUpdatedAt : null;
}

export function saveFoundationWorkshopSession(session: FoundationWorkshopSession) {
  rawDb
    .prepare(`
      INSERT INTO foundation_workshop_sessions (
        project_id,
        session_id,
        status,
        stage,
        progress,
        status_message,
        user_message,
        assistant_message,
        error,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        session_id = excluded.session_id,
        status = excluded.status,
        stage = excluded.stage,
        progress = excluded.progress,
        status_message = excluded.status_message,
        user_message = excluded.user_message,
        assistant_message = excluded.assistant_message,
        error = excluded.error,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `)
    .run(
      session.projectId,
      session.sessionId,
      session.status,
      session.stage,
      session.progress,
      session.statusMessage,
      session.userMessage,
      session.assistantMessage,
      session.error,
      session.createdAt,
      session.updatedAt,
    );

  return getFoundationWorkshopSession(session.projectId);
}

export function clearFoundationWorkshopSessionIfCurrent(projectId: string, sessionId: string) {
  const result = rawDb
    .prepare("DELETE FROM foundation_workshop_sessions WHERE project_id = ? AND session_id = ?")
    .run(projectId, sessionId);
  return result.changes > 0;
}

export function clearFoundationWorkshopSession(projectId: string) {
  rawDb.prepare("DELETE FROM foundation_workshop_sessions WHERE project_id = ?").run(projectId);
}

export function listRunningFoundationWorkshopSessionsUpdatedBefore(updatedBefore: string) {
  const rows = rawDb
    .prepare(`
      SELECT * FROM foundation_workshop_sessions
      WHERE status = 'running' AND updated_at < ?
      ORDER BY updated_at ASC
    `)
    .all(updatedBefore) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    projectId: String(row.project_id),
    sessionId: String(row.session_id),
    status: row.status as FoundationWorkshopSession["status"],
    stage: String(row.stage),
    progress: Number(row.progress ?? 0),
    statusMessage: String(row.status_message ?? ""),
    userMessage: String(row.user_message ?? ""),
    assistantMessage: String(row.assistant_message ?? ""),
    error: typeof row.error === "string" ? row.error : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export function appendFoundationWorkshopMessage(
  projectId: string,
  role: FoundationWorkshopMessage["role"],
  content: string,
) {
  const message = {
    id: nanoid(),
    projectId,
    role,
    content,
    createdAt: nowIso(),
  } satisfies FoundationWorkshopMessage;

  rawDb
    .prepare(`
      INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(message.id, message.projectId, message.role, message.content, message.createdAt);

  return message;
}

/**
 * 流式 workshop 结束时的原子收口：
 *   1. 追加 assistant 消息
 *   2. upsert 草稿 envelope
 *   3. 清理当前 session 行
 * 三步打包在同一个 SQLite 事务里，避免部分失败造成数据撕裂。
 */
export function finalizeFoundationWorkshopTurn(input: {
  projectId: string;
  sessionId: string;
  assistantContent: string;
  envelope: FoundationCoreEnvelope;
  readyToGenerate: boolean;
  structuredSuggestions?: FoundationStructuredSuggestions | null;
  expectedRevisionId?: string | null;
}) {
  const txn = rawDb.transaction(() => {
    if (input.expectedRevisionId !== undefined) {
      // CAS 预检放在任何写入之前：冲突时整个回合收口原子放弃，
      // 不会留下"assistant 消息已落库但草稿没更新"的撕裂状态。
      const current = getFoundationWorkshopEnvelopeState(input.projectId);
      const currentRevisionId = current?.envelope.syncMeta.revisionId ?? null;
      if (currentRevisionId !== input.expectedRevisionId) {
        return null;
      }
    }
    const message = appendFoundationWorkshopMessage(input.projectId, "assistant", input.assistantContent);
    const nextState = upsertFoundationWorkshopEnvelopeState(
      input.projectId,
      input.envelope,
      input.readyToGenerate,
      input.structuredSuggestions,
    );
    const sessionCleared = clearFoundationWorkshopSessionIfCurrent(input.projectId, input.sessionId);
    return { message, nextState, sessionCleared };
  });
  // 先读后写的事务必须 immediate：deferred 在 WAL 多进程下读锁升级写锁会撞 SQLITE_BUSY_SNAPSHOT。
  return txn.immediate();
}
