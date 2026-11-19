import "../server-only.ts";

import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname } from "node:path";

import { badRequest, conflict, internalError, isAppError } from "../errors.ts";
import { resolveProjectFilePath, withinProject } from "../paths.ts";
import { wordCount } from "../utils.ts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PREVIEW_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const AUTHOR_SUBMISSION_MAX_BYTES = 32 * 1024 * 1024;
const AUTHOR_SUBMISSION_MAX_TITLE_CHARS = 200;
const AUTHOR_SUBMISSION_READ_CHUNK_BYTES = 64 * 1024;
const SHORT_CHAPTER_WORDS = 800;
const LONG_CHAPTER_WORDS = 6000;
const PREVIEW_SUMMARY_LIMIT = 120;

export interface SingleAuthorSubmissionPreviewChapter {
  chapterNo: number;
  chapterNumber: number;
  title: string;
  content: string;
  characterCount: number;
  wordCount: number;
  summary: string;
  startOffset: number;
  endOffset: number;
}

export interface SingleAuthorSubmissionPreview {
  needsEncodingChoice: false;
  encoding: "utf-8";
  parseConfidence: "high";
  parserMode: "single_submission";
  normalizedText: string;
  wordCount: number;
  characterCount: number;
  chapterCount: 1;
  warnings: Array<{
    code: string;
    message: string;
    level: "info" | "warning";
  }>;
  chapters: [SingleAuthorSubmissionPreviewChapter];
  samplePlan: {
    indexes: [0];
    skippedShort: number[];
    total: 1;
  };
  sourceHash: string;
}

function assertChapterNo(chapterNo: number) {
  if (!Number.isSafeInteger(chapterNo) || chapterNo <= 0) {
    throw badRequest("chapterNo 必须是正整数");
  }
  return chapterNo;
}

function assertContentHash(contentHash: string) {
  if (typeof contentHash !== "string" || !SHA256_PATTERN.test(contentHash)) {
    throw badRequest("contentHash 必须是小写 SHA-256 内容哈希");
  }
  return contentHash;
}

function assertContentSize(size: number | bigint) {
  const normalizedSize = typeof size === "bigint" ? size : BigInt(size);
  if (normalizedSize > BigInt(AUTHOR_SUBMISSION_MAX_BYTES)) {
    throw badRequest("作者稿正文不得超过 32MB");
  }
}

function hashContent(content: string | Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

function summarize(content: string) {
  const compact = content.replace(/\s+/gu, " ").trim();
  return compact.length <= PREVIEW_SUMMARY_LIMIT
    ? compact
    : `${compact.slice(0, PREVIEW_SUMMARY_LIMIT - 1)}…`;
}

function buildSingleWarnings(input: {
  chapterNo: number;
  title: string;
  wordCount: number;
}) {
  const warnings: SingleAuthorSubmissionPreview["warnings"] = [];
  if (input.wordCount < SHORT_CHAPTER_WORDS) {
    warnings.push({
      code: "chapter_too_short",
      message: `第${input.chapterNo}章《${input.title}》偏短，可能影响审校质量。`,
      level: "warning",
    });
  }
  if (input.wordCount > LONG_CHAPTER_WORDS) {
    warnings.push({
      code: "chapter_too_long",
      message: `第${input.chapterNo}章《${input.title}》偏长，建议确认是否需要拆章。`,
      level: "info",
    });
  }
  return warnings;
}

export function buildSingleSubmissionPreview(input: {
  chapterNo: number;
  title: string;
  content: string;
}): SingleAuthorSubmissionPreview {
  const chapterNo = assertChapterNo(input.chapterNo);
  const title = input.title.trim();
  if (!title) {
    throw badRequest("作者稿标题不能为空");
  }
  if (title.length > AUTHOR_SUBMISSION_MAX_TITLE_CHARS) {
    throw badRequest("作者稿标题不得超过 200 个字符");
  }
  if (!input.content.trim()) {
    throw badRequest("作者稿正文不能为空");
  }
  assertContentSize(Buffer.byteLength(input.content, "utf8"));

  const content = input.content;
  const contentWordCount = wordCount(content);
  const characterCount = content.length;
  const chapter: SingleAuthorSubmissionPreviewChapter = {
    chapterNo,
    chapterNumber: chapterNo,
    title,
    content,
    characterCount,
    wordCount: contentWordCount,
    summary: summarize(content),
    startOffset: 0,
    endOffset: content.length,
  };

  return {
    needsEncodingChoice: false,
    encoding: "utf-8",
    parseConfidence: "high",
    parserMode: "single_submission",
    normalizedText: content,
    wordCount: contentWordCount,
    characterCount,
    chapterCount: 1,
    warnings: buildSingleWarnings({ chapterNo, title, wordCount: contentWordCount }),
    chapters: [chapter],
    samplePlan: {
      indexes: [0],
      skippedShort: contentWordCount < SHORT_CHAPTER_WORDS ? [0] : [],
      total: 1,
    },
    sourceHash: hashContent(content),
  };
}

export function authorSubmissionPreviewDir(projectId: string, previewId: string) {
  if (typeof previewId !== "string" || !PREVIEW_ID_PATTERN.test(previewId)) {
    throw badRequest("previewId 预览标识不合法");
  }
  return withinProject(projectId, ".staging", "author-submissions", previewId);
}

export function authorSubmissionContentPath(projectId: string, chapterNo: number, contentHash: string) {
  const safeChapterNo = assertChapterNo(chapterNo);
  const safeContentHash = assertContentHash(contentHash);
  const chapter = String(safeChapterNo).padStart(3, "0");
  return withinProject(
    projectId,
    "author-submissions",
    `chapter_${chapter}_${safeContentHash.slice(0, 12)}.md`,
  );
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

interface FileIdentity {
  dev: number | bigint;
  ino: number | bigint;
  birthtimeMs: number | bigint;
}

interface OpenFileSnapshot {
  buffer: Buffer;
  handle: FileHandle;
  identity: FileIdentity;
}

interface ProjectFileBoundary {
  projectId: string;
  allowedSubdirs: string[];
}

export interface AuthorSubmissionFileOperations {
  link: typeof link;
  lstat: typeof lstat;
  mkdir: typeof mkdir;
  open: typeof open;
  unlink: typeof unlink;
}

const defaultFileOperations: AuthorSubmissionFileOperations = {
  link,
  lstat,
  mkdir,
  open,
  unlink,
};

function fileIdentity(stats: Awaited<ReturnType<FileHandle["stat"]>>): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    birthtimeMs: stats.birthtimeMs,
  };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs;
}

async function readFileBounded(handle: FileHandle) {
  const chunks: Buffer[] = [];
  let position = 0;
  while (position <= AUTHOR_SUBMISSION_MAX_BYTES) {
    const remaining = AUTHOR_SUBMISSION_MAX_BYTES + 1 - position;
    const chunk = Buffer.allocUnsafe(Math.min(AUTHOR_SUBMISSION_READ_CHUNK_BYTES, remaining));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
    if (bytesRead === 0) {
      break;
    }
    position += bytesRead;
    if (position > AUTHOR_SUBMISSION_MAX_BYTES) {
      throw badRequest("作者稿正文不得超过 32MB");
    }
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
  }
  return Buffer.concat(chunks, position);
}

async function assertOpenFileWithinBoundary(input: {
  path: string;
  handleIdentity: FileIdentity;
  boundary: ProjectFileBoundary;
  fileOperations: AuthorSubmissionFileOperations;
}) {
  try {
    resolveProjectFilePath(
      input.boundary.projectId,
      input.path,
      input.boundary.allowedSubdirs,
    );
  } catch {
    throw conflict("作者稿文件归属已发生变化");
  }
  const currentStats = await input.fileOperations.lstat(input.path);
  assertContentSize(currentStats.size);
  if (
    currentStats.isSymbolicLink()
    || !currentStats.isFile()
    || !sameFileIdentity(fileIdentity(currentStats), input.handleIdentity)
  ) {
    throw conflict("作者稿文件归属已发生变化");
  }
}

async function openRegularFileSnapshot(
  path: string,
  fileOperations: AuthorSubmissionFileOperations,
  boundary?: ProjectFileBoundary,
): Promise<OpenFileSnapshot | null> {
  let pathStats: Awaited<ReturnType<typeof lstat>>;
  try {
    pathStats = await fileOperations.lstat(path);
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
      throw badRequest("作者稿预览路径必须指向普通文件");
    }
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }

  let handle: FileHandle;
  try {
    handle = await fileOperations.open(path, "r");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }

  try {
    const handleStats = await handle.stat();
    const pathIdentity = fileIdentity(pathStats);
    const handleIdentity = fileIdentity(handleStats);
    if (!handleStats.isFile() || !sameFileIdentity(pathIdentity, handleIdentity)) {
      throw conflict("作者稿文件在读取前已发生变化");
    }
    assertContentSize(handleStats.size);
    if (boundary) {
      await assertOpenFileWithinBoundary({
        path,
        handleIdentity,
        boundary,
        fileOperations,
      });
    }
    const buffer = await readFileBounded(handle);
    assertContentSize((await handle.stat()).size);
    if (boundary) {
      await assertOpenFileWithinBoundary({
        path,
        handleIdentity,
        boundary,
        fileOperations,
      });
    }
    return {
      buffer,
      handle,
      identity: handleIdentity,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function closeSnapshot(snapshot: OpenFileSnapshot | null) {
  if (snapshot) {
    await snapshot.handle.close().catch(() => undefined);
  }
}

async function readRegularFileHash(
  path: string,
  fileOperations: AuthorSubmissionFileOperations,
  boundary?: ProjectFileBoundary,
) {
  const snapshot = await openRegularFileSnapshot(path, fileOperations, boundary);
  try {
    return snapshot ? hashContent(snapshot.buffer) : null;
  } finally {
    await closeSnapshot(snapshot);
  }
}

async function unlinkOwnedFileIfStillWithinBoundary(input: {
  path: string;
  identity: FileIdentity;
  boundary: ProjectFileBoundary;
  fileOperations: AuthorSubmissionFileOperations;
}) {
  try {
    resolveProjectFilePath(
      input.boundary.projectId,
      input.path,
      input.boundary.allowedSubdirs,
    );
    const stats = await input.fileOperations.lstat(input.path);
    if (
      stats.isFile()
      && !stats.isSymbolicLink()
      && sameFileIdentity(fileIdentity(stats), input.identity)
    ) {
      await input.fileOperations.unlink(input.path);
    }
  } catch {
    // A cleanup path that changed ownership is intentionally retained.
  }
}

async function publishSnapshotExclusive(input: {
  projectId: string;
  target: string;
  buffer: Buffer;
  expectedHash: string;
  fileOperations: AuthorSubmissionFileOperations;
}) {
  const authorBoundary: ProjectFileBoundary = {
    projectId: input.projectId,
    allowedSubdirs: ["author-submissions"],
  };
  await input.fileOperations.mkdir(dirname(input.target), { recursive: true });
  const temporaryPath = withinProject(
    input.projectId,
    "author-submissions",
    `.publish-${randomUUID()}.tmp`,
  );
  let temporaryHandle: FileHandle | null = null;
  let temporaryIdentity: FileIdentity | null = null;

  try {
    temporaryHandle = await input.fileOperations.open(temporaryPath, "wx", 0o600);
    temporaryIdentity = fileIdentity(await temporaryHandle.stat());
    await assertOpenFileWithinBoundary({
      path: temporaryPath,
      handleIdentity: temporaryIdentity,
      boundary: authorBoundary,
      fileOperations: input.fileOperations,
    });
    await temporaryHandle.writeFile(input.buffer);
    await temporaryHandle.sync();
    await assertOpenFileWithinBoundary({
      path: temporaryPath,
      handleIdentity: temporaryIdentity,
      boundary: authorBoundary,
      fileOperations: input.fileOperations,
    });
    await temporaryHandle.close();
    temporaryHandle = null;

    try {
      await input.fileOperations.link(temporaryPath, input.target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const existingHash = await readRegularFileHash(
        input.target,
        input.fileOperations,
        authorBoundary,
      );
      if (existingHash === input.expectedHash) {
        return;
      }
      throw conflict("不可变作者稿目标已存在不同内容");
    }

    const publishedSnapshot = await openRegularFileSnapshot(
      input.target,
      input.fileOperations,
      authorBoundary,
    );
    try {
      if (!publishedSnapshot || hashContent(publishedSnapshot.buffer) !== input.expectedHash) {
        if (
          publishedSnapshot
          && temporaryIdentity
          && sameFileIdentity(publishedSnapshot.identity, temporaryIdentity)
        ) {
          await unlinkOwnedFileIfStillWithinBoundary({
            path: input.target,
            identity: publishedSnapshot.identity,
            boundary: authorBoundary,
            fileOperations: input.fileOperations,
          });
        }
        throw conflict("作者稿发布后完整性校验失败");
      }
    } finally {
      await closeSnapshot(publishedSnapshot);
    }
  } finally {
    await temporaryHandle?.close().catch(() => undefined);
    if (temporaryIdentity) {
      await unlinkOwnedFileIfStillWithinBoundary({
        path: temporaryPath,
        identity: temporaryIdentity,
        boundary: authorBoundary,
        fileOperations: input.fileOperations,
      });
    }
  }
}

async function promoteAuthorSubmissionWithFileOperations(input: {
  projectId: string;
  previewPath: string;
  chapterNo: number;
  contentHash: string;
}, fileOperations: AuthorSubmissionFileOperations) {
  const expectedHash = assertContentHash(input.contentHash);
  const target = authorSubmissionContentPath(input.projectId, input.chapterNo, expectedHash);
  let previewPath: string;
  try {
    previewPath = resolveProjectFilePath(
      input.projectId,
      input.previewPath,
      [".staging/author-submissions"],
    );
  } catch {
    throw badRequest("作者稿预览路径不合法");
  }

  const authorBoundary: ProjectFileBoundary = {
    projectId: input.projectId,
    allowedSubdirs: ["author-submissions"],
  };
  const stagingBoundary: ProjectFileBoundary = {
    projectId: input.projectId,
    allowedSubdirs: [".staging/author-submissions"],
  };

  const targetHash = await readRegularFileHash(target, fileOperations, authorBoundary);
  if (targetHash !== null) {
    if (targetHash !== expectedHash) {
      throw conflict("不可变作者稿目标已存在不同内容");
    }
    return target;
  }

  const sourceSnapshot = await openRegularFileSnapshot(
    previewPath,
    fileOperations,
    stagingBoundary,
  );
  if (!sourceSnapshot) {
    throw badRequest("作者稿预览文件不存在");
  }
  try {
    if (hashContent(sourceSnapshot.buffer) !== expectedHash) {
      throw conflict("作者稿预览内容哈希冲突");
    }
    await publishSnapshotExclusive({
      projectId: input.projectId,
      target,
      buffer: sourceSnapshot.buffer,
      expectedHash,
      fileOperations,
    });
  } finally {
    await closeSnapshot(sourceSnapshot);
  }
  return target;
}

export function createAuthorSubmissionFileStore(
  fileOperations: Partial<AuthorSubmissionFileOperations> = {},
) {
  const resolvedFileOperations: AuthorSubmissionFileOperations = {
    ...defaultFileOperations,
    ...fileOperations,
  };
  return {
    promoteAuthorSubmission: async (input: {
      projectId: string;
      previewPath: string;
      chapterNo: number;
      contentHash: string;
    }) => {
      try {
        return await promoteAuthorSubmissionWithFileOperations(input, resolvedFileOperations);
      } catch (error) {
        if (isAppError(error)) {
          throw error;
        }
        throw internalError("作者稿文件处理失败");
      }
    },
  };
}

const defaultAuthorSubmissionFileStore = createAuthorSubmissionFileStore();

export async function promoteAuthorSubmission(input: {
  projectId: string;
  previewPath: string;
  chapterNo: number;
  contentHash: string;
}) {
  return defaultAuthorSubmissionFileStore.promoteAuthorSubmission(input);
}
