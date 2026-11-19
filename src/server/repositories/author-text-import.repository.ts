import "../server-only.ts";

import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import type { AuthorTextImportRecord } from "../types.ts";
import { nowIso } from "../utils.ts";
import { toAuthorTextImportRecord } from "./shared.ts";

export function listTextImportsByAuthor(authorCardId: string) {
  const rows = rawDb
    .prepare("SELECT * FROM author_text_imports WHERE author_card_id = ? ORDER BY created_at DESC")
    .all(authorCardId) as Array<Record<string, unknown>>;
  return rows.map(toAuthorTextImportRecord);
}

export function getTextImport(importId: string) {
  const row = rawDb
    .prepare("SELECT * FROM author_text_imports WHERE id = ?")
    .get(importId) as Record<string, unknown> | undefined;
  return row ? toAuthorTextImportRecord(row) : null;
}

export function saveTextImport(
  input: Omit<AuthorTextImportRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
) {
  const id = input.id ?? nanoid();
  const createdAt = input.createdAt ?? nowIso();

  rawDb
    .prepare(`
      INSERT INTO author_text_imports (
        id, author_card_id, title, author_name, original_file_name, media_type, source_hash,
        word_count, encoding, confidence, chapter_count, excerpts_json, source_kind,
        book_card_status, last_generation_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      input.authorCardId,
      input.title,
      input.authorName ?? null,
      input.originalFileName,
      input.mediaType,
      input.sourceHash,
      input.wordCount,
      input.encoding,
      input.confidence,
      input.chapterCount,
      JSON.stringify(input.excerpts),
      input.sourceKind,
      input.bookCardStatus,
      input.lastGenerationError ?? null,
      createdAt,
    );

  return getTextImport(id);
}

export function updateTextImportBookCardState(input: {
  importId: string;
  bookCardStatus: AuthorTextImportRecord["bookCardStatus"];
  lastGenerationError?: string | null;
}) {
  rawDb.prepare(`
    UPDATE author_text_imports
    SET book_card_status = ?, last_generation_error = ?
    WHERE id = ?
  `).run(input.bookCardStatus, input.lastGenerationError ?? null, input.importId);
  return getTextImport(input.importId);
}

export function deleteTextImport(importId: string) {
  rawDb.prepare("DELETE FROM author_text_imports WHERE id = ?").run(importId);
}

export function getTextImportsByIds(ids: string[]) {
  if (!ids.length) {
    return [] as AuthorTextImportRecord[];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = rawDb
    .prepare(`SELECT * FROM author_text_imports WHERE id IN (${placeholders})`)
    .all(...ids) as Array<Record<string, unknown>>;
  const mapped = rows.map(toAuthorTextImportRecord);
  const byId = new Map(mapped.map((entry) => [entry.id, entry] as const));
  return ids.map((id) => byId.get(id)).filter((entry): entry is AuthorTextImportRecord => Boolean(entry));
}
