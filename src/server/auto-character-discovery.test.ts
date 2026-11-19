import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoRecurringCharacterPlan,
  type AutoRecurringSummaryEntry,
} from "./character/auto-character-discovery.ts";
import type { CanonFact, FoundationPayload, ProjectCard } from "./types.ts";

const foundation: FoundationPayload = {
  premise: "姜尘沿着若木残骸追查自己的身世。",
  styleCard: "克制、危险、因果递进",
  characters: [
    {
      name: "姜尘",
      role: "主角",
      goal: "查清若木下被捡来的真相",
      traits: ["敏锐", "主动"],
    },
  ],
  worldview: [],
  relationships: [],
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
    status: overrides.status ?? "draft",
    confirmedAt: overrides.confirmedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-04-06T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T00:00:00.000Z",
  };
}

function makeFact(
  chapterNo: number,
  type: CanonFact["type"],
  content: string,
  metadata: Record<string, unknown>,
  keywords: string[],
): CanonFact {
  return {
    id: `fact-${chapterNo}-${type}-${keywords.join("-")}`,
    type,
    chapterNo,
    content,
    metadata,
    timestamp: `2026-04-${String(chapterNo).padStart(2, "0")}T00:00:00.000Z`,
    keywords,
  };
}

function makeFullSummary(chapterNo: number, content: string, keywords: string[] = []): AutoRecurringSummaryEntry {
  return {
    chapterNo,
    level: "full",
    content,
    keywords,
  };
}

test("buildAutoRecurringCharacterPlan creates auto_recurring drafts only after 4 consecutive chapters and 5 deduped evidences", () => {
  const facts: CanonFact[] = [
    makeFact(12, "character_state", "姜烈在乱流峡现身，挡在姜尘前面。", { character: "姜烈" }, ["姜烈", "乱流峡"]),
    makeFact(13, "relationship", "姜烈再次阻拦姜尘，逼他回若木旧城。", { source: "姜烈", target: "姜尘" }, ["姜烈", "姜尘"]),
    makeFact(14, "character_state", "姜烈负伤后仍守在城门阴影里。", { character: "姜烈" }, ["姜烈"]),
    makeFact(15, "relationship", "姜烈承认自己一直在替风氏监视姜尘。", { source: "姜烈", target: "风氏" }, ["姜烈", "风氏"]),
  ];
  const summaries: AutoRecurringSummaryEntry[] = [
    makeFullSummary(12, "姜尘在乱流峡第一次看清姜烈的脸。"),
    makeFullSummary(13, "姜烈再次出现，把姜尘逼回若木旧城。"),
  ];

  const plan = buildAutoRecurringCharacterPlan({
    foundation,
    existingCards: [],
    facts,
    summaries,
  });

  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0]?.name, "姜烈");
  assert.equal(plan.creates[0]?.status, "draft");
  assert.equal(plan.creates[0]?.meta.origin, "auto_recurring");
  assert.equal(plan.creates[0]?.meta.discoveryStage, "recurring_candidate");
  assert.equal(plan.creates[0]?.meta.evidence?.length, 6);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.deletes.length, 0);
});

test("buildAutoRecurringCharacterPlan does not let summary-only free text invent new names", () => {
  const summaries: AutoRecurringSummaryEntry[] = [
    makeFullSummary(21, "风氏一直在暗中布局，若木旧债会继续追上姜尘。"),
    makeFullSummary(22, "风氏没有露面，但她的布局仍在推进。"),
    makeFullSummary(23, "风氏留下的命令让旧城守卫全部收紧。"),
    makeFullSummary(24, "风氏的影子压住了整座旧城。"),
  ];

  const plan = buildAutoRecurringCharacterPlan({
    foundation,
    existingCards: [],
    facts: [],
    summaries,
  });

  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.deletes.length, 0);
});

test("buildAutoRecurringCharacterPlan trims evidence to the latest 12 entries and invalidates stale non-contiguous windows", () => {
  const facts: CanonFact[] = [
    makeFact(1, "character_state", "姜烈在旧城出现。", { character: "姜烈" }, ["姜烈"]),
    makeFact(2, "character_state", "姜烈再次出现。", { character: "姜烈" }, ["姜烈"]),
    makeFact(3, "relationship", "姜烈盯上姜尘。", { source: "姜烈", target: "姜尘" }, ["姜烈", "姜尘"]),
    makeFact(5, "character_state", "姜烈重新现身。", { character: "姜烈" }, ["姜烈"]),
  ];
  const existingAutoRecurring = makeCard({
    id: "card-jianglie",
    name: "姜烈",
    cardType: "character",
    status: "draft",
    meta: {
      aliases: ["姜烈"],
      keywords: [],
      priority: 50,
      pinnedScope: "none",
      linkedCardIds: [],
      enabled: true,
      origin: "auto_recurring",
      discoveryStage: "recurring_candidate",
      evidence: Array.from({ length: 13 }, (_, index) => ({
        chapterNo: index + 1,
        source: index % 2 === 0 ? "chapter.facts.character_state" : "chapter.facts.relationship",
        reason: "旧证据",
        snippet: `旧证据 ${index + 1}`,
      })),
    },
  });

  const plan = buildAutoRecurringCharacterPlan({
    foundation,
    existingCards: [existingAutoRecurring],
    facts,
    summaries: [],
  });

  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 0);
  assert.deepEqual(plan.deletes, ["card-jianglie"]);
});

test("buildAutoRecurringCharacterPlan refreshes existing recurring drafts and keeps only the latest 12 evidences", () => {
  const facts: CanonFact[] = Array.from({ length: 10 }, (_, index) =>
    makeFact(30 + index, "character_state", `姜烈在第 ${30 + index} 章仍然跟着姜尘。`, { character: "姜烈" }, ["姜烈", "姜尘"])
  );
  const summaries: AutoRecurringSummaryEntry[] = [
    makeFullSummary(36, "姜烈继续逼近姜尘。"),
    makeFullSummary(37, "姜烈守在山门外。"),
    makeFullSummary(38, "姜烈再次现身。"),
  ];
  const existingAutoRecurring = makeCard({
    id: "card-jianglie",
    name: "姜烈",
    cardType: "character",
    status: "draft",
    meta: {
      aliases: ["姜烈"],
      keywords: [],
      priority: 50,
      pinnedScope: "none",
      linkedCardIds: [],
      enabled: true,
      origin: "auto_recurring",
      discoveryStage: "recurring_candidate",
      evidence: [],
    },
  });

  const plan = buildAutoRecurringCharacterPlan({
    foundation,
    existingCards: [existingAutoRecurring],
    facts,
    summaries,
  });

  assert.equal(plan.creates.length, 0);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0]?.cardId, "card-jianglie");
  assert.equal(plan.updates[0]?.meta.origin, "auto_recurring");
  assert.equal(plan.updates[0]?.meta.evidence?.length, 12);
  assert.equal(plan.deletes.length, 0);
});
