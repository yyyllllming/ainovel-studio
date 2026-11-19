import "../server-only.ts";

import { notFound } from "../errors.ts";
import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import type {
  FoundationWorkshopDraft,
  IdeaRecord,
  IdeaWorkshopMessage,
  IdeaWorkshopStateRecord,
} from "../types.ts";
import { nowIso } from "../utils.ts";
import {
  getEmptyIdeaWorkshopDraft,
  toIdeaRecord,
  toIdeaWorkshopMessage,
  toIdeaWorkshopStateRecord,
} from "./shared.ts";

export function listIdeas() {
  const stmt = rawDb.prepare("SELECT * FROM ideas WHERE deleted_at IS NULL ORDER BY updated_at DESC");
  return (stmt.all() as Record<string, unknown>[]).map(toIdeaRecord);
}

export function listTrashedIdeas() {
  const stmt = rawDb.prepare("SELECT * FROM ideas WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
  return (stmt.all() as Record<string, unknown>[]).map(toIdeaRecord);
}

export function getIdea(ideaId: string): IdeaRecord | null {
  const row = rawDb.prepare("SELECT * FROM ideas WHERE id = ?").get(ideaId) as Record<string, unknown> | undefined;
  return row ? toIdeaRecord(row) : null;
}

export function createIdea(input?: { title?: string }) {
  const now = nowIso();
  const ideaId = nanoid();
  const title = input?.title?.trim() || "未命名想法";

  rawDb.transaction(() => {
    rawDb
      .prepare(`
        INSERT INTO ideas (id, title, deleted_at, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?)
      `)
      .run(ideaId, title, now, now);

    rawDb
      .prepare(`
        INSERT INTO idea_workshop_states (idea_id, draft_json, updated_at)
        VALUES (?, ?, ?)
      `)
      .run(ideaId, JSON.stringify(getEmptyIdeaWorkshopDraft()), now);
  })();

  return getIdea(ideaId);
}

export function updateIdea(ideaId: string, input: { title?: string }) {
  const idea = getIdea(ideaId);
  if (!idea) {
    throw notFound("想法不存在");
  }
  const now = nowIso();
  const title = input.title?.trim() || idea.title;
  rawDb.prepare("UPDATE ideas SET title = ?, updated_at = ? WHERE id = ?").run(title, now, ideaId);
  return getIdea(ideaId);
}

export function softDeleteIdea(ideaId: string) {
  const idea = getIdea(ideaId);
  if (!idea) {
    throw notFound("想法不存在");
  }
  if (idea.deletedAt) {
    return;
  }
  const now = nowIso();
  rawDb.prepare("UPDATE ideas SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, ideaId);
}

export function restoreIdea(ideaId: string) {
  const idea = getIdea(ideaId);
  if (!idea) {
    throw notFound("想法不存在");
  }
  if (!idea.deletedAt) {
    return idea;
  }
  const now = nowIso();
  rawDb.prepare("UPDATE ideas SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(now, ideaId);
  return getIdea(ideaId);
}

export function getIdeaWorkshopState(ideaId: string): IdeaWorkshopStateRecord | null {
  const row = rawDb.prepare("SELECT * FROM idea_workshop_states WHERE idea_id = ?").get(ideaId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return null;
  }
  return toIdeaWorkshopStateRecord(row);
}

export function upsertIdeaWorkshopState(ideaId: string, draft: FoundationWorkshopDraft) {
  const now = nowIso();
  const nextDraft = {
    ...getEmptyIdeaWorkshopDraft(),
    ...draft,
    styleSnapshotId: draft.styleSnapshotId ?? null,
    styleSnapshotVersion:
      typeof draft.styleSnapshotVersion === "number" ? draft.styleSnapshotVersion : null,
    styleDigest: draft.styleDigest ?? "",
    styleExemplars: draft.styleExemplars ?? [],
  };

  rawDb.transaction(() => {
    rawDb
      .prepare(`
        INSERT INTO idea_workshop_states (idea_id, draft_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(idea_id) DO UPDATE SET
          draft_json = excluded.draft_json,
          updated_at = excluded.updated_at
      `)
      .run(ideaId, JSON.stringify(nextDraft), now);

    rawDb.prepare("UPDATE ideas SET updated_at = ? WHERE id = ?").run(now, ideaId);
  })();

  return getIdeaWorkshopState(ideaId);
}

export function listIdeaWorkshopMessages(ideaId: string): IdeaWorkshopMessage[] {
  const rows = rawDb
    .prepare(`
      SELECT * FROM idea_workshop_messages
      WHERE idea_id = ?
      ORDER BY created_at ASC
    `)
    .all(ideaId) as Array<Record<string, unknown>>;

  return rows.map(toIdeaWorkshopMessage);
}

export function appendIdeaWorkshopMessage(
  ideaId: string,
  role: IdeaWorkshopMessage["role"],
  content: string,
  createdAt = nowIso(),
) {
  const message = {
    id: nanoid(),
    ideaId,
    role,
    content,
    createdAt,
  } satisfies IdeaWorkshopMessage;

  rawDb.transaction(() => {
    rawDb
      .prepare(`
        INSERT INTO idea_workshop_messages (id, idea_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(message.id, message.ideaId, message.role, message.content, message.createdAt);

    rawDb.prepare("UPDATE ideas SET updated_at = ? WHERE id = ?").run(createdAt, ideaId);
  })();

  return message;
}
