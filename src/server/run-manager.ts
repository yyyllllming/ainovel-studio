import "./server-only.ts";

import { notFound } from "./errors.ts";
import { getFoundation, isFoundationLocked } from "./repositories/foundation.repository.ts";
import { getProject } from "./repositories/project.repository.ts";
import { appendRunLog, buildRunProgress, getRunState, upsertRunState } from "./repositories/run.repository.ts";
import { createRunSessionRepository } from "./repositories/run-session.repository.ts";
import { executeRun } from "./run/chapter-runner.ts";
import {
  buildSuspendedRunStatePatch,
  createLock,
  readLockState,
  releaseLock,
  runningTasks,
  updateLockState,
} from "./run/run-internals.ts";
import { deriveRunProgressView, resolveResumeStage } from "./run/run-state.ts";
import { getFoundationDriftReport } from "./services/foundation-truth-source.service.ts";
import {
  finalizeProjectCompletion as finalizeProjectCompletionService,
  persistAcceptedChapterSignals as persistAcceptedChapterSignalsService,
} from "./services/manual-review.service.ts";
import { nowIso } from "./utils.ts";

export { autoPickVersionForManualReview, requireActiveManualReview } from "./run/manual-review-engine.ts";
export { ensureRunSessionActive } from "./run/session-activation.ts";
export { buildDynamicPlannerExemplars, buildStaticPlannerExemplars } from "./story/planner-exemplars.ts";
export { planChapterBlueprint } from "./story/blueprint-plan-engine.ts";
export { syncAcceptedChapterStoryProgressState } from "./story/story-progression-sync.ts";
export { ensureSegmentPlans } from "./story/segment-plan-engine.ts";
export { ensureStoryContract } from "./story/story-contract-engine.ts";
export { invalidateFutureTimelineAfterChapterChange, softInvalidateChapterRange } from "./story/timeline-invalidation.ts";
export { commitChapterState } from "./commit/chapter-commit-engine.ts";
export { syncChapterArtifacts, syncCommittedChapterArtifacts } from "./commit/chapter-artifact-sync.ts";

// NOTE: Generation only runs inside the detached Runner process (run/runner-main.ts).
// API routes must go through the run/ route services (start/resume/stop/pause/manual-review)
// plus controlService; do not re-introduce in-process startRun/resumeRun entrypoints here —
// they would bypass the run_sessions control plane and become unpausable background work.
export async function runDetachedExecution(
  projectId: string,
  input: {
    sessionId: string;
    fromChapter: number;
  },
) {
  const project = getProject(projectId);
  const state = getRunState(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  if (!getFoundation(projectId) || !isFoundationLocked(projectId)) {
    throw new Error("请先整理并锁定正式设定，再开始自动写作");
  }
  const drift = getFoundationDriftReport(projectId);
  if (drift.coreDrift) {
    throw new Error(drift.blockingReason ?? "请先整理正式设定，再开始自动写作");
  }

  createLock(projectId, input.sessionId);

  try {
    if (state && state.currentChapter === input.fromChapter) {
      const resumeStage = resolveResumeStage(state.stage, state.stageDetails);
      upsertRunState(projectId, {
        stage: resumeStage,
        status: resumeStage,
        desiredState: "running",
        runSessionId: input.sessionId,
        heartbeatAt: nowIso(),
        currentChapter: state.currentChapter,
        totalChapters: state.totalChapters,
        retryCount: state.retryCount,
        confidence: state.confidence,
        lastError: null,
        draftFile: state.draftFile ?? null,
        currentPosition: state.currentPosition ?? 0,
        wordCount: state.wordCount ?? 0,
        stageDetails: state.stageDetails ?? {},
      });
    } else {
      upsertRunState(projectId, {
        stage: "blueprint",
        status: "blueprint",
        desiredState: "running",
        runSessionId: input.sessionId,
        heartbeatAt: nowIso(),
        currentChapter: input.fromChapter,
        totalChapters: project.storyContract?.forecast.target ?? project.chapterBudgetTarget,
        retryCount: 0,
        confidence: 0,
        lastError: null,
        draftFile: null,
        currentPosition: 0,
        wordCount: 0,
        stageDetails: {
          blueprint: {
            generated: false,
            conflictCount: 0,
          },
        },
      });
    }

    // Seed the control-plane progress before the first heartbeat so an immediate
    // crash/pause still resumes from the chapter this execution actually targets.
    createRunSessionRepository().updateProgress({
      sessionId: input.sessionId,
      currentChapter: input.fromChapter,
      currentStage: getRunState(projectId)?.stage ?? "blueprint",
      updatedAt: nowIso(),
    });

    await executeRun(projectId, input.fromChapter);
  } catch (error) {
    await releaseLock(projectId, input.sessionId);
    throw error;
  }
}

export function pauseRun(projectId: string) {
  const task = runningTasks.get(projectId);
  const lockState = readLockState(projectId);
  if (!task && !lockState) {
    throw new Error("当前没有运行中的任务");
  }
  if (task) {
    task.paused = true;
  }
  updateLockState(projectId, { paused: true, desiredState: "paused", heartbeatAt: nowIso() });
  upsertRunState(projectId, buildSuspendedRunStatePatch(projectId, "paused"));
  appendRunLog(projectId, "info", "任务已暂停");
  return buildRunProgress(projectId);
}

export function stopRun(projectId: string) {
  const task = runningTasks.get(projectId);
  if (task) {
    task.stopRequested = true;
  }
  if (readLockState(projectId)) {
    updateLockState(projectId, { stopRequested: true, paused: false, desiredState: "stopped", heartbeatAt: nowIso() });
  }
  const state = getRunState(projectId);
  if (state) {
    upsertRunState(projectId, {
      stage: state.stage,
      status: state.status,
      desiredState: "stopped",
      heartbeatAt: nowIso(),
      currentChapter: state.currentChapter,
      totalChapters: state.totalChapters,
      retryCount: state.retryCount,
      confidence: state.confidence,
      lastError: state.lastError,
      draftFile: state.draftFile,
      currentPosition: state.currentPosition,
      wordCount: state.wordCount,
      stageDetails: state.stageDetails,
    });
  }
  appendRunLog(projectId, "warning", "任务收到停止请求");
  return buildRunProgress(projectId);
}

export function getRunProgress(projectId: string) {
  const progress = buildRunProgress(projectId);
  const state = getRunState(projectId);
  return state
    ? deriveRunProgressView(
        progress,
        {
          desiredState: state.desiredState,
          heartbeatAt: state.heartbeatAt,
        },
      )
    : progress;
}

export async function finalizeProjectCompletion(projectId: string, message: string, finalChapterNo?: number) {
  return finalizeProjectCompletionService(projectId, message, finalChapterNo);
}

export async function persistAcceptedChapterSignals(projectId: string, chapterNo: number) {
  return persistAcceptedChapterSignalsService(projectId, chapterNo);
}
