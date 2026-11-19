import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

interface AuthorSubmissionModule {
  authorSubmissionPreviewDir(projectId: string, previewId: string): string;
  authorSubmissionContentPath(projectId: string, chapterNo: number, contentHash: string): string;
  buildSingleSubmissionPreview(input: {
    chapterNo: number;
    title: string;
    content: string;
  }): {
    chapterCount: number;
    characterCount: number;
    warnings: Array<{ code: string; message: string; level: "info" | "warning" }>;
    chapters: Array<{
      chapterNo: number;
      chapterNumber: number;
      title: string;
      content: string;
      characterCount: number;
    }>;
  };
  ensureProjectLayout(projectId: string): Promise<void>;
  promoteAuthorSubmission(input: {
    projectId: string;
    previewPath: string;
    chapterNo: number;
    contentHash: string;
  }): Promise<string>;
}

interface AuthorSubmissionFileInternals {
  createAuthorSubmissionFileStore(fileOps?: {
    link?: typeof link;
    lstat?: typeof lstat;
    open?: typeof open;
  }): {
    promoteAuthorSubmission(input: {
      projectId: string;
      previewPath: string;
      chapterNo: number;
      contentHash: string;
    }): Promise<string>;
  };
}

const originalAppRoot = process.env.AINOVEL_APP_ROOT;
const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-author-submission-"));
process.env.AINOVEL_APP_ROOT = tempRoot;
await cp(join(process.cwd(), "migrations"), join(tempRoot, "migrations"), { recursive: true });

const projectFiles = await import("./project-files.ts") as unknown as AuthorSubmissionModule;
const authorSubmissionFileInternals = await import("./files/author-submission-files.ts") as unknown as AuthorSubmissionFileInternals;
const { runMigrations } = await import("./db/migration-runner.ts");
const paths = await import("./paths.ts");
const { buildSingleSubmissionPreview } = projectFiles;
const AUTHOR_SUBMISSION_MAX_BYTES = 32 * 1024 * 1024;
let defaultSubmissionDb: Database.Database | undefined;

async function loadAuthorSubmissionService() {
  const [authorSubmissionServiceModule, repositoryModule, dbModule] = await Promise.all([
    import("./services/author-submission.service.ts"),
    import("./repositories/chapter-submission.repository.ts"),
    import("./db/client.ts"),
  ]);
  defaultSubmissionDb = dbModule.rawDb;
  return {
    authorSubmissionServiceModule,
    createChapterSubmissionRepository: repositoryModule.createChapterSubmissionRepository,
  };
}

test.after(async () => {
  if (defaultSubmissionDb?.open) {
    defaultSubmissionDb.close();
  }
  if (originalAppRoot === undefined) {
    delete process.env.AINOVEL_APP_ROOT;
  } else {
    process.env.AINOVEL_APP_ROOT = originalAppRoot;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function createProjectId(label: string) {
  return `author-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createSubmissionDb() {
  const db = new Database(":memory:");
  runMigrations(db, readMigrationFiles({ migrationsFolder: join(process.cwd(), "migrations") }));
  return db;
}

function countRows(db: Database.Database, table: "chapter_submissions" | "chapter_submission_batches") {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

test("single pasted chapter remains one submission", () => {
  const result = buildSingleSubmissionPreview({ chapterNo: 7, title: "雨夜遗物", content: "正文".repeat(1200) });
  assert.equal(result.chapters.length, 1);
  assert.equal(result.chapters[0]?.chapterNo, 7);
});

test("single pasted preview preserves title, content, character count, and warnings without writing files", () => {
  const content = "雨落在旧伞上。";
  const result = projectFiles.buildSingleSubmissionPreview({
    chapterNo: 12,
    title: " 灯下旧信 ",
    content,
  });

  assert.equal(result.chapterCount, 1);
  assert.equal(result.characterCount, content.length);
  assert.equal(result.chapters[0]?.chapterNumber, 12);
  assert.equal(result.chapters[0]?.title, "灯下旧信");
  assert.equal(result.chapters[0]?.content, content);
  assert.equal(result.chapters[0]?.characterCount, content.length);
  assert.equal(result.warnings.some((warning) => warning.code === "chapter_too_short"), true);
  assert.equal(existsSync(join(tempRoot, "projects")), false);
  assert.equal(existsSync(join(tempRoot, "data", "app.db")), false);
});

test("single pasted preview rejects oversized content and titles", () => {
  assert.throws(
    () => projectFiles.buildSingleSubmissionPreview({
      chapterNo: 1,
      title: "第一章",
      content: "a".repeat(AUTHOR_SUBMISSION_MAX_BYTES + 1),
    }),
    /32MB|过大|字节/u,
  );
  assert.throws(
    () => projectFiles.buildSingleSubmissionPreview({
      chapterNo: 1,
      title: "题".repeat(201),
      content: "正文",
    }),
    /标题|200/u,
  );
});

test("ensureProjectLayout creates immutable author submission and staging directories", async () => {
  const projectId = createProjectId("layout");
  await projectFiles.ensureProjectLayout(projectId);

  assert.equal(existsSync(paths.withinProject(projectId, "author-submissions")), true);
  assert.equal(existsSync(paths.withinProject(projectId, ".staging", "author-submissions")), true);
});

test("author submission paths reject traversal-shaped user file names and invalid identities", () => {
  const projectId = createProjectId("paths");
  const projectRoot = paths.projectDir(projectId);
  const safePreview = projectFiles.authorSubmissionPreviewDir(projectId, "preview_7-safe");
  const safeTarget = projectFiles.authorSubmissionContentPath(projectId, 7, "a".repeat(64));

  assert.equal(relative(projectRoot, safePreview).replace(/\\/gu, "/"), ".staging/author-submissions/preview_7-safe");
  assert.equal(relative(projectRoot, safeTarget).replace(/\\/gu, "/"), "author-submissions/chapter_007_aaaaaaaaaaaa.md");
  assert.equal(safePreview.includes("book.md"), false);
  assert.throws(
    () => projectFiles.authorSubmissionPreviewDir(projectId, "../../outside/book.md"),
    /previewId|预览标识/u,
  );
  assert.throws(
    () => projectFiles.authorSubmissionPreviewDir(projectId, "..\\..\\outside\\book.md"),
    /previewId|预览标识/u,
  );
  assert.throws(
    () => projectFiles.authorSubmissionPreviewDir("../../outside", "preview-safe"),
    /projectId|项目/u,
  );
  assert.throws(
    () => projectFiles.authorSubmissionContentPath(projectId, Number.NaN, "a".repeat(64)),
    /chapterNo|章节号/u,
  );
  assert.throws(
    () => projectFiles.authorSubmissionContentPath(projectId, 7, "../../outside.md"),
    /contentHash|内容哈希/u,
  );
});

test("promoteAuthorSubmission accepts a relative in-project stage path and is idempotent", async () => {
  const projectId = createProjectId("promote");
  await projectFiles.ensureProjectLayout(projectId);
  const previewDir = projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe");
  const previewPath = join(previewDir, "chapter.md");
  const content = "第七章 雨夜遗物\n\n雨水沿着纸伞骨一滴滴落下。\n";
  const contentHash = hashContent(content);
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, content, "utf8");

  const relativePreviewPath = relative(paths.projectDir(projectId), previewPath);
  const target = await projectFiles.promoteAuthorSubmission({
    projectId,
    previewPath: relativePreviewPath,
    chapterNo: 7,
    contentHash,
  });

  assert.equal(target, projectFiles.authorSubmissionContentPath(projectId, 7, contentHash));
  assert.equal(await readFile(target, "utf8"), content);
  assert.equal(await readFile(previewPath, "utf8"), content);
  assert.equal(
    await projectFiles.promoteAuthorSubmission({
      projectId,
      previewPath: relativePreviewPath,
      chapterNo: 7,
      contentHash,
    }),
    target,
  );
});

test("promoteAuthorSubmission rejects hash mismatches before moving preview content", async () => {
  const projectId = createProjectId("hash-mismatch");
  await projectFiles.ensureProjectLayout(projectId);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, "实际正文", "utf8");

  await assert.rejects(
    projectFiles.promoteAuthorSubmission({
      projectId,
      previewPath,
      chapterNo: 7,
      contentHash: hashContent("另一份正文"),
    }),
    /哈希|hash/iu,
  );
  assert.equal(await readFile(previewPath, "utf8"), "实际正文");
});

test("promoteAuthorSubmission rejects an oversized staging file before reading it", async () => {
  const projectId = createProjectId("oversized-stage");
  await projectFiles.ensureProjectLayout(projectId);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  await mkdir(dirname(previewPath), { recursive: true });
  const handle = await open(previewPath, "w");
  try {
    await handle.truncate(AUTHOR_SUBMISSION_MAX_BYTES + 1);
  } finally {
    await handle.close();
  }

  await assert.rejects(
    projectFiles.promoteAuthorSubmission({
      projectId,
      previewPath,
      chapterNo: 7,
      contentHash: "a".repeat(64),
    }),
    /32MB|过大|字节/u,
  );
});

test("promoteAuthorSubmission bounds a staging file that grows after the first stat", async () => {
  const projectId = createProjectId("growing-stage");
  await projectFiles.ensureProjectLayout(projectId);
  const content = "初次 stat 时仍然很小的正文";
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, content, "utf8");
  let previewLstatCount = 0;
  const fileStore = authorSubmissionFileInternals.createAuthorSubmissionFileStore({
    lstat: (async (path, options) => {
      if (String(path) === previewPath) {
        previewLstatCount += 1;
        if (previewLstatCount === 2) {
          const handle = await open(previewPath, "r+");
          try {
            await handle.truncate(AUTHOR_SUBMISSION_MAX_BYTES + 1);
          } finally {
            await handle.close();
          }
        }
      }
      return lstat(path, options);
    }) as typeof lstat,
  });

  await assert.rejects(
    fileStore.promoteAuthorSubmission({
      projectId,
      previewPath,
      chapterNo: 7,
      contentHash: hashContent(content),
    }),
    /32MB|过大|字节/u,
  );
});

test("author submission file store redacts raw filesystem paths", async () => {
  const projectId = createProjectId("redacted-fs-error");
  await projectFiles.ensureProjectLayout(projectId);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, "正文", "utf8");
  const fileStore = authorSubmissionFileInternals.createAuthorSubmissionFileStore({
    open: (async () => {
      throw Object.assign(new Error(`EACCES: denied, open '${previewPath}'`), { code: "EACCES" });
    }) as typeof open,
  });

  await assert.rejects(
    fileStore.promoteAuthorSubmission({
      projectId,
      previewPath,
      chapterNo: 7,
      contentHash: hashContent("正文"),
    }),
    (error: unknown) => {
      assert.equal(typeof error, "object");
      assert.notEqual(error, null);
      const record = error as { code?: unknown; message?: unknown };
      assert.equal(record.code, "INTERNAL_ERROR");
      assert.equal(record.message, "作者稿文件处理失败");
      assert.equal(String(record.message).includes(tempRoot), false);
      return true;
    },
  );
});

test("promoteAuthorSubmission preserves an existing immutable target on conflict", async () => {
  const projectId = createProjectId("conflict");
  await projectFiles.ensureProjectLayout(projectId);
  const content = "待提升正文";
  const contentHash = hashContent(content);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  const target = projectFiles.authorSubmissionContentPath(projectId, 7, contentHash);
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, content, "utf8");
  await writeFile(target, "被占用的不同正文", "utf8");

  await assert.rejects(
    projectFiles.promoteAuthorSubmission({ projectId, previewPath, chapterNo: 7, contentHash }),
    /冲突|已存在|不可变/u,
  );
  assert.equal(await readFile(target, "utf8"), "被占用的不同正文");
  assert.equal(await readFile(previewPath, "utf8"), content);
});

test("promoteAuthorSubmission atomically refuses a target created after its existence check", async () => {
  const projectId = createProjectId("publish-race");
  await projectFiles.ensureProjectLayout(projectId);
  const content = "待原子提升的正文";
  const competingContent = "竞争写入的不同正文";
  const contentHash = hashContent(content);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  const target = projectFiles.authorSubmissionContentPath(projectId, 7, contentHash);
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, content, "utf8");
  const fileStore = authorSubmissionFileInternals.createAuthorSubmissionFileStore({
    link: async (temporaryPath, targetPath) => {
      await writeFile(target, competingContent, { encoding: "utf8", flag: "wx" });
      await link(temporaryPath, targetPath);
    },
  });

  await assert.rejects(
    fileStore.promoteAuthorSubmission({ projectId, previewPath, chapterNo: 7, contentHash }),
    /冲突|已存在|不可变/u,
  );

  assert.equal(await readFile(target, "utf8"), competingContent);
  assert.equal(await readFile(previewPath, "utf8"), content);
  const authorSubmissionDir = dirname(target);
  const remainingNames = await readdir(authorSubmissionDir);
  assert.equal(remainingNames.some((name) => name.startsWith(".publish-")), false);
});

test("promoteAuthorSubmission publishes the verified source object and preserves a replaced staging path", async () => {
  const projectId = createProjectId("source-race");
  await projectFiles.ensureProjectLayout(projectId);
  const verifiedContent = "句柄已经读取并验证的正文";
  const replacementContent = "检查后替换进 staging 的未知正文";
  const contentHash = hashContent(verifiedContent);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, verifiedContent, "utf8");
  const fileStore = authorSubmissionFileInternals.createAuthorSubmissionFileStore({
    link: async (temporaryPath, targetPath) => {
      await writeFile(previewPath, replacementContent, "utf8");
      await link(temporaryPath, targetPath);
    },
  });

  const target = await fileStore.promoteAuthorSubmission({ projectId, previewPath, chapterNo: 7, contentHash });

  assert.equal(await readFile(target, "utf8"), verifiedContent);
  assert.equal(await readFile(previewPath, "utf8"), replacementContent);
});

test("promoteAuthorSubmission retains staging so cleanup cannot delete a raced path", async () => {
  const projectId = createProjectId("cleanup-race");
  await projectFiles.ensureProjectLayout(projectId);
  const verifiedContent = "通过校验并等待发布的正文";
  const contentHash = hashContent(verifiedContent);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, verifiedContent, "utf8");
  const target = await projectFiles.promoteAuthorSubmission({ projectId, previewPath, chapterNo: 7, contentHash });

  assert.equal(await readFile(target, "utf8"), verifiedContent);
  assert.equal(await readFile(previewPath, "utf8"), verifiedContent);
});

test("promoteAuthorSubmission rejects preview paths outside the project staging root", async () => {
  const projectId = createProjectId("outside");
  await projectFiles.ensureProjectLayout(projectId);
  const outsidePath = join(tempRoot, "outside-preview.md");
  const content = "项目外正文";
  await writeFile(outsidePath, content, "utf8");

  await assert.rejects(
    projectFiles.promoteAuthorSubmission({
      projectId,
      previewPath: outsidePath,
      chapterNo: 7,
      contentHash: hashContent(content),
    }),
    /项目文件路径不合法|预览路径/u,
  );
  assert.equal(await readFile(outsidePath, "utf8"), content);
});

test("promoteAuthorSubmission rejects a staging junction that resolves outside the project", async (context) => {
  const projectId = createProjectId("junction");
  await projectFiles.ensureProjectLayout(projectId);
  const outsideDir = join(tempRoot, "junction-outside");
  const linkPath = paths.withinProject(projectId, ".staging", "author-submissions", "linked");
  await mkdir(outsideDir, { recursive: true });
  const content = "链接外正文";
  await writeFile(join(outsideDir, "chapter.md"), content, "utf8");

  try {
    await symlink(outsideDir, linkPath, "junction");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      context.skip(`当前 Windows 权限不允许创建 junction: ${code}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    projectFiles.promoteAuthorSubmission({
      projectId,
      previewPath: join(linkPath, "chapter.md"),
      chapterNo: 7,
      contentHash: hashContent(content),
    }),
    /项目文件路径不合法|预览路径/u,
  );
});

test("promoteAuthorSubmission rejects a staging parent replaced by a junction after validation", async (context) => {
  const projectId = createProjectId("dynamic-source-junction");
  await projectFiles.ensureProjectLayout(projectId);
  const previewDir = projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe");
  const previewPath = join(previewDir, "chapter.md");
  const backupDir = `${previewDir}-backup`;
  const outsideDir = join(tempRoot, "dynamic-source-outside");
  const outsideContent = "OUTSIDE_PROJECT_CONTENT";
  await mkdir(previewDir, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(previewPath, "项目内原始正文", "utf8");
  await writeFile(join(outsideDir, "chapter.md"), outsideContent, "utf8");

  const probe = join(paths.projectDir(projectId), ".staging", "author-submissions", "junction-probe");
  try {
    await symlink(outsideDir, probe, "junction");
    await rm(probe, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      context.skip(`当前 Windows 权限不允许创建 junction: ${code}`);
      return;
    }
    throw error;
  }

  let swapped = false;
  const fileStore = authorSubmissionFileInternals.createAuthorSubmissionFileStore({
    lstat: (async (path, options) => {
      if (!swapped && String(path) === previewPath) {
        swapped = true;
        await rename(previewDir, backupDir);
        await symlink(outsideDir, previewDir, "junction");
      }
      return lstat(path, options);
    }) as typeof lstat,
  });
  const contentHash = hashContent(outsideContent);
  const target = projectFiles.authorSubmissionContentPath(projectId, 7, contentHash);

  await assert.rejects(
    fileStore.promoteAuthorSubmission({ projectId, previewPath, chapterNo: 7, contentHash }),
    /项目文件路径不合法|发生变化|归属/u,
  );
  assert.equal(existsSync(target), false);
});

test("promoteAuthorSubmission rejects a target directory replaced after path construction", async (context) => {
  const projectId = createProjectId("dynamic-target-junction");
  await projectFiles.ensureProjectLayout(projectId);
  const content = "只能写进项目正式目录的正文";
  const contentHash = hashContent(content);
  const previewPath = join(projectFiles.authorSubmissionPreviewDir(projectId, "preview-safe"), "chapter.md");
  const authorDir = paths.withinProject(projectId, "author-submissions");
  const backupDir = `${authorDir}-backup`;
  const outsideDir = join(tempRoot, "dynamic-target-outside");
  await mkdir(dirname(previewPath), { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  await writeFile(previewPath, content, "utf8");

  const probe = join(authorDir, "junction-probe");
  try {
    await symlink(outsideDir, probe, "junction");
    await rm(probe, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      context.skip(`当前 Windows 权限不允许创建 junction: ${code}`);
      return;
    }
    throw error;
  }

  let swapped = false;
  const fileStore = authorSubmissionFileInternals.createAuthorSubmissionFileStore({
    open: (async (path, flags, mode) => {
      if (!swapped && flags === "wx" && String(path).includes(".publish-")) {
        swapped = true;
        await rename(authorDir, backupDir);
        await symlink(outsideDir, authorDir, "junction");
      }
      return open(path, flags, mode);
    }) as typeof open,
  });
  const target = projectFiles.authorSubmissionContentPath(projectId, 7, contentHash);

  await assert.rejects(
    fileStore.promoteAuthorSubmission({ projectId, previewPath, chapterNo: 7, contentHash }),
    /项目文件路径不合法|发生变化|归属/u,
  );
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(join(outsideDir, `chapter_007_${contentHash.slice(0, 12)}.md`)), false);
  const outsideNames = await readdir(outsideDir);
  const publishTemps = outsideNames.filter((name) => name.startsWith(".publish-"));
  for (const name of publishTemps) {
    assert.equal((await stat(join(outsideDir, name))).size, 0);
  }
});

test("service preview stages single and four-chapter multi manuscripts without database rows", async () => {
  const { authorSubmissionServiceModule, createChapterSubmissionRepository } = await loadAuthorSubmissionService();
  const db = createSubmissionDb();
  const repository = createChapterSubmissionRepository({ db });
  const service = authorSubmissionServiceModule.createAuthorSubmissionService({ repository });
  const singleProjectId = createProjectId("service-single-preview");
  const multiProjectId = createProjectId("service-multi-preview");

  try {
    const single = await service.preview(singleProjectId, {
      kind: "single",
      chapterNo: 7,
      title: "第七章 雨夜遗物",
      content: "雨落在旧伞上。".repeat(180),
      source: "human",
    });
    assert.ok(single.previewId);
    assert.equal(single.chapterCount, 1);
    assert.equal(single.chapters[0]?.chapterNo, 7);
    assert.equal(single.chapters[0]?.characterCount, "雨落在旧伞上。".repeat(180).length);
    assert.equal(single.parseConfidence, "high");
    assert.match(single.previewId, /^[A-Za-z0-9_-]+$/u);

    const book = [
      "## 第十章 初见",
      "第一章正文。".repeat(180),
      "## 无编号过场",
      "第二章正文。".repeat(180),
      "## Chapter 12 Return",
      "第三章正文。".repeat(180),
      "## 第十章 重逢",
      "第四章正文。".repeat(180),
    ].join("\n");
    const multi = await service.preview(multiProjectId, {
      kind: "multi",
      buffer: Buffer.from(book, "utf8"),
      fileName: "../../用户上传/小说.txt",
      startChapterNo: 40,
      encoding: "utf-8",
      source: "import",
    });

    assert.ok(multi.previewId);
    assert.equal(multi.chapterCount, 4);
    assert.equal(multi.parseConfidence, "high");
    assert.deepEqual(multi.chapters.map((chapter) => chapter.chapterNo), [10, 41, 12, 10]);
    assert.ok(multi.chapters.every((chapter) => chapter.characterCount > 0));
    assert.ok(multi.warnings.some((warning) => warning.code === "duplicate_chapter_number"));
    assert.equal(countRows(db, "chapter_submissions"), 0);
    assert.equal(countRows(db, "chapter_submission_batches"), 0);
    const previewNames = await readdir(projectFiles.authorSubmissionPreviewDir(multiProjectId, multi.previewId));
    assert.ok(previewNames.includes("manifest.json"));
    assert.ok(previewNames.every((name) => !name.includes("用户上传") && !name.includes("小说.txt")));

    for (const chapter of multi.chapters) {
      const stagedContent: Buffer = await readFile(join(
        projectFiles.authorSubmissionPreviewDir(multiProjectId, multi.previewId),
        `chapter-${chapter.index}.md`,
      ));
      assert.equal(createHash("sha256").update(stagedContent).digest("hex"), chapter.contentHash);
    }
  } finally {
    db.close();
  }
});

test("import processes chapters independently, remains draft during an active writer session, and lists by project", async () => {
  const { authorSubmissionServiceModule, createChapterSubmissionRepository } = await loadAuthorSubmissionService();
  const db = createSubmissionDb();
  const repository = createChapterSubmissionRepository({ db });
  const projectId = createProjectId("service-partial");
  const service = authorSubmissionServiceModule.createAuthorSubmissionService({
    repository,
    promoteAuthorSubmission: async (input) => {
      if (input.chapterNo === 3) {
        throw new Error(`simulated promotion failure at ${join(tempRoot, "secret", "chapter-3.md")}`);
      }
      return projectFiles.promoteAuthorSubmission(input);
    },
  });

  try {
    db.prepare(`
      INSERT INTO run_sessions (
        session_id, project_id, session_seq, from_chapter, target_chapter,
        desired_state, lifecycle_status, started_at, updated_at
      ) VALUES ('writer-active', ?, 1, 1, NULL, 'running', 'running', ?, ?)
    `).run(projectId, new Date().toISOString(), new Date().toISOString());

    const manuscript = [1, 2, 3, 4]
      .map((chapterNo) => `## 第${["一", "二", "三", "四"][chapterNo - 1]}章\n正文${chapterNo}。`.concat("内容。".repeat(220)))
      .join("\n");
    const preview = await service.preview(projectId, {
      kind: "multi",
      buffer: Buffer.from(manuscript),
      fileName: "four.md",
      startChapterNo: 1,
      encoding: "utf-8",
      source: "import",
    });
    assert.ok(preview.previewId);
    const incompatibleChapter = preview.chapters[1]!;
    repository.createOrGet({
      projectId,
      chapterNo: incompatibleChapter.chapterNo,
      title: "已存在的不同作者稿身份",
      source: "human",
      contentPath: "author-submissions/incompatible.md",
      contentHash: incompatibleChapter.contentHash,
    });
    const imported = await service.importPreview(projectId, { previewId: preview.previewId });

    assert.equal(imported.batch.status, "partial_failed");
    assert.deepEqual(imported.results.map((result) => result.success), [true, false, false, true]);
    assert.equal(imported.results[1]?.error?.code, "CONFLICT");
    assert.equal(imported.results[2]?.error?.code, "INTERNAL_ERROR");
    assert.equal(imported.results[2]?.error?.message.includes(tempRoot), false);
    assert.equal(countRows(db, "chapter_submissions"), 3);
    assert.ok(service.list(projectId).every((entry) => entry.projectId === projectId && entry.status === "draft"));
    assert.deepEqual(service.list(createProjectId("foreign-list")), []);
  } finally {
    db.close();
  }
});

test("import is idempotent and rejects tampered or cross-project previews", async () => {
  const { authorSubmissionServiceModule, createChapterSubmissionRepository } = await loadAuthorSubmissionService();
  const db = createSubmissionDb();
  const repository = createChapterSubmissionRepository({ db });
  const service = authorSubmissionServiceModule.createAuthorSubmissionService({ repository });
  const projectId = createProjectId("service-idempotent");

  try {
    const preview = await service.preview(projectId, {
      kind: "single",
      chapterNo: 9,
      title: "第九章",
      content: "幂等正文。".repeat(300),
      source: "human",
    });
    assert.ok(preview.previewId);
    const first = await service.importPreview(projectId, { previewId: preview.previewId });
    const second = await service.importPreview(projectId, { previewId: preview.previewId });
    assert.equal(first.results[0]?.submission?.id, second.results[0]?.submission?.id);
    assert.equal(countRows(db, "chapter_submissions"), 1);
    assert.equal(countRows(db, "chapter_submission_batches"), 1);

    await assert.rejects(
      service.importPreview(createProjectId("other-project"), { previewId: preview.previewId }),
      /预览不存在|预览无效/u,
    );

    const manifestPath = join(projectFiles.authorSubmissionPreviewDir(projectId, preview.previewId), "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.projectId = createProjectId("tampered-project");
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    await assert.rejects(
      service.importPreview(projectId, { previewId: preview.previewId }),
      /预览清单已被篡改|预览无效/u,
    );
  } finally {
    db.close();
  }
});

test("revision creates an idempotent child lineage without changing chapters or versions", async () => {
  const { authorSubmissionServiceModule, createChapterSubmissionRepository } = await loadAuthorSubmissionService();
  const db = createSubmissionDb();
  const repository = createChapterSubmissionRepository({ db });
  const service = authorSubmissionServiceModule.createAuthorSubmissionService({ repository });
  const projectId = createProjectId("service-revision");

  try {
    const preview = await service.preview(projectId, {
      kind: "single",
      chapterNo: 5,
      title: "第五章 原稿",
      content: "原稿正文。".repeat(300),
      source: "human",
    });
    assert.ok(preview.previewId);
    const imported = await service.importPreview(projectId, { previewId: preview.previewId });
    const parent = imported.results[0]?.submission;
    assert.ok(parent);

    const revisionInput = {
      title: "第五章 修订稿",
      content: "修订正文。".repeat(320),
      source: "human" as const,
    };
    const revision = await service.revise(projectId, parent.id, revisionInput);
    const replay = await service.revise(projectId, parent.id, revisionInput);
    assert.equal(revision.id, replay.id);
    assert.equal(revision.parentSubmissionId, parent.id);
    assert.equal(revision.chapterNo, parent.chapterNo);
    assert.equal(countRows(db, "chapter_submissions"), 2);
    assert.equal(Number((db.prepare("SELECT COUNT(*) AS count FROM chapter_versions").get() as { count: number }).count), 0);

    const secondPreview = await service.preview(projectId, {
      kind: "single",
      chapterNo: 5,
      title: "第五章 另一原稿",
      content: "另一份原稿正文。".repeat(300),
      source: "human",
    });
    assert.ok(secondPreview.previewId);
    const secondImport = await service.importPreview(projectId, { previewId: secondPreview.previewId });
    const secondParent = secondImport.results[0]?.submission;
    assert.ok(secondParent);
    await assert.rejects(
      service.revise(projectId, secondParent.id, revisionInput),
      /修订归属已变化|内容身份已变化/u,
    );

    await assert.rejects(
      service.revise(createProjectId("foreign-revision"), parent.id, revisionInput),
      /作者稿不存在|不属于当前项目/u,
    );
  } finally {
    db.close();
  }
});

test("author submission service has no Writer, run-manager, or LLM dependency", async () => {
  const { authorSubmissionServiceModule } = await loadAuthorSubmissionService();
  const source = await readFile(join(process.cwd(), "src/server/services/author-submission.service.ts"), "utf8");
  assert.doesNotMatch(source, /\bWriter\b|run-manager|llm|chatJson|runSession|sessionGuard/iu);
  assert.doesNotMatch(JSON.stringify(authorSubmissionServiceModule.defaultAuthorSubmissionDependencies ?? {}), /writer|llm|run/iu);
});
