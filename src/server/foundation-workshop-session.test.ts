import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rawDb } from "./db/client.ts";
import { appPaths } from "./paths.ts";
import { createProject, getProject } from "./repositories/project.repository.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import {
  clearFoundationWorkshopSession,
  getFoundationWorkshopState,
  saveFoundationWorkshopSession,
  saveFoundation,
  upsertFoundationWorkshopState,
} from "./repositories/foundation.repository.ts";
import {
  applyFoundationStructuredSuggestion,
  dismissFoundationStructuredSuggestion,
  generateFoundationStructuredSuggestions,
  getFoundationWorkshopSnapshot,
  sendFoundationWorkshopMessage,
  streamFoundationStyleSteering,
  updateFoundationStyleSteering,
} from "./foundation/foundation-workshop.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import { saveStyleCardSnapshot } from "./repositories/style.repository.ts";
import type { StyleExcerpt } from "./types.ts";

const seedProfile = {
  id: "test-profile",
  name: "Test Relay",
  providerId: "custom",
  protocol: "openai_compatible" as const,
  baseUrl: "https://relay.example.com/v1",
  apiKey: "sk-test-profile-123456",
  defaultModel: "fake-model",
  enabled: true,
  createdAt: "2026-04-13T00:00:00.000Z",
  updatedAt: "2026-04-13T00:00:00.000Z",
};

async function withTempProfileStore(run: () => Promise<void>) {
  const original = {
    configDir: appPaths.configDir,
    profileFile: appPaths.profileFile,
    profileExampleFile: appPaths.profileExampleFile,
  };
  const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-foundation-workshop-"));
  const profileFile = join(tempRoot, "llm-profiles.json");

  appPaths.configDir = tempRoot;
  appPaths.profileFile = profileFile;
  appPaths.profileExampleFile = join(tempRoot, "llm-profiles.example.json");

  try {
    await writeFile(
      profileFile,
      JSON.stringify({ version: 1, profiles: [seedProfile] }, null, 2),
      "utf8",
    );
    await run();
  } finally {
    appPaths.configDir = original.configDir;
    appPaths.profileFile = original.profileFile;
    appPaths.profileExampleFile = original.profileExampleFile;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function createSampleExcerpt(id: string, content: string): StyleExcerpt {
  return {
    id,
    sourceId: "snapshot-1",
    sourceTitle: "快照样本",
    label: "片段",
    tags: ["narrative", "dialogue"] as StyleExcerpt["tags"],
    content,
    wordCount: content.length,
    startOffset: 0,
    endOffset: content.length,
    positionRatio: 0,
    dialogueRatio: 0.25,
  };
}

test("foundation workshop snapshot exposes the durable active session until it is cleared", () => {
  const project = createProject({
    title: "Session Smoke",
    genre: "奇幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "主角在雨夜捡到一把会说话的钥匙。",
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
    const now = new Date();
    const createdAt = new Date(now.getTime() - 5_000).toISOString();
    const runningUpdatedAt = new Date(now.getTime() - 2_000).toISOString();
    const failedUpdatedAt = new Date(now.getTime() - 1_000).toISOString();
    const emptySnapshot = getFoundationWorkshopSnapshot(projectId!);
    assert.equal(emptySnapshot.activeSession, null);

    saveFoundationWorkshopSession({
      projectId: projectId!,
      sessionId: "session-1",
      status: "running",
      stage: "replying",
      progress: 52,
      statusMessage: "设定助手正在续写回复。",
      userMessage: "帮我把主角体内的寄生关系设定得更危险。",
      assistantMessage: "可以把它设计成一种共享感官但会反噬宿主的寄生机制。",
      error: null,
      createdAt,
      updatedAt: runningUpdatedAt,
    });

    const runningSnapshot = getFoundationWorkshopSnapshot(projectId!);
    assert.deepEqual(runningSnapshot.activeSession, {
      projectId: projectId!,
      sessionId: "session-1",
      status: "running",
      stage: "replying",
      progress: 52,
      statusMessage: "设定助手正在续写回复。",
      userMessage: "帮我把主角体内的寄生关系设定得更危险。",
      assistantMessage: "可以把它设计成一种共享感官但会反噬宿主的寄生机制。",
      error: null,
      createdAt,
      updatedAt: runningUpdatedAt,
    });

    saveFoundationWorkshopSession({
      projectId: projectId!,
      sessionId: "session-1",
      status: "failed",
      stage: "draft_sync",
      progress: 96,
      statusMessage: "正在同步共创草案和下一步焦点。",
      userMessage: "帮我把主角体内的寄生关系设定得更危险。",
      assistantMessage: "可以把它设计成一种共享感官但会反噬宿主的寄生机制。",
      error: "draft sync failed",
      createdAt,
      updatedAt: failedUpdatedAt,
    });

    const failedSnapshot = getFoundationWorkshopSnapshot(projectId!);
    assert.equal(failedSnapshot.activeSession?.status, "failed");
    assert.equal(failedSnapshot.activeSession?.error, "draft sync failed");

    clearFoundationWorkshopSession(projectId!);
    const clearedSnapshot = getFoundationWorkshopSnapshot(projectId!);
    assert.equal(clearedSnapshot.activeSession, null);
  } finally {
    cleanupProject(projectId!);
  }
});

test("foundation workshop snapshot exposes a richer derived foundation preview and marks stale persisted foundations", () => {
  const project = createProject({
    title: "Derived Foundation Smoke",
    genre: "玄幻",
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
      premise: "这是一个山海经的故事。",
      styleCard: "风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-1",
      styleSnapshotVersion: 1,
      styleDigest: "旧摘要",
      styleExemplars: [],
      characters: [
        {
          name: "主角",
          role: "protagonist",
          goal: "推动主线完成",
          traits: ["主动"],
        },
      ],
      worldview: [
        {
          name: "世界基调",
          description: "玄幻 类型故事，保持 default 风格",
        },
      ],
      relationships: [],
    });

    upsertFoundationWorkshopState(projectId!, {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "盗取将死之山的地纹",
          traits: ["谨慎", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "山川不是兽，而是有位格的存在，会通过地纹和祭祀回应闯入者。",
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
      styleSnapshotId: "snapshot-1",
      styleSnapshotVersion: 1,
      styleDigest: "旧摘要",
      styleExemplars: [],
    }, false);

    rawDb.prepare(
      "INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg-derived-user",
      projectId!,
      "user",
      "主角叫陆渊，是个寻找将死之山盗纹的渎神者。开篇就是他第一次对山神下手，差点被同化成石头。",
      "2026-04-06T10:00:00.000Z",
    );

    const snapshot = getFoundationWorkshopSnapshot(projectId!);
    assert.equal(snapshot.derivedFoundation?.characters[0]?.name, "陆渊");
    assert.equal(snapshot.derivedFoundation?.worldview[0]?.name, "山神体系");
    assert.equal(snapshot.derivedFoundationMeta?.staleComparedToPersisted, true);
    assert.equal(snapshot.derivedFoundationMeta?.coverage.premiseFilled, true);
  } finally {
    cleanupProject(projectId!);
  }
});

test("foundation workshop snapshot keeps transcript-mined实名角色 in aiCharacterSuggestions instead of fixed cast", () => {
  const project = createProject({
    title: "AI Character Suggestions",
    genre: "玄幻",
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

    upsertFoundationWorkshopState(projectId!, {
      premise: "",
      mainline: "",
      storyHook: "",
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
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    }, false);

    rawDb.prepare(
      "INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg-ai-character-suggestion",
      projectId!,
      "assistant",
      [
        "主角叫姜尘。",
        "七岁的姜尘蹲在涧边一块风化的夔牛骨上，看姜烈处理一头刚猎得的异兽。",
        "别把姜烈就是在这里这种半句当角色名。",
      ].join("\n\n"),
      "2026-04-06T11:00:00.000Z",
    );

    const snapshot = getFoundationWorkshopSnapshot(projectId!);

    assert.equal(snapshot.state?.draft?.characterIdeas?.length ?? 0, 0);
    assert.deepEqual(snapshot.aiCharacterSuggestions?.map((item) => item.canonicalName), ["姜尘"]);
  } finally {
    cleanupProject(projectId!);
  }
});

test("foundation workshop keeps running sessions alive while auto-wrapping legacy bare draft state", () => {
  const project = createProject({
    title: "Legacy Session Fail Fast",
    genre: "玄幻",
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
    rawDb.prepare(
      "UPDATE foundation_workshop_states SET draft_json = ?, ready_to_generate = ?, updated_at = ? WHERE project_id = ?",
    ).run(
      JSON.stringify({
        premise: "这是一个旧 bare draft。",
        mainline: "",
        storyHook: "",
        desiredTone: "default",
        characterIdeas: [],
        worldviewIdeas: [],
        relationshipIdeas: [],
        unresolvedQuestions: [],
      }),
      0,
      "2026-04-06T08:00:00.000Z",
      projectId!,
    );

    saveFoundationWorkshopSession({
      projectId: projectId!,
      sessionId: "legacy-session",
      status: "running",
      stage: "replying",
      progress: 42,
      statusMessage: "还在回复中",
      userMessage: "继续完善",
      assistantMessage: "旧回复",
      error: null,
      createdAt: "2026-04-06T08:00:00.000Z",
      updatedAt: new Date().toISOString(),
    });

    const snapshot = getFoundationWorkshopSnapshot(projectId!);

    assert.equal(snapshot.activeSession?.status, "running");
    assert.equal(snapshot.activeSession?.stage, "replying");
    assert.equal(snapshot.activeSession?.error, null);
    assert.equal(snapshot.state?.draft.premise, "这是一个旧 bare draft。");
  } finally {
    cleanupProject(projectId!);
  }
});

test("upsertFoundationWorkshopState keeps the stable project premise instead of writing workshop summaries back", () => {
  const project = createProject({
    title: "Stable Project Premise",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "项目最初的 seed premise。",
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
      premise: "主角母的禁，卷入第一。",
      mainline: "主角母的警告。",
      storyHook: "主角母的分裂。",
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
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    }, false);

    assert.equal(getProject(projectId!)?.premise, "项目最初的 seed premise。");
  } finally {
    cleanupProject(projectId!);
  }
});

test("saveFoundation keeps the stable project premise and stores the authoritative premise only inside foundations", () => {
  const project = createProject({
    title: "Stable Authoritative Premise",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "项目最初的 seed premise。",
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

    const saved = saveFoundation(projectId!, {
      premise: "正式设定里的 authoritative premise。",
      styleCard: "风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
      characters: [
        {
          name: "墨渊",
          role: "protagonist",
          goal: "活下去并查清来历",
          traits: ["敏感", "警觉"],
        },
      ],
      worldview: [
        {
          name: "山海骨书",
          description: "骨书会在骨髓深处生长新的骨页，并持续啃噬旧骨。",
        },
      ],
      relationships: [],
    });

    assert.equal(saved.premise, "正式设定里的 authoritative premise。");
    assert.equal(getProject(projectId!)?.premise, "项目最初的 seed premise。");
  } finally {
    cleanupProject(projectId!);
  }
});

test("foundation workshop snapshot derives suggestions and rejections from mention candidates instead of polluted derived foundation loops", () => {
  const project = createProject({
    title: "Mention Governance",
    genre: "玄幻",
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

    upsertFoundationWorkshopState(projectId!, {
      premise: "主角母的禁，卷入第一。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [
        {
          name: "第一",
          description: "第一，关于债的具体形态。",
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

    rawDb.prepare(
      "INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg-mention-governance",
      projectId!,
      "user",
      [
        "姓名：墨渊。",
        "姓名：母收养。",
        "养父：慕忘（狻猊）。",
        "养父母的警告不能算角色名。",
      ].join("\n"),
      "2026-04-07T10:00:00.000Z",
    );

    const snapshot = getFoundationWorkshopSnapshot(projectId!);

    assert.deepEqual(snapshot.aiCharacterSuggestions?.map((item) => item.canonicalName), ["墨渊", "慕忘"]);
    assert.equal(snapshot.recentRejections?.some((item) => item.rawName === "母收养"), true);
    assert.equal(snapshot.recentRejections?.some((item) => item.sourceKind === "message"), true);
    assert.equal(snapshot.recentRejections?.some((item) => item.evidenceSnippet?.includes("姓名：母收养")), true);
    assert.equal(snapshot.derivedFoundation?.characters.some((item) => /母收养|母的|母捡/u.test(item.name)), false);
    assert.equal(snapshot.derivedFoundation?.worldview.some((item) => item.name === "第一"), false);
  } finally {
    cleanupProject(projectId!);
  }
});

test("foundation structured suggestions can be generated, dismissed, applied, and then become stale after draft changes", () => {
  const project = createProject({
    title: "Structured Suggestions",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "主角在山里发现会说话的石骨。",
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
      premise: "山里捡骨的少年被迫学会与旧神残响交易。",
      mainline: "少年尝试破解石骨的来历，并活着离开山脉。",
      storyHook: "石骨第一次在夜里开口，要求他去偷山神的名字。",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: ["石骨为什么选中主角？"],
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

    rawDb.prepare(
      "INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg-structured-suggestion",
      projectId!,
      "assistant",
      [
        "主角叫墨渊。",
        "他需要一个懂祭仪的同行者，名字可以是祝九。",
        "这个世界的山神会吞掉被偷走的名字。",
      ].join("\n"),
      "2026-04-08T10:00:00.000Z",
    );

    const generated = generateFoundationStructuredSuggestions(projectId!);
    assert.equal(generated.structuredSuggestions?.status, "fresh");
    assert.equal(generated.structuredSuggestions?.characters.some((item) => item.canonicalName === "墨渊"), true);
    assert.equal((generated.structuredSuggestions?.worldRules.length ?? 0) > 0, true);

    const dismissed = dismissFoundationStructuredSuggestion(projectId!, "character:祝九");
    assert.deepEqual(dismissed.structuredSuggestions?.characters.map((item) => item.canonicalName), ["墨渊"]);
    assert.equal(dismissed.structuredSuggestions?.dismissedIds.includes("character:祝九"), true);

    const applied = applyFoundationStructuredSuggestion(projectId!, "character:墨渊");
    assert.equal(applied.state?.draft.characterIdeas.some((item) => item.name === "墨渊"), true);
    assert.equal(applied.structuredSuggestions?.status, "stale");
  } finally {
    cleanupProject(projectId!);
  }
});

test("updateFoundationStyleSteering prioritizes map-reduce when active sampled excerpts exist", async () => {
  await withTempProfileStore(async () => {
    const project = createProject({
    title: "Style Steering Map Reduce",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "主角在雨夜追查失踪案。",
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

    saveStyleCardSnapshot({
      id: "snapshot-map-reduce",
      projectId: projectId!,
      mode: "book",
      sourceIds: ["import-1"],
      styleCard: "旧风格卡",
      styleProfile,
      styleDigest: "旧摘要",
      styleExemplars: [],
      sampledExcerpts: [
        createSampleExcerpt("excerpt-1", "雨顺着石阶爬上来，他把呼吸压得很轻。"),
        createSampleExcerpt("excerpt-2", "“别回头。”她把灯举高，影子在墙上裂开。"),
      ],
      confidence: "medium",
      version: 1,
      createdAt: new Date().toISOString(),
    });

    upsertFoundationWorkshopState(projectId!, {
      premise: "主角在雨夜追查失踪案。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleReferences: [],
      styleSamples: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "旧风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-map-reduce",
      styleSnapshotVersion: 1,
      styleDigest: "旧摘要",
      styleExemplars: [],
    }, false);

    const updated = await updateFoundationStyleSteering(projectId!, {
      references: [],
      manualGuidance: "保留压迫感。",
      avoidances: "避免解释腔。",
    });

    assert.equal(updated.styleSteeringCard?.includes("风格签名："), true);
    assert.equal(updated.state?.draft.styleSteeringCard?.includes("风格签名："), true);
    } finally {
      cleanupProject(projectId!);
    }
  });
});

test("streamFoundationStyleSteering uses map-reduce when only samples are provided", async () => {
  await withTempProfileStore(async () => {
    const project = createProject({
    title: "Style Steering Stream Map Reduce",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "主角在雨夜追查失踪案。",
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
      premise: "主角在雨夜追查失踪案。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleReferences: [],
      styleSamples: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "旧风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    }, false);

    const events: Array<Record<string, unknown>> = [];
    await streamFoundationStyleSteering(projectId!, {
      references: [],
      samples: ["雨顺着屋脊砸下来，他没抬头。“先走。”她压低声音。"],
      manualGuidance: "偏克制叙述。",
      avoidances: "避免空泛比喻。",
    }, async (event) => {
      events.push(event);
    });

    const analysisMessages = events
      .filter((event) => event.type === "status" && event.stage === "analysis")
      .map((event) => String(event.message ?? ""));
    const finalEvent = events.find((event) => event.type === "final");

    assert.equal(analysisMessages.includes("正在抽取样本切面并融合文体指纹。"), true);
    assert.equal(String(finalEvent?.styleSteeringCard ?? "").includes("风格签名："), true);
    } finally {
      cleanupProject(projectId!);
    }
  });
});

test("streamFoundationStyleSteering preserves draft changes made while the style compile is in flight", async () => {
  await withTempProfileStore(async () => {
    const project = createProject({
      title: "Style Steering Concurrent Draft",
      genre: "悬疑",
      style: "default",
      seriesMode: "standalone",
      storyLength: "long",
      narrativePerson: "third",
      chapterPlanningMode: "fixed",
      paceProfile: "medium",
      completionCriteria: "主线闭环",
      targetChapters: 12,
      premise: "主角在雨夜追查失踪案。",
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
        premise: "主角在雨夜追查失踪案。",
        mainline: "",
        storyHook: "",
        desiredTone: "default",
        characterIdeas: [],
        worldviewIdeas: [],
        relationshipIdeas: [],
        unresolvedQuestions: [],
        styleReferences: [],
        styleSamples: [],
        styleManualGuidance: "",
        styleAvoidances: "",
        styleSteeringCard: "旧风格卡",
        styleProfile,
        styleSnapshotId: null,
        styleSnapshotVersion: null,
        styleDigest: "",
        styleExemplars: [],
      }, false);

      let injectedConcurrentEdit = false;
      await streamFoundationStyleSteering(projectId!, {
        references: [],
        manualGuidance: "保持冷感。",
      }, async () => {
        if (injectedConcurrentEdit) {
          return;
        }
        injectedConcurrentEdit = true;
        const current = getFoundationWorkshopState(projectId!);
        upsertFoundationWorkshopState(projectId!, {
          ...current!.draft,
          characterIdeas: [
            {
              name: "陆鸣",
              role: "protagonist",
              goal: "查清雨夜失踪案的真相",
              traits: ["敏锐", "克制"],
            },
          ],
        }, current!.readyToGenerate);
      });

      assert.equal(injectedConcurrentEdit, true);
      const finalState = getFoundationWorkshopState(projectId!);
      assert.equal(finalState?.draft.characterIdeas.some((item) => item.name === "陆鸣"), true);
      assert.equal(finalState?.draft.styleManualGuidance, "保持冷感。");
    } finally {
      cleanupProject(projectId!);
    }
  });
});

test("style steering and workshop chat turns are mutually exclusive", async () => {
  await withTempProfileStore(async () => {
    const project = createProject({
      title: "Style Steering Mutex",
      genre: "悬疑",
      style: "default",
      seriesMode: "standalone",
      storyLength: "long",
      narrativePerson: "third",
      chapterPlanningMode: "fixed",
      paceProfile: "medium",
      completionCriteria: "主线闭环",
      targetChapters: 12,
      premise: "主角在雨夜追查失踪案。",
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
        premise: "主角在雨夜追查失踪案。",
        mainline: "",
        storyHook: "",
        desiredTone: "default",
        characterIdeas: [],
        worldviewIdeas: [],
        relationshipIdeas: [],
        unresolvedQuestions: [],
        styleReferences: [],
        styleSamples: [],
        styleManualGuidance: "",
        styleAvoidances: "",
        styleSteeringCard: "旧风格卡",
        styleProfile,
        styleSnapshotId: null,
        styleSnapshotVersion: null,
        styleDigest: "",
        styleExemplars: [],
      }, false);

      // 聊天回合进行中：文风编译必须被拒绝。
      const now = new Date().toISOString();
      saveFoundationWorkshopSession({
        projectId: projectId!,
        sessionId: "mutex-session",
        status: "running",
        stage: "replying",
        progress: 40,
        statusMessage: "回复中",
        userMessage: "继续",
        assistantMessage: "",
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      await assert.rejects(
        updateFoundationStyleSteering(projectId!, { references: [] }),
        /未完成的回复/u,
      );
      clearFoundationWorkshopSession(projectId!);

      // 文风编译进行中：发送 workshop 消息必须被拒绝。
      let sendRejectionChecked = false;
      await streamFoundationStyleSteering(projectId!, { references: [] }, async () => {
        if (sendRejectionChecked) {
          return;
        }
        sendRejectionChecked = true;
        await assert.rejects(
          sendFoundationWorkshopMessage(projectId!, { message: "测试互斥" }),
          /文风约束/u,
        );
      });
      assert.equal(sendRejectionChecked, true);
    } finally {
      cleanupProject(projectId!);
    }
  });
});

test("sendFoundationWorkshopMessage finalizes the turn atomically and leaves no dangling session", async () => {
  await withTempProfileStore(async () => {
    const project = createProject({
      title: "Non Stream Send Finalize",
      genre: "悬疑",
      style: "default",
      seriesMode: "standalone",
      storyLength: "long",
      narrativePerson: "third",
      chapterPlanningMode: "fixed",
      paceProfile: "medium",
      completionCriteria: "主线闭环",
      targetChapters: 12,
      premise: "主角在雨夜追查失踪案。",
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
      const result = await sendFoundationWorkshopMessage(projectId!, {
        message: "帮我把主角的目标定得更具体一点。",
      });

      assert.equal(Boolean(result.assistant.content.trim()), true);
      assert.equal(Boolean(result.state?.draft), true);

      const snapshot = getFoundationWorkshopSnapshot(projectId!);
      assert.equal(snapshot.activeSession, null);
      assert.deepEqual(
        snapshot.messages.map((message) => message.role),
        ["user", "assistant"],
      );
    } finally {
      cleanupProject(projectId!);
    }
  });
});

test("getFoundationWorkshopSnapshot memoizes derived computation until workshop inputs change", () => {
  const project = createProject({
    title: "Snapshot Memoization",
    genre: "玄幻",
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

    upsertFoundationWorkshopState(projectId!, {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "盗取将死之山的地纹",
          traits: ["谨慎", "会伪装"],
        },
      ],
      worldviewIdeas: [],
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

    rawDb.prepare(
      "INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg-memo-1",
      projectId!,
      "user",
      "主角叫陆渊，是个寻找将死之山盗纹的渎神者。",
      "2026-04-06T10:00:00.000Z",
    );

    const first = getFoundationWorkshopSnapshot(projectId!);
    const second = getFoundationWorkshopSnapshot(projectId!);
    // 输入未变时命中进程内 memo：派生结果是同一引用，不重复跑候选推导与漂移比较。
    assert.equal(second.derivedFoundation, first.derivedFoundation);
    assert.equal(second.derivedFoundationMeta, first.derivedFoundationMeta);

    rawDb.prepare(
      "INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "msg-memo-2",
      projectId!,
      "user",
      "再加一个配角，名字叫祝九，懂祭仪。",
      "2026-04-06T10:05:00.000Z",
    );

    const third = getFoundationWorkshopSnapshot(projectId!);
    assert.notEqual(third.derivedFoundation, first.derivedFoundation);
    assert.equal(third.messages.length, 2);
  } finally {
    cleanupProject(projectId!);
  }
});

test("streamFoundationStyleSteering falls back to legacy interpret/compile when no samples exist", async () => {
  await withTempProfileStore(async () => {
    const project = createProject({
    title: "Style Steering Stream Legacy Fallback",
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "主角在雨夜追查失踪案。",
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
      premise: "主角在雨夜追查失踪案。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleReferences: [],
      styleSamples: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "旧风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    }, false);

    const events: Array<Record<string, unknown>> = [];
    await streamFoundationStyleSteering(projectId!, {
      references: [],
      manualGuidance: "保持冷感。",
      avoidances: "不要模板化总结。",
    }, async (event) => {
      events.push(event);
    });

    const analysisMessages = events
      .filter((event) => event.type === "status" && event.stage === "analysis")
      .map((event) => String(event.message ?? ""));

    assert.equal(analysisMessages.includes("正在抽取样本切面并融合文体指纹。"), false);
    assert.equal(analysisMessages.includes("正在拆解参考作品/作者的叙事节奏和文气特征。"), true);
    } finally {
      cleanupProject(projectId!);
    }
  });
});
