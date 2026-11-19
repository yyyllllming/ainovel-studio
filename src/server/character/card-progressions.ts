import { nanoid } from "nanoid";
import type { CanonFact, CardProgression, CharacterSnapshot, ProjectCard } from "../types.ts";
import { nowIso } from "../utils.ts";

function unique(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function createProgression(input: {
  projectId: string;
  cardId: string;
  chapterNo: number;
  targetPath: string;
  mode: CardProgression["mode"];
  content: string;
  sourceFactIds?: string[];
}) {
  const now = nowIso();
  return {
    id: nanoid(),
    projectId: input.projectId,
    cardId: input.cardId,
    chapterNo: input.chapterNo,
    targetPath: input.targetPath,
    mode: input.mode,
    content: input.content,
    sourceFactIds: input.sourceFactIds ?? [],
    status: "active",
    reviewState: "provisional",
    createdAt: now,
    updatedAt: now,
  } satisfies CardProgression;
}

function matchWorldCard(card: ProjectCard, fact: CanonFact) {
  const metadataNeedles = [
    String(fact.metadata.rule ?? ""),
    String(fact.metadata.name ?? ""),
    String(fact.metadata.world ?? ""),
    String(fact.metadata.location ?? ""),
  ].filter(Boolean);

  return [fact.content, ...metadataNeedles].some((entry) => entry.includes(card.name));
}

export function buildCardProgressionsFromArtifacts(input: {
  projectId: string;
  chapterNo: number;
  cards: ProjectCard[];
  snapshot: CharacterSnapshot;
  facts: CanonFact[];
}) {
  const next: CardProgression[] = [];
  const confirmedCards = input.cards.filter((card) => card.status === "confirmed");

  for (const card of confirmedCards) {
    if (card.cardType === "character") {
      const snapshotState = input.snapshot.characters[card.name];
      if (snapshotState?.location) {
        next.push(
          createProgression({
            projectId: input.projectId,
            cardId: card.id,
            chapterNo: input.chapterNo,
            targetPath: "state.location",
            mode: "replace",
            content: snapshotState.location,
          }),
        );
      }
      if (snapshotState?.emotion) {
        next.push(
          createProgression({
            projectId: input.projectId,
            cardId: card.id,
            chapterNo: input.chapterNo,
            targetPath: "state.emotion",
            mode: "replace",
            content: snapshotState.emotion,
          }),
        );
      }
      if (snapshotState?.items?.length) {
        next.push(
          createProgression({
            projectId: input.projectId,
            cardId: card.id,
            chapterNo: input.chapterNo,
            targetPath: "state.items",
            mode: "replace",
            content: JSON.stringify(unique(snapshotState.items)),
          }),
        );
      }
      for (const [other, relation] of Object.entries(snapshotState?.relationships ?? {})) {
        next.push(
          createProgression({
            projectId: input.projectId,
            cardId: card.id,
            chapterNo: input.chapterNo,
            targetPath: `state.relationships.${other}`,
            mode: "replace",
            content: relation,
          }),
        );
      }
      for (const note of snapshotState?.notes ?? []) {
        next.push(
          createProgression({
            projectId: input.projectId,
            cardId: card.id,
            chapterNo: input.chapterNo,
            targetPath: "state.notes",
            mode: "add",
            content: note,
          }),
        );
      }
    }

    for (const fact of input.facts) {
      if (card.cardType === "character") {
        const character = String(fact.metadata.character ?? fact.metadata.source ?? "");
        if (character !== card.name && !fact.content.includes(card.name)) {
          continue;
        }

        if (fact.type === "location_change") {
          const location = String(fact.metadata.location ?? fact.metadata.to ?? "");
          if (location) {
            next.push(
              createProgression({
                projectId: input.projectId,
                cardId: card.id,
                chapterNo: input.chapterNo,
                targetPath: "state.location",
                mode: "replace",
                content: location,
                sourceFactIds: [fact.id],
              }),
            );
          }
          continue;
        }

        if (fact.type === "item_acquired") {
          const item = String(fact.metadata.item ?? fact.metadata.name ?? "");
          if (item) {
            next.push(
              createProgression({
                projectId: input.projectId,
                cardId: card.id,
                chapterNo: input.chapterNo,
                targetPath: "state.items",
                mode: "add",
                content: item,
                sourceFactIds: [fact.id],
              }),
            );
          }
          continue;
        }

        if (fact.type === "relationship") {
          const source = String(fact.metadata.source ?? "");
          const target = String(fact.metadata.target ?? "");
          if (source !== card.name && target !== card.name) {
            continue;
          }
          const relationTarget = source === card.name ? target : source;
          const label = String(fact.metadata.label ?? fact.metadata.value ?? fact.metadata.change ?? "");
          if (relationTarget && label) {
            next.push(
              createProgression({
                projectId: input.projectId,
                cardId: card.id,
                chapterNo: input.chapterNo,
                targetPath: `state.relationships.${relationTarget}`,
                mode: "replace",
                content: label,
                sourceFactIds: [fact.id],
              }),
            );
          }
          continue;
        }

        if (fact.type === "character_state") {
          const field = String(fact.metadata.field ?? "");
          const value = String(fact.metadata.value ?? "");
          if (field && value && ["emotion", "location"].includes(field)) {
            next.push(
              createProgression({
                projectId: input.projectId,
                cardId: card.id,
                chapterNo: input.chapterNo,
                targetPath: `state.${field}`,
                mode: "replace",
                content: value,
                sourceFactIds: [fact.id],
              }),
            );
          } else {
            next.push(
              createProgression({
                projectId: input.projectId,
                cardId: card.id,
                chapterNo: input.chapterNo,
                targetPath: "state.notes",
                mode: "add",
                content: fact.content,
                sourceFactIds: [fact.id],
              }),
            );
          }
        }
      }

      if (card.cardType === "world" && (fact.type === "world_rule" || fact.type === "plot_event")) {
        if (!matchWorldCard(card, fact)) {
          continue;
        }
        next.push(
          createProgression({
            projectId: input.projectId,
            cardId: card.id,
            chapterNo: input.chapterNo,
            targetPath: "state.notes",
            mode: "add",
            content: fact.content,
            sourceFactIds: [fact.id],
          }),
        );
      }
    }
  }

  const dedupeKey = new Set<string>();
  return next.filter((progression) => {
    const key = [
      progression.cardId,
      progression.targetPath,
      progression.mode,
      progression.content,
    ].join("::");
    if (dedupeKey.has(key)) {
      return false;
    }
    dedupeKey.add(key);
    return true;
  });
}
