import "../server-only.ts";

import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { notFound } from "../errors.ts";
import { recalculateAutoRecurringCharacterCards } from "../character/auto-character-discovery-runtime.ts";
import { buildCardProgressionsFromArtifacts } from "../character/card-progressions.ts";
import { buildForeshadowLedger, extractCanonArtifacts, type CanonArtifacts, type CanonDiagnostics } from "../story/canon.ts";
import {
  readCharacterSnapshot,
  readCanonFacts,
  readLatestLogicStateSnapshot,
  readFinalChapter,
  replaceCanonFactEntriesForChapter,
  replaceForeshadowEntriesForChapter,
  saveSummaryFiles,
  writeCharacterSnapshot,
  writeConflictNote,
} from "../project-files.ts";
import { withinProject } from "../paths.ts";
import { appendRunStatistic, appendRunLog, getRunState } from "../repositories/run.repository.ts";
import { createArtifactOutboxRepository } from "../repositories/artifact-outbox.repository.ts";
import { getBlueprint, getFoundation } from "../repositories/foundation.repository.ts";
import { getChapterReviewState, replaceCanonFactsForChapter, saveConflictRecords, upsertChapterReviewState, upsertSummaryIndex } from "../repositories/review.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { listCards, replaceCardProgressionsForChapter } from "../repositories/card.repository.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { persistAcceptedChapterSignals } from "../services/manual-review.service.ts";
import { hasMajorProgressionChange } from "../story/story-lorebook.ts";
import { nowIso } from "../utils.ts";

const pendingArtifactSyncs = new Map<string, Promise<void>>();

function canonArtifactStatusPath(projectId: string, chapterNo: number) {
  return withinProject(projectId, "canon", `artifact_status_${String(chapterNo).padStart(3, "0")}.json`);
}

export async function invalidateDurableCanonArtifacts(projectId: string, chapterNo: number) {
  const statusPath = canonArtifactStatusPath(projectId, chapterNo);
  try {
    const diagnostics = JSON.parse(await readFile(statusPath, "utf8")) as Partial<CanonDiagnostics>;
    if (diagnostics.aggregateStatus !== "success") return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if (!(error instanceof SyntaxError)) throw error;
  }
  await unlink(statusPath);
}

async function readDurableCanonArtifacts(projectId: string, chapterNo: number): Promise<CanonArtifacts | null> {
  const statusPath = canonArtifactStatusPath(projectId, chapterNo);
  if (!existsSync(statusPath)) return null;
  try {
    const diagnostics = JSON.parse(await readFile(statusPath, "utf8")) as CanonDiagnostics;
    const chapterId = String(chapterNo).padStart(3, "0");
    const [brief, detailed, full, snapshot, allFacts] = await Promise.all([
      readFile(withinProject(projectId, "chapters", "summaries", `chapter_${chapterId}_brief.md`), "utf8"),
      readFile(withinProject(projectId, "chapters", "summaries", `chapter_${chapterId}_detailed.md`), "utf8"),
      readFile(withinProject(projectId, "chapters", "summaries", `chapter_${chapterId}_full.md`), "utf8"),
      readCharacterSnapshot(projectId, chapterNo),
      readCanonFacts(projectId),
    ]);
    if (!snapshot || snapshot.chapterNo !== chapterNo) return null;
    return {
      summaries: { brief: brief.trim(), detailed: detailed.trim(), full: full.trim() },
      facts: allFacts.filter((fact) => fact.chapterNo === chapterNo),
      snapshot,
      diagnostics,
    };
  } catch {
    return null;
  }
}

async function writeCanonArtifactStatus(projectId: string, chapterNo: number, diagnostics: CanonDiagnostics) {
  await writeFile(canonArtifactStatusPath(projectId, chapterNo), `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
}

export async function syncChapterArtifacts(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  options?: {
    preview?:
      | {
          artifacts: Awaited<ReturnType<typeof extractCanonArtifacts>>;
          progressions: ReturnType<typeof buildCardProgressionsFromArtifacts>;
        }
      | null;
    reviewStatus?: "provisional" | "deep_locked";
  },
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  if (!project || !foundation) {
    throw new Error("项目或设定丢失");
  }

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const blueprint = getBlueprint(projectId, chapterNo);
  if (!blueprint) {
    throw new Error("缺少章节蓝图");
  }

  const preview = options?.preview ?? null;
  const previousArtifacts = preview ? null : await readDurableCanonArtifacts(projectId, chapterNo);
  const artifacts =
    preview?.artifacts ??
    (await extractCanonArtifacts({
      profile: context.agents.reviewer.profile,
      model: context.agents.reviewer.assignment.model,
      chapterNo,
      blueprint,
      foundation,
      chapterContent,
       prompts: {
        summaryPrompt: context.prompts.archivist,
         archivistPrompt: context.prompts.archivist,
       },
       previousArtifacts,
     }));
  const progressions =
    preview?.progressions ??
    buildCardProgressionsFromArtifacts({
      projectId,
      chapterNo,
      cards: listCards(projectId),
      snapshot: artifacts.snapshot,
      facts: artifacts.facts,
    });

  await saveSummaryFiles(projectId, chapterNo, artifacts.summaries);
  await writeCharacterSnapshot(projectId, chapterNo, artifacts.snapshot);

  replaceCanonFactsForChapter(projectId, chapterNo, artifacts.facts);
  // 产物已按最新正文重建，清空该章旧冲突（DB 与文件两份都要清，避免过期冲突残留）。
  saveConflictRecords(projectId, chapterNo, []);
  await writeConflictNote(projectId, chapterNo, []);
  await replaceCanonFactEntriesForChapter(projectId, chapterNo, artifacts.facts);
  await replaceForeshadowEntriesForChapter(projectId, chapterNo, buildForeshadowLedger(chapterNo, artifacts.facts));
  replaceCardProgressionsForChapter(projectId, chapterNo, progressions);
  recalculateAutoRecurringCharacterCards(projectId);

  upsertSummaryIndex(projectId, chapterNo, [
    {
      level: "brief",
      content: artifacts.summaries.brief,
      path: withinProject(projectId, "chapters", "summaries", `chapter_${String(chapterNo).padStart(3, "0")}_brief.md`),
      keywords: [project.title, ...blueprint.characters, ...blueprint.locations],
    },
    {
      level: "detailed",
      content: artifacts.summaries.detailed,
      path: withinProject(projectId, "chapters", "summaries", `chapter_${String(chapterNo).padStart(3, "0")}_detailed.md`),
      keywords: [project.title, ...blueprint.conflicts],
    },
    {
      level: "full",
      content: artifacts.summaries.full,
      path: withinProject(projectId, "chapters", "summaries", `chapter_${String(chapterNo).padStart(3, "0")}_full.md`),
      keywords: [project.title, ...blueprint.foreshadows],
    },
  ]);
  await writeCanonArtifactStatus(projectId, chapterNo, artifacts.diagnostics);
  if (artifacts.diagnostics.aggregateStatus !== "success") {
    appendRunStatistic(projectId, chapterNo, "canon", {
      ...artifacts.diagnostics,
    });
    throw new Error(`第 ${chapterNo} 章 Canon 产物部分成功，等待仅重试失败组件`);
  }

  // Logic State、声线与推进信号必须建立在本章 Summary/Snapshot/Facts 已耐久写入之后。
  // 该调用完成后，下一章的 artifact barrier 才能把本章判定为完整可读。
  await persistAcceptedChapterSignals(projectId, chapterNo);

  upsertChapterReviewState({
    projectId,
    chapterNo,
    status: options?.reviewStatus ?? "provisional",
    quickCheckedAt: getChapterReviewState(projectId, chapterNo)?.quickCheckedAt ?? nowIso(),
    deepCheckedAt: options?.reviewStatus === "deep_locked" ? nowIso() : null,
    lastReviewMode: options?.reviewStatus === "deep_locked" ? "deep" : "quick",
    latestConfidence: getRunState(projectId)?.confidence ?? 0,
  });
  appendRunStatistic(projectId, chapterNo, "canon", {
    usedFallback: Boolean(artifacts.diagnostics?.usedFallback),
    factCount: artifacts.diagnostics?.factCount ?? artifacts.facts.length,
    snapshotCharacterCount:
      artifacts.diagnostics?.snapshotCharacterCount
      ?? Object.keys(artifacts.snapshot.characters).length,
    missingCategories: artifacts.diagnostics?.missingCategories ?? [],
  });

  return {
    factsExtracted: artifacts.facts.length,
    progressionsExtracted: progressions.length,
    hasMajorProgression: hasMajorProgressionChange(progressions),
  };
}

function artifactSyncKey(projectId: string, chapterNo: number) {
  return `${projectId}:${chapterNo}`;
}

const OUTBOX_SYNC_POLL_INTERVAL_MS = 2_000;
const OUTBOX_SYNC_MAX_WAIT_MS = 10 * 60_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function hasActiveOutboxSyncJob(projectId: string, chapterNo: number) {
  return createArtifactOutboxRepository()
    .listActiveByChapter(projectId, chapterNo, "chapter_artifact_sync")
    .length > 0;
}

// Reconciler 进程可能正持有该章的 outbox sync job（LLM 提取耗时数十秒到数分钟）；
// 等待其离开 pending/claimed，避免 Runner 与 Reconciler 双进程并发提取与文件竞态。
async function waitForOutboxSyncSettled(
  projectId: string,
  chapterNo: number,
  options?: { pollIntervalMs?: number; maxWaitMs?: number },
) {
  const pollIntervalMs = options?.pollIntervalMs ?? OUTBOX_SYNC_POLL_INTERVAL_MS;
  const deadline = Date.now() + (options?.maxWaitMs ?? OUTBOX_SYNC_MAX_WAIT_MS);

  while (hasActiveOutboxSyncJob(projectId, chapterNo)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(pollIntervalMs);
  }
  return true;
}

export async function hasChapterArtifactsSynced(projectId: string, chapterNo: number) {
  const snapshot = await readCharacterSnapshot(projectId, chapterNo);
  const logicState = await readLatestLogicStateSnapshot(projectId, { uptoChapterNo: chapterNo + 1 });
  const durableArtifacts = await readDurableCanonArtifacts(projectId, chapterNo);
  const chapterId = String(chapterNo).padStart(3, "0");
  const summaryPaths = ["brief", "detailed", "full"].map((level) =>
    withinProject(projectId, "chapters", "summaries", `chapter_${chapterId}_${level}.md`)
  );
  const factsPath = withinProject(projectId, "canon", "facts.jsonl");
  if (
    snapshot?.chapterNo !== chapterNo
    || logicState?.chapterNo !== chapterNo
    || durableArtifacts?.diagnostics.aggregateStatus !== "success"
    || !existsSync(factsPath)
    || summaryPaths.some((path) => !existsSync(path))
  ) {
    return false;
  }
  const summaryContents = await Promise.all(summaryPaths.map((path) => readFile(path, "utf8")));
  return summaryContents.every((content) => content.trim().length > 0);
}

function queueChapterArtifactSync(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  options: {
    reviewStatus?: "provisional" | "deep_locked";
  },
  executionContext?: ProjectExecutionContext,
) {
  const key = artifactSyncKey(projectId, chapterNo);
  const existing = pendingArtifactSyncs.get(key);
  if (existing) {
    return existing;
  }

  const task = (async () => {
    const { factsExtracted, progressionsExtracted, hasMajorProgression } = await syncChapterArtifacts(
      projectId,
      chapterNo,
      chapterContent,
      options,
      executionContext,
    );
    if (hasMajorProgression) {
      appendRunLog(
        projectId,
        "warning",
        `第 ${chapterNo} 章异步分析发现明显进展变更，当前保留 provisional 状态，等待后续深审窗口复核。`,
      );
    } else {
      appendRunLog(
        projectId,
        "info",
        `第 ${chapterNo} 章异步收尾分析完成（facts=${factsExtracted}，progressions=${progressionsExtracted}）。`,
      );
    }
  })()
    .catch((error) => {
      appendRunLog(
        projectId,
        "warning",
        `第 ${chapterNo} 章异步收尾分析失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    })
    .finally(() => {
      pendingArtifactSyncs.delete(key);
    });

  pendingArtifactSyncs.set(key, task);
  return task;
}

export async function ensureChapterArtifactsReady(
  projectId: string,
  chapterNo: number,
  executionContext?: ProjectExecutionContext,
  outboxWaitOptions?: { pollIntervalMs?: number; maxWaitMs?: number },
) {
  if (chapterNo <= 0) {
    return;
  }

  const key = artifactSyncKey(projectId, chapterNo);
  const pending = pendingArtifactSyncs.get(key);
  if (pending) {
    await pending;
    if (await hasChapterArtifactsSynced(projectId, chapterNo)) {
      return;
    }
  }

  if (await hasChapterArtifactsSynced(projectId, chapterNo)) {
    return;
  }

  // Reconciler 正在跑该章的 sync job 时先等待它完成，而不是绕过 claim 机制重跑一遍。
  if (hasActiveOutboxSyncJob(projectId, chapterNo)) {
    await waitForOutboxSyncSettled(projectId, chapterNo, outboxWaitOptions);
    if (await hasChapterArtifactsSynced(projectId, chapterNo)) {
      return;
    }
  }

  const content = await readFinalChapter(projectId, chapterNo);
  if (!content?.trim()) {
    throw new Error(`第 ${chapterNo} 章正式正文不存在，无法满足前置产物屏障`);
  }

  const reviewState = getChapterReviewState(projectId, chapterNo);
  await queueChapterArtifactSync(
    projectId,
    chapterNo,
    content,
    {
      reviewStatus: reviewState?.status === "deep_locked" ? "deep_locked" : "provisional",
    },
    executionContext,
  );
  if (!(await hasChapterArtifactsSynced(projectId, chapterNo))) {
    throw new Error(`第 ${chapterNo} 章 Summary/Snapshot/Facts/Logic State 未完整就绪`);
  }
}

export async function syncCommittedChapterArtifacts(
  projectId: string,
  chapterNo: number,
  options?: {
    reviewStatus?: "provisional" | "deep_locked";
  },
  executionContext?: ProjectExecutionContext,
) {
  const content = await readFinalChapter(projectId, chapterNo);
  if (!content?.trim()) {
    throw notFound("正式章节正文不存在，无法同步分析产物");
  }

  return syncChapterArtifacts(
    projectId,
    chapterNo,
    content,
    {
      reviewStatus: options?.reviewStatus ?? "provisional",
    },
    executionContext,
  );
}
