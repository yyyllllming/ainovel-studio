import test from "node:test";
import assert from "node:assert/strict";

import { rawDb } from "./db/client.ts";
import { saveFoundation } from "./repositories/foundation.repository.ts";
import { createProject } from "./repositories/project.repository.ts";
import { createCard, listCards } from "./repositories/card.repository.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import {
  createProjectCard,
  listProjectCards,
  syncConfirmedCardsFromProjectFoundation,
} from "./services/card.service.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function createTestProject() {
  return createProject({
    title: "Card Governance",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    premise: "用于角色卡治理测试。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });
}

test("listProjectCards defaults to confirmed only while includeDraft exposes recurring drafts and candidate count", () => {
  const project = createTestProject();
  if (!project) {
    throw new Error("创建测试项目失败");
  }

  try {
    const confirmed = createCard({
      projectId: project.id,
      cardType: "character",
      name: "姜尘",
      draft: {
        name: "姜尘",
        role: "主角",
        goal: "查清真相",
        traits: ["主动"],
      },
    });
    rawDb
      .prepare("UPDATE project_cards SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?")
      .run("2026-04-07T00:00:00.000Z", "2026-04-07T00:00:00.000Z", confirmed.id);

    const recurringDraft = createCard({
      projectId: project.id,
      cardType: "character",
      name: "姜烈",
      draft: {
        name: "姜烈",
        role: "持续出现角色候选",
        goal: "待确认",
        traits: ["持续出现"],
      },
      meta: {
        origin: "auto_recurring",
        discoveryStage: "recurring_candidate",
        evidence: [
          {
            chapterNo: 12,
            source: "chapter.facts.character_state",
            reason: "accepted 章节角色状态事实命中该角色",
            snippet: "姜烈在乱流峡现身。",
          },
        ],
      },
    });

    const confirmedOnly = listProjectCards(project.id);
    assert.equal(confirmedOnly.cards.length, 1);
    assert.equal(confirmedOnly.cards[0]?.id, confirmed.id);
    assert.equal(confirmedOnly.candidateCount, 1);

    const withDraft = listProjectCards(project.id, { includeDraft: true });
    assert.equal(withDraft.cards.length, 2);
    assert.equal(withDraft.candidateCount, 1);
    assert.equal(Boolean(withDraft.cards.find((card) => card.id === recurringDraft.id)), true);
  } finally {
    cleanupProject(project.id);
  }
});

test("syncConfirmedCardsFromProjectFoundation only runs on explicit write path, not reads", () => {
  const project = createTestProject();
  if (!project) {
    throw new Error("创建测试项目失败");
  }

  try {
    saveFoundation(project.id, {
      premise: "姜尘沿若木旧债追查身世。",
      styleCard: "默认",
      characters: [
        {
          name: "姜尘",
          role: "主角",
          goal: "查清真相",
          traits: ["主动"],
        },
      ],
      worldview: [],
      relationships: [],
    });

    assert.equal(listCards(project.id).length, 0);

    const result = syncConfirmedCardsFromProjectFoundation(project.id);
    assert.equal(result.imported, 1);
    assert.equal(listCards(project.id).length, 1);
  } finally {
    cleanupProject(project.id);
  }
});

test("createProjectCard rejects invalid character names before persistence", () => {
  const project = createTestProject();
  if (!project) {
    throw new Error("创建测试项目失败");
  }

  try {
    assert.throws(
      () =>
        createProjectCard({
          projectId: project.id,
          cardType: "character",
          name: "姜烈就是在这",
        }),
      /完整专有名|角色名/u,
    );
    assert.equal(listCards(project.id).length, 0);
  } finally {
    cleanupProject(project.id);
  }
});
