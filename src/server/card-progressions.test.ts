import test from "node:test";
import assert from "node:assert/strict";

import { buildCardProgressionsFromArtifacts } from "./character/card-progressions.ts";
import type { CanonFact, CharacterSnapshot, ProjectCard } from "./types.ts";

const emptySnapshot: CharacterSnapshot = {
  chapterNo: 5,
  characters: {},
};

function makeCard(overrides: Partial<ProjectCard> & Pick<ProjectCard, "id" | "name" | "cardType">): ProjectCard {
  return {
    id: overrides.id,
    projectId: overrides.projectId ?? "project-1",
    cardType: overrides.cardType,
    name: overrides.name,
    draft:
      overrides.draft ?? {
        name: overrides.name,
        role: "待补完",
        goal: "待补完",
        traits: ["待观察"],
      },
    meta: {
      aliases: [overrides.name],
      keywords: [],
      priority: 50,
      pinnedScope: "none",
      linkedCardIds: [],
      enabled: true,
      ...overrides.meta,
    },
    status: overrides.status ?? "confirmed",
    confirmedAt: overrides.confirmedAt ?? "2026-04-06T00:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-04-06T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T00:00:00.000Z",
  };
}

function makeRelationshipFact(id: string, content: string, metadata: Record<string, unknown>): CanonFact {
  return {
    id,
    type: "relationship",
    chapterNo: 5,
    content,
    metadata,
    timestamp: "2026-04-06T00:00:00.000Z",
    keywords: [],
  };
}

test("relationship facts only progress cards that are one of the relation endpoints", () => {
  const cards = [
    makeCard({ id: "card-linzhou", name: "林舟", cardType: "character" }),
    makeCard({ id: "card-yanwujiu", name: "晏无咎", cardType: "character" }),
    makeCard({ id: "card-gunan", name: "顾南", cardType: "character" }),
  ];
  const facts = [
    makeRelationshipFact("fact-rel-1", "林舟与晏无咎当众决裂，顾南在场目睹。", {
      source: "林舟",
      target: "晏无咎",
      label: "决裂",
    }),
  ];

  const progressions = buildCardProgressionsFromArtifacts({
    projectId: "project-1",
    chapterNo: 5,
    cards,
    snapshot: emptySnapshot,
    facts,
  });

  const linzhou = progressions.filter((item) => item.cardId === "card-linzhou");
  assert.equal(linzhou.length, 1);
  assert.equal(linzhou[0]?.targetPath, "state.relationships.晏无咎");
  assert.equal(linzhou[0]?.content, "决裂");

  const yanwujiu = progressions.filter((item) => item.cardId === "card-yanwujiu");
  assert.equal(yanwujiu.length, 1);
  assert.equal(yanwujiu[0]?.targetPath, "state.relationships.林舟");

  const gunan = progressions.filter((item) => item.cardId === "card-gunan");
  assert.equal(gunan.length, 0, "仅在内容中被提及的角色不应获得关系进展");
});

test("relationship facts from the fallback extractor carry their label via metadata.change", () => {
  const cards = [makeCard({ id: "card-linzhou", name: "林舟", cardType: "character" })];
  const facts = [
    makeRelationshipFact("fact-rel-2", "林舟与晏无咎的关系在本章出现明显变化。", {
      source: "林舟",
      target: "晏无咎",
      change: "敌意加深",
    }),
  ];

  const progressions = buildCardProgressionsFromArtifacts({
    projectId: "project-1",
    chapterNo: 5,
    cards,
    snapshot: emptySnapshot,
    facts,
  });

  assert.equal(progressions.length, 1);
  assert.equal(progressions[0]?.targetPath, "state.relationships.晏无咎");
  assert.equal(progressions[0]?.content, "敌意加深");
  assert.deepEqual(progressions[0]?.sourceFactIds, ["fact-rel-2"]);
});
