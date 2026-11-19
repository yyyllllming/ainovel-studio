import "../server-only.ts";

import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import { deriveRunProgressView, mergeRunStageDetails } from "../run/run-state.ts";
import type { RunProgressPayload, RunStatisticRecord } from "../types.ts";
import { nowIso, safeJsonParse } from "../utils.ts";
import { getProject, getStoryContract } from "./project.repository.ts";
import { type RunStateRecord, toRunStateRecord } from "./shared.ts";

const BLUEPRINT_HEALTH_WINDOW = 20;
const BLUEPRINT_HEALTH_MIN_SAMPLE = 12;
const BLUEPRINT_HEALTH_MAX_REPAIR_RATE = 0.2;
const BLUEPRINT_HEALTH_MAX_FALLBACK_RATE = 0.05;
const BLUEPRINT_HEALTH_MAX_HARD_CONFLICT_RATE = 0;
const BLUEPRINT_HEALTH_MIN_MEDIAN_VERIFICATION_SCORE = 4;

export type BlueprintRunRecommendation =
  | "data_insufficient"
  | "keep_3"
  | "observe"
  | "safe_to_try_2";

export interface BlueprintRunHealthSummary {
  windowSize: number;
  sampleCount: number;
  repairRate: number;
  fallbackRate: number;
  hardConflictRate: number;
  medianVerificationScore: number | null;
  recommendation: BlueprintRunRecommendation;
}

function parseRunStatisticRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    stage: String(row.stage) as RunStatisticRecord["stage"],
    metrics: safeJsonParse<Record<string, unknown>>(String(row.metrics_json ?? "{}"), {}),
    createdAt: String(row.created_at),
  } satisfies RunStatisticRecord;
}

function readBooleanMetric(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    return value === "true" || value === "1";
  }
  return false;
}

function readNumberMetric(metrics: Record<string, unknown>, key: string) {
  const value = metrics[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (left === undefined || right === undefined) {
    return null;
  }
  return (left + right) / 2;
}

function toRate(count: number, total: number) {
  if (!total) {
    return 0;
  }
  return Number((count / total).toFixed(4));
}

export function getRunState(projectId: string): RunStateRecord | null {
  const row = rawDb.prepare("SELECT * FROM run_states WHERE project_id = ?").get(projectId) as
    | Record<string, unknown>
    | undefined;
  return row ? toRunStateRecord(row) : null;
}

export function upsertRunState(
  projectId: string,
  patch: Partial<RunStateRecord> & Pick<RunStateRecord, "stage">,
) {
  const current = getRunState(projectId);
  const now = nowIso();
  const next: RunStateRecord = {
    projectId,
    status: patch.status ?? patch.stage,
    stage: patch.stage,
    desiredState: patch.desiredState ?? current?.desiredState ?? (patch.stage === "paused" ? "paused" : "idle"),
    runSessionId: patch.runSessionId !== undefined ? patch.runSessionId : current?.runSessionId ?? null,
    heartbeatAt: patch.heartbeatAt !== undefined ? patch.heartbeatAt : current?.heartbeatAt ?? null,
    currentChapter: patch.currentChapter ?? current?.currentChapter ?? 1,
    totalChapters: patch.totalChapters ?? current?.totalChapters ?? 1,
    retryCount: patch.retryCount ?? current?.retryCount ?? 0,
    confidence: patch.confidence ?? current?.confidence ?? 0,
    lastError: patch.lastError !== undefined ? patch.lastError : current?.lastError ?? null,
    draftFile: patch.draftFile !== undefined ? patch.draftFile : current?.draftFile ?? null,
    currentPosition: patch.currentPosition ?? current?.currentPosition ?? 0,
    wordCount: patch.wordCount ?? current?.wordCount ?? 0,
    stageDetails: mergeRunStageDetails(
      patch.stage,
      current?.stageDetails,
      patch.stageDetails,
    ),
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
  };

  rawDb
    .prepare(`
      INSERT INTO run_states (
        project_id, status, stage, desired_state, run_session_id, heartbeat_at, current_chapter, total_chapters, retry_count, confidence,
        last_error, draft_file, current_position, word_count, stage_details_json, started_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        status = excluded.status,
        stage = excluded.stage,
        desired_state = excluded.desired_state,
        run_session_id = excluded.run_session_id,
        heartbeat_at = excluded.heartbeat_at,
        current_chapter = excluded.current_chapter,
        total_chapters = excluded.total_chapters,
        retry_count = excluded.retry_count,
        confidence = excluded.confidence,
        last_error = excluded.last_error,
        draft_file = excluded.draft_file,
        current_position = excluded.current_position,
        word_count = excluded.word_count,
        stage_details_json = excluded.stage_details_json,
        updated_at = excluded.updated_at
    `)
    .run(
      next.projectId,
      next.status,
      next.stage,
      next.desiredState,
      next.runSessionId,
      next.heartbeatAt,
      next.currentChapter,
      next.totalChapters,
      next.retryCount,
      next.confidence,
      next.lastError,
      next.draftFile,
      next.currentPosition,
      next.wordCount,
      JSON.stringify(next.stageDetails),
      next.startedAt,
      next.updatedAt,
    );

  return next;
}

export function appendRunLog(projectId: string, level: string, message: string) {
  rawDb
    .prepare("INSERT INTO run_logs (id, project_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(nanoid(), projectId, level, message, nowIso());
}

export function appendRunStatistic(
  projectId: string,
  chapterNo: number,
  stage: RunStatisticRecord["stage"],
  metrics: RunStatisticRecord["metrics"],
) {
  const record: RunStatisticRecord = {
    id: nanoid(),
    projectId,
    chapterNo,
    stage,
    metrics,
    createdAt: nowIso(),
  };

  rawDb
    .prepare(`
      INSERT INTO run_statistics (id, project_id, chapter_no, stage, metrics_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      record.id,
      record.projectId,
      record.chapterNo,
      record.stage,
      JSON.stringify(record.metrics ?? {}),
      record.createdAt,
    );

  return record;
}

export function listRunStatistics(projectId: string, chapterNo?: number): RunStatisticRecord[] {
  const rows = chapterNo
    ? (rawDb
      .prepare(`
        SELECT * FROM run_statistics
        WHERE project_id = ? AND chapter_no = ?
        ORDER BY created_at DESC, _rowid_ DESC
      `)
      .all(projectId, chapterNo) as Array<Record<string, unknown>>)
    : (rawDb
      .prepare(`
        SELECT * FROM run_statistics
        WHERE project_id = ?
        ORDER BY created_at DESC, _rowid_ DESC
      `)
      .all(projectId) as Array<Record<string, unknown>>);

  return rows.map(parseRunStatisticRow);
}

export function listRunStatisticsByStage(
  projectId: string,
  stage: RunStatisticRecord["stage"],
  limit = BLUEPRINT_HEALTH_WINDOW,
) {
  const rows = rawDb
    .prepare(`
      SELECT * FROM run_statistics
      WHERE project_id = ? AND stage = ?
      ORDER BY created_at DESC, _rowid_ DESC
      LIMIT ?
    `)
    .all(projectId, stage, Math.max(1, limit)) as Array<Record<string, unknown>>;

  return rows.map(parseRunStatisticRow);
}

export function summarizeBlueprintRunHealth(
  projectId: string,
  window = BLUEPRINT_HEALTH_WINDOW,
): BlueprintRunHealthSummary {
  const effectiveWindow = Math.max(1, window);
  const blueprintRows = listRunStatisticsByStage(projectId, "blueprint", effectiveWindow);
  const sampleCount = blueprintRows.length;
  if (!sampleCount) {
    return {
      windowSize: effectiveWindow,
      sampleCount: 0,
      repairRate: 0,
      fallbackRate: 0,
      hardConflictRate: 0,
      medianVerificationScore: null,
      recommendation: "data_insufficient",
    };
  }

  const conflictRows = listRunStatisticsByStage(projectId, "conflict", Math.max(effectiveWindow * 4, effectiveWindow));
  const conflictByChapter = new Map<number, RunStatisticRecord>();
  for (const row of conflictRows) {
    if (!conflictByChapter.has(row.chapterNo)) {
      conflictByChapter.set(row.chapterNo, row);
    }
  }

  const repairCount = blueprintRows.filter((row) => readBooleanMetric(row.metrics, "repairUsed")).length;
  const fallbackCount = blueprintRows.filter((row) => readBooleanMetric(row.metrics, "fallbackUsed")).length;
  const hardConflictCount = blueprintRows.filter((row) => {
    const conflictRow = conflictByChapter.get(row.chapterNo);
    return (readNumberMetric(conflictRow?.metrics ?? {}, "hardConflictCount") ?? 0) > 0;
  }).length;
  const verificationScores = blueprintRows
    .map((row) => readNumberMetric(row.metrics, "verificationScore"))
    .filter((value): value is number => value !== null);
  const medianVerificationScore = median(verificationScores);
  const repairRate = toRate(repairCount, sampleCount);
  const fallbackRate = toRate(fallbackCount, sampleCount);
  const hardConflictRate = toRate(hardConflictCount, sampleCount);

  let recommendation: BlueprintRunRecommendation = "data_insufficient";
  if (sampleCount < BLUEPRINT_HEALTH_MIN_SAMPLE || medianVerificationScore === null) {
    recommendation = "data_insufficient";
  } else if (
    repairRate <= BLUEPRINT_HEALTH_MAX_REPAIR_RATE
    && fallbackRate <= BLUEPRINT_HEALTH_MAX_FALLBACK_RATE
    && hardConflictRate <= BLUEPRINT_HEALTH_MAX_HARD_CONFLICT_RATE
    && medianVerificationScore >= BLUEPRINT_HEALTH_MIN_MEDIAN_VERIFICATION_SCORE
  ) {
    recommendation = "safe_to_try_2";
  } else if (
    fallbackRate > BLUEPRINT_HEALTH_MAX_FALLBACK_RATE
    || hardConflictRate > BLUEPRINT_HEALTH_MAX_HARD_CONFLICT_RATE
  ) {
    recommendation = "keep_3";
  } else {
    recommendation = "observe";
  }

  return {
    windowSize: effectiveWindow,
    sampleCount,
    repairRate,
    fallbackRate,
    hardConflictRate,
    medianVerificationScore,
    recommendation,
  };
}

export function listRunLogs(projectId: string, limit = 40) {
  return rawDb
    .prepare("SELECT level, message, created_at FROM run_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(projectId, limit) as Array<{ level: string; message: string; created_at: string }>;
}

export function buildRunProgress(projectId: string): RunProgressPayload {
  const state = getRunState(projectId);
  const project = getProject(projectId);
  const storyContract = getStoryContract(projectId);
  const progress = {
    running: Boolean(state && !["idle", "completed", "failed", "manual_review", "paused"].includes(state.status)),
    stage: state?.stage ?? "idle",
    currentChapter: state?.currentChapter ?? 1,
    totalChapters: state?.totalChapters ?? 1,
    retryCount: state?.retryCount ?? 0,
    confidence: state?.confidence ?? 0,
    draftFile: state?.draftFile ?? undefined,
    currentPosition: state?.currentPosition ?? 0,
    wordCount: state?.wordCount ?? 0,
    stageDetails: state?.stageDetails ?? {},
    planningMode: project?.chapterPlanningMode,
    currentVolume: storyContract?.currentVolume,
    hardChapterCap: project?.hardChapterCap,
    forecastRange: storyContract
      ? {
          min: storyContract.forecast.min,
          target: storyContract.forecast.target,
          max: storyContract.forecast.max,
        }
      : project
        ? {
            min: project.chapterBudgetMin,
            target: project.chapterBudgetTarget,
            max: project.chapterBudgetMax,
          }
        : undefined,
    completionProgress: storyContract?.forecast.completionProgress,
    nextPlan: storyContract?.recentPlan ?? [],
    error: state?.lastError ?? undefined,
    logs: listRunLogs(projectId, 25)
      .reverse()
      .map((entry) => ({
        level: entry.level,
        message: entry.message,
        createdAt: entry.created_at,
      })),
  };

  return state
    ? deriveRunProgressView(
        {
          ...progress,
          running: Boolean(state && !["idle", "completed", "failed", "manual_review", "paused", "interrupted"].includes(progress.stage)),
        },
        {
          desiredState: state.desiredState,
          heartbeatAt: state.heartbeatAt,
        },
      )
    : progress;
}
