import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { rawDb } from "./db/client.ts";
import type { ChatMessage } from "./llm.ts";
import { AUTHOR_CARD_MAX_TOKEN_CANDIDATES } from "./llm-token-policy.ts";
import { applyFoundationStyleSnapshot } from "./style/foundation-style.ts";
import { authorCardDir, projectDir } from "./paths.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { createBookCard } from "./repositories/author-book-card.repository.ts";
import { createProject } from "./repositories/project.repository.ts";
import { listStyleCardSnapshots, saveStyleCardSnapshot } from "./repositories/style.repository.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import type { StyleCardSnapshot, StyleExcerpt } from "./types.ts";
import {
  applyBookCardToProject,
  applyAuthorCardToProject,
  createAuthorCardWithName,
  callLibraryLlmWithRetry,
  generateBookCardForAuthor,
  getAuthorCardDetail,
  importTextToAuthorCard,
  mergeAuthorStyle,
  normalizeAuthorCardName,
  syncAuthorCardFromProjectSnapshot,
} from "./services/author-card.service.ts";

function createAssignments() {
  return [
    { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
    { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
    { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
    { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
  ] as const;
}

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function cleanupAuthorCard(authorCardId: string) {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM author_book_cards WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_text_imports WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_card_versions WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_cards WHERE id = ?").run(authorCardId);
  })();
}

function createExcerpt(id: string, sourceId: string, content: string): StyleExcerpt {
  return {
    id,
    sourceId,
    sourceTitle: "测试来源",
    label: "第1章",
    tags: ["narrative"],
    content,
    wordCount: content.length,
    startOffset: 0,
    endOffset: content.length,
    positionRatio: 0.2,
    dialogueRatio: 0.1,
  };
}

function createSnapshot(projectId: string, input: {
  id: string;
  version: number;
  mode: "book" | "author";
  styleCard: string;
  styleDigest: string;
  confidence?: StyleCardSnapshot["confidence"];
}) {
  const snapshotId = `${input.id}-${projectId}`;
  const exemplar = createExcerpt(
    `${snapshotId}-ex`,
    `${snapshotId}-source`,
    "潮气沿着石阶往上涌，他听见风从门缝里一点点挤进来，肩背也跟着发冷。".repeat(4).slice(0, 180),
  );
  return {
    id: snapshotId,
    projectId,
    mode: input.mode,
    sourceIds: [],
    styleCard: input.styleCard,
    styleProfile: buildFallbackStyleProfile({
      references: [],
      manualGuidance: "叙述要压紧，动作推动情绪。",
      avoidances: "不要解释腔。",
    }),
    styleDigest: input.styleDigest,
    styleExemplars: [exemplar],
    sampledExcerpts: [
      createExcerpt(
        `${snapshotId}-raw`,
        `${snapshotId}-source`,
        "远处铜铃又响了一声，像有人把更大的麻烦摇给他听。".repeat(5).slice(0, 160),
      ),
      exemplar,
    ],
    confidence: input.confidence ?? "high",
    version: input.version,
    createdAt: new Date(0).toISOString(),
  } satisfies StyleCardSnapshot;
}

function createProjectFixture(title: string) {
  const project = createProject({
    title,
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 10,
    premise: "主角必须潜入夜禁城市。",
    assignments: [...createAssignments()],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }
  return project;
}

function createLibraryProfile() {
  return {
    id: "library-profile",
    name: "Library Profile",
    providerId: "custom",
    protocol: "openai_compatible" as const,
    baseUrl: "https://example.test/v1",
    apiKey: "test-key",
    defaultModel: "fake-model",
    enabled: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function buildImportText(title: string) {
  const districts = ["潮汐坊", "旧灯巷", "听雨埠", "白石渡", "栖钟台", "斜桥市"];
  const relics = ["骨哨", "盐铁牌", "潮纹匣", "旧铜钥", "裂镜片", "乌木签"];

  return Array.from({ length: 72 }, (_, index) => `第${index + 1}章 风起

${title}沿着潮湿石阶往上走，雾气顺着衣摆往膝骨里钻，像旧事一点点往身上爬。他没有停，只是把呼吸压得更轻，免得让身后的铜铃先听见他的犹豫。第${index + 1}夜的风从${districts[index % districts.length]}倒灌下来，把他袖口里那枚${relics[index % relics.length]}碰得发凉。

“再往前一步，夜禁就不是规矩，是收尸。”另一人把灯举高，影子一晃，声音也跟着发冷。${title}没有回头，只把指节在刀柄上扣紧：“要命也得去。”他记得昨夜在${districts[(index + 1) % districts.length]}听见的那句密语，还像鱼刺一样卡在喉咙里。

山口忽然炸开一串铁器碰撞声，巡夜人从暗处扑出，刀背劈在石栏上，火星和雨点一起乱溅。${title}侧身撞进风里，肩骨发麻，脚下一滑，整个人几乎翻出山道。那串动静把藏在他怀里的${relics[(index + 2) % relics.length]}也震得轻响，像在提醒他这一步已经回不了头。

那一下失重让他的心口空了一瞬，恐惧像冰水灌进肺里，可他在发抖里偏偏想起更久以前那句没说完的话。远处铜铃又响了一下，像有人把更大的麻烦摇给他听。第${index + 1}章的尾声里，他忽然意识到，真正盯上他的并不是夜禁，而是${districts[(index + 3) % districts.length]}那边迟迟没有熄灭的一盏灯。`).join("\n\n");
}

async function fakeStyleLlm(messages: ChatMessage[]) {
  const systemPrompt = messages[0]?.content ?? "";

  if (systemPrompt.includes("资深文学编辑")) {
    return JSON.stringify({
      narrativeDistance: "贴近人物即时感受，少做高空解释。",
      infoDelivery: "信息顺着动作和对白自然露出，不用旁白抢先解释。",
      paragraphRhythm: "叙述与对白交替，关键动作和情绪点用短段收紧。",
      dialogueBreathing: "对白保留气口和关系压强，不把结论说透。",
      emotionRendering: "情绪更多落在身体反应和环境回声里。",
      chapterClosure: "章末留后患，不做总结回钉。",
      forbiddenPatterns: ["解释腔", "平均句式", "空转比喻"],
      signature: "冷压强、动作牵引、留白收束",
    });
  }

  return JSON.stringify({
    referenceAnchor: {
      primary: "测试参考",
      secondary: ["辅参考 A"],
    },
    paragraphCadence: {
      narrativeRule: "叙述段以动作、感受和局势变化成组推进。",
      dialogueRule: "对白随气口、停顿和动作切换换段。",
      emphasisRule: "只在揭示或骤变处留短段。",
    },
    sentenceRhythm: {
      pacingRule: "长短句交替，避免平均句式。",
      transitionRule: "转场靠动作、视线和结果带动。",
      pauseRule: "停顿落在呼吸、手势和环境反馈上。",
    },
    narrativeDistance: {
      intimacyRule: "始终贴近当前人物的即时感受。",
      expositionRule: "解释延后，不要抢在场景前面下定义。",
      textureRule: "正文质感保持冷静、压紧、带风险余波。",
    },
    dialogueStyle: {
      voiceRule: "对白克制但带刺，不直接说透结论。",
      subtextRule: "冲突要靠停顿、对位和动作回声显形。",
      distinctionRule: "让身份与关系决定人物说话方式。",
    },
    imageryRegister: {
      densityRule: "意象点到为止，只服务气压和触感。",
      textureRule: "修辞顺着场景和动作生长，不堆金句。",
      avoid: ["空泛抒情", "模板转折", "解释性总结"],
    },
    forbiddenLexicon: ["推进主线", "阻力", "信息投放"],
    toneGuardrails: ["不要写成策划稿。", "不要把心理总结直接端出来。"],
    openingStrategy: "从动作和场景直接切入，不用总结式开场。",
    infoRevealRule: "关键信息顺着局势与对白自然露出。",
    emotionRenderingRule: "情绪依靠身体反应和环境反射外化。",
    chapterClosureRule: "章末只钉一个新后患，不回钉总结。",
    aiSmellPatterns: ["解释过早", "句式平均"],
    styleTaboos: ["空转比喻", "总结腔"],
  });
}

test("callLibraryLlmWithRetry retries from 5120 to 4096 when max_tokens is rejected", async () => {
  const attempts: number[] = [];
  const result = await callLibraryLlmWithRetry(
    createLibraryProfile(),
    [{ role: "user", content: "测试" }],
    {
      chatCompletionImpl: async (_profile, _model, _messages, options) => {
        attempts.push(options?.maxTokens ?? -1);
        if (attempts.length === 1) {
          throw new Error("(400) max_tokens too large");
        }
        return "ok";
      },
    },
  );

  assert.equal(result, "ok");
  assert.deepEqual(attempts, [AUTHOR_CARD_MAX_TOKEN_CANDIDATES[0], AUTHOR_CARD_MAX_TOKEN_CANDIDATES[1]]);
});

test("callLibraryLlmWithRetry falls through to 3072 before surfacing the final max_tokens failure", async () => {
  const attempts: number[] = [];

  await assert.rejects(
    () =>
      callLibraryLlmWithRetry(
        createLibraryProfile(),
        [{ role: "user", content: "测试" }],
        {
          chatCompletionImpl: async (_profile, _model, _messages, options) => {
            attempts.push(options?.maxTokens ?? -1);
            throw new Error("(400) max_tokens too large");
          },
        },
      ),
    /max_tokens/i,
  );

  assert.deepEqual(attempts, [...AUTHOR_CARD_MAX_TOKEN_CANDIDATES]);
});

test("syncAuthorCardFromProjectSnapshot returns conflicts for same normalized author and can merge versions", async () => {
  const createdProjectIds: string[] = [];
  const createdAuthorCardIds: string[] = [];

  try {
    const projectA = createProjectFixture("Author Card A");
    const projectB = createProjectFixture("Author Card B");
    createdProjectIds.push(projectA.id, projectB.id);

    const firstSnapshot = saveStyleCardSnapshot(
      createSnapshot(projectA.id, {
        id: "author-seed-a",
        version: 1,
        mode: "author",
        styleCard: "作者风格卡 A",
        styleDigest: "冷压强、动作牵引、留白收束。".repeat(80).slice(0, 1280),
      }),
    );
    const secondSnapshot = saveStyleCardSnapshot(
      createSnapshot(projectB.id, {
        id: "author-seed-b",
        version: 1,
        mode: "author",
        styleCard: "作者风格卡 B",
        styleDigest: "机制先撞代价，再补最少必要辨认。".repeat(80).slice(0, 1280),
      }),
    );

    if (!firstSnapshot || !secondSnapshot) {
      throw new Error("测试 snapshot 保存失败");
    }

    const created = await syncAuthorCardFromProjectSnapshot({
      projectId: projectA.id,
      snapshotId: firstSnapshot.id,
      authorName: "辰东（完美世界）",
    });
    if (created.status !== "created") {
      throw new Error("第一次同步应当创建新作者卡");
    }
    createdAuthorCardIds.push(created.card.id);

    assert.equal(normalizeAuthorCardName("辰东（完美世界）"), normalizeAuthorCardName("辰东"));
    assert.equal(existsSync(authorCardDir(created.card.id)), true);

    const conflict = await syncAuthorCardFromProjectSnapshot({
      projectId: projectB.id,
      snapshotId: secondSnapshot.id,
      authorName: "辰东",
    });
    assert.equal(conflict.status, "conflict");
    if (conflict.status !== "conflict") {
      throw new Error("第二次同步应当先提示冲突");
    }
    assert.equal(conflict.candidates.some((entry) => entry.id === created.card.id), true);

    const merged = await syncAuthorCardFromProjectSnapshot({
      projectId: projectB.id,
      snapshotId: secondSnapshot.id,
      authorName: "辰东",
      conflictResolution: "merge_existing",
      existingCardId: created.card.id,
    });
    assert.equal(merged.status, "merged");

    const detail = getAuthorCardDetail(created.card.id);
    assert.equal(detail.versions.length, 2);
    assert.equal(detail.versions[0]?.version, 2);
  } finally {
    for (const authorCardId of createdAuthorCardIds) {
      cleanupAuthorCard(authorCardId);
      await rm(authorCardDir(authorCardId), { recursive: true, force: true });
    }
    for (const projectId of createdProjectIds) {
      cleanupProject(projectId);
      await rm(projectDir(projectId), { recursive: true, force: true });
    }
  }
});

test("applyAuthorCardToProject clones a new local snapshot and preserves older project snapshots", async () => {
  const createdProjectIds: string[] = [];
  const createdAuthorCardIds: string[] = [];

  try {
    const project = createProjectFixture("Author Card Apply");
    createdProjectIds.push(project.id);

    const existingBookSnapshot = saveStyleCardSnapshot(
      createSnapshot(project.id, {
        id: "book-snapshot-existing",
        version: 1,
        mode: "book",
        styleCard: "旧书籍风格卡",
        styleDigest: "旧风格摘要".repeat(180).slice(0, 1260),
      }),
    );
    const authorSeedSnapshot = saveStyleCardSnapshot(
      createSnapshot(project.id, {
        id: "author-snapshot-source",
        version: 2,
        mode: "author",
        styleCard: "全局作者风格卡",
        styleDigest: "作者风格摘要".repeat(180).slice(0, 1260),
      }),
    );

    if (!existingBookSnapshot || !authorSeedSnapshot) {
      throw new Error("测试 snapshot 保存失败");
    }

    await applyFoundationStyleSnapshot(project.id, existingBookSnapshot.id);

    const authorName = `烽火戏诸侯-${project.id}`;
    const synced = await syncAuthorCardFromProjectSnapshot({
      projectId: project.id,
      snapshotId: authorSeedSnapshot.id,
      authorName,
    });
    if (synced.status !== "created") {
      throw new Error("作者卡应当创建成功");
    }
    createdAuthorCardIds.push(synced.card.id);

    const applied = await applyAuthorCardToProject(project.id, synced.card.id);
    assert.notEqual(applied.snapshot.id, existingBookSnapshot.id);
    assert.notEqual(applied.snapshot.id, authorSeedSnapshot.id);
    assert.deepEqual(applied.snapshot.sourceIds, []);
    assert.equal(applied.applied.foundation?.styleSnapshotId, applied.snapshot.id);
    assert.equal(applied.applied.workshopState?.draft.styleSnapshotId, applied.snapshot.id);

    const snapshots = listStyleCardSnapshots(project.id);
    assert.equal(snapshots.length, 3);
    assert.equal(snapshots.some((entry) => entry.id === existingBookSnapshot.id), true);
    assert.equal(snapshots.some((entry) => entry.id === authorSeedSnapshot.id), true);
    assert.equal(snapshots.some((entry) => entry.id === applied.snapshot.id), true);
  } finally {
    for (const authorCardId of createdAuthorCardIds) {
      cleanupAuthorCard(authorCardId);
      await rm(authorCardDir(authorCardId), { recursive: true, force: true });
    }
    for (const projectId of createdProjectIds) {
      cleanupProject(projectId);
      await rm(projectDir(projectId), { recursive: true, force: true });
    }
  }
});

test("author library workflow imports texts, generates book cards, merges author style, and applies both author and book cards to a project", async () => {
  const createdProjectIds: string[] = [];
  const createdAuthorCardIds: string[] = [];

  try {
    const project = createProjectFixture("Author Library Workflow");
    createdProjectIds.push(project.id);

    const createdAuthor = await createAuthorCardWithName("沈知白");
    createdAuthorCardIds.push(createdAuthor.card.id);
    assert.equal(createdAuthor.created, true);

    const firstImport = await importTextToAuthorCard(createdAuthor.card.id, {
      fileName: "长夜潮声.txt",
      mediaType: "text/plain",
      title: "长夜潮声",
      author: "沈知白",
      buffer: Buffer.from(buildImportText("林霁"), "utf8"),
    });
    const secondImport = await importTextToAuthorCard(createdAuthor.card.id, {
      fileName: "雾中山门.txt",
      mediaType: "text/plain",
      title: "雾中山门",
      author: "沈知白",
      buffer: Buffer.from(buildImportText("顾停"), "utf8"),
    });

    const bookCards = await generateBookCardForAuthor(
      createdAuthor.card.id,
      [firstImport.id, secondImport.id],
      { llmCall: fakeStyleLlm },
    );
    assert.equal(bookCards.length, 2);
    assert.equal(bookCards.every((entry) => entry.confidence === "high" || entry.confidence === "medium"), true);
    assert.equal(bookCards.every((entry) => Boolean(entry.fingerprint)), true);

    const mergedVersion = await mergeAuthorStyle(createdAuthor.card.id, { llmCall: fakeStyleLlm });
    assert.equal(mergedVersion.version, 1);

    const detail = getAuthorCardDetail(createdAuthor.card.id);
    assert.equal(detail.imports.length, 2);
    assert.equal(detail.bookCards.length, 2);
    assert.equal(detail.bookCards.every((entry) => Boolean(entry.fingerprint)), true);
    assert.equal(detail.versions.length, 1);
    assert.equal(detail.authorProfile?.profileMode, "multi-book stable");
    assert.equal(existsSync(authorCardDir(createdAuthor.card.id)), true);

    const appliedAuthor = await applyAuthorCardToProject(project.id, createdAuthor.card.id);
    assert.equal(appliedAuthor.snapshot.mode, "author");
    assert.equal(appliedAuthor.applied.foundation?.styleSnapshotId, appliedAuthor.snapshot.id);

    const appliedBook = await applyBookCardToProject(project.id, bookCards[0]!.id);
    assert.equal(appliedBook.snapshot.mode, "book");
    assert.equal(appliedBook.applied.foundation?.styleSnapshotId, appliedBook.snapshot.id);

    const snapshots = listStyleCardSnapshots(project.id);
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots.some((entry) => entry.id === appliedAuthor.snapshot.id), true);
    assert.equal(snapshots.some((entry) => entry.id === appliedBook.snapshot.id), true);
  } finally {
    for (const authorCardId of createdAuthorCardIds) {
      cleanupAuthorCard(authorCardId);
      await rm(authorCardDir(authorCardId), { recursive: true, force: true });
    }
    for (const projectId of createdProjectIds) {
      cleanupProject(projectId);
      await rm(projectDir(projectId), { recursive: true, force: true });
    }
  }
});

test("generateBookCardForAuthor removes every same-source duplicate before recreating the book card", async () => {
  const createdAuthor = await createAuthorCardWithName("测试作者-重复清理");

  try {
    const imported = await importTextToAuthorCard(createdAuthor.card.id, {
      fileName: "完美世界-辰东.txt",
      mediaType: "text/plain",
      title: "完美世界-辰东",
      author: "测试作者-重复清理",
      buffer: Buffer.from(buildImportText("石昊"), "utf8"),
    });

    await generateBookCardForAuthor(createdAuthor.card.id, [imported.id], { llmCall: fakeStyleLlm });

    const duplicate = createBookCard({
      authorCardId: createdAuthor.card.id,
      title: imported.title,
      authorName: imported.authorName ?? createdAuthor.card.displayName,
      styleCard: "历史重复书卡",
      styleProfile: buildFallbackStyleProfile({
        references: [],
        manualGuidance: "保留动作压强。",
        avoidances: "不要解释腔。",
      }),
      styleDigest: "历史重复摘要",
      styleExemplars: [],
      sampledExcerpts: [],
      confidence: "medium",
      wordCount: imported.wordCount,
      chapterCount: imported.chapterCount,
      sourceFileName: imported.originalFileName,
    });

    assert.equal(Boolean(duplicate), true);
    assert.equal(
      getAuthorCardDetail(createdAuthor.card.id).bookCards.filter((entry) =>
        entry.title === imported.title && entry.sourceFileName === imported.originalFileName
      ).length,
      2,
    );

    await generateBookCardForAuthor(createdAuthor.card.id, [imported.id], { llmCall: fakeStyleLlm });

    const remaining = getAuthorCardDetail(createdAuthor.card.id).bookCards.filter((entry) =>
      entry.title === imported.title && entry.sourceFileName === imported.originalFileName
    );
    assert.equal(remaining.length, 1);
    assert.notEqual(remaining[0]?.styleDigest, "历史重复摘要");
  } finally {
    cleanupAuthorCard(createdAuthor.card.id);
    await rm(authorCardDir(createdAuthor.card.id), { recursive: true, force: true });
  }
});

test("createAuthorCardWithName deduplicates by normalized author name", async () => {
  const createdAuthorCardIds: string[] = [];

  try {
    const first = await createAuthorCardWithName("辰东（完美世界）");
    createdAuthorCardIds.push(first.card.id);
    const second = await createAuthorCardWithName("辰东");

    assert.equal(normalizeAuthorCardName("辰东（完美世界）"), normalizeAuthorCardName("辰东"));
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.card.id, first.card.id);
  } finally {
    for (const authorCardId of createdAuthorCardIds) {
      cleanupAuthorCard(authorCardId);
      await rm(authorCardDir(authorCardId), { recursive: true, force: true });
    }
  }
});

test("mergeAuthorStyle rejects authors without enough book cards", async () => {
  const createdAuthor = await createAuthorCardWithName("测试作者-空合并");

  try {
    await assert.rejects(() => mergeAuthorStyle(createdAuthor.card.id, { llmCall: fakeStyleLlm }), /至少两张书级风格卡|至少两本书/);

    const imported = await importTextToAuthorCard(createdAuthor.card.id, {
      fileName: "单本风格.txt",
      mediaType: "text/plain",
      title: "单本风格",
      author: "测试作者-空合并",
      buffer: Buffer.from(buildImportText("裴照"), "utf8"),
    });
    await generateBookCardForAuthor(createdAuthor.card.id, [imported.id], { llmCall: fakeStyleLlm });

    const detail = getAuthorCardDetail(createdAuthor.card.id);
    assert.equal(detail.authorProfile?.profileMode, "single-book inferred");

    await assert.rejects(() => mergeAuthorStyle(createdAuthor.card.id, { llmCall: fakeStyleLlm }), /至少两张书级风格卡|至少两本书/);
  } finally {
    cleanupAuthorCard(createdAuthor.card.id);
    await rm(authorCardDir(createdAuthor.card.id), { recursive: true, force: true });
  }
});
