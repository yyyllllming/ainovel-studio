import "../server-only.ts";

import { basename } from "node:path";
import { updateProjectVoiceSnapshot } from "../content/project-voice-snapshot.service.ts";
import { notFound } from "../errors.ts";
import { readFinalChapter, readNovelExport, writeNovelExport, writeNovelExportFailure } from "../project-files.ts";
import { getProject, saveStoryContract } from "../repositories/project.repository.ts";
import { appendRunLog, buildRunProgress, getRunState, upsertRunState } from "../repositories/run.repository.ts";
import { saveStyleDeltaNotes } from "../repositories/review.repository.ts";
import { applyContinuationDecision } from "../story/story-contract.ts";
import { commitChapterState } from "../commit/chapter-commit-engine.ts";
import { syncAcceptedChapterStoryProgressState } from "../story/story-progression-sync.ts";
import { getLatestCurrentReview } from "./review-content-identity.service.ts";

export async function persistAcceptedChapterSignals(projectId: string, chapterNo: number) {
  const content = await readFinalChapter(projectId, chapterNo);
  const latestReview = await getLatestCurrentReview(projectId, chapterNo, content);
  const styleNotes = latestReview
    ? latestReview.styleChecklistHits
      .map((hit) => `${hit.dimension}：${hit.description}`)
      .filter(Boolean)
    : [];
  if (styleNotes.length) {
    saveStyleDeltaNotes(projectId, chapterNo, true, styleNotes);
  }

  await syncAcceptedChapterStoryProgressState(projectId, chapterNo).catch((error) => {
    appendRunLog(
      projectId,
      "warning",
      `第 ${chapterNo} 章故事推进状态回写失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  });
  await updateProjectVoiceSnapshot(projectId).catch((error) => {
    appendRunLog(
      projectId,
      "warning",
      `第 ${chapterNo} 章项目声线快照更新失败：${error instanceof Error ? error.message : "未知错误"}`,
    );
  });

  return commitChapterState(projectId, chapterNo);
}

export async function finalizeProjectCompletion(projectId: string, message: string, finalChapterNo?: number) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const completedChapterNo = finalChapterNo
    ?? getRunState(projectId)?.currentChapter
    ?? (project.chapterPlanningMode === "fixed"
      ? project.targetChapters
      : project.storyContract?.forecast.target ?? project.chapterBudgetTarget);
  if (project.storyContract && project.storyContract.forecast.completionProgress < 1) {
    saveStoryContract(projectId, applyContinuationDecision(project.storyContract, {
      chapterNo: completedChapterNo,
      decision: "complete_story",
      summary: message,
      nextPlan: [],
    }));
  }

  upsertRunState(projectId, {
    stage: "completed",
    status: "completed",
    desiredState: "idle",
    heartbeatAt: null,
    currentChapter: completedChapterNo,
    totalChapters: completedChapterNo,
    retryCount: 0,
    confidence: 1,
    lastError: null,
  });
  appendRunLog(projectId, "info", message);

  const exportState = await readNovelExport(projectId);
  if (exportState.status !== "pending") {
    return buildRunProgress(projectId);
  }

  try {
    const exportResult = await writeNovelExport(projectId, {
      title: project.title,
      targetChapters: completedChapterNo,
    });

    if (exportResult.status === "ready" && exportResult.path) {
      appendRunLog(projectId, "info", `小说 TXT 已导出：${basename(exportResult.path)}`);
    } else {
      appendRunLog(projectId, "warning", `小说 TXT 导出失败：${exportResult.error ?? "未知错误"}`);
    }
  } catch (error) {
    const exportError = error instanceof Error ? error.message : "小说 TXT 导出失败";
    appendRunLog(projectId, "warning", `小说 TXT 导出失败：${exportError}`);
    try {
      await writeNovelExportFailure(projectId, exportError);
    } catch {
      // 如果 sidecar 也无法写入，保留 completed 状态并只记录日志。
    }
  }

  return buildRunProgress(projectId);
}
