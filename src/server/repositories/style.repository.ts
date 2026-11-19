import "../server-only.ts";

import { notFound } from "../errors.ts";

import { rawDb } from "../db/client.ts";
import { sanitizeProjectPremise } from "../foundation/foundation-summary-sanitizer.ts";
import { normalizeStyleProfile } from "../style/style-steering.ts";
import type {
  ActiveStylePackage,
  FoundationPayload,
  StyleCardSnapshot,
  StyleReferenceImport,
} from "../types.ts";
import { safeJsonParse } from "../utils.ts";
import { getFoundation, getFoundationWorkshopState, saveFoundation, upsertFoundationWorkshopState } from "./foundation.repository.ts";
import { getProject } from "./project.repository.ts";
import { getDefaultWorkshopDraft } from "./shared.ts";

function toStyleReferenceImport(row: Record<string, unknown>): StyleReferenceImport {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    author: row.author ? String(row.author) : undefined,
    originalFileName: String(row.original_file_name),
    mediaType: String(row.media_type),
    sourceHash: String(row.source_hash),
    rawFilePath: String(row.raw_file_path),
    normalizedFilePath: String(row.normalized_file_path),
    wordCount: Number(row.word_count),
    encoding: String(row.encoding),
    confidence: String(row.confidence) as StyleReferenceImport["confidence"],
    chapterCount: Number(row.chapter_count),
    excerpts: safeJsonParse(String(row.excerpts_json ?? "[]"), []),
    createdAt: String(row.created_at),
  };
}

function toStyleCardSnapshot(row: Record<string, unknown>): StyleCardSnapshot {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    mode: String(row.mode) as StyleCardSnapshot["mode"],
    sourceIds: safeJsonParse(String(row.source_ids_json ?? "[]"), []),
    styleCard: String(row.style_card),
    styleProfile: normalizeStyleProfile(safeJsonParse(String(row.style_profile_json ?? "{}"), {})),
    styleDigest: String(row.style_digest ?? ""),
    styleExemplars: safeJsonParse(String(row.style_exemplars_json ?? "[]"), []),
    sampledExcerpts: safeJsonParse(String(row.sampled_excerpts_json ?? "[]"), []),
    confidence: String(row.confidence) as StyleCardSnapshot["confidence"],
    version: Number(row.version),
    createdAt: String(row.created_at),
  };
}

/** @deprecated 项目级 style_reference_imports 仅保留历史兼容用途；新的导入入口应写入作者卡库。 */
export function saveStyleReferenceImport(projectId: string, input: Omit<StyleReferenceImport, "projectId">) {
  rawDb
    .prepare(`
      INSERT INTO style_reference_imports (
        id, project_id, title, author, original_file_name, media_type, source_hash,
        raw_file_path, normalized_file_path, word_count, encoding, confidence, chapter_count, excerpts_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.id,
      projectId,
      input.title,
      input.author ?? null,
      input.originalFileName,
      input.mediaType,
      input.sourceHash,
      input.rawFilePath,
      input.normalizedFilePath,
      input.wordCount,
      input.encoding,
      input.confidence,
      input.chapterCount,
      JSON.stringify(input.excerpts),
      input.createdAt,
    );

  return getStyleReferenceImport(projectId, input.id);
}

/** @deprecated 项目级 style_reference_imports 仅用于读取历史项目数据。 */
export function listStyleReferenceImports(projectId: string) {
  return (rawDb
    .prepare("SELECT * FROM style_reference_imports WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as Array<Record<string, unknown>>).map(toStyleReferenceImport);
}

export function getStyleReferenceImport(projectId: string, importId: string) {
  const row = rawDb
    .prepare("SELECT * FROM style_reference_imports WHERE project_id = ? AND id = ?")
    .get(projectId, importId) as Record<string, unknown> | undefined;
  return row ? toStyleReferenceImport(row) : null;
}

export function getStyleReferenceImportsByIds(projectId: string, sourceIds: string[]) {
  if (sourceIds.length === 0) {
    return [];
  }
  const placeholders = sourceIds.map(() => "?").join(",");
  const rows = rawDb
    .prepare(
      `SELECT * FROM style_reference_imports WHERE project_id = ? AND id IN (${placeholders}) ORDER BY created_at DESC`,
    )
    .all(projectId, ...sourceIds) as Array<Record<string, unknown>>;
  return rows.map(toStyleReferenceImport);
}

export function getNextStyleSnapshotVersion(projectId: string) {
  const row = rawDb
    .prepare("SELECT COALESCE(MAX(version), 0) AS max_version FROM style_card_snapshots WHERE project_id = ?")
    .get(projectId) as Record<string, unknown>;
  return Number(row.max_version ?? 0) + 1;
}

export function saveStyleCardSnapshot(snapshot: StyleCardSnapshot) {
  rawDb
    .prepare(`
      INSERT INTO style_card_snapshots (
        id, project_id, mode, source_ids_json, style_card, style_profile_json,
        style_digest, style_exemplars_json, sampled_excerpts_json, confidence, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      snapshot.id,
      snapshot.projectId,
      snapshot.mode,
      JSON.stringify(snapshot.sourceIds),
      snapshot.styleCard,
      JSON.stringify(snapshot.styleProfile),
      snapshot.styleDigest,
      JSON.stringify(snapshot.styleExemplars),
      JSON.stringify(snapshot.sampledExcerpts),
      snapshot.confidence,
      snapshot.version,
      snapshot.createdAt,
    );

  return getStyleCardSnapshot(snapshot.projectId, snapshot.id);
}

export function listStyleCardSnapshots(projectId: string) {
  return (rawDb
    .prepare("SELECT * FROM style_card_snapshots WHERE project_id = ? ORDER BY version DESC")
    .all(projectId) as Array<Record<string, unknown>>).map(toStyleCardSnapshot);
}

export function getStyleCardSnapshot(projectId: string, snapshotId: string) {
  const row = rawDb
    .prepare("SELECT * FROM style_card_snapshots WHERE project_id = ? AND id = ?")
    .get(projectId, snapshotId) as Record<string, unknown> | undefined;
  return row ? toStyleCardSnapshot(row) : null;
}

export function getActiveStylePackage(projectId: string): ActiveStylePackage {
  const foundation = getFoundation(projectId);
  const workshop = getFoundationWorkshopState(projectId);
  const snapshotId = foundation?.styleSnapshotId ?? workshop?.draft.styleSnapshotId ?? null;
  const snapshot = snapshotId ? getStyleCardSnapshot(projectId, snapshotId) : null;
  const styleProfile = normalizeStyleProfile(
    snapshot?.styleProfile
      ?? foundation?.styleProfile
      ?? workshop?.draft.styleProfile
      ?? undefined,
  );

  return {
    styleSnapshotId: snapshot?.id ?? foundation?.styleSnapshotId ?? workshop?.draft.styleSnapshotId ?? null,
    styleSnapshotVersion:
      snapshot?.version
      ?? foundation?.styleSnapshotVersion
      ?? workshop?.draft.styleSnapshotVersion
      ?? null,
    styleCard: snapshot?.styleCard ?? foundation?.styleCard ?? workshop?.draft.styleSteeringCard ?? "",
    styleProfile,
    styleDigest: snapshot?.styleDigest || foundation?.styleDigest || workshop?.draft.styleDigest || "",
    styleExemplars:
      snapshot?.styleExemplars?.length
        ? snapshot.styleExemplars
        : foundation?.styleExemplars?.length
          ? foundation.styleExemplars
          : workshop?.draft.styleExemplars ?? [],
    confidence: snapshot?.confidence ?? null,
    sampledExcerpts: snapshot?.sampledExcerpts ?? [],
    sourceIds: snapshot?.sourceIds ?? [],
  };
}

export function applyStyleCardSnapshot(projectId: string, snapshotId: string) {
  const project = getProject(projectId);
  const snapshot = getStyleCardSnapshot(projectId, snapshotId);
  if (!project || !snapshot) {
    throw notFound("待应用的 style snapshot 不存在");
  }

  const existingFoundation = getFoundation(projectId);
  const existingWorkshop = getFoundationWorkshopState(projectId);
  const baseDraft = existingWorkshop?.draft ?? getDefaultWorkshopDraft(project);
  const stableProjectPremise = sanitizeProjectPremise(project.premise);
  const nextFoundation: FoundationPayload = {
    premise: existingFoundation?.premise || stableProjectPremise || baseDraft.premise || "待补充",
    styleCard: snapshot.styleCard,
    styleProfile: snapshot.styleProfile,
    styleSnapshotId: snapshot.id,
    styleSnapshotVersion: snapshot.version,
    styleDigest: snapshot.styleDigest,
    styleExemplars: snapshot.styleExemplars,
    characters: existingFoundation?.characters ?? baseDraft.characterIdeas,
    worldview: existingFoundation?.worldview ?? baseDraft.worldviewIdeas,
    relationships: existingFoundation?.relationships ?? baseDraft.relationshipIdeas,
  };
  const nextDraft = {
    ...baseDraft,
    styleSteeringCard: snapshot.styleCard,
    styleProfile: snapshot.styleProfile,
    styleSnapshotId: snapshot.id,
    styleSnapshotVersion: snapshot.version,
    styleDigest: snapshot.styleDigest,
    styleExemplars: snapshot.styleExemplars,
  };

  rawDb.transaction(() => {
    saveFoundation(projectId, nextFoundation);
    upsertFoundationWorkshopState(projectId, nextDraft, existingWorkshop?.readyToGenerate ?? false);
  })();

  return {
    snapshot,
    foundation: getFoundation(projectId),
    workshopState: getFoundationWorkshopState(projectId),
  };
}
