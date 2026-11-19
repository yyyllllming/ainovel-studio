import "./server-only.ts";

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { appPaths } from "./paths.ts";

interface CachedTextFile {
  mtimeMs: number;
  content: string;
}

const promptCache = new Map<string, CachedTextFile>();
const styleCache = new Map<string, CachedTextFile>();

// 与 profiles.ts 一致：按 mtime 失效缓存，常驻的 Next 主进程才能感知 prompts/*.md 的修改。
async function readCachedFile(cache: Map<string, CachedTextFile>, path: string) {
  const fileStat = await stat(path);
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.content;
  }
  const content = await readFile(path, "utf8");
  cache.set(path, { mtimeMs: fileStat.mtimeMs, content });
  return content;
}

export async function getPrompt(name: string) {
  return readCachedFile(promptCache, join(appPaths.promptsDir, `${name}.md`));
}

export async function getStyleCard(name = "default") {
  return readCachedFile(styleCache, join(appPaths.stylesDir, `${name}.md`));
}
