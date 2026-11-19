import "../server-only.ts";

import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import type { AuthorBookImportPreviewRecord } from "../types.ts";
import { nowIso } from "../utils.ts";
import { toAuthorBookImportPreviewRecord } from "./shared.ts";

export function getAuthorBookImportPreview(previewId: string) {
  const row = rawDb
    .prepare("SELECT * FROM author_book_import_previews WHERE id = ?")
    .get(previewId) as Record<string, unknown> | undefined;
  return row ? toAuthorBookImportPreviewRecord(row) : null;
}

export function listExpiredAuthorBookImportPreviews(authorCardId: string, now: string) {
  const rows = rawDb
    .prepare(`
      SELECT * FROM author_book_import_previews
      WHERE author_card_id = ?
        AND expires_at < ?
    `)
    .all(authorCardId, now) as Array<Record<string, unknown>>;
  return rows.map(toAuthorBookImportPreviewRecord);
}

export function createAuthorBookImportPreview(
  input: Omit<AuthorBookImportPreviewRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
) {
  const id = input.id ?? nanoid();
  const createdAt = input.createdAt ?? nowIso();

  rawDb.prepare(`
    INSERT INTO author_book_import_previews (
      id, author_card_id, title, author_name, original_file_name, media_type, source_hash,
      word_count, encoding, parse_confidence, parser_mode, chapter_count, warnings_json, sample_plan_json,
      status, apply_status, import_id, book_card_id, last_error, created_at, expires_at, consumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.authorCardId,
    input.title,
    input.authorName ?? null,
    input.originalFileName,
    input.mediaType,
    input.sourceHash,
    input.wordCount,
    input.encoding,
    input.parseConfidence,
    input.parserMode,
    input.chapterCount,
    JSON.stringify(input.warnings),
    JSON.stringify(input.samplePlan),
    input.status,
    input.applyStatus,
    input.importId ?? null,
    input.bookCardId ?? null,
    input.lastError ?? null,
    createdAt,
    input.expiresAt,
    input.consumedAt ?? null,
  );

  return getAuthorBookImportPreview(id);
}

export function updateAuthorBookImportPreview(
  previewId: string,
  patch: Partial<Pick<
    AuthorBookImportPreviewRecord,
    "status" | "applyStatus" | "importId" | "bookCardId" | "lastError" | "expiresAt" | "consumedAt"
  >>,
) {
  const existing = getAuthorBookImportPreview(previewId);
  if (!existing) {
    return null;
  }

  rawDb.prepare(`
    UPDATE author_book_import_previews
    SET status = ?, apply_status = ?, import_id = ?, book_card_id = ?, last_error = ?, expires_at = ?, consumed_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? existing.status,
    patch.applyStatus ?? existing.applyStatus,
    // 可空字段需区分“未提供”(undefined) 与“显式清空”(null)，否则 null 补丁会被旧值吞掉。
    patch.importId !== undefined ? patch.importId : existing.importId ?? null,
    patch.bookCardId !== undefined ? patch.bookCardId : existing.bookCardId ?? null,
    patch.lastError !== undefined ? patch.lastError : existing.lastError ?? null,
    patch.expiresAt ?? existing.expiresAt,
    patch.consumedAt !== undefined ? patch.consumedAt : existing.consumedAt ?? null,
    previewId,
  );

  return getAuthorBookImportPreview(previewId);
}

export function markAuthorBookImportPreviewExpired(previewId: string) {
  return updateAuthorBookImportPreview(previewId, { status: "expired" });
}
