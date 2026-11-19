import assert from "node:assert/strict";
import test from "node:test";
import { nanoid } from "nanoid";

import { rawDb } from "../db/client.ts";
import { nowIso } from "../utils.ts";
import {
  createAuthorBookImportPreview,
  updateAuthorBookImportPreview,
} from "./author-book-import-preview.repository.ts";

function createAuthorCard() {
  const id = nanoid();
  const now = nowIso();
  rawDb
    .prepare(`
      INSERT INTO author_cards (id, display_name, normalized_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(id, "测试作者", `测试作者-${id}`, now, now);
  return id;
}

function cleanup(authorCardId: string) {
  rawDb.prepare("DELETE FROM author_book_import_previews WHERE author_card_id = ?").run(authorCardId);
  rawDb.prepare("DELETE FROM author_cards WHERE id = ?").run(authorCardId);
}

test("updateAuthorBookImportPreview clears nullable fields when patch passes explicit null", () => {
  const authorCardId = createAuthorCard();
  try {
    const preview = createAuthorBookImportPreview({
      authorCardId,
      title: "样章预览",
      originalFileName: "book.txt",
      mediaType: "text/plain",
      sourceHash: "hash-1",
      wordCount: 1000,
      encoding: "utf-8",
      parseConfidence: "medium",
      parserMode: "heading_relaxed",
      chapterCount: 3,
      warnings: [],
      samplePlan: { indexes: [], skippedShort: [], total: 0 },
      status: "active",
      applyStatus: "pending",
      importId: "import-old",
      bookCardId: "book-old",
      lastError: "上一次导入失败",
      expiresAt: nowIso(),
      consumedAt: nowIso(),
    });
    assert.ok(preview);
    assert.equal(preview.lastError, "上一次导入失败");

    const updated = updateAuthorBookImportPreview(preview.id, {
      status: "consumed",
      applyStatus: "completed",
      lastError: null,
      consumedAt: null,
      importId: null,
      bookCardId: null,
    });

    assert.ok(updated);
    assert.equal(updated.status, "consumed");
    assert.equal(updated.applyStatus, "completed");
    assert.equal(updated.lastError, null, "显式传入 null 应清除旧错误");
    assert.equal(updated.consumedAt, null);
    assert.equal(updated.importId, null);
    assert.equal(updated.bookCardId, null);
  } finally {
    cleanup(authorCardId);
  }
});

test("updateAuthorBookImportPreview keeps omitted fields untouched", () => {
  const authorCardId = createAuthorCard();
  try {
    const preview = createAuthorBookImportPreview({
      authorCardId,
      title: "样章预览",
      originalFileName: "book.txt",
      mediaType: "text/plain",
      sourceHash: "hash-2",
      wordCount: 1000,
      encoding: "utf-8",
      parseConfidence: "medium",
      parserMode: "heading_relaxed",
      chapterCount: 3,
      warnings: [],
      samplePlan: { indexes: [], skippedShort: [], total: 0 },
      status: "active",
      applyStatus: "pending",
      importId: "import-keep",
      lastError: "保留中的错误",
      expiresAt: nowIso(),
    });
    assert.ok(preview);

    const updated = updateAuthorBookImportPreview(preview.id, { status: "consumed" });

    assert.ok(updated);
    assert.equal(updated.status, "consumed");
    assert.equal(updated.importId, "import-keep");
    assert.equal(updated.lastError, "保留中的错误");
  } finally {
    cleanup(authorCardId);
  }
});
