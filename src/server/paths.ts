import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isNextRequestStore, resolveTenantId } from "./tenant.ts";

export function getGlobalAppRoot() {
  return resolve(process.env.AINOVEL_APP_ROOT?.trim() || process.cwd());
}

type AppPaths = {
  root: string;
  dataDir: string;
  dbFile: string;
  configDir: string;
  profileFile: string;
  profileExampleFile: string;
  projectsDir: string;
  ideasDir: string;
  authorsDir: string;
  promptsDir: string;
  stylesDir: string;
};

function currentRootDir() {
  const tenantId = resolveTenantId();
  if (tenantId) return resolve(getGlobalAppRoot(), "tenants", tenantId);
  if (isNextRequestStore() && process.env.NODE_ENV === "production") {
    throw new Error("未登录用户不能访问小说数据");
  }
  return getGlobalAppRoot();
}

function buildAppPaths(rootDir: string): AppPaths {
  return {
    root: rootDir,
    dataDir: resolve(rootDir, "data"),
    dbFile: resolve(rootDir, "data", "app.db"),
    configDir: resolve(rootDir, "config"),
    profileFile: resolve(rootDir, "config", "llm-profiles.json"),
    profileExampleFile: resolve(getGlobalAppRoot(), "config", "llm-profiles.example.json"),
    projectsDir: resolve(rootDir, "projects"),
    ideasDir: resolve(rootDir, "ideas"),
    authorsDir: resolve(rootDir, "authors"),
    promptsDir: resolve(getGlobalAppRoot(), "prompts"),
    stylesDir: resolve(getGlobalAppRoot(), "styles"),
  };
}

export const appPaths: AppPaths = new Proxy({} as AppPaths, {
  get(_target, prop) {
    return buildAppPaths(currentRootDir())[prop as keyof AppPaths];
  },
});

function isWithinRoot(root: string, target: string) {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

// realpath 归一：目标可能尚不存在（写入前构造路径），向上找到最近的已存在祖先做
// realpath，再拼回缺失的尾段，确保 symlink/junction 被展开后再做包含校验。
function realpathWithExistingAncestor(target: string) {
  let existing = target;
  const missingSegments: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      return target;
    }
    missingSegments.unshift(basename(existing));
    existing = parent;
  }
  try {
    const realExisting = realpathSync(existing);
    return missingSegments.length ? resolve(realExisting, ...missingSegments) : realExisting;
  } catch {
    return target;
  }
}

// 逻辑路径校验之外的第二道防线：展开符号链接后复核包含关系，防止 projects/ 内的
// symlink/junction 把读写指到沙箱外（root 与 target 都归一，兼容 root 自身是链接的情况）。
function isWithinRootAfterRealpath(root: string, target: string) {
  return isWithinRoot(realpathWithExistingAncestor(root), realpathWithExistingAncestor(target));
}

export function assertValidProjectId(projectId: string) {
  const normalized = projectId.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("projectId 不合法");
  }
  return normalized;
}

function ensureWithinRoot(root: string, target: string, message: string) {
  if (!isWithinRoot(root, target) || !isWithinRootAfterRealpath(root, target)) {
    throw new Error(message);
  }
  return target;
}

export function ensureBasePaths() {
  for (const dir of [appPaths.dataDir, appPaths.configDir, appPaths.projectsDir, appPaths.ideasDir, appPaths.authorsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  if (!existsSync(appPaths.profileFile)) {
    const template = existsSync(appPaths.profileExampleFile)
      ? readFileSync(appPaths.profileExampleFile, "utf8")
      : JSON.stringify({ version: 1, profiles: [] }, null, 2);
    // temp + rename 原子写，与 profiles.ts 的 writeProfileFile 同策略，
    // 避免初始化中途被杀留下截断的 JSON 让后续读取直接抛错。
    const tempFile = `${appPaths.profileFile}.tmp`;
    writeFileSync(tempFile, template, "utf8");
    try {
      renameSync(tempFile, appPaths.profileFile);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EEXIST") {
        rmSync(tempFile, { force: true });
        throw error;
      }
      writeFileSync(appPaths.profileFile, template, "utf8");
      rmSync(tempFile, { force: true });
    }
  }
}

export function projectDir(projectId: string) {
  const safeProjectId = assertValidProjectId(projectId);
  return ensureWithinRoot(
    appPaths.projectsDir,
    resolve(appPaths.projectsDir, safeProjectId),
    "项目目录不合法",
  );
}

export function ideaDir(ideaId: string) {
  const safeIdeaId = assertValidProjectId(ideaId);
  return ensureWithinRoot(
    appPaths.ideasDir,
    resolve(appPaths.ideasDir, safeIdeaId),
    "想法目录不合法",
  );
}

export function withinIdea(ideaId: string, ...parts: string[]) {
  const base = ideaDir(ideaId);
  return ensureWithinRoot(base, resolve(base, ...parts), "想法文件路径不合法");
}

export function authorCardDir(authorCardId: string) {
  const safeAuthorCardId = assertValidProjectId(authorCardId);
  return ensureWithinRoot(
    appPaths.authorsDir,
    resolve(appPaths.authorsDir, safeAuthorCardId),
    "作者卡目录不合法",
  );
}

export function withinAuthorCard(authorCardId: string, ...parts: string[]) {
  const base = authorCardDir(authorCardId);
  return ensureWithinRoot(base, resolve(base, ...parts), "作者卡文件路径不合法");
}

export function withinProject(projectId: string, ...parts: string[]) {
  const base = projectDir(projectId);
  return ensureWithinRoot(base, resolve(base, ...parts), "项目文件路径不合法");
}

export function resolveReadablePath(path: string) {
  const resolvedPath = resolve(appPaths.root, path);
  const allowedRoots = [appPaths.projectsDir, appPaths.promptsDir, appPaths.stylesDir];
  if (!allowedRoots.some((root) => isWithinRoot(root, resolvedPath) && isWithinRootAfterRealpath(root, resolvedPath))) {
    throw new Error("文件路径不在允许范围内");
  }
  return resolvedPath;
}

export function resolveProjectFilePath(projectId: string, candidatePath: string, allowedSubdirs?: string[]) {
  const base = projectDir(projectId);
  const resolvedPath = isAbsolute(candidatePath)
    ? resolve(candidatePath)
    : resolve(base, candidatePath);
  const allowedRoots = allowedSubdirs?.length
    ? allowedSubdirs.map((subdir) => withinProject(projectId, subdir))
    : [base];
  if (!allowedRoots.some((root) => isWithinRoot(root, resolvedPath) && isWithinRootAfterRealpath(root, resolvedPath))) {
    throw new Error("项目文件路径不合法");
  }
  return resolvedPath;
}
