import test from "node:test";
import assert from "node:assert/strict";

import { rawDb } from "./db/client.ts";
import { createProject } from "./repositories/project.repository.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import {
  appendFoundationWorkshopMessage,
  saveFoundation,
  upsertFoundationWorkshopState,
} from "./repositories/foundation.repository.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import { buildFoundationHandoffExport } from "./services/foundation-handoff.service.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("buildFoundationHandoffExport marks stale formal foundation, preserves accepted direction, and summarizes cards", () => {
  const project = createProject({
    title: "Foundation Handoff Smoke",
    genre: "玄幻修仙",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "这是一个山海经的故事。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });

  const projectId = project?.id;
  assert.equal(Boolean(projectId), true);

  try {
    const styleProfile = buildFallbackStyleProfile({
      references: [],
      draft: {
        mainline: "",
        desiredTone: "default",
        storyHook: "",
      },
    });

    saveFoundation(projectId!, {
      premise: "这是一个山海经的故事，卷入山神体系。",
      styleCard: "风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-1",
      styleSnapshotVersion: 1,
      styleDigest: "旧摘要",
      styleExemplars: [],
      characters: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "推动主线完成",
          traits: ["主动"],
        },
      ],
      worldview: [
        {
          name: "山神体系",
          description: "旧的山神主体系分支。",
        },
      ],
      relationships: [],
    });

    upsertFoundationWorkshopState(projectId!, {
      premise: "山只是有灵，核心还是山海经万灵。",
      mainline: "陆渊背着骨书灵债，靠剥纹一路去问白泽。",
      storyHook: "开篇他刚剥下一道骨纹，灵债立刻反噬。",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "剥纹、还债、去问白泽",
          traits: ["谨慎", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山海经万灵",
          description: "核心是万灵，不是祭祀山神体系。",
        },
      ],
      relationshipIdeas: [
        {
          source: "陆渊",
          label: "背负",
          target: "骨书灵债",
        },
      ],
      unresolvedQuestions: ["白泽会如何安抚骨书里的灵？"],
      styleReferences: [],
      styleSamples: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-1",
      styleSnapshotVersion: 1,
      styleDigest: "旧摘要",
      styleExemplars: [],
    }, false);

    appendFoundationWorkshopMessage(projectId!, "user", "第一章就是他被捡到，在异兽夫妇照料下找身世。");
    appendFoundationWorkshopMessage(projectId!, "assistant", "可以把异兽夫妇线再拉长。");
    appendFoundationWorkshopMessage(projectId!, "user", "山神不是主要体系啊，只是山的灵作为这样。");
    appendFoundationWorkshopMessage(projectId!, "assistant", "我理解错了重心。");
    appendFoundationWorkshopMessage(projectId!, "user", "核心还是山海经万灵，主角方向是剥纹、骨书、还债、问白泽。");

    rawDb.prepare(`
      INSERT INTO project_cards (
        id, project_id, card_type, name, draft_json, meta_json, status, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 'confirmed', ?, ?, ?)
    `).run(
      "card-character-1",
      projectId!,
      "character",
      "陆渊",
      JSON.stringify({
        name: "陆渊",
        role: "protagonist",
        goal: "推动主线完成",
        traits: ["主动", "敏感", "有成长空间"],
      }),
      "2026-04-06T08:34:24.173Z",
      "2026-04-06T08:34:24.173Z",
      "2026-04-06T08:34:24.173Z",
    );
    rawDb.prepare(`
      INSERT INTO project_cards (
        id, project_id, card_type, name, draft_json, meta_json, status, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '{}', 'confirmed', ?, ?, ?)
    `).run(
      "card-world-1",
      projectId!,
      "world",
      "世界基调",
      JSON.stringify({
        name: "世界基调",
        description: "玄幻修仙 类型故事，保持 default 风格",
      }),
      "2026-04-06T08:34:24.173Z",
      "2026-04-06T08:34:24.173Z",
      "2026-04-06T08:34:24.173Z",
    );

    const exportPayload = buildFoundationHandoffExport(projectId!);

    assert.match(exportPayload.json.coreState.acceptedDirection, /山只是有灵/);
    assert.match(exportPayload.json.coreState.acceptedDirection, /山海经万灵/);
    assert.match(exportPayload.json.coreState.acceptedDirection, /剥纹/);
    assert.match(exportPayload.json.coreState.acceptedDirection, /骨书/);
    assert.match(exportPayload.json.coreState.acceptedDirection, /还债/);
    assert.match(exportPayload.json.coreState.acceptedDirection, /白泽/);
    assert.deepEqual(exportPayload.json.coreState.supersededBranches, [
      "旧世界规则：山神体系",
    ]);
    assert.equal(
      exportPayload.json.coreState.rebuildGuide.some((entry) => entry.includes("先重建陆渊的主角卡")),
      true,
    );
    assert.equal(exportPayload.json.formalFoundation.status, "stale");
    assert.deepEqual(
      exportPayload.json.cards.validCharacterCards.map((entry) => entry.name),
      ["陆渊"],
    );
    assert.deepEqual(
      exportPayload.json.cards.placeholderWorldCards.map((entry) => entry.name),
      ["世界基调"],
    );
    assert.match(exportPayload.markdown, /^# Foundation Handoff/m);
    assert.match(exportPayload.markdown, /^## Premise/m);
    assert.match(exportPayload.markdown, /^## 已废弃分支/m);
  } finally {
    cleanupProject(projectId!);
  }
});

test("buildFoundationHandoffExport derives guidance from the project's own draft instead of hardcoded novel facts", () => {
  const project = createProject({
    title: "Generic Handoff Smoke",
    genre: "都市情感",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "林晚在催收逼近时发现母亲留下的旧账本。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });

  const projectId = project?.id;
  assert.equal(Boolean(projectId), true);

  try {
    const styleProfile = buildFallbackStyleProfile({
      references: [],
      draft: {
        mainline: "",
        desiredTone: "default",
        storyHook: "",
      },
    });

    upsertFoundationWorkshopState(projectId!, {
      premise: "林晚在催收逼近时发现母亲留下的旧账本。",
      mainline: "林晚追查旧账本背后的债务来历，并保住自己的落脚点。",
      storyHook: "开篇催收的人第一次敲门，林晚在账本里发现一个陌生名字。",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "林晚",
          role: "protagonist",
          goal: "查清债务来历，保住出租屋",
          traits: ["敏锐", "倔强"],
        },
      ],
      worldviewIdeas: [
        {
          name: "城中村出租屋",
          description: "林晚的落脚点，邻里耳目众多。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleReferences: [],
      styleSamples: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    }, false);

    const exportPayload = buildFoundationHandoffExport(projectId!);
    const serialized = JSON.stringify(exportPayload.json.coreState) + exportPayload.markdown;

    assert.doesNotMatch(serialized, /陆渊|骨书|灵债|白泽|山神|剥纹/u);
    assert.equal(
      exportPayload.json.coreState.rebuildGuide.some((entry) => entry.includes("先重建林晚的主角卡")),
      true,
    );
    assert.match(exportPayload.json.coreState.acceptedDirection, /旧账本|债务/u);
  } finally {
    cleanupProject(projectId!);
  }
});
