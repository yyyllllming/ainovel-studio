import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { rawDb } from "./db/client.ts";
import { createProject } from "./repositories/project.repository.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import {
  appendFoundationWorkshopMessage,
  getFoundation,
  getFoundationWorkshopEnvelopeState,
  lockFoundation,
  saveFoundation,
  upsertFoundationWorkshopState,
} from "./repositories/foundation.repository.ts";
import { deriveFoundationCandidate } from "./foundation/foundation-candidate.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import {
  diagnoseFoundationTruthSource,
  getFoundationDriftReport,
  repairFoundationTruthSource,
} from "./services/foundation-truth-source.service.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function getCurrentDbFile() {
  const row = rawDb.prepare("PRAGMA database_list").all() as Array<{ file?: string }>;
  return row.find((entry) => entry.file)?.file ?? "";
}

test("diagnose + repair can move a legacy workshop draft back to canonical truth source and republish formal foundation", async () => {
  const project = createProject({
    title: "Truth Source Repair Smoke",
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
      mainline: "陆渊在山神体系里盗纹求生。",
      storyHook: "开篇陆渊第一次触犯山神体系，差点被同化成石头。",
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
          goal: "先活下去",
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
    lockFoundation(projectId!);

    rawDb.prepare(`
      INSERT OR REPLACE INTO foundation_workshop_states (project_id, draft_json, ready_to_generate, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(
      projectId!,
      JSON.stringify({
        premise: "山只是有灵，核心还是山海经万灵。",
        mainline: "主角是异兽，被捡到后找身世。",
        storyHook: "第一章就是他被捡到，在异兽夫妇照料下找身世。",
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
            name: "山神体系",
            description: "旧的山神主体系分支。",
          },
          {
            name: "山海经万灵",
            description: "核心是万灵，不是祭祀山神体系。",
          },
        ],
        relationshipIdeas: [],
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
      }),
      0,
      "2026-04-06T08:34:24.173Z",
    );

    appendFoundationWorkshopMessage(projectId!, "user", "第一章就是他被捡到，在异兽夫妇照料下找身世。");
    appendFoundationWorkshopMessage(projectId!, "assistant", "可以把异兽夫妇线再拉长。");
    appendFoundationWorkshopMessage(projectId!, "user", "山神不是主要体系啊，只是山的灵作为这样。");
    appendFoundationWorkshopMessage(projectId!, "assistant", "我理解错了重心。");
    appendFoundationWorkshopMessage(projectId!, "user", "核心还是山海经万灵，主角方向是剥纹、骨书、还债、问白泽。");
    appendFoundationWorkshopMessage(projectId!, "user", "开篇不是被捡到，是他刚剥下一道骨纹，灵债立刻反噬。");

    const diagnosisBefore = diagnoseFoundationTruthSource(projectId!);
    assert.equal(diagnosisBefore.legacyBareDraft, true);
    assert.equal(diagnosisBefore.workshopFormalCoreDrift, true);
    assert.deepEqual(diagnosisBefore.canonicalPlaceholderResidue, []);
    assert.deepEqual(diagnosisBefore.formalPlaceholderResidue, []);
    assert.equal(diagnosisBefore.deprecatedWorldviewResidue.includes("山神体系"), true);

    const repairReport = await repairFoundationTruthSource(projectId!);
    assert.equal(repairReport.repaired, true);
    assert.equal(repairReport.diagnosisBefore.legacyBareDraft, true);
    assert.equal(repairReport.diagnosisAfter.legacyBareDraft, false);
    assert.deepEqual(repairReport.diagnosisAfter.canonicalPlaceholderResidue, []);
    assert.deepEqual(repairReport.diagnosisAfter.formalPlaceholderResidue, []);

    const workshopState = getFoundationWorkshopEnvelopeState(projectId!);
    assert.equal(workshopState?.legacyBareDraftJson, false);
    assert.match(workshopState?.envelope.draft.mainline ?? "", /剥纹/);
    assert.match(workshopState?.envelope.draft.mainline ?? "", /白泽/);
    assert.doesNotMatch(workshopState?.envelope.draft.mainline ?? "", /异兽/);

    const repairedFoundation = getFoundation(projectId!);
    assert.match(repairedFoundation?.mainline ?? "", /剥纹/);
    assert.match(repairedFoundation?.storyHook ?? "", /灵债/);
    assert.deepEqual(
      repairedFoundation?.worldview.map((entry) => entry.name),
      ["山海经万灵"],
    );

    const drift = getFoundationDriftReport(projectId!);
    assert.equal(drift.coreDrift, false);
    assert.equal(drift.blockingReason, null);
  } finally {
    cleanupProject(projectId!);
  }
});

test("getFoundationDriftReport does not keep reporting drift when formal foundation only expands sparse draft entities from workshop messages", () => {
  const project = createProject({
    title: "Sparse Draft Drift",
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
        mainline: "墨渊在剥纹、还债、问白泽的路上求生。",
        desiredTone: "default",
        storyHook: "开篇墨渊刚剥下一道骨纹，灵债立刻反噬。",
      },
    });

    upsertFoundationWorkshopState(projectId!, {
      premise: "玄幻修仙长篇。墨渊靠剥纹、还债、问白泽寻找活路。",
      mainline: "墨渊在剥纹、还债、问白泽的路上求生。",
      storyHook: "开篇墨渊刚剥下一道骨纹，灵债立刻反噬。",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleReferences: [],
      styleSamples: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-1",
      styleSnapshotVersion: 1,
      styleDigest: "摘要",
      styleExemplars: [],
    }, true);

    appendFoundationWorkshopMessage(projectId!, "user", "主角叫墨渊，目标是剥纹、还债、问白泽。");
    appendFoundationWorkshopMessage(projectId!, "user", "世界核心是山海经万灵道，不是山神主体系。");

    const candidate = deriveFoundationCandidate({
      project: {
        ...project!,
        premise: "这是一个山海经的故事。",
      },
      workshopDraft: getFoundationWorkshopEnvelopeState(projectId!)!.envelope.draft,
      workshopMessages: [
        { role: "user", content: "主角叫墨渊，目标是剥纹、还债、问白泽。" },
        { role: "user", content: "世界核心是山海经万灵道，不是山神主体系。" },
      ],
      activeStyle: {
        styleSnapshotId: "snapshot-1",
        styleSnapshotVersion: 1,
        styleCard: "风格卡",
        styleProfile,
        styleDigest: "摘要",
        styleExemplars: [],
        confidence: "high",
        sampledExcerpts: [],
        sourceIds: [],
      },
      existing: null,
    });
    saveFoundation(projectId!, {
      ...candidate,
      premise: "玄幻修仙长篇。墨渊靠剥纹、还债、问白泽寻找活路。",
      mainline: candidate.mainline,
      storyHook: candidate.storyHook,
    });
    lockFoundation(projectId!);

    const drift = getFoundationDriftReport(projectId!);
    assert.equal(drift.coreDrift, false);
    assert.equal(drift.blockingReason, null);
  } finally {
    cleanupProject(projectId!);
  }
});

test("foundation truth-source cli diagnose and repair commands run successfully", () => {
  const project = createProject({
    title: "Truth Source CLI",
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
    const diagnoseResult = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/foundation-truth-source.ts", "diagnose", projectId!],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          AINOVEL_DB_FILE: getCurrentDbFile(),
        },
      },
    );
    assert.equal(diagnoseResult.status, 0, diagnoseResult.stderr || diagnoseResult.stdout);
    const diagnosePayload = JSON.parse(diagnoseResult.stdout.trim()) as { mode: string; projectId: string };
    assert.equal(diagnosePayload.mode, "diagnose");
    assert.equal(diagnosePayload.projectId, projectId);

    const repairResult = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/foundation-truth-source.ts", "repair", projectId!],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          AINOVEL_DB_FILE: getCurrentDbFile(),
        },
      },
    );
    assert.equal(repairResult.status, 0, repairResult.stderr || repairResult.stdout);
    const repairPayload = JSON.parse(repairResult.stdout.trim()) as { mode: string; projectId: string; report: { repaired: boolean } };
    assert.equal(repairPayload.mode, "repair");
    assert.equal(repairPayload.projectId, projectId);
    assert.equal(repairPayload.report.repaired, true);
  } finally {
    cleanupProject(projectId!);
  }
});
