import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { rawDb } from "./db/client.ts";
import { authorCardDir, withinAuthorCard } from "./paths.ts";
import * as authorCardService from "./services/author-card.service.ts";
import { writeAuthorTextImportFiles } from "./files/author-card-files.ts";
import { prepareStyleReferenceImport } from "./style/style-reference-import.ts";
import { ensureDir } from "./utils.ts";

type PreviewService = (
  authorCardId: string,
  input: {
    fileName: string;
    buffer: Buffer;
    mediaType?: string;
    title?: string;
    author?: string;
    encoding?: string;
  },
) => Promise<{
  previewId: string;
  title: string;
  authorName: string;
  originalFileName: string;
  encoding: string;
  parseConfidence: "low" | "medium" | "high";
  parserMode: "heading_strict" | "heading_relaxed" | "marker" | "window_fallback";
  chapterCount: number;
  samplePlan: { indexes: number[]; skippedShort: number[]; total: number };
  chapters: Array<{ chapterNumber: number; title: string; summary: string; wordCount: number }>;
  warnings: Array<{ code: string; message: string; level: "info" | "warning" }>;
}>;

type ApplyService = (
  authorCardId: string,
  input: {
    previewId: string;
    profileId?: string;
    llmCall?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  },
) => Promise<{
  status: "imported" | "completed";
  previewId: string;
  importId: string;
  bookCardId?: string | null;
}>;

function getPreviewBookImportForAuthor() {
  const service = (authorCardService as Record<string, unknown>).previewBookImportForAuthor;
  assert.equal(typeof service, "function", "previewBookImportForAuthor 尚未实现");
  return service as PreviewService;
}

function getApplyBookImportPreviewForAuthor() {
  const service = (authorCardService as Record<string, unknown>).applyBookImportPreviewForAuthor;
  assert.equal(typeof service, "function", "applyBookImportPreviewForAuthor 尚未实现");
  return service as ApplyService;
}

async function fakeStyleLlm(messages: Array<{ role: string; content: string }>) {
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

function createBookImportText() {
  return Array.from({ length: 8 }, (_, index) => `第${index + 1}章 雨夜回灯

林霁沿着潮湿石阶往上走，雾气顺着衣摆往膝骨里钻，像旧事一点点往身上爬。第${index + 1}章里，他把袖口里的骨哨压得更紧，生怕那一点轻响先出卖自己。

“再往前一步，夜禁就不是规矩，是收尸。”对面的人把灯举高，影子被山风拉得老长。林霁没有回头，只把呼吸压得更轻，继续朝着旧灯巷尽头那扇没关严的门走去。

山口忽然炸开一串铁器碰撞声，巡夜人从暗处扑出，刀背劈在石栏上，火星和雨点一起乱溅。那一下失重让他的心口空了一瞬，真正盯上他的并不是夜禁，而是门后那封不该出现在这里的密信。`).join("\n\n");
}

function previewDir(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId);
}

function previewNormalizedPath(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId, "normalized.txt");
}

function previewManifestPath(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId, "chapters.manifest.json");
}

function previewSourcePath(authorCardId: string, previewId: string) {
  return withinAuthorCard(authorCardId, "book-import-previews", previewId, "source.bin");
}

function cleanupAuthorCard(authorCardId: string) {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM author_book_cards WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_text_imports WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_book_import_previews WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_card_versions WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_cards WHERE id = ?").run(authorCardId);
  })();
}

test("previewBookImportForAuthor writes preview assets and lazily removes expired preview files", async () => {
  const created = await authorCardService.createAuthorCardWithName(`拆书预览作者-${nanoid(6)}`);
  const previewBookImportForAuthor = getPreviewBookImportForAuthor();

  try {
    const expiredPreviewId = nanoid();
    const expiredDir = previewDir(created.card.id, expiredPreviewId);
    await ensureDir(expiredDir);
    await writeFile(previewNormalizedPath(created.card.id, expiredPreviewId), "旧的预览正文\n", "utf8");
    await writeFile(previewManifestPath(created.card.id, expiredPreviewId), "[]", "utf8");
    await writeFile(previewSourcePath(created.card.id, expiredPreviewId), Buffer.from("旧文件", "utf8"));

    rawDb.prepare(`
      INSERT INTO author_book_import_previews (
        id, author_card_id, title, author_name, original_file_name, media_type, source_hash,
        word_count, encoding, parse_confidence, parser_mode, chapter_count, warnings_json, sample_plan_json,
        status, apply_status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      expiredPreviewId,
      created.card.id,
      "旧书",
      created.card.displayName,
      "old.txt",
      "text/plain",
      createHash("sha256").update("old").digest("hex"),
      10,
      "utf-8",
      "high",
      "heading_relaxed",
      1,
      "[]",
      JSON.stringify({ indexes: [0], skippedShort: [], total: 1 }),
      "active",
      "pending",
      "2026-04-09T00:00:00.000Z",
      "2026-04-09T00:30:00.000Z",
    );

    const preview = await previewBookImportForAuthor(created.card.id, {
      fileName: "长夜潮声.txt",
      mediaType: "text/plain",
      title: "长夜潮声",
      author: created.card.displayName,
      buffer: Buffer.from(createBookImportText(), "utf8"),
    });

    assert.equal(preview.title, "长夜潮声");
    assert.equal(preview.samplePlan.total, preview.chapterCount);
    assert.equal(preview.samplePlan.indexes.length > 0, true);
    assert.equal(existsSync(expiredDir), false);
    assert.equal(existsSync(previewDir(created.card.id, preview.previewId)), true);
    assert.equal(existsSync(previewNormalizedPath(created.card.id, preview.previewId)), true);
    assert.equal(existsSync(previewManifestPath(created.card.id, preview.previewId)), true);
    assert.equal(existsSync(previewSourcePath(created.card.id, preview.previewId)), true);
  } finally {
    cleanupAuthorCard(created.card.id);
    await rm(authorCardDir(created.card.id), { recursive: true, force: true });
  }
});

test("applyBookImportPreviewForAuthor rejects expired previews with 410", async () => {
  const created = await authorCardService.createAuthorCardWithName(`拆书过期作者-${nanoid(6)}`);
  const previewBookImportForAuthor = getPreviewBookImportForAuthor();
  const applyBookImportPreviewForAuthor = getApplyBookImportPreviewForAuthor();

  try {
    const preview = await previewBookImportForAuthor(created.card.id, {
      fileName: "过期测试.txt",
      mediaType: "text/plain",
      title: "过期测试",
      author: created.card.displayName,
      buffer: Buffer.from(createBookImportText(), "utf8"),
    });

    rawDb.prepare("UPDATE author_book_import_previews SET expires_at = ? WHERE id = ?")
      .run("2026-04-09T00:00:00.000Z", preview.previewId);

    await assert.rejects(
      () => applyBookImportPreviewForAuthor(created.card.id, { previewId: preview.previewId, llmCall: fakeStyleLlm }),
      (error: unknown) =>
        error instanceof Error
        && "status" in error
        && Number((error as { status: number }).status) === 410,
    );
  } finally {
    cleanupAuthorCard(created.card.id);
    await rm(authorCardDir(created.card.id), { recursive: true, force: true });
  }
});

test("applyBookImportPreviewForAuthor returns imported on generation failure and can retry to completed", async () => {
  const created = await authorCardService.createAuthorCardWithName(`拆书失败恢复作者-${nanoid(6)}`);
  const previewBookImportForAuthor = getPreviewBookImportForAuthor();
  const applyBookImportPreviewForAuthor = getApplyBookImportPreviewForAuthor();

  try {
    const preview = await previewBookImportForAuthor(created.card.id, {
      fileName: "失败恢复.txt",
      mediaType: "text/plain",
      title: "失败恢复",
      author: created.card.displayName,
      buffer: Buffer.from(createBookImportText(), "utf8"),
    });

    const imported = await applyBookImportPreviewForAuthor(created.card.id, {
      previewId: preview.previewId,
      llmCall: async () => {
        throw new Error("LLM timeout");
      },
    });
    assert.equal(imported.status, "imported");

    const afterFailure = authorCardService.getAuthorCardDetail(created.card.id);
    assert.equal(afterFailure.imports.length, 1);
    assert.equal(afterFailure.imports[0]?.bookCardStatus, "failed");
    assert.equal(afterFailure.imports[0]?.sourceKind, "book_import");
    assert.equal(afterFailure.bookCards.length, 0);

    const recovered = await applyBookImportPreviewForAuthor(created.card.id, {
      previewId: preview.previewId,
      llmCall: fakeStyleLlm,
    });
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.importId, imported.importId);

    const detail = authorCardService.getAuthorCardDetail(created.card.id);
    assert.equal(detail.imports.length, 1);
    assert.equal(detail.imports[0]?.bookCardStatus, "completed");
    assert.equal(detail.bookCards.length, 1);
  } finally {
    cleanupAuthorCard(created.card.id);
    await rm(authorCardDir(created.card.id), { recursive: true, force: true });
  }
});

test("applyBookImportPreviewForAuthor resumes a consumed pending preview idempotently", async () => {
  const created = await authorCardService.createAuthorCardWithName(`拆书幂等作者-${nanoid(6)}`);
  const previewBookImportForAuthor = getPreviewBookImportForAuthor();
  const applyBookImportPreviewForAuthor = getApplyBookImportPreviewForAuthor();

  try {
    const preview = await previewBookImportForAuthor(created.card.id, {
      fileName: "幂等恢复.txt",
      mediaType: "text/plain",
      title: "幂等恢复",
      author: created.card.displayName,
      buffer: Buffer.from(createBookImportText(), "utf8"),
    });

    const normalizedText = await readFile(previewNormalizedPath(created.card.id, preview.previewId), "utf8");
    const sourceBuffer = await readFile(previewSourcePath(created.card.id, preview.previewId));
    const prepared = prepareStyleReferenceImport({
      buffer: Buffer.from(normalizedText, "utf8"),
      fileName: "幂等恢复.txt",
      mediaType: "text/plain",
      title: "幂等恢复",
      author: created.card.displayName,
    });
    const importId = nanoid();

    await writeAuthorTextImportFiles({
      authorCardId: created.card.id,
      importId,
      originalFileName: "幂等恢复.txt",
      title: "幂等恢复",
      rawBuffer: sourceBuffer,
      normalizedText,
    });

    rawDb.prepare(`
      INSERT INTO author_text_imports (
        id, author_card_id, title, author_name, original_file_name, media_type, source_hash,
        word_count, encoding, confidence, chapter_count, excerpts_json, source_kind,
        book_card_status, last_generation_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      importId,
      created.card.id,
      "幂等恢复",
      created.card.displayName,
      "幂等恢复.txt",
      "text/plain",
      prepared.sourceHash,
      prepared.wordCount,
      prepared.encoding,
      prepared.confidence,
      preview.chapterCount,
      JSON.stringify(prepared.excerpts),
      "book_import",
      "pending",
      null,
      "2026-04-09T00:00:00.000Z",
    );

    rawDb.prepare(`
      UPDATE author_book_import_previews
      SET status = 'consumed', apply_status = 'pending', import_id = ?, consumed_at = ?
      WHERE id = ?
    `).run(importId, "2026-04-09T00:10:00.000Z", preview.previewId);

    const first = await applyBookImportPreviewForAuthor(created.card.id, {
      previewId: preview.previewId,
      llmCall: fakeStyleLlm,
    });
    assert.equal(first.status, "completed");
    assert.equal(first.importId, importId);

    const second = await applyBookImportPreviewForAuthor(created.card.id, {
      previewId: preview.previewId,
      llmCall: fakeStyleLlm,
    });
    assert.equal(second.status, "completed");
    assert.equal(second.importId, importId);
    assert.equal(second.bookCardId, first.bookCardId);

    const detail = authorCardService.getAuthorCardDetail(created.card.id);
    assert.equal(detail.imports.length, 1);
    assert.equal(detail.imports[0]?.bookCardStatus, "completed");
    assert.equal(detail.bookCards.length, 1);
  } finally {
    cleanupAuthorCard(created.card.id);
    await rm(authorCardDir(created.card.id), { recursive: true, force: true });
  }
});
