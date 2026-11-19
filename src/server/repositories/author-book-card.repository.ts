import "../server-only.ts";

import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import type { AuthorBookCardRecord } from "../types.ts";
import { nowIso } from "../utils.ts";
import { toAuthorBookCardRecord } from "./shared.ts";

export function listBookCardsByAuthor(authorCardId: string) {
  const rows = rawDb
    .prepare("SELECT * FROM author_book_cards WHERE author_card_id = ? ORDER BY created_at DESC")
    .all(authorCardId) as Array<Record<string, unknown>>;
  return rows.map(toAuthorBookCardRecord);
}

export function getBookCard(bookCardId: string) {
  const row = rawDb
    .prepare("SELECT * FROM author_book_cards WHERE id = ?")
    .get(bookCardId) as Record<string, unknown> | undefined;
  return row ? toAuthorBookCardRecord(row) : null;
}

export function createBookCard(
  input: Omit<AuthorBookCardRecord, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
    fingerprintJson?: string;
  },
) {
  const id = input.id ?? nanoid();
  const createdAt = input.createdAt ?? nowIso();

  rawDb
    .prepare(`
      INSERT INTO author_book_cards (
        id, author_card_id, title, author_name, style_card, style_profile_json, style_digest,
        style_exemplars_json, sampled_excerpts_json, confidence, fingerprint_json, word_count, chapter_count,
        source_file_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      input.authorCardId,
      input.title,
      input.authorName ?? null,
      input.styleCard,
      JSON.stringify(input.styleProfile),
      input.styleDigest,
      JSON.stringify(input.styleExemplars),
      JSON.stringify(input.sampledExcerpts),
      input.confidence,
      input.fingerprintJson ?? JSON.stringify(input.fingerprint ?? {}),
      input.wordCount,
      input.chapterCount,
      input.sourceFileName ?? null,
      createdAt,
    );

  return getBookCard(id);
}

export function deleteBookCard(bookCardId: string) {
  rawDb.prepare("DELETE FROM author_book_cards WHERE id = ?").run(bookCardId);
}
