import "../server-only.ts";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative } from "node:path";

import { z } from "zod";

import {
  buildSourceHash,
  parseAuthorBookImportBuffer,
  type AuthorBookImportWarning,
} from "../author-book-import-parser.ts";
import { badRequest, conflict, internalError, isAppError, notFound } from "../errors.ts";
import {
  authorSubmissionPreviewDir,
  buildSingleSubmissionPreview,
  promoteAuthorSubmission,
} from "../files/author-submission-files.ts";
import { computeChapterContentHash, normalizeChapterContent } from "../files/commit-stage-files.ts";
import { projectDir } from "../paths.ts";
import { resolveProjectFilePath } from "../paths.ts";
import { createChapterSubmissionRepository } from "../repositories/chapter-submission.repository.ts";
import { getNextVersionNo, saveChapterVersion } from "../repositories/chapter.repository.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { assembleContextPack } from "../run/context-engine.ts";
import { quickAuditChapter } from "../run/chapter-audit.ts";
import { deepReviewChapter } from "../run/chapter-review.ts";
import { ensureAuthorReviewBlueprint } from "./author-review-blueprint.service.ts";
import { assertAuthorSubmissionMayCommit } from "../commit/author-submission-commit-guard.ts";
import { invalidateDurableCanonArtifacts } from "../commit/chapter-artifact-sync.ts";
import { createChapterCommitService } from "../commit/chapter-commit.service.ts";
import { createLauncherService } from "../run/launcher.service.ts";
import {
  commitStageDir,
  writeCommitStage,
  writeVersionFile,
} from "../project-files.ts";
import type {
  ChapterSubmissionRecord,
  SubmissionFilters,
} from "../types.ts";
import {
  authorSubmissionImportInputSchema,
  authorSubmissionPreviewInputSchema,
  projectIdSchema,
  reviseAuthorSubmissionInputSchema,
  submissionFiltersSchema,
} from "../validation.ts";

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const STAGED_CONTENT_FILE_PATTERN = /^chapter-\d+\.md$/u;
const AUTHOR_SUBMISSION_MAX_BYTES = 32 * 1024 * 1024;

const previewManifestChapterSchema = z.object({
  index: z.number().int().nonnegative(),
  chapterNo: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  contentFile: z.string().regex(STAGED_CONTENT_FILE_PATTERN),
  contentHash: z.string().regex(CONTENT_HASH_PATTERN),
}).strict();

const previewManifestSchema = z.object({
  version: z.literal(1),
  previewId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
  projectId: projectIdSchema,
  sourceFileName: z.string().min(1).max(255),
  sourceFileHash: z.string().regex(CONTENT_HASH_PATTERN),
  source: z.enum(["human", "codex", "import"]),
  chapterCount: z.number().int().positive(),
  createdAt: z.string().datetime(),
  chapters: z.array(previewManifestChapterSchema).min(1),
  integrity: z.string().regex(CONTENT_HASH_PATTERN),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.chapterCount !== manifest.chapters.length) {
    ctx.addIssue({ code: "custom", message: "预览章节数不一致" });
  }
  const indexes = manifest.chapters.map((chapter) => chapter.index);
  if (indexes.some((index, position) => index !== position)) {
    ctx.addIssue({ code: "custom", message: "预览章节顺序不一致" });
  }
});

export type AuthorSubmissionPreviewInput = z.input<typeof authorSubmissionPreviewInputSchema>;
export type AuthorSubmissionImportInput = z.input<typeof authorSubmissionImportInputSchema>;
export type ReviseAuthorSubmissionInput = z.input<typeof reviseAuthorSubmissionInputSchema>;

type AuthorSubmissionRepository = ReturnType<typeof createChapterSubmissionRepository>;
type PromoteAuthorSubmission = typeof promoteAuthorSubmission;

export interface AuthorSubmissionDependencies {
  repository: AuthorSubmissionRepository;
  promoteAuthorSubmission: PromoteAuthorSubmission;
  parseAuthorBookImportBuffer: typeof parseAuthorBookImportBuffer;
  buildSingleSubmissionPreview: typeof buildSingleSubmissionPreview;
  ensureAuthorReviewBlueprint: typeof ensureAuthorReviewBlueprint;
  assembleContextPack: typeof assembleContextPack;
  quickAuditChapter: typeof quickAuditChapter;
  deepReviewChapter: typeof deepReviewChapter;
}

export const defaultAuthorSubmissionDependencies: AuthorSubmissionDependencies = {
  repository: createChapterSubmissionRepository(),
  promoteAuthorSubmission,
  parseAuthorBookImportBuffer,
  buildSingleSubmissionPreview,
  ensureAuthorReviewBlueprint,
  assembleContextPack,
  quickAuditChapter,
  deepReviewChapter,
};

interface StagedChapter {
  index: number;
  chapterNo: number;
  title: string;
  content: string;
  contentFile: string;
  contentHash: string;
}

function normalizeSubmissionContent(content: string) {
  const normalized = normalizeChapterContent(content);
  if (Buffer.byteLength(normalized, "utf8") > AUTHOR_SUBMISSION_MAX_BYTES) {
    throw badRequest("作者稿正文不得超过 32MB");
  }
  return normalized;
}

function manifestIntegrity(manifest: Omit<z.infer<typeof previewManifestSchema>, "integrity">) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function safeSourceFileName(fileName: string) {
  return fileName.split(/[\\/]/u).filter(Boolean).pop()?.slice(0, 255) || "manuscript.txt";
}

function parseChineseChapterNumber(token: string) {
  const normalized = token.replace(/两/gu, "二").replace(/〇/gu, "零");
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let section = 0;
  let total = 0;
  let digit = 0;
  for (const character of normalized) {
    if (character in digits) {
      digit = digits[character]!;
      continue;
    }
    const unit = units[character];
    if (!unit) {
      return null;
    }
    if (unit === 10000) {
      total += (section + digit) * unit;
      section = 0;
      digit = 0;
    } else {
      section += (digit || 1) * unit;
      digit = 0;
    }
  }
  const value = total + section + digit;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseChapterNoFromTitle(title: string) {
  const normalized = title.trim();
  const chineseOrArabic = normalized.match(/^第([零一二三四五六七八九十百千万两〇0-9]+)(?:章|回|节|卷|集|部|篇)/u)?.[1];
  const english = normalized.match(/^(?:chapter|chap\.)\s*(\d+)\b/iu)?.[1];
  const leadingArabic = normalized.match(/^(\d+)(?:[.、\s]|$)/u)?.[1];
  const token = chineseOrArabic ?? english ?? leadingArabic;
  if (!token) {
    return null;
  }
  if (/^\d+$/u.test(token)) {
    const value = Number(token);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return parseChineseChapterNumber(token);
}

async function writePreviewManifest(input: {
  projectId: string;
  previewId: string;
  sourceFileName: string;
  sourceFileHash: string;
  source: "human" | "codex" | "import";
  chapters: StagedChapter[];
}) {
  const previewDir = authorSubmissionPreviewDir(input.projectId, input.previewId);
  await mkdir(previewDir, { recursive: true });
  try {
    for (const chapter of input.chapters) {
      await writeFile(`${previewDir}/${chapter.contentFile}`, chapter.content, { encoding: "utf8", flag: "wx" });
    }
    const unsignedManifest = {
      version: 1 as const,
      previewId: input.previewId,
      projectId: input.projectId,
      sourceFileName: input.sourceFileName,
      sourceFileHash: input.sourceFileHash,
      source: input.source,
      chapterCount: input.chapters.length,
      createdAt: new Date().toISOString(),
      chapters: input.chapters.map(({ index, chapterNo, title, contentFile, contentHash }) => ({
        index,
        chapterNo,
        title,
        contentFile,
        contentHash,
      })),
    };
    const manifest = {
      ...unsignedManifest,
      integrity: manifestIntegrity(unsignedManifest),
    };
    await writeFile(`${previewDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rm(previewDir, { recursive: true, force: true }).catch(() => undefined);
    if (isAppError(error)) {
      throw error;
    }
    throw internalError("作者稿预览文件处理失败");
  }
}

async function readPreviewManifest(projectId: string, previewId: string) {
  const previewDir = authorSubmissionPreviewDir(projectId, previewId);
  let raw: string;
  try {
    raw = await readFile(`${previewDir}/manifest.json`, "utf8");
  } catch {
    throw badRequest("作者稿预览不存在");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw badRequest("作者稿预览无效");
  }
  const result = previewManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw badRequest("作者稿预览无效");
  }
  const { integrity, ...unsignedManifest } = result.data;
  if (
    integrity !== manifestIntegrity(unsignedManifest)
    || result.data.projectId !== projectId
    || result.data.previewId !== previewId
  ) {
    throw conflict("作者稿预览清单已被篡改");
  }
  return { manifest: result.data, previewDir };
}

function resolveDependencies(deps?: Partial<AuthorSubmissionDependencies>): AuthorSubmissionDependencies {
  return {
    ...defaultAuthorSubmissionDependencies,
    ...deps,
  };
}

export async function previewAuthorSubmissions(
  projectId: string,
  input: AuthorSubmissionPreviewInput,
  dependencies?: Partial<AuthorSubmissionDependencies>,
) {
  const safeProjectId = projectIdSchema.parse(projectId);
  const parsedInput = authorSubmissionPreviewInputSchema.parse(input);
  const deps = resolveDependencies(dependencies);
  const previewId = `preview_${randomUUID().replace(/-/gu, "")}`;
  let sourceFileName: string;
  let sourceFileHash: string;
  let source: "human" | "codex" | "import";
  let parseConfidence: "low" | "medium" | "high";
  let warnings: AuthorBookImportWarning[];
  let chapters: StagedChapter[];

  if (parsedInput.kind === "single") {
    const preview = deps.buildSingleSubmissionPreview(parsedInput);
    sourceFileName = "single-submission.md";
    sourceFileHash = preview.sourceHash;
    source = parsedInput.source;
    parseConfidence = preview.parseConfidence;
    warnings = preview.warnings;
    chapters = preview.chapters.map((chapter, index) => ({
      index,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      content: normalizeSubmissionContent(chapter.content),
      contentFile: `chapter-${index}.md`,
      contentHash: computeChapterContentHash(chapter.content),
    }));
  } else {
    sourceFileHash = buildSourceHash(parsedInput.buffer);
    const preview = deps.parseAuthorBookImportBuffer({
      buffer: parsedInput.buffer,
      explicitEncoding: parsedInput.encoding,
      sourceHash: sourceFileHash,
    });
    if (preview.needsEncodingChoice) {
      return {
        needsEncodingChoice: true as const,
        encodingCandidates: preview.encodingCandidates,
        previewId: null,
        chapterCount: 0,
        parseConfidence: "low" as const,
        warnings: [],
        chapters: [],
      };
    }
    sourceFileName = safeSourceFileName(parsedInput.fileName);
    source = parsedInput.source;
    parseConfidence = preview.parseConfidence;
    warnings = preview.warnings;
    chapters = preview.chapters.map((chapter, index) => {
      const content = normalizeSubmissionContent(
        preview.normalizedText.slice(chapter.startOffset, chapter.endOffset),
      );
      return {
        index,
        chapterNo: parseChapterNoFromTitle(chapter.title) ?? parsedInput.startChapterNo + index,
        title: chapter.title,
        content,
        contentFile: `chapter-${index}.md`,
        contentHash: computeChapterContentHash(content),
      };
    });
  }

  await writePreviewManifest({
    projectId: safeProjectId,
    previewId,
    sourceFileName,
    sourceFileHash,
    source,
    chapters,
  });
  return {
    needsEncodingChoice: false as const,
    previewId,
    chapterCount: chapters.length,
    parseConfidence,
    warnings,
    chapters: chapters.map((chapter) => ({
      index: chapter.index,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
      characterCount: chapter.content.trimEnd().length,
      contentHash: chapter.contentHash,
    })),
  };
}

function safeChapterImportError(error: unknown) {
  if (isAppError(error)) {
    return { code: error.code, message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: "作者稿章节导入失败" };
}

export async function importAuthorSubmissions(
  projectId: string,
  input: AuthorSubmissionImportInput,
  dependencies?: Partial<AuthorSubmissionDependencies>,
) {
  const safeProjectId = projectIdSchema.parse(projectId);
  const parsedInput = authorSubmissionImportInputSchema.parse(input);
  const deps = resolveDependencies(dependencies);
  const { manifest, previewDir } = await readPreviewManifest(safeProjectId, parsedInput.previewId);
  const batch = deps.repository.createOrGetBatch({
    projectId: safeProjectId,
    sourceFileName: manifest.sourceFileName,
    sourceFileHash: manifest.sourceFileHash,
    chapterCount: manifest.chapterCount,
    status: "preview",
  });
  deps.repository.setBatchStatus(batch.id, "importing");

  const results: Array<{
    chapterNo: number;
    success: boolean;
    submission?: ChapterSubmissionRecord;
    error?: { code: string; message: string };
  }> = [];
  for (const chapter of manifest.chapters) {
    try {
      const promotedPath = await deps.promoteAuthorSubmission({
        projectId: safeProjectId,
        previewPath: `${previewDir}/${chapter.contentFile}`,
        chapterNo: chapter.chapterNo,
        contentHash: chapter.contentHash,
      });
      const contentPath = relative(projectDir(safeProjectId), promotedPath).replace(/\\/gu, "/");
      if (!contentPath || contentPath.startsWith("..")) {
        throw conflict("作者稿正式路径归属无效");
      }
      const submission = deps.repository.createOrGet({
        batchId: batch.id,
        projectId: safeProjectId,
        chapterNo: chapter.chapterNo,
        title: chapter.title,
        source: manifest.source,
        contentPath,
        contentHash: chapter.contentHash,
      });
      results.push({ chapterNo: chapter.chapterNo, success: true, submission });
    } catch (error) {
      results.push({ chapterNo: chapter.chapterNo, success: false, error: safeChapterImportError(error) });
    }
  }

  const successCount = results.filter((result) => result.success).length;
  const status = successCount === results.length
    ? "completed"
    : successCount === 0
      ? "failed"
      : "partial_failed";
  const completedBatch = deps.repository.setBatchStatus(batch.id, status);
  return { batch: completedBatch, results };
}

export async function reviseAuthorSubmission(
  projectId: string,
  submissionId: string,
  input: ReviseAuthorSubmissionInput,
  dependencies?: Partial<AuthorSubmissionDependencies>,
) {
  const safeProjectId = projectIdSchema.parse(projectId);
  const safeSubmissionId = z.string().trim().min(1, "submissionId 不能为空").parse(submissionId);
  const parsedInput = reviseAuthorSubmissionInputSchema.parse(input);
  const deps = resolveDependencies(dependencies);
  const parent = deps.repository.getById(safeSubmissionId);
  if (!parent || parent.projectId !== safeProjectId) {
    throw notFound("作者稿不存在或不属于当前项目");
  }

  const previewId = `revision_${randomUUID().replace(/-/gu, "")}`;
  const previewDir = authorSubmissionPreviewDir(safeProjectId, previewId);
  const previewPath = `${previewDir}/chapter-0.md`;
  const normalizedContent = normalizeSubmissionContent(parsedInput.content);
  const contentHash = computeChapterContentHash(normalizedContent);
  try {
    await mkdir(previewDir, { recursive: true });
    await writeFile(previewPath, normalizedContent, { encoding: "utf8", flag: "wx" });
    const promotedPath = await deps.promoteAuthorSubmission({
      projectId: safeProjectId,
      previewPath,
      chapterNo: parent.chapterNo,
      contentHash,
    });
    const contentPath = relative(projectDir(safeProjectId), promotedPath).replace(/\\/gu, "/");
    return deps.repository.createRevision({
      parentSubmissionId: parent.id,
      title: parsedInput.title,
      source: parsedInput.source,
      contentPath,
      contentHash,
    });
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    throw internalError("作者稿修订文件处理失败");
  }
}

async function readSubmissionContent(submission: ChapterSubmissionRecord) {
  const safePath = resolveProjectFilePath(submission.projectId, submission.contentPath, ["author-submissions"]);
  const content = normalizeSubmissionContent(await readFile(safePath, "utf8"));
  if (computeChapterContentHash(content) !== submission.contentHash) {
    throw conflict("作者稿正文哈希与提交记录不一致");
  }
  return content;
}

export async function reviewAuthorSubmission(
  projectId: string,
  submissionId: string,
  dependencies?: Partial<AuthorSubmissionDependencies>,
) {
  const safeProjectId = projectIdSchema.parse(projectId);
  const safeSubmissionId = z.string().trim().min(1).parse(submissionId);
  const deps = resolveDependencies(dependencies);
  let submission = deps.repository.getById(safeSubmissionId);
  if (!submission || submission.projectId !== safeProjectId) throw notFound("作者稿不存在或不属于当前项目");
  if (submission.status === "committed") throw conflict("作者稿已经提交，不能重复审查");
  if (submission.status === "draft" || submission.status === "failed" || submission.status === "needs_revision") {
    submission = deps.repository.transition(submission.id, "queued");
  }
  if (submission.status === "queued") submission = deps.repository.transition(submission.id, "reviewing");
  if (submission.status !== "reviewing") throw conflict("作者稿当前状态不能审查");

  const content = await readSubmissionContent(submission);
  try {
    await deps.ensureAuthorReviewBlueprint(safeProjectId, {
      chapterNo: submission.chapterNo,
      title: submission.title,
      content,
    });
    const contextPack = await deps.assembleContextPack(safeProjectId, submission.chapterNo);
    const lineage = {
      submissionId: submission.id,
      versionId: null,
      contentHash: submission.contentHash,
    };
    const quick = await deps.quickAuditChapter(
      safeProjectId,
      submission.chapterNo,
      content,
      0,
      contextPack,
      null,
      undefined,
      lineage,
    );
    const deep = await deps.deepReviewChapter(
      safeProjectId,
      submission.chapterNo,
      content,
      0,
      quick.triggerReasons,
      contextPack,
      quick.localFlavorSignals ?? null,
      undefined,
      lineage,
    );
    const nextStatus = deep.verdict === "pass" ? "approved" : "needs_revision";
    submission = deps.repository.transition(submission.id, nextStatus);
    return { submission, quick, deep };
  } catch (error) {
    deps.repository.transition(submission.id, "failed");
    throw error;
  }
}

export async function approveAuthorSubmission(
  projectId: string,
  submissionId: string,
  input?: { humanOverride?: boolean; overrideReason?: string },
  dependencies?: Partial<AuthorSubmissionDependencies>,
) {
  const safeProjectId = projectIdSchema.parse(projectId);
  const safeSubmissionId = z.string().trim().min(1).parse(submissionId);
  const deps = resolveDependencies(dependencies);
  assertAuthorSubmissionMayCommit(safeProjectId);
  let submission = deps.repository.getById(safeSubmissionId);
  if (!submission || submission.projectId !== safeProjectId) throw notFound("作者稿不存在或不属于当前项目");
  const resyncRequested = submission.status === "committed";
  if (submission.status !== "approved" && submission.status !== "committed") {
    if (!input?.humanOverride || !input.overrideReason?.trim()) {
      throw conflict("作者稿尚未通过审查；如需强制提交，必须填写人工覆盖原因");
    }
    submission = deps.repository.approveWithOverride(submission.id);
    appendRunLog(safeProjectId, "warning", `第 ${submission.chapterNo} 章作者稿由人工覆盖审查：${input.overrideReason.trim()}`);
  }

  const content = await readSubmissionContent(submission);
  let versionId = submission.committedVersionId;
  if (!versionId) {
    const versionNo = getNextVersionNo(safeProjectId, submission.chapterNo);
    const versionPath = await writeVersionFile(safeProjectId, submission.chapterNo, versionNo, content);
    versionId = saveChapterVersion({
      projectId: safeProjectId,
      chapterNo: submission.chapterNo,
      versionNo,
      temperature: 0,
      path: versionPath,
      excerpt: content.slice(0, 180),
      selected: false,
      source: "author_submission",
    });
  }

  const normalizedContent = content.trimEnd() + "\n";
  const stageDir = commitStageDir(safeProjectId, `author-submission-${submission.id}-${versionId}`);
  const manifest = await writeCommitStage(stageDir, [{
    relativePath: `chapters/chapter_${String(submission.chapterNo).padStart(3, "0")}.md`,
    content: normalizedContent,
  }]);
  const commitService = createChapterCommitService({
    createOutboxPayload: (commit) => JSON.stringify({
      commitId: commit.commitId,
      projectId: commit.projectId,
      chapterNo: commit.chapterNo,
      reviewStatus: "deep_locked",
    }),
  });
  const prepared = await commitService.prepareCommit({
    projectId: safeProjectId,
    chapterNo: submission.chapterNo,
    sessionId: null,
    sourceKind: "workshop",
    acceptedVersionId: versionId,
    idempotencyKey: `${safeProjectId}:${submission.chapterNo}:${versionId}:author-submission:${submission.id}`,
    manifest,
    stageDir,
    contentHash: submission.contentHash,
  });
  if (prepared.state !== "committed") {
    await commitService.applyStagedFiles(prepared.commitId);
    await commitService.markFsApplied(prepared.commitId);
  }
  if (resyncRequested) {
    await invalidateDurableCanonArtifacts(safeProjectId, submission.chapterNo);
  }
  await commitService.finalizeCommit(prepared.commitId);
  submission = deps.repository.attachCommittedVersion(submission.id, versionId);
  if (process.env.AINOVEL_DISABLE_DETACHED_WORKERS !== "1") {
    createLauncherService().spawnCommitReconciler();
  }
  appendRunLog(safeProjectId, "info", `第 ${submission.chapterNo} 章作者稿已提交，生成写作调用为 0`);
  return { submission, versionId, commitId: prepared.commitId };
}

export function createAuthorSubmissionService(deps?: Partial<AuthorSubmissionDependencies>) {
  const resolvedDeps = resolveDependencies(deps);
  const repository = resolvedDeps.repository;
  return {
    preview: (projectId: string, input: AuthorSubmissionPreviewInput) => previewAuthorSubmissions(projectId, input, resolvedDeps),
    importPreview: (projectId: string, input: AuthorSubmissionImportInput) => importAuthorSubmissions(projectId, input, resolvedDeps),
    list: (projectId: string, filters?: SubmissionFilters) => repository.listByProject(
      projectIdSchema.parse(projectId),
      submissionFiltersSchema.parse(filters ?? {}),
    ),
    revise: (projectId: string, submissionId: string, input: ReviseAuthorSubmissionInput) => reviseAuthorSubmission(projectId, submissionId, input, resolvedDeps),
    review: (projectId: string, submissionId: string) => reviewAuthorSubmission(projectId, submissionId, resolvedDeps),
    approve: (projectId: string, submissionId: string, input?: { humanOverride?: boolean; overrideReason?: string }) => approveAuthorSubmission(projectId, submissionId, input, resolvedDeps),
  };
}
