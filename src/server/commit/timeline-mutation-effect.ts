import "../server-only.ts";

import type Database from "better-sqlite3";
import { rawDb } from "../db/client.ts";
import { computeContentHash } from "../project-files.ts";
import { nowIso } from "../utils.ts";

export interface TimelineMutationPayload {
  projectId: string;
  chapterNo: number;
  reason: string;
  operationKey: string;
  invalidatedAt: string;
  versionId: string;
  contentHash: string;
  mutationIdentity: string;
}

export interface TimelineMutationEffectRecord {
  operationKey: string;
  identityKey: string;
  mutationIdentity: string;
  commitId: string;
  projectId: string;
  chapterNo: number;
  state: "pending" | "done";
  payload: TimelineMutationPayload;
  result: unknown;
  attempts: number;
  lastError: string | null;
}

export function buildTimelineMutationKeys(input: {
  projectId: string;
  chapterNo: number;
  oldContentHash: string;
  newContentHash: string;
  mutationIdentity: string;
}) {
  const identityKey = computeContentHash([
    input.projectId,
    input.chapterNo,
    input.oldContentHash,
    input.mutationIdentity,
  ].join("\n"));
  const operationKey = computeContentHash([
    input.projectId,
    input.chapterNo,
    input.oldContentHash,
    input.newContentHash,
    input.mutationIdentity,
  ].join("\n"));
  return { identityKey, operationKey };
}

function fromRow(row: Record<string, unknown> | undefined): TimelineMutationEffectRecord | null {
  if (!row) return null;
  return {
    operationKey: String(row.operation_key),
    identityKey: String(row.identity_key),
    mutationIdentity: String(row.mutation_identity),
    commitId: String(row.commit_id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    state: String(row.state) as "pending" | "done",
    payload: JSON.parse(String(row.payload_json)) as TimelineMutationPayload,
    result: row.result_json ? JSON.parse(String(row.result_json)) : null,
    attempts: Number(row.attempts),
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

export function registerTimelineMutationEffect(
  db: Database.Database,
  input: {
    operationKey: string;
    identityKey: string;
    mutationIdentity: string;
    commitId: string;
    projectId: string;
    chapterNo: number;
    payloadJson: string;
    timestamp: string;
  },
) {
  db.prepare(`
    INSERT OR IGNORE INTO timeline_mutation_effects (
      operation_key, identity_key, mutation_identity, commit_id, project_id, chapter_no, state,
      payload_json, result_json, attempts, last_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, 0, NULL, ?, ?)
  `).run(
    input.operationKey,
    input.identityKey,
    input.mutationIdentity,
    input.commitId,
    input.projectId,
    input.chapterNo,
    input.payloadJson,
    input.timestamp,
    input.timestamp,
  );
}

export function findTimelineMutationEffectByIdentity(identityKey: string, db: Database.Database = rawDb) {
  return fromRow(db.prepare("SELECT * FROM timeline_mutation_effects WHERE identity_key = ?").get(identityKey) as Record<string, unknown> | undefined);
}

export function findReplayableTimelineMutationEffect(
  projectId: string,
  chapterNo: number,
  mutationIdentity: string,
  currentContentHash: string,
  db: Database.Database = rawDb,
) {
  const rows = db.prepare(`
    SELECT * FROM timeline_mutation_effects
    WHERE project_id = ? AND chapter_no = ? AND mutation_identity = ?
    ORDER BY CASE state WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC
  `).all(projectId, chapterNo, mutationIdentity) as Array<Record<string, unknown>>;
  return rows
    .map((row) => fromRow(row))
    .find((effect) => effect && (effect.state === "pending" || effect.payload.contentHash === currentContentHash))
    ?? null;
}

export function findTimelineMutationEffect(operationKey: string, db: Database.Database = rawDb) {
  return fromRow(db.prepare("SELECT * FROM timeline_mutation_effects WHERE operation_key = ?").get(operationKey) as Record<string, unknown> | undefined);
}

export async function resumeTimelineMutationEffect(
  operationKey: string,
  invalidate: (
    projectId: string,
    chapterNo: number,
    reason: string,
    options: { operationKey: string; invalidatedAt: string },
  ) => Promise<unknown>,
  db: Database.Database = rawDb,
) {
  const effect = findTimelineMutationEffect(operationKey, db);
  if (!effect) throw new Error("时间线失效 effect 不存在");
  if (effect.state === "done") return effect.result;
  const timestamp = nowIso();
  db.prepare(`
    UPDATE timeline_mutation_effects
    SET attempts = attempts + 1, last_error = NULL, updated_at = ?
    WHERE operation_key = ?
  `).run(timestamp, operationKey);
  try {
    const result = await invalidate(
      effect.payload.projectId,
      effect.payload.chapterNo,
      effect.payload.reason,
      { operationKey, invalidatedAt: effect.payload.invalidatedAt },
    );
    db.prepare(`
      UPDATE timeline_mutation_effects
      SET state = 'done', result_json = ?, last_error = NULL, updated_at = ?
      WHERE operation_key = ?
    `).run(JSON.stringify(result ?? null), nowIso(), operationKey);
    return result;
  } catch (error) {
    db.prepare(`
      UPDATE timeline_mutation_effects
      SET last_error = ?, updated_at = ?
      WHERE operation_key = ?
    `).run(error instanceof Error ? error.message : String(error), nowIso(), operationKey);
    throw error;
  }
}
