import test from "node:test";
import assert from "node:assert/strict";
import { buildFoundationCardSeeds, planFoundationCardImport } from "./foundation/foundation-card-sync.ts";
import { rawDb } from "./db/client.ts";
import { ensureCardsFromFoundation, getCard } from "./repositories/card.repository.ts";
import { saveFoundation } from "./repositories/foundation.repository.ts";
import { createProject } from "./repositories/project.repository.ts";
import type { FoundationPayload, ProjectCard } from "./types.ts";

const foundation: FoundationPayload = {
  premise: "测试设定",
  styleCard: "默认",
  characters: [
    {
      name: "林霁",
      role: "主角",
      goal: "找回失去的记忆",
      traits: ["嘴硬", "敏感"],
    },
    {
      name: "沈砚",
      role: "对手",
      goal: "守住旧秩序",
      traits: ["克制"],
    },
  ],
  worldview: [
    {
      name: "谎言代价",
      description: "每说一次谎都会失去一段真实记忆。",
    },
    {
      name: "城墙夜禁",
      description: "子时后任何人不得出城。",
    },
  ],
  relationships: [],
};

function createExistingCard(cardType: ProjectCard["cardType"], name: string): Pick<ProjectCard, "cardType" | "name"> {
  return { cardType, name };
}

test("buildFoundationCardSeeds converts formal foundation into character and world seeds", () => {
  const seeds = buildFoundationCardSeeds(foundation);

  assert.equal(seeds.length, 4);
  assert.deepEqual(seeds[0], {
    cardType: "character",
    name: "林霁",
    draft: {
      name: "林霁",
      role: "主角",
      goal: "找回失去的记忆",
      traits: ["嘴硬", "敏感"],
      secrets: undefined,
    },
  });
  assert.deepEqual(seeds[2], {
    cardType: "world",
    name: "谎言代价",
    draft: {
      name: "谎言代价",
      description: "每说一次谎都会失去一段真实记忆。",
    },
  });
});

test("planFoundationCardImport only imports missing cards and preserves existing ones", () => {
  const plan = planFoundationCardImport(foundation, [
    createExistingCard("character", "林霁"),
    createExistingCard("world", "谎言代价"),
  ]);

  assert.equal(plan.skipped, 2);
  assert.deepEqual(plan.toUpgrade ?? [], []);
  assert.deepEqual(
    plan.toImport.map((item) => `${item.cardType}:${item.name}`),
    ["character:沈砚", "world:城墙夜禁"],
  );
});

test("planFoundationCardImport ignores duplicated names from the formal foundation payload", () => {
  const duplicateFoundation: FoundationPayload = {
    ...foundation,
    characters: [...foundation.characters, foundation.characters[0]!],
    worldview: [...foundation.worldview, foundation.worldview[0]!],
  };

  const plan = planFoundationCardImport(duplicateFoundation, []);

  assert.equal(plan.skipped, 2);
  assert.equal(plan.toImport.length, 4);
  assert.deepEqual(plan.toUpgrade ?? [], []);
});

test("planFoundationCardImport upgrades a confirmed placeholder protagonist card when the formal foundation has a concrete name", () => {
  const plan = planFoundationCardImport(
    {
      ...foundation,
      characters: [
        {
          name: "姜尘",
          role: "protagonist",
          goal: "查清若木下被捡来的真相",
          traits: ["主动", "敏感"],
        },
      ],
      worldview: [],
      relationships: [],
    },
    [
      {
        id: "card-protagonist",
        cardType: "character",
        name: "主角",
        status: "confirmed",
        draft: {
          name: "主角",
          role: "protagonist",
          goal: "推动主线完成",
          traits: ["主动"],
        },
      },
    ],
  );

  assert.equal(plan.toImport.length, 0);
  assert.equal(plan.toUpgrade?.length, 1);
  assert.equal(plan.toUpgrade?.[0]?.cardId, "card-protagonist");
  assert.equal(plan.toUpgrade?.[0]?.name, "姜尘");
});

test("ensureCardsFromFoundation upgrades an existing placeholder protagonist card in place", () => {
  const project = createProject({
    title: "占位主角升级",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    premise: "测试 premise",
    assignments: [],
  })!;

  try {
    saveFoundation(project.id, {
      premise: "姜尘被卷入若木残骸下的旧债。",
      styleCard: "默认",
      characters: [
        {
          name: "姜尘",
          role: "protagonist",
          goal: "查清若木下被捡来的真相",
          traits: ["主动", "敏感"],
        },
      ],
      worldview: [],
      relationships: [],
    });

    rawDb.prepare(
      "INSERT INTO project_cards (id, project_id, card_type, name, draft_json, meta_json, status, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)",
    ).run(
      "card-placeholder",
      project.id,
      "character",
      "主角",
      JSON.stringify({
        name: "主角",
        role: "protagonist",
        goal: "推动主线完成",
        traits: ["主动"],
      }),
      JSON.stringify({ aliases: ["主角"], keywords: [], priority: 50, pinnedScope: "none", linkedCardIds: [], enabled: true }),
      "2026-04-06T00:00:00.000Z",
      "2026-04-06T00:00:00.000Z",
      "2026-04-06T00:00:00.000Z",
    );

    const result = ensureCardsFromFoundation(project.id);
    const card = getCard("card-placeholder");

    assert.equal(result.imported, 0);
    assert.equal(result.upgraded, 1);
    assert.equal(card?.name, "姜尘");
    assert.equal(card?.draft.name, "姜尘");
    assert.equal(card?.status, "confirmed");
  } finally {
    rawDb.transaction(() => {
      rawDb.prepare("DELETE FROM project_card_messages WHERE project_id = ?").run(project.id);
      rawDb.prepare("DELETE FROM project_cards WHERE project_id = ?").run(project.id);
      rawDb.prepare("DELETE FROM foundations WHERE project_id = ?").run(project.id);
      rawDb.prepare("DELETE FROM foundation_workshop_messages WHERE project_id = ?").run(project.id);
      rawDb.prepare("DELETE FROM foundation_workshop_states WHERE project_id = ?").run(project.id);
      rawDb.prepare("DELETE FROM run_states WHERE project_id = ?").run(project.id);
      rawDb.prepare("DELETE FROM projects WHERE id = ?").run(project.id);
    })();
  }
});
