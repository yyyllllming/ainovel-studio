import { isAbsolute, relative, resolve } from "node:path";
import { appPaths, assertValidProjectId } from "../paths.ts";
import { getFileWindow } from "../project-files.ts";

export interface FileReadRequestInput {
  projectId?: string;
  relativePath?: string;
  path?: string;
  start?: number;
  end?: number;
}

// 与 file-names.ts 的 ILLEGAL_FILE_CHARS 保持一致：显式拒绝 NUL 与控制字符，
// 不依赖底层 fs 调用抛 ERR_INVALID_ARG_VALUE。
const CONTROL_CHARS = /[\u0000-\u001f]/u;

function normalizeRelativePath(candidatePath: string) {
  const trimmed = candidatePath.trim();
  if (!trimmed) {
    throw new Error("缺少 relativePath");
  }
  if (isAbsolute(trimmed)) {
    throw new Error("relativePath 必须是项目内相对路径");
  }
  if (CONTROL_CHARS.test(trimmed)) {
    throw new Error("relativePath 含非法字符");
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\/+/u, "");
  const segments = normalized.split("/").filter(Boolean);

  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("relativePath 必须是项目内相对路径");
  }

  return segments.join("/");
}

function parseLegacyProjectPath(candidatePath: string) {
  const trimmed = candidatePath.trim();
  if (!trimmed) {
    throw new Error("缺少 path");
  }

  let normalized = trimmed.replace(/\\/g, "/");

  if (isAbsolute(trimmed)) {
    const resolvedPath = resolve(trimmed);
    const projectRelativePath = relative(appPaths.projectsDir, resolvedPath).replace(/\\/g, "/");
    if (!projectRelativePath || projectRelativePath.startsWith("..")) {
      throw new Error("旧 path 参数仅支持 projects/<projectId>/... 或 projects 目录内绝对路径");
    }
    normalized = projectRelativePath;
  } else {
    normalized = normalized.replace(/^\.\/+/u, "");
    if (normalized.startsWith("projects/")) {
      normalized = normalized.slice("projects/".length);
    } else {
      throw new Error("旧 path 参数仅支持 projects/<projectId>/... 或 projects 目录内绝对路径");
    }
  }

  const [projectId, ...rest] = normalized.split("/").filter(Boolean);
  if (!projectId || !rest.length) {
    throw new Error("旧 path 参数仅支持 projects/<projectId>/... 或 projects 目录内绝对路径");
  }

  return {
    projectId: assertValidProjectId(projectId),
    relativePath: normalizeRelativePath(rest.join("/")),
  };
}

function resolveProjectFileReadTarget(input: FileReadRequestInput) {
  if (input.projectId && input.relativePath) {
    return {
      projectId: assertValidProjectId(input.projectId),
      relativePath: normalizeRelativePath(input.relativePath),
    };
  }

  if (input.path) {
    return parseLegacyProjectPath(input.path);
  }

  throw new Error("缺少 projectId + relativePath");
}

// Impact note (Task 2): browser-facing file reads are now project-scoped only.
// prompts/ and styles/ stay in the broader readable allowlist for non-route callers
// until a separate audit confirms they can be removed safely.
export async function readProjectFileWindow(input: FileReadRequestInput) {
  const target = resolveProjectFileReadTarget(input);
  return getFileWindow(target.projectId, target.relativePath, input.start ?? 0, input.end);
}
