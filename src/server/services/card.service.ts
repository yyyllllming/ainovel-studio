import "../server-only.ts";

import { validateCharacterName } from "../../lib/character-name-policy.ts";
import { recalculateAutoRecurringCharacterCards } from "../character/auto-character-discovery-runtime.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import {
  confirmCard as confirmCardRecord,
  createCard as createCardRecord,
  deleteCard as deleteCardRecord,
  syncConfirmedCardsFromFoundation as syncConfirmedCardsFromFoundationRecord,
  getCard as getCardRecord,
  listCardMessages as listCardMessagesRecord,
  listCardProgressions as listCardProgressionsRecord,
  listCards as listCardsRecord,
  unconfirmCard as unconfirmCardRecord,
  updateCardDraft as updateCardDraftRecord,
} from "../repositories/card.repository.ts";
import type { CardDraft, CardMeta, CardType } from "../types.ts";

function assertProjectCard(projectId: string, cardId: string) {
  const card = getCardRecord(cardId);
  if (!card) {
    throw notFound("卡片不存在", { cardId });
  }
  if (card.projectId !== projectId) {
    throw forbidden("卡片不属于该项目", { projectId, cardId });
  }
  return card;
}

function requireConcreteCharacterName(name: string) {
  const validation = validateCharacterName(name);
  if (!validation.accepted || !validation.canonical) {
    throw badRequest("角色名必须是完整专有名，不能使用称谓、动作片段或半句", {
      name,
      reason: validation.reason,
    });
  }
  return validation.canonical;
}

function normalizeCharacterDraftName(draft: CardDraft | undefined, canonicalName: string) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return draft;
  }
  return {
    ...draft,
    name: canonicalName,
  } satisfies CardDraft;
}

export function listProjectCards(projectId: string, options?: { includeDraft?: boolean }) {
  const cards = listCardsRecord(projectId);
  return {
    cards: options?.includeDraft ? cards : cards.filter((card) => card.status === "confirmed"),
    candidateCount: cards.filter((card) => card.status === "draft" && card.meta.origin === "auto_recurring").length,
  };
}

export function syncConfirmedCardsFromProjectFoundation(projectId: string) {
  const result = syncConfirmedCardsFromFoundationRecord(projectId);
  recalculateAutoRecurringCharacterCards(projectId);
  return result;
}

export function createProjectCard(input: {
  projectId: string;
  cardType: CardType;
  name: string;
  draft?: CardDraft;
  meta?: Partial<CardMeta>;
}) {
  if (input.cardType === "character") {
    const canonicalName = requireConcreteCharacterName(input.name);
    const card = createCardRecord({
      ...input,
      name: canonicalName,
      draft: normalizeCharacterDraftName(input.draft, canonicalName),
    });
    recalculateAutoRecurringCharacterCards(input.projectId);
    return card;
  }
  return createCardRecord({
    ...input,
    name: input.name.trim(),
  });
}

export function getProjectCard(projectId: string, cardId: string) {
  return assertProjectCard(projectId, cardId);
}

export function listProjectCardMessages(projectId: string, cardId: string) {
  assertProjectCard(projectId, cardId);
  return listCardMessagesRecord(cardId);
}

export function updateProjectCard(
  projectId: string,
  cardId: string,
  name: string | undefined,
  draft: CardDraft | undefined,
  meta: Partial<CardMeta> | undefined,
) {
  const current = assertProjectCard(projectId, cardId);
  if (current.cardType === "character") {
    const nextName = requireConcreteCharacterName(name ?? current.name);
    const card = updateCardDraftRecord(
      cardId,
      nextName,
      normalizeCharacterDraftName(draft ?? current.draft, nextName),
      meta,
    );
    recalculateAutoRecurringCharacterCards(projectId);
    return card;
  }
  return updateCardDraftRecord(cardId, name, draft, meta);
}

export function deleteProjectCard(projectId: string, cardId: string) {
  const card = assertProjectCard(projectId, cardId);
  deleteCardRecord(cardId);
  if (card.cardType === "character") {
    recalculateAutoRecurringCharacterCards(projectId);
  }
}

export function confirmProjectCard(projectId: string, cardId: string) {
  const card = assertProjectCard(projectId, cardId);
  if (card.cardType === "character") {
    requireConcreteCharacterName(card.name);
  }
  const confirmed = confirmCardRecord(cardId);
  if (card.cardType === "character") {
    recalculateAutoRecurringCharacterCards(projectId);
  }
  return confirmed;
}

export function unconfirmProjectCard(projectId: string, cardId: string) {
  const card = assertProjectCard(projectId, cardId);
  const draft = unconfirmCardRecord(cardId);
  if (card.cardType === "character") {
    recalculateAutoRecurringCharacterCards(projectId);
  }
  return draft;
}

export function listProjectCardProgressions(projectId: string, cardId: string) {
  assertProjectCard(projectId, cardId);
  return listCardProgressionsRecord(projectId, { cardId });
}
