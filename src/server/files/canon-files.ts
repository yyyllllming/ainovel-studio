import "../server-only.ts";

import { readdir, rename, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";
import { withinProject } from "../paths.ts";
import type { CanonFact, CharacterSnapshot, ConflictRecord, LogicStateSnapshot } from "../types.ts";
import { ensureDir, readTextFile } from "../utils.ts";
import { safeParseJson } from "../utils/safe-json.ts";

let atomicWriteSeq = 0;

// 原子写：先写临时文件再 rename 覆盖，避免进程在 O_TRUNC 写入中途被杀留下空文件/半行。
// Windows 上 rename 到已存在目标可能抛 EEXIST/EPERM，此时先删除目标再重试一次。
async function writeTextFileAtomic(path: string, content: string) {
  await ensureDir(dirname(path));
  const tmpPath = `${path}.${process.pid}.${(atomicWriteSeq += 1)}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  try {
    await rename(tmpPath, path);
  } catch (error) {
    try {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EACCES") {
        throw error;
      }
      await rm(path, { force: true });
      await rename(tmpPath, path);
    } catch (retryError) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw retryError;
    }
  }
}

// 进程内每项目互斥，串行化 facts.jsonl/foreshadows.jsonl 的 read-modify-write，避免并发丢写。
const canonFileLocks = new Map<string, Promise<unknown>>();

async function withCanonFileLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = canonFileLocks.get(projectId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const guard = run.then(() => undefined, () => undefined);
  canonFileLocks.set(projectId, guard);
  try {
    return await run;
  } finally {
    if (canonFileLocks.get(projectId) === guard) {
      canonFileLocks.delete(projectId);
    }
  }
}

async function writeJson(path: string, value: unknown) {
  await writeTextFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function appendCanonFacts(projectId: string, facts: CanonFact[]) {
  if (!facts.length) {
    return;
  }
  const lines = facts.map((fact) => JSON.stringify(fact)).join("\n") + "\n";
  await writeFile(withinProject(projectId, "canon", "facts.jsonl"), lines, {
    encoding: "utf8",
    flag: "a",
  });
}

export async function replaceCanonFacts(projectId: string, facts: CanonFact[]) {
  const content = facts.length ? `${facts.map((fact) => JSON.stringify(fact)).join("\n")}\n` : "";
  await writeTextFileAtomic(withinProject(projectId, "canon", "facts.jsonl"), content);
}

export async function replaceCanonFactEntriesForChapter(projectId: string, chapterNo: number, facts: CanonFact[]) {
  return withCanonFileLock(projectId, async () => {
    const existing = await readCanonFacts(projectId);
    const merged = existing.filter((fact) => fact.chapterNo !== chapterNo).concat(facts);
    await replaceCanonFacts(projectId, merged);
    return merged;
  });
}

export async function readCanonFacts(projectId: string) {
  const path = withinProject(projectId, "canon", "facts.jsonl");
  if (!existsSync(path)) {
    return [] as CanonFact[];
  }
  const raw = await readTextFile(path);
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => safeParseJson<CanonFact>(line))
    .filter((fact): fact is CanonFact => fact !== null);
}

export async function appendForeshadowEntries(projectId: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    return;
  }
  const path = withinProject(projectId, "canon", "foreshadows.jsonl");
  const content = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(path, content, { encoding: "utf8", flag: "a" });
}

export async function replaceForeshadowEntries(projectId: string, rows: Array<Record<string, unknown>>) {
  const path = withinProject(projectId, "canon", "foreshadows.jsonl");
  const content = rows.length ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
  await writeTextFileAtomic(path, content);
}

export async function replaceForeshadowEntriesForChapter(
  projectId: string,
  chapterNo: number,
  rows: Array<Record<string, unknown>>,
) {
  return withCanonFileLock(projectId, async () => {
    const existing = await readForeshadowEntries(projectId);
    const merged = existing
      .filter((entry) => Number(entry.chapterNo ?? 0) !== chapterNo)
      .concat(rows);
    await replaceForeshadowEntries(projectId, merged);
    return merged;
  });
}

export async function readForeshadowEntries(projectId: string) {
  const path = withinProject(projectId, "canon", "foreshadows.jsonl");
  if (!existsSync(path)) {
    return [] as Array<Record<string, unknown>>;
  }
  const raw = await readTextFile(path);
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => safeParseJson<Record<string, unknown>>(line))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

/**
 * 按章节区间删除 facts/foreshadows 条目（删章场景）。
 * 读改写全程持同一把项目级锁，避免与 artifact sync 的逐章 replace 并发交叠丢写。
 */
export async function removeCanonEntriesInChapterRange(
  projectId: string,
  startChapter: number,
  endChapter: number,
) {
  return withCanonFileLock(projectId, async () => {
    const [facts, foreshadows] = await Promise.all([
      readCanonFacts(projectId),
      readForeshadowEntries(projectId),
    ]);
    await Promise.all([
      replaceCanonFacts(
        projectId,
        facts.filter((fact) => fact.chapterNo < startChapter || fact.chapterNo > endChapter),
      ),
      replaceForeshadowEntries(
        projectId,
        foreshadows.filter((entry) => {
          const chapterNo = Number(entry.chapterNo ?? 0);
          return !Number.isFinite(chapterNo) || chapterNo < startChapter || chapterNo > endChapter;
        }),
      ),
    ]);
  });
}

export interface ForeshadowLedgerState {
  status: string;
  timestamp: string;
  chapterNo: number;
}

function shouldReplaceForeshadowLedgerState(
  current: ForeshadowLedgerState | undefined,
  next: ForeshadowLedgerState,
) {
  if (!current) {
    return true;
  }

  if (next.chapterNo !== current.chapterNo) {
    return next.chapterNo > current.chapterNo;
  }

  return next.timestamp.localeCompare(current.timestamp) >= 0;
}

export async function readForeshadowLedgerStateMap(projectId: string, contents: string[]) {
  const path = withinProject(projectId, "canon", "foreshadows.jsonl");
  const targets = new Set(
    contents
      .map((content) => content.trim())
      .filter(Boolean),
  );
  const states = new Map<string, ForeshadowLedgerState>();

  if (!targets.size || !existsSync(path)) {
    return states;
  }

  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const entry = safeParseJson<Record<string, unknown>>(line);
      if (!entry) {
        continue;
      }

      const content = String(entry.content ?? "").trim();
      if (!targets.has(content)) {
        continue;
      }

      const nextState: ForeshadowLedgerState = {
        status: String(entry.status ?? "active"),
        timestamp: String(entry.timestamp ?? ""),
        chapterNo: Number(entry.chapterNo ?? 0),
      };
      const currentState = states.get(content);
      if (shouldReplaceForeshadowLedgerState(currentState, nextState)) {
        states.set(content, nextState);
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  return states;
}

export async function writeCharacterSnapshot(projectId: string, chapterNo: number, snapshot: CharacterSnapshot) {
  await writeJson(
    withinProject(projectId, "canon", `character_snapshot_${String(chapterNo).padStart(3, "0")}.json`),
    snapshot,
  );
}

export async function readCharacterSnapshot(projectId: string, chapterNo: number) {
  const path = withinProject(projectId, "canon", `character_snapshot_${String(chapterNo).padStart(3, "0")}.json`);
  if (!existsSync(path)) {
    return null;
  }
  return safeParseJson<CharacterSnapshot>(await readTextFile(path));
}

export async function listCharacterSnapshots(projectId: string, options?: { uptoChapterNo?: number }) {
  const canonDir = withinProject(projectId, "canon");
  if (!existsSync(canonDir)) {
    return [] as CharacterSnapshot[];
  }

  const files = (await readdir(canonDir))
    .filter((file) => /^character_snapshot_\d+\.json$/u.test(file))
    .map((file) => ({
      file,
      chapterNo: Number(file.match(/\d+/u)?.[0] ?? 0),
    }))
    .filter((entry) =>
      options?.uptoChapterNo ? entry.chapterNo > 0 && entry.chapterNo < options.uptoChapterNo : entry.chapterNo > 0,
    )
    .sort((left, right) => right.chapterNo - left.chapterNo);

  const snapshots = (await Promise.all(
    files.map(async (entry) =>
      safeParseJson<CharacterSnapshot>(await readTextFile(withinProject(projectId, "canon", entry.file))),
    ),
  )).filter((snapshot): snapshot is CharacterSnapshot => snapshot !== null);

  return snapshots.sort((left, right) => right.chapterNo - left.chapterNo);
}

export async function selectContextCharacterSnapshots(input: {
  projectId: string;
  uptoChapterNo: number;
  focusCharacters: string[];
  recentWindow?: number;
}) {
  const canonDir = withinProject(input.projectId, "canon");
  if (!existsSync(canonDir)) {
    return [] as CharacterSnapshot[];
  }

  const recentWindow = Math.max(1, input.recentWindow ?? 5);
  const files = (await readdir(canonDir))
    .filter((file) => /^character_snapshot_\d+\.json$/u.test(file))
    .map((file) => ({
      file,
      chapterNo: Number(file.match(/\d+/u)?.[0] ?? 0),
    }))
    .filter((entry) => entry.chapterNo > 0 && entry.chapterNo < input.uptoChapterNo)
    .sort((left, right) => right.chapterNo - left.chapterNo);

  if (!files.length) {
    return [] as CharacterSnapshot[];
  }

  const selectedFiles = new Set<string>();
  const recentThreshold = Math.max(1, input.uptoChapterNo - recentWindow);
  for (const entry of files) {
    if (entry.chapterNo >= recentThreshold) {
      selectedFiles.add(entry.file);
    }
  }

  const remainingFocus = new Set(input.focusCharacters.map((name) => name.trim()).filter(Boolean));
  if (remainingFocus.size) {
    for (const entry of files) {
      if (!remainingFocus.size) {
        break;
      }
      const snapshot = safeParseJson<CharacterSnapshot>(await readTextFile(withinProject(input.projectId, "canon", entry.file)));
      if (!snapshot) {
        continue;
      }
      const matched = [...remainingFocus].filter((name) => Boolean(snapshot.characters[name]));
      if (!matched.length) {
        continue;
      }
      selectedFiles.add(entry.file);
      for (const name of matched) {
        remainingFocus.delete(name);
      }
    }
  }

  const snapshots = (await Promise.all(
    [...selectedFiles].map(async (file) =>
      safeParseJson<CharacterSnapshot>(await readTextFile(withinProject(input.projectId, "canon", file))),
    ),
  )).filter((snapshot): snapshot is CharacterSnapshot => snapshot !== null);

  return snapshots.sort((left, right) => right.chapterNo - left.chapterNo);
}

export async function writeLogicStateSnapshot(projectId: string, chapterNo: number, snapshot: LogicStateSnapshot) {
  await writeJson(
    withinProject(projectId, "canon", `logic_state_${String(chapterNo).padStart(3, "0")}.json`),
    snapshot,
  );
}

export async function readLatestLogicStateSnapshot(projectId: string, options?: { uptoChapterNo?: number }) {
  const canonDir = withinProject(projectId, "canon");
  if (!existsSync(canonDir)) {
    return null;
  }

  const files = (await readdir(canonDir))
    .filter((file) => /^logic_state_\d+\.json$/u.test(file))
    .map((file) => ({
      file,
      chapterNo: Number(file.match(/\d+/u)?.[0] ?? 0),
    }))
    .filter((entry) =>
      options?.uptoChapterNo ? entry.chapterNo > 0 && entry.chapterNo < options.uptoChapterNo : entry.chapterNo > 0,
    )
    .sort((left, right) => right.chapterNo - left.chapterNo);

  if (!files.length) {
    return null;
  }

  return safeParseJson<LogicStateSnapshot>(
    await readTextFile(withinProject(projectId, "canon", files[0]!.file)),
  );
}

export async function writeConflictNote(projectId: string, chapterNo: number, conflicts: ConflictRecord[]) {
  const path = withinProject(projectId, "reviews", `chapter_${String(chapterNo).padStart(3, "0")}_conflicts.json`);
  if (!conflicts.length) {
    // 空冲突列表语义为“清空”：删除旧冲突文件，避免基于旧正文的过期冲突残留。
    await rm(path, { force: true });
    return null;
  }
  await writeJson(path, conflicts);
  return path;
}
