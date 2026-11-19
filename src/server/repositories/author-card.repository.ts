import "../server-only.ts";

import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import type {
  AuthorCardRecord,
  AuthorCardSourceWork,
  StyleCardSnapshot,
} from "../types.ts";
import { nowIso } from "../utils.ts";
import { toAuthorCardRecord, toAuthorCardVersionRecord } from "./shared.ts";

const authorCardListSql = `
  SELECT
    author_cards.*,
    latest.version AS latest_version,
    latest.confidence AS latest_confidence,
    latest.created_at AS latest_created_at,
    COALESCE(version_totals.version_count, 0) AS version_count
  FROM author_cards
  LEFT JOIN author_card_versions AS latest
    ON latest.author_card_id = author_cards.id
   AND latest.version = (
     SELECT MAX(version)
     FROM author_card_versions
     WHERE author_card_id = author_cards.id
   )
  LEFT JOIN (
    SELECT author_card_id, COUNT(*) AS version_count
    FROM author_card_versions
    GROUP BY author_card_id
  ) AS version_totals
    ON version_totals.author_card_id = author_cards.id
`;

export function listAuthorCards() {
  const rows = rawDb.prepare(`${authorCardListSql} WHERE author_cards.archived_at IS NULL ORDER BY author_cards.updated_at DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(toAuthorCardRecord);
}

export function getAuthorCard(authorCardId: string): AuthorCardRecord | null {
  const row = rawDb.prepare(`${authorCardListSql} WHERE author_cards.id = ?`).get(authorCardId) as
    | Record<string, unknown>
    | undefined;
  return row ? toAuthorCardRecord(row) : null;
}

export function findAuthorCardsByNormalizedName(normalizedName: string) {
  const rows = rawDb.prepare(
    `${authorCardListSql} WHERE author_cards.normalized_name = ? AND author_cards.archived_at IS NULL ORDER BY author_cards.updated_at DESC`,
  ).all(normalizedName) as Array<Record<string, unknown>>;
  return rows.map(toAuthorCardRecord);
}

export function listAuthorCardVersions(authorCardId: string) {
  const rows = rawDb.prepare(
    "SELECT * FROM author_card_versions WHERE author_card_id = ? ORDER BY version DESC",
  ).all(authorCardId) as Array<Record<string, unknown>>;
  return rows.map(toAuthorCardVersionRecord);
}

export function getLatestAuthorCardVersion(authorCardId: string) {
  const row = rawDb.prepare(
    "SELECT * FROM author_card_versions WHERE author_card_id = ? ORDER BY version DESC LIMIT 1",
  ).get(authorCardId) as Record<string, unknown> | undefined;
  return row ? toAuthorCardVersionRecord(row) : null;
}

export function createAuthorCard(input: { displayName: string; normalizedName: string }) {
  const now = nowIso();
  const authorCardId = nanoid();
  rawDb
    .prepare(`
      INSERT INTO author_cards (id, display_name, normalized_name, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?)
    `)
    .run(authorCardId, input.displayName, input.normalizedName, now, now);
  return getAuthorCard(authorCardId);
}

export function getNextAuthorCardVersion(authorCardId: string) {
  const row = rawDb.prepare(
    "SELECT COALESCE(MAX(version), 0) AS max_version FROM author_card_versions WHERE author_card_id = ?",
  ).get(authorCardId) as Record<string, unknown>;
  return Number(row.max_version ?? 0) + 1;
}

export function appendAuthorCardVersion(input: {
  authorCardId: string;
  snapshot: Pick<
    StyleCardSnapshot,
    "styleCard" | "styleProfile" | "styleDigest" | "styleExemplars" | "sampledExcerpts" | "confidence"
  >;
  sourceWorks: AuthorCardSourceWork[];
}) {
  const createdAt = nowIso();
  const version = getNextAuthorCardVersion(input.authorCardId);
  const versionId = nanoid();

  rawDb.transaction(() => {
    rawDb
      .prepare(`
        INSERT INTO author_card_versions (
          id, author_card_id, version, style_card, style_profile_json, style_digest,
          style_exemplars_json, sampled_excerpts_json, confidence, source_works_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        versionId,
        input.authorCardId,
        version,
        input.snapshot.styleCard,
        JSON.stringify(input.snapshot.styleProfile),
        input.snapshot.styleDigest,
        JSON.stringify(input.snapshot.styleExemplars),
        JSON.stringify(input.snapshot.sampledExcerpts),
        input.snapshot.confidence,
        JSON.stringify(input.sourceWorks),
        createdAt,
      );

    rawDb
      .prepare("UPDATE author_cards SET updated_at = ? WHERE id = ?")
      .run(createdAt, input.authorCardId);
  })();

  return listAuthorCardVersions(input.authorCardId).find((entry) => entry.id === versionId) ?? null;
}
