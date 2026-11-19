import "../server-only.ts";

import { notFound } from "../errors.ts";
import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import { planFoundationCardImport } from "../foundation/foundation-card-sync.ts";
import { buildDefaultCardMeta, normalizeCardMeta } from "../story/story-lorebook.ts";
import type {
  CardDraft,
  CardMeta,
  CardMessage,
  CardProgression,
  CardType,
  ProjectCard,
} from "../types.ts";
import { nowIso } from "../utils.ts";
import { getFoundation } from "./foundation.repository.ts";
import { toCardMessage, toCardProgression, toProjectCard } from "./shared.ts";

export function listCards(projectId: string): ProjectCard[] {
  const stmt = rawDb.prepare("SELECT * FROM project_cards WHERE project_id = ? ORDER BY created_at ASC");
  return (stmt.all(projectId) as Record<string, unknown>[]).map(toProjectCard);
}

export function getCard(cardId: string): ProjectCard | null {
  const row = rawDb.prepare("SELECT * FROM project_cards WHERE id = ?").get(cardId) as Record<string, unknown> | undefined;
  return row ? toProjectCard(row) : null;
}

export function createCard(input: {
  projectId: string;
  cardType: CardType;
  name: string;
  draft?: CardDraft;
  meta?: Partial<CardMeta>;
}): ProjectCard {
  const id = nanoid();
  const now = nowIso();
  const meta = normalizeCardMeta(input.name, { origin: "manual", ...(input.meta ?? {}) });
  rawDb.prepare(
    "INSERT INTO project_cards (id, project_id, card_type, name, draft_json, meta_json, status, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', NULL, ?, ?)",
  ).run(id, input.projectId, input.cardType, input.name, JSON.stringify(input.draft ?? {}), JSON.stringify(meta), now, now);
  return getCard(id)!;
}

export function updateCardDraft(
  cardId: string,
  name: string | undefined,
  draft: CardDraft | undefined,
  meta: Partial<CardMeta> | undefined,
): ProjectCard {
  const now = nowIso();
  const current = getCard(cardId);
  if (!current) {
    throw notFound("卡片不存在");
  }
  const nextName = name ?? current.name;
  const nextDraft = draft ?? current.draft;
  const nextMeta = meta ? normalizeCardMeta(nextName, { ...current.meta, ...meta }) : current.meta;
  rawDb
    .prepare("UPDATE project_cards SET name = ?, draft_json = ?, meta_json = ?, updated_at = ? WHERE id = ?")
    .run(nextName, JSON.stringify(nextDraft), JSON.stringify(nextMeta), now, cardId);
  return getCard(cardId)!;
}

export function confirmCard(cardId: string): ProjectCard {
  const now = nowIso();
  rawDb.prepare("UPDATE project_cards SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?").run(now, now, cardId);
  return getCard(cardId)!;
}

export function unconfirmCard(cardId: string): ProjectCard {
  const now = nowIso();
  rawDb.prepare("UPDATE project_cards SET status = 'draft', confirmed_at = NULL, updated_at = ? WHERE id = ?").run(now, cardId);
  return getCard(cardId)!;
}

export function deleteCard(cardId: string): void {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM project_card_messages WHERE card_id = ?").run(cardId);
    rawDb.prepare("DELETE FROM project_cards WHERE id = ?").run(cardId);
  })();
}

export function syncConfirmedCardsFromFoundation(projectId: string): { imported: number; upgraded: number; skipped: number } {
  const foundation = getFoundation(projectId);
  if (!foundation) {
    return { imported: 0, upgraded: 0, skipped: 0 };
  }

  const existingCards = listCards(projectId);
  const existingCardsById = new Map(existingCards.map((card) => [card.id, card]));
  const importPlan = planFoundationCardImport(foundation, existingCards);
  if (!importPlan.toImport.length && !importPlan.toUpgrade.length) {
    return { imported: 0, upgraded: 0, skipped: importPlan.skipped };
  }

  const now = nowIso();
  let imported = 0;
  let upgraded = 0;

  rawDb.transaction(() => {
    for (const upgrade of importPlan.toUpgrade) {
      const current = existingCardsById.get(upgrade.cardId);
      if (!current || current.cardType !== "character") {
        continue;
      }

      const nextDraft = {
        ...((current.draft as unknown) as Record<string, unknown>),
        ...((upgrade.draft as unknown) as Record<string, unknown>),
        name: upgrade.name,
      } as CardDraft;
      const nextMeta = normalizeCardMeta(upgrade.name, current.meta);
      rawDb
        .prepare("UPDATE project_cards SET name = ?, draft_json = ?, meta_json = ?, updated_at = ? WHERE id = ?")
        .run(upgrade.name, JSON.stringify(nextDraft), JSON.stringify(nextMeta), now, upgrade.cardId);
      upgraded++;
    }

    for (const seed of importPlan.toImport) {
      const id = nanoid();
      const meta = normalizeCardMeta(seed.name, { ...buildDefaultCardMeta(seed.name), origin: "foundation" });
      rawDb.prepare(
        "INSERT INTO project_cards (id, project_id, card_type, name, draft_json, meta_json, status, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)",
      ).run(id, projectId, seed.cardType, seed.name, JSON.stringify(seed.draft), JSON.stringify(meta), now, now, now);
      imported++;
    }
  })();

  return { imported, upgraded, skipped: importPlan.skipped };
}

export const ensureCardsFromFoundation = syncConfirmedCardsFromFoundation;

export function listCardMessages(cardId: string): CardMessage[] {
  const stmt = rawDb.prepare("SELECT * FROM project_card_messages WHERE card_id = ? ORDER BY created_at ASC");
  return (stmt.all(cardId) as Record<string, unknown>[]).map(toCardMessage);
}

export function appendCardMessage(cardId: string, projectId: string, role: "user" | "assistant", content: string): CardMessage {
  const id = nanoid();
  const now = nowIso();
  rawDb.prepare(
    "INSERT INTO project_card_messages (id, card_id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, cardId, projectId, role, content, now);
  return toCardMessage(rawDb.prepare("SELECT * FROM project_card_messages WHERE id = ?").get(id) as Record<string, unknown>);
}

export function listCardProgressions(projectId: string, options?: { cardId?: string; uptoChapterNo?: number }) {
  const clauses = ["project_id = ?"];
  const params: Array<string | number> = [projectId];
  if (options?.cardId) {
    clauses.push("card_id = ?");
    params.push(options.cardId);
  }
  if (options?.uptoChapterNo) {
    clauses.push("chapter_no <= ?");
    params.push(options.uptoChapterNo);
  }
  const sql = `
    SELECT * FROM card_progressions
    WHERE ${clauses.join(" AND ")}
    ORDER BY chapter_no ASC, created_at ASC
  `;
  return (rawDb.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(toCardProgression);
}

export function replaceCardProgressionsForChapter(projectId: string, chapterNo: number, progressions: CardProgression[]) {
  const deleteStmt = rawDb.prepare("DELETE FROM card_progressions WHERE project_id = ? AND chapter_no = ?");
  const insertStmt = rawDb.prepare(`
    INSERT INTO card_progressions (
      id, project_id, card_id, chapter_no, target_path, mode, content, source_fact_ids_json,
      status, review_state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  rawDb.transaction(() => {
    deleteStmt.run(projectId, chapterNo);
    for (const progression of progressions) {
      insertStmt.run(
        progression.id,
        progression.projectId,
        progression.cardId,
        progression.chapterNo,
        progression.targetPath,
        progression.mode,
        progression.content,
        JSON.stringify(progression.sourceFactIds),
        progression.status,
        progression.reviewState,
        progression.createdAt,
        progression.updatedAt,
      );
    }
  })();

  return listCardProgressions(projectId, { uptoChapterNo: chapterNo });
}

export function confirmCardProgressionsInWindow(projectId: string, startChapter: number, endChapter: number) {
  const now = nowIso();
  rawDb
    .prepare(`
      UPDATE card_progressions
      SET review_state = 'confirmed', updated_at = ?
      WHERE project_id = ? AND chapter_no BETWEEN ? AND ?
    `)
    .run(now, projectId, startChapter, endChapter);
}
