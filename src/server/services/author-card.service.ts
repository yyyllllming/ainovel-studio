import "../server-only.ts";

import { readFile, rm } from "node:fs/promises";
import { nanoid } from "nanoid";
import { type ChatMessage, chatCompletion } from "../llm.ts";
import { AppError, notFound } from "../errors.ts";
import { writeAuthorCardMirror } from "../library-files.ts";
import {
  authorBookImportPreviewDir,
  authorBookImportPreviewManifestPath,
  authorBookImportPreviewNormalizedPath,
  authorBookImportPreviewSourcePath,
  authorTextImportNormalizedPath,
  authorTextImportRawPath,
  writeAuthorBookImportPreviewFiles,
  writeAuthorTextImportFiles,
} from "../files/author-card-files.ts";
import {
  AUTHOR_CARD_MAX_TOKEN_CANDIDATES,
  isRetryableOutputTokenError,
  runWithTokenCandidates,
} from "../llm-token-policy.ts";
import { writeStyleSnapshotFile } from "../project-files.ts";
import { getProfiles } from "../profiles.ts";
import { getProject } from "../repositories/project.repository.ts";
import { writeDbThenFile, writeFileThenDb } from "../utils/safe-write.ts";
import {
  appendAuthorCardVersion,
  createAuthorCard,
  findAuthorCardsByNormalizedName,
  getAuthorCard,
  getLatestAuthorCardVersion,
  listAuthorCards,
  listAuthorCardVersions,
} from "../repositories/author-card.repository.ts";
import {
  createAuthorBookImportPreview,
  getAuthorBookImportPreview,
  listExpiredAuthorBookImportPreviews,
  markAuthorBookImportPreviewExpired,
  updateAuthorBookImportPreview,
} from "../repositories/author-book-import-preview.repository.ts";
import {
  createBookCard,
  deleteBookCard,
  getBookCard,
  listBookCardsByAuthor,
} from "../repositories/author-book-card.repository.ts";
import {
  deleteTextImport,
  getTextImport,
  getTextImportsByIds,
  listTextImportsByAuthor,
  saveTextImport,
  updateTextImportBookCardState,
} from "../repositories/author-text-import.repository.ts";
import {
  getNextStyleSnapshotVersion,
  getStyleCardSnapshot,
  getStyleReferenceImportsByIds,
  saveStyleCardSnapshot,
} from "../repositories/style.repository.ts";
import { applyFoundationStyleSnapshot } from "../style/foundation-style.ts";
import { computeStyleFingerprint, type StyleFingerprint } from "../style-fingerprint.ts";
import { prepareStyleReferenceImport, splitStyleReferenceSections } from "../style/style-reference-import.ts";
import { generateStyleCardFromExcerpts, type StyleGenerationImport } from "../style/style-snapshot.ts";
import { buildAuthorStyleProfile } from "./author-style-profile.ts";
import {
  authorBookImportLimits,
  buildSourceHash,
  parseAuthorBookImportBuffer,
  type AuthorBookImportChapterManifest,
} from "../author-book-import-parser.ts";
import type {
  AuthorBookCardRecord,
  AuthorBookImportPreviewRecord,
  AuthorCardRecord,
  AuthorCardSourceWork,
  AuthorTextImportRecord,
  StyleCardSnapshot,
  StyleConfidence,
  LlmProfile,
} from "../types.ts";
import { nowIso } from "../utils.ts";

export type AuthorCardConflictResolution =
  | "auto"
  | "merge_existing"
  | "create_independent"
  | "cancel";

export type AuthorCardSyncResult =
  | {
      status: "created" | "merged";
      card: AuthorCardRecord;
      version: ReturnType<typeof getLatestAuthorCardVersion>;
    }
  | {
      status: "conflict";
      normalizedName: string;
      candidates: AuthorCardRecord[];
    }
  | {
      status: "cancelled";
    }
  | {
      status: "skipped";
      reason: string;
    };

type AuthorBookImportPreviewResponse =
  | {
      needsEncodingChoice: true;
      encodingCandidates: string[];
    }
  | {
      previewId: string;
      title: string;
      authorName: string;
      originalFileName: string;
      encoding: string;
      parseConfidence: AuthorBookImportPreviewRecord["parseConfidence"];
      parserMode: AuthorBookImportPreviewRecord["parserMode"];
      chapterCount: number;
      warnings: AuthorBookImportPreviewRecord["warnings"];
      samplePlan: AuthorBookImportPreviewRecord["samplePlan"];
      chapters: Array<Pick<AuthorBookImportChapterManifest, "chapterNumber" | "title" | "summary" | "wordCount">>;
    };

type AuthorBookImportApplyResult = {
  status: "imported" | "completed";
  previewId: string;
  importId: string;
  bookCardId?: string | null;
};

function buildSourceWorksFromProjectSnapshot(
  projectId: string,
  snapshot: StyleCardSnapshot,
  authorName: string,
): AuthorCardSourceWork[] {
  const imports = snapshot.sourceIds.length ? getStyleReferenceImportsByIds(projectId, snapshot.sourceIds) : [];
  if (!imports.length) {
    return [{
      title: authorName,
      author: authorName,
      projectId,
      snapshotId: snapshot.id,
    }];
  }
  return imports.map((entry) => ({
    title: entry.title,
    author: entry.author ?? authorName,
    projectId,
    snapshotId: snapshot.id,
  }));
}

function buildSourceWorksFromBookCards(bookCards: AuthorBookCardRecord[]): AuthorCardSourceWork[] {
  return bookCards.map((entry) => ({
    title: entry.title,
    author: entry.authorName ?? entry.title,
    bookCardId: entry.id,
  }));
}

function toImportGenerationSource(entry: AuthorTextImportRecord): StyleGenerationImport {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.authorName,
    wordCount: entry.wordCount,
    confidence: entry.confidence,
    excerpts: entry.excerpts,
    encoding: entry.encoding,
  };
}

function toBookCardGenerationSource(entry: AuthorBookCardRecord): StyleGenerationImport {
  return {
    id: entry.id,
    title: entry.title,
    author: entry.authorName,
    wordCount: entry.wordCount,
    confidence: entry.confidence,
    excerpts: entry.sampledExcerpts,
    encoding: "library_book_card",
    fingerprint: entry.fingerprint ?? null,
  };
}

async function resolveImportFingerprint(authorCardId: string, entry: AuthorTextImportRecord): Promise<{
  normalizedText?: string;
  fingerprint?: StyleFingerprint | null;
}> {
  try {
    const normalizedText = await readFile(authorTextImportNormalizedPath(authorCardId, entry.id, entry.title), "utf8");
    const trimmed = normalizedText.trim();
    if (!trimmed) {
      return {};
    }
    return {
      normalizedText: trimmed,
      fingerprint: computeStyleFingerprint(trimmed, splitStyleReferenceSections(trimmed)),
    };
  } catch {
    return {};
  }
}

async function resolveLibraryLlmCall(profileId?: string) {
  const profiles = await getProfiles();
  const profile =
    (profileId ? profiles.find((entry) => entry.id === profileId) : undefined)
    ?? profiles.find((entry) => entry.enabled && entry.apiKey.trim() && entry.defaultModel.trim());
  if (!profile) {
    throw new Error("未找到可用的全局 LLM 配置，请先在设置页启用至少一个带默认模型的 Profile。");
  }

  return async (messages: ChatMessage[]) => callLibraryLlmWithRetry(profile, messages);
}

export async function callLibraryLlmWithRetry(
  profile: LlmProfile,
  messages: ChatMessage[],
  options?: {
    chatCompletionImpl?: typeof chatCompletion;
  },
) {
  const complete = options?.chatCompletionImpl ?? chatCompletion;
  return runWithTokenCandidates(
    [...AUTHOR_CARD_MAX_TOKEN_CANDIDATES],
    (maxTokens) => complete(profile, profile.defaultModel, messages, {
      temperature: 0.55,
      maxTokens,
    }),
    isRetryableOutputTokenError,
  );
}

function createProjectSnapshotFromSource(input: {
  projectId: string;
  mode: "book" | "author";
  source: {
    styleCard: string;
    styleProfile: StyleCardSnapshot["styleProfile"];
    styleDigest: string;
    styleExemplars: StyleCardSnapshot["styleExemplars"];
    sampledExcerpts: StyleCardSnapshot["sampledExcerpts"];
    confidence: StyleConfidence;
  };
}) {
  return {
    id: nanoid(),
    projectId: input.projectId,
    mode: input.mode,
    sourceIds: [],
    styleCard: input.source.styleCard,
    styleProfile: input.source.styleProfile,
    styleDigest: input.source.styleDigest,
    styleExemplars: input.source.styleExemplars,
    sampledExcerpts: input.source.sampledExcerpts,
    confidence: input.source.confidence,
    version: getNextStyleSnapshotVersion(input.projectId),
    createdAt: nowIso(),
  } satisfies StyleCardSnapshot;
}

async function syncMirror(authorCardId: string) {
  const detail = getAuthorCardFullDetail(authorCardId);
  await writeAuthorCardMirror(detail);
}

function warnAuthorCardMirrorFailure(authorCardId: string, action: string, error: unknown) {
  console.warn(`[author-card:${authorCardId}] ${action} 后镜像写入失败`, error);
}

export function normalizeAuthorCardName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/[（(].*?[)）]/gu, "")
    .replace(/\s+/gu, "")
    .trim()
    .toLowerCase();
}

export function listAuthorCardSummaries() {
  return listAuthorCards();
}

export function getAuthorCardFullDetail(authorCardId: string) {
  const card = getAuthorCard(authorCardId);
  if (!card) {
    throw notFound("作者卡不存在", { authorCardId });
  }

  const bookCards = listBookCardsByAuthor(authorCardId);

  return {
    card,
    versions: listAuthorCardVersions(authorCardId),
    bookCards,
    imports: listTextImportsByAuthor(authorCardId),
    authorProfile: buildAuthorStyleProfile(bookCards),
  };
}

export function getAuthorCardDetail(authorCardId: string) {
  return getAuthorCardFullDetail(authorCardId);
}

function buildBookImportPreviewPayload(
  preview: AuthorBookImportPreviewRecord,
  chapters: AuthorBookImportChapterManifest[],
): Extract<AuthorBookImportPreviewResponse, { previewId: string }> {
  return {
    previewId: preview.id,
    title: preview.title,
    authorName: preview.authorName ?? preview.title,
    originalFileName: preview.originalFileName,
    encoding: preview.encoding,
    parseConfidence: preview.parseConfidence,
    parserMode: preview.parserMode,
    chapterCount: preview.chapterCount,
    warnings: preview.warnings,
    samplePlan: preview.samplePlan,
    chapters: chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      summary: chapter.summary,
      wordCount: chapter.wordCount,
    })),
  };
}

async function cleanupExpiredBookImportPreviewArtifacts(authorCardId: string, now = nowIso()) {
  const expired = listExpiredAuthorBookImportPreviews(authorCardId, now);
  await Promise.all(expired.map(async (preview) => {
    await rm(authorBookImportPreviewDir(authorCardId, preview.id), { recursive: true, force: true });
    if (preview.status === "active") {
      markAuthorBookImportPreviewExpired(preview.id);
    }
  }));
}

async function readBookImportManifest(authorCardId: string, previewId: string) {
  const raw = await readFile(authorBookImportPreviewManifestPath(authorCardId, previewId), "utf8");
  return JSON.parse(raw) as AuthorBookImportChapterManifest[];
}

function buildSampledReferenceText(input: {
  normalizedText: string;
  chapters: AuthorBookImportChapterManifest[];
  samplePlan: AuthorBookImportPreviewRecord["samplePlan"];
}) {
  const indexes = input.samplePlan.indexes.length
    ? input.samplePlan.indexes
    : input.chapters.map((_, index) => index);
  const selected = indexes
    .map((index) => input.chapters[index])
    .filter((chapter): chapter is AuthorBookImportChapterManifest => Boolean(chapter))
    .map((chapter) => `${chapter.title}\n\n${input.normalizedText.slice(chapter.startOffset, chapter.endOffset).trim()}`)
    .filter((chunk) => chunk.trim().length > 0);

  return selected.join("\n\n");
}

async function materializeBookImportPreviewToImport(
  preview: AuthorBookImportPreviewRecord,
  fallbackAuthorName: string,
) {
  const normalizedText = await readFile(authorBookImportPreviewNormalizedPath(preview.authorCardId, preview.id), "utf8");
  const sourceBuffer = await readFile(authorBookImportPreviewSourcePath(preview.authorCardId, preview.id));
  const chapters = await readBookImportManifest(preview.authorCardId, preview.id);
  const sampledReferenceText = buildSampledReferenceText({
    normalizedText,
    chapters,
    samplePlan: preview.samplePlan,
  }) || normalizedText;
  const prepared = prepareStyleReferenceImport({
    buffer: Buffer.from(sampledReferenceText, "utf8"),
    fileName: preview.originalFileName,
    mediaType: preview.mediaType,
    title: preview.title,
    author: preview.authorName ?? fallbackAuthorName,
    samplingContext: {
      sourceKind: "book_import",
      totalWordCount: preview.wordCount,
      totalChapterCount: preview.chapterCount,
      sampledChapterCount: preview.samplePlan.indexes.length || chapters.length,
    },
  });
  const importId = nanoid();
  const consumedAt = nowIso();

  const saved = await writeFileThenDb(
    async () => {
      const written = await writeAuthorTextImportFiles({
        authorCardId: preview.authorCardId,
        importId,
        originalFileName: preview.originalFileName,
        title: preview.title,
        rawBuffer: sourceBuffer,
        normalizedText,
      });
      return {
        writtenFiles: [written.rawPath, written.normalizedPath],
        result: prepared,
      };
    },
    (result) => {
      const created = saveTextImport({
        id: importId,
        authorCardId: preview.authorCardId,
        title: preview.title,
        authorName: preview.authorName ?? fallbackAuthorName,
        originalFileName: preview.originalFileName,
        mediaType: preview.mediaType,
        sourceHash: preview.sourceHash,
        wordCount: preview.wordCount,
        encoding: preview.encoding,
        confidence: result?.confidence ?? preview.parseConfidence,
        chapterCount: preview.chapterCount,
        excerpts: result?.excerpts ?? [],
        sourceKind: "book_import",
        bookCardStatus: "pending",
        lastGenerationError: null,
        createdAt: consumedAt,
      });
      if (!created) {
        throw new Error("拆书导入记录保存失败");
      }
      updateAuthorBookImportPreview(preview.id, {
        status: "consumed",
        applyStatus: "pending",
        importId,
        lastError: null,
        consumedAt,
      });
      return created;
    },
  );

  return saved;
}

function ensurePreviewOwnership(authorCardId: string, previewId: string) {
  const preview = getAuthorBookImportPreview(previewId);
  if (!preview || preview.authorCardId !== authorCardId) {
    throw notFound("拆书预览不存在", { authorCardId, previewId });
  }
  return preview;
}

export async function previewBookImportForAuthor(authorCardId: string, input: {
  fileName: string;
  buffer: Buffer;
  mediaType?: string;
  title?: string;
  author?: string;
  encoding?: string;
}): Promise<AuthorBookImportPreviewResponse> {
  const card = getAuthorCard(authorCardId);
  if (!card) {
    throw notFound("作者卡不存在", { authorCardId });
  }

  await cleanupExpiredBookImportPreviewArtifacts(authorCardId);
  const sourceHash = buildSourceHash(input.buffer);
  const parsed = parseAuthorBookImportBuffer({
    buffer: input.buffer,
    explicitEncoding: input.encoding,
    sourceHash,
  });

  if (parsed.needsEncodingChoice) {
    return parsed;
  }

  const previewId = nanoid();
  const title = input.title?.trim() || input.fileName.replace(/\.[^.]+$/u, "") || "未命名作品";
  const authorName = input.author?.trim() || card.displayName;
  const expiresAt = new Date(Date.now() + authorBookImportLimits.previewTtlMs).toISOString();
  const saved = await writeFileThenDb(
    async () => {
      const written = await writeAuthorBookImportPreviewFiles({
        authorCardId,
        previewId,
        rawBuffer: input.buffer,
        normalizedText: parsed.normalizedText,
        manifestJson: JSON.stringify(parsed.chapters),
      });
      return [written.sourcePath, written.normalizedPath, written.manifestPath];
    },
    () => createAuthorBookImportPreview({
      id: previewId,
      authorCardId,
      title,
      authorName,
      originalFileName: input.fileName,
      mediaType: input.mediaType ?? "text/plain",
      sourceHash,
      wordCount: parsed.wordCount,
      encoding: parsed.encoding,
      parseConfidence: parsed.parseConfidence,
      parserMode: parsed.parserMode,
      chapterCount: parsed.chapterCount,
      warnings: parsed.warnings,
      samplePlan: parsed.samplePlan,
      status: "active",
      applyStatus: "pending",
      importId: null,
      bookCardId: null,
      lastError: null,
      expiresAt,
      consumedAt: null,
    }),
  );

  if (!saved) {
    throw new Error("拆书预览保存失败");
  }

  return buildBookImportPreviewPayload(saved, parsed.chapters);
}

export async function applyBookImportPreviewForAuthor(authorCardId: string, input: {
  previewId: string;
  profileId?: string;
  llmCall?: (messages: ChatMessage[]) => Promise<string>;
}): Promise<AuthorBookImportApplyResult> {
  const card = getAuthorCard(authorCardId);
  if (!card) {
    throw notFound("作者卡不存在", { authorCardId });
  }

  let preview = ensurePreviewOwnership(authorCardId, input.previewId);
  if (preview.status === "active" && preview.expiresAt < nowIso()) {
    preview = markAuthorBookImportPreviewExpired(preview.id) ?? preview;
  }
  if (preview.status === "expired") {
    throw new AppError("拆书预览已过期，请重新上传 TXT 后再确认导入。", {
      status: 410,
      code: "BOOK_IMPORT_PREVIEW_GONE",
      details: { previewId: preview.id },
    });
  }

  let importRecord = preview.importId ? getTextImport(preview.importId) : null;
  if (!importRecord) {
    importRecord = await materializeBookImportPreviewToImport(preview, card.displayName);
    preview = ensurePreviewOwnership(authorCardId, input.previewId);
  }

  if (importRecord.bookCardStatus === "completed") {
    return {
      status: "completed",
      previewId: preview.id,
      importId: importRecord.id,
      bookCardId: preview.bookCardId ?? null,
    };
  }

  try {
    const baseLlmCall = input.llmCall ?? await resolveLibraryLlmCall(input.profileId);
    let llmFailed = false;
    const trackedLlmCall = async (messages: ChatMessage[]) => {
      try {
        return await baseLlmCall(messages);
      } catch (error) {
        llmFailed = true;
        throw error;
      }
    };
    const generated = await generateBookCardForAuthor(
      authorCardId,
      [importRecord.id],
      { llmCall: trackedLlmCall },
    );
    if (llmFailed) {
      for (const bookCard of generated) {
        deleteBookCard(bookCard.id);
      }
      throw new Error("书级风格卡生成过程中发生 LLM 错误，已保留导入记录供稍后重试。");
    }
    const created = generated[0] ?? null;
    updateTextImportBookCardState({
      importId: importRecord.id,
      bookCardStatus: "completed",
      lastGenerationError: null,
    });
    updateAuthorBookImportPreview(preview.id, {
      status: "consumed",
      applyStatus: "completed",
      importId: importRecord.id,
      bookCardId: created?.id ?? null,
      lastError: null,
      consumedAt: preview.consumedAt ?? nowIso(),
    });
    return {
      status: "completed",
      previewId: preview.id,
      importId: importRecord.id,
      bookCardId: created?.id ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "书级风格卡生成失败";
    updateTextImportBookCardState({
      importId: importRecord.id,
      bookCardStatus: "failed",
      lastGenerationError: message,
    });
    updateAuthorBookImportPreview(preview.id, {
      status: "consumed",
      applyStatus: "imported",
      importId: importRecord.id,
      lastError: message,
      consumedAt: preview.consumedAt ?? nowIso(),
    });
    return {
      status: "imported",
      previewId: preview.id,
      importId: importRecord.id,
      bookCardId: null,
    };
  }
}

export async function createAuthorCardWithName(displayName: string) {
  const normalizedDisplayName = displayName.trim();
  if (!normalizedDisplayName) {
    throw new Error("作者名不能为空");
  }

  const normalizedName = normalizeAuthorCardName(normalizedDisplayName);
  if (!normalizedName) {
    throw new Error("作者名归一化后为空，无法创建作者卡。");
  }

  const existing = findAuthorCardsByNormalizedName(normalizedName)[0] ?? null;
  if (existing) {
    return {
      card: existing,
      created: false,
    };
  }

  const created = createAuthorCard({
    displayName: normalizedDisplayName,
    normalizedName,
  });
  if (!created) {
    throw new Error("作者卡创建失败");
  }

  await writeDbThenFile(
    () => created,
    async () => {
      await syncMirror(created.id);
    },
    (error) => warnAuthorCardMirrorFailure(created.id, "创建作者卡", error),
  );
  return {
    card: created,
    created: true,
  };
}

export async function importTextToAuthorCard(authorCardId: string, input: {
  fileName: string;
  buffer: Buffer;
  mediaType?: string;
  title?: string;
  author?: string;
}) {
  const card = getAuthorCard(authorCardId);
  if (!card) {
    throw notFound("作者卡不存在", { authorCardId });
  }

  const prepared = prepareStyleReferenceImport({
    buffer: input.buffer,
    fileName: input.fileName,
    mediaType: input.mediaType,
    title: input.title,
    author: input.author,
  });
  const importId = nanoid();
  const createdAt = nowIso();

  const saved = await writeFileThenDb(
    async () => {
      const written = await writeAuthorTextImportFiles({
        authorCardId,
        importId,
        originalFileName: prepared.originalFileName,
        title: prepared.title,
        rawBuffer: input.buffer,
        normalizedText: prepared.normalizedText,
      });
      return [written.rawPath, written.normalizedPath];
    },
    () => {
      const result = saveTextImport({
        id: importId,
        authorCardId,
        title: prepared.title,
        authorName: prepared.author ?? card.displayName,
        originalFileName: prepared.originalFileName,
        mediaType: prepared.mediaType,
        sourceHash: prepared.sourceHash,
        wordCount: prepared.wordCount,
        encoding: prepared.encoding,
        confidence: prepared.confidence,
        chapterCount: prepared.chapterCount,
        excerpts: prepared.excerpts,
        sourceKind: "plain_import",
        bookCardStatus: "idle",
        lastGenerationError: null,
        createdAt,
      });
      if (!result) {
        throw new Error("作者文本导入保存失败");
      }
      return result;
    },
  );
  if (!saved) {
    throw new Error("作者文本导入保存失败");
  }

  await writeDbThenFile(
    () => saved,
    async () => {
      await syncMirror(authorCardId);
    },
    (error) => warnAuthorCardMirrorFailure(authorCardId, "导入作者文本", error),
  );
  return saved;
}

export async function deleteAuthorTextImport(authorCardId: string, importId: string) {
  const existing = getTextImport(importId);
  if (!existing || existing.authorCardId !== authorCardId) {
    throw notFound("作者导入记录不存在", { authorCardId, importId });
  }

  await writeDbThenFile(
    () => {
      deleteTextImport(importId);
      return existing;
    },
    async () => {
      await Promise.all([
        rm(authorTextImportRawPath(authorCardId, existing.id, existing.originalFileName), { force: true }),
        rm(authorTextImportNormalizedPath(authorCardId, existing.id, existing.title), { force: true }),
      ]);
      await syncMirror(authorCardId);
    },
    (error) => warnAuthorCardMirrorFailure(authorCardId, "删除作者文本导入", error),
  );
}

export async function generateBookCardForAuthor(
  authorCardId: string,
  importIds: string[],
  options?: { llmCall?: (messages: ChatMessage[]) => Promise<string>; profileId?: string },
) {
  const card = getAuthorCard(authorCardId);
  if (!card) {
    throw notFound("作者卡不存在", { authorCardId });
  }
  if (!importIds.length) {
    throw new Error("至少选择一份导入文本来生成书级风格卡。");
  }

  const imports = getTextImportsByIds(importIds);
  if (imports.length !== importIds.length || imports.some((entry) => entry.authorCardId !== authorCardId)) {
    throw new Error("存在未找到或不属于当前作者的导入文本。");
  }

  const llmCall = options?.llmCall ?? await resolveLibraryLlmCall(options?.profileId);
  const existingCards = listBookCardsByAuthor(authorCardId);
  const createdBookCards: AuthorBookCardRecord[] = [];

  for (const importEntry of imports) {
    const duplicates = existingCards.filter((entry) =>
      entry.title === importEntry.title
      && entry.sourceFileName === importEntry.originalFileName
    );
    for (const duplicate of duplicates) {
      deleteBookCard(duplicate.id);
    }

    const importFingerprint = await resolveImportFingerprint(authorCardId, importEntry);

    const generated = await generateStyleCardFromExcerpts({
      mode: "book",
      imports: [{
        ...toImportGenerationSource(importEntry),
        normalizedText: importFingerprint.normalizedText,
        fingerprint: importFingerprint.fingerprint ?? null,
      }],
      llmCall,
    });
    const saved = createBookCard({
      authorCardId,
      title: importEntry.title,
      authorName: importEntry.authorName ?? card.displayName,
      styleCard: generated.styleCard,
      styleProfile: generated.styleProfile,
      styleDigest: generated.styleDigest,
      styleExemplars: generated.styleExemplars,
      sampledExcerpts: generated.sampledExcerpts,
      confidence: generated.confidence,
      fingerprint: generated.fingerprint ?? importFingerprint.fingerprint ?? null,
      fingerprintJson: JSON.stringify(generated.fingerprint ?? importFingerprint.fingerprint ?? {}),
      wordCount: importEntry.wordCount,
      chapterCount: importEntry.chapterCount,
      sourceFileName: importEntry.originalFileName,
    });
    if (!saved) {
      throw new Error("书级风格卡保存失败");
    }
    createdBookCards.push(saved);
  }

  await writeDbThenFile(
    () => createdBookCards,
    async () => {
      await syncMirror(authorCardId);
    },
    (error) => warnAuthorCardMirrorFailure(authorCardId, "生成书级风格卡", error),
  );
  return createdBookCards;
}

export async function mergeAuthorStyle(
  authorCardId: string,
  options?: { llmCall?: (messages: ChatMessage[]) => Promise<string>; profileId?: string },
) {
  const card = getAuthorCard(authorCardId);
  if (!card) {
    throw notFound("作者卡不存在", { authorCardId });
  }

  const bookCards = listBookCardsByAuthor(authorCardId);
  if (bookCards.length < 2) {
    throw new Error("至少两张书级风格卡才能合并作者风格。");
  }

  const llmCall = options?.llmCall ?? await resolveLibraryLlmCall(options?.profileId);
  const generated = await generateStyleCardFromExcerpts({
    mode: "author",
    imports: bookCards.map(toBookCardGenerationSource),
    llmCall,
  });

  const version = appendAuthorCardVersion({
    authorCardId,
    snapshot: {
      styleCard: generated.styleCard,
      styleProfile: generated.styleProfile,
      styleDigest: generated.styleDigest,
      styleExemplars: generated.styleExemplars,
      sampledExcerpts: generated.sampledExcerpts,
      confidence: generated.confidence,
    },
    sourceWorks: buildSourceWorksFromBookCards(bookCards),
  });
  if (!version) {
    throw new Error("作者风格合并失败");
  }

  await writeDbThenFile(
    () => version,
    async () => {
      await syncMirror(authorCardId);
    },
    (error) => warnAuthorCardMirrorFailure(authorCardId, "合并作者风格", error),
  );
  return version;
}

export async function syncAuthorCardFromProjectSnapshot(input: {
  projectId: string;
  snapshotId: string;
  authorName: string;
  conflictResolution?: AuthorCardConflictResolution;
  existingCardId?: string;
}): Promise<AuthorCardSyncResult> {
  const snapshot = getStyleCardSnapshot(input.projectId, input.snapshotId);
  if (!snapshot) {
    throw notFound("style snapshot 不存在", { snapshotId: input.snapshotId });
  }
  if (snapshot.mode !== "author") {
    return {
      status: "skipped",
      reason: "只有 author 模式的 snapshot 才会同步到全局作者卡库。",
    };
  }

  const displayName = input.authorName.trim();
  if (!displayName) {
    return {
      status: "skipped",
      reason: "缺少作者名，无法保存为全局作者卡。",
    };
  }

  const normalizedName = normalizeAuthorCardName(displayName);
  if (!normalizedName) {
    return {
      status: "skipped",
      reason: "作者名归一化后为空，无法保存为全局作者卡。",
    };
  }

  const candidates = findAuthorCardsByNormalizedName(normalizedName);
  const resolution = input.conflictResolution ?? "auto";
  const sourceWorks = buildSourceWorksFromProjectSnapshot(input.projectId, snapshot, displayName);

  if (!candidates.length) {
    const created = createAuthorCard({
      displayName,
      normalizedName,
    });
    if (!created) {
      throw new Error("作者卡创建失败");
    }
    const version = appendAuthorCardVersion({
      authorCardId: created.id,
      snapshot,
      sourceWorks,
    });
    await writeDbThenFile(
      () => version,
      async () => {
        await syncMirror(created.id);
      },
      (error) => warnAuthorCardMirrorFailure(created.id, "从项目快照创建作者卡", error),
    );
    return {
      status: "created",
      card: getAuthorCard(created.id)!,
      version,
    };
  }

  if (resolution === "cancel") {
    return { status: "cancelled" };
  }

  if (resolution === "auto") {
    return {
      status: "conflict",
      normalizedName,
      candidates,
    };
  }

  const targetCard = resolution === "merge_existing"
    ? (input.existingCardId ? getAuthorCard(input.existingCardId) : candidates[0] ?? null)
    : null;

  const targetId = resolution === "merge_existing"
    ? targetCard?.id
    : resolution === "create_independent"
      ? createAuthorCard({ displayName, normalizedName })?.id
      : null;

  if (!targetId) {
    throw notFound("作者卡归档目标不存在");
  }

  const version = appendAuthorCardVersion({
    authorCardId: targetId,
    snapshot,
    sourceWorks,
  });
  await writeDbThenFile(
    () => version,
    async () => {
      await syncMirror(targetId);
    },
    (error) => warnAuthorCardMirrorFailure(targetId, "同步项目快照到作者卡", error),
  );
  return {
    status: resolution === "merge_existing" ? "merged" : "created",
    card: getAuthorCard(targetId)!,
    version,
  };
}

export async function applyAuthorCardToProject(projectId: string, authorCardId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }

  const detail = getAuthorCardFullDetail(authorCardId);
  const latestVersion = detail.versions[0];
  if (!latestVersion) {
    throw notFound("作者卡还没有可用版本", { authorCardId });
  }

  const localSnapshot = createProjectSnapshotFromSource({
    projectId,
    mode: "author",
    source: latestVersion,
  });
  const saved = saveStyleCardSnapshot(localSnapshot);
  if (!saved) {
    throw new Error("项目本地 style snapshot 创建失败");
  }

  await writeStyleSnapshotFile(projectId, saved);
  const applied = await applyFoundationStyleSnapshot(projectId, saved.id);
  return {
    authorCard: detail.card,
    authorCardVersion: latestVersion,
    snapshot: saved,
    applied,
  };
}

export async function applyBookCardToProject(projectId: string, bookCardId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在", { projectId });
  }

  const bookCard = getBookCard(bookCardId);
  if (!bookCard) {
    throw notFound("书级风格卡不存在", { bookCardId });
  }

  const authorCard = getAuthorCard(bookCard.authorCardId);
  if (!authorCard) {
    throw notFound("书级风格卡所属作者不存在", { authorCardId: bookCard.authorCardId });
  }

  const localSnapshot = createProjectSnapshotFromSource({
    projectId,
    mode: "book",
    source: bookCard,
  });
  const saved = saveStyleCardSnapshot(localSnapshot);
  if (!saved) {
    throw new Error("项目本地 style snapshot 创建失败");
  }

  await writeStyleSnapshotFile(projectId, saved);
  const applied = await applyFoundationStyleSnapshot(projectId, saved.id);
  return {
    authorCard,
    bookCard,
    snapshot: saved,
    applied,
  };
}
