import "../server-only.ts";

import { rawDb } from "../db/client.ts";
import { createCard, deleteCard, listCards, updateCardDraft } from "../repositories/card.repository.ts";
import { getFoundation } from "../repositories/foundation.repository.ts";
import { safeJsonParse } from "../utils.ts";
import type { CanonFact } from "../types.ts";
import {
  buildAutoRecurringCharacterPlan,
  type AutoRecurringSummaryEntry,
} from "./auto-character-discovery.ts";

function listCanonFactsForAutoRecurring(projectId: string) {
  const rows = rawDb
    .prepare(`
      SELECT id, chapter_no, type, content, keywords, metadata_json, created_at
      FROM canon_fact_index
      WHERE project_id = ? AND type IN ('character_state', 'relationship')
      ORDER BY chapter_no ASC, created_at ASC
    `)
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type) as CanonFact["type"],
    chapterNo: Number(row.chapter_no),
    content: String(row.content),
    metadata: safeJsonParse<Record<string, unknown>>(String(row.metadata_json ?? "{}"), {}),
    timestamp: String(row.created_at),
    keywords: String(row.keywords ?? "").split(/\s+/).filter(Boolean),
  } satisfies CanonFact));
}

function listFullSummariesForAutoRecurring(projectId: string): AutoRecurringSummaryEntry[] {
  const rows = rawDb
    .prepare(`
      SELECT chapter_no, level, content, keywords
      FROM summary_index
      WHERE project_id = ? AND level = 'full'
      ORDER BY chapter_no ASC, created_at ASC
    `)
    .all(projectId) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    chapterNo: Number(row.chapter_no),
    level: String(row.level),
    content: String(row.content ?? ""),
    keywords: String(row.keywords ?? "").split(/\s+/).filter(Boolean),
  }));
}

export function recalculateAutoRecurringCharacterCards(projectId: string) {
  const foundation = getFoundation(projectId);
  const cards = listCards(projectId);
  const plan = buildAutoRecurringCharacterPlan({
    foundation,
    existingCards: cards,
    facts: listCanonFactsForAutoRecurring(projectId),
    summaries: listFullSummariesForAutoRecurring(projectId),
  });

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const next of plan.creates) {
    createCard({
      projectId,
      cardType: "character",
      name: next.name,
      draft: next.draft,
      meta: next.meta,
    });
    created += 1;
  }

  for (const next of plan.updates) {
    updateCardDraft(next.cardId, undefined, next.draft, next.meta);
    updated += 1;
  }

  for (const cardId of plan.deletes) {
    deleteCard(cardId);
    deleted += 1;
  }

  return {
    created,
    updated,
    deleted,
  };
}
