import "../server-only.ts";

import { notFound } from "../errors.ts";
import { getFoundation, isFoundationLocked } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { getFoundationDriftReport } from "../services/foundation-truth-source.service.ts";
import type { RunSessionRecord } from "../repositories/run-session.repository.ts";
import { createControlService } from "./control.service.ts";
import { createLauncherService } from "./launcher.service.ts";
import type { RunProgressView } from "./progress.service.ts";
import { createRunProgressService } from "./progress.service.ts";
import { createSessionReconciler } from "./session-reconciler.ts";
import { createSessionService } from "./session.service.ts";
import { softInvalidateChapterRange } from "../services/run-restart.service.ts";

const controlService = createControlService({
  launcher: createLauncherService(),
  sessionReconciler: createSessionReconciler(),
  sessionService: createSessionService(),
});

const progressService = createRunProgressService();

export interface RestartRunFromChapterDependencies {
  controlService: Pick<typeof controlService, "startOrResumeRun">;
  progressService: Pick<typeof progressService, "getRunProgressView">;
  getProject: typeof getProject;
  getFoundation: typeof getFoundation;
  isFoundationLocked: typeof isFoundationLocked;
  getFoundationDriftReport?: typeof getFoundationDriftReport;
  softInvalidateChapterRange: (
    projectId: string,
    input: {
      fromChapter: number;
      reason: string;
      reviewReason?: string | null;
    },
  ) => Promise<{
    startChapter: number;
    endChapter: number;
    invalidatedChapters: number[];
  }>;
}

function ensureRestartResponse(progress: RunProgressView, session: RunSessionRecord): RunProgressView {
  if (!["queued", "launching", "running", "recovering"].includes(session.lifecycleStatus)) {
    return progress;
  }

  return {
    ...progress,
    running: true,
    stage: progress.stage === "idle" ? "blueprint" : progress.stage,
    currentChapter: session.currentChapter ?? session.fromChapter ?? progress.currentChapter,
    desiredState: "running",
    heartbeatAt: session.lastHeartbeatAt,
    sessionId: session.sessionId,
    lifecycleStatus: session.lifecycleStatus,
    recoverable: false,
  };
}

export async function restartRunFromChapter(
  input: {
    projectId: string;
    fromChapter: number;
    invalidationReason?: string;
    reviewReason?: string | null;
  },
  deps?: RestartRunFromChapterDependencies,
) {
  const runtimeDeps = deps ?? {
    controlService,
    progressService,
    getProject,
    getFoundation,
    isFoundationLocked,
    getFoundationDriftReport,
    softInvalidateChapterRange,
  } satisfies RestartRunFromChapterDependencies;

  const project = runtimeDeps.getProject(input.projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  if (!runtimeDeps.getFoundation(input.projectId) || !runtimeDeps.isFoundationLocked(input.projectId)) {
    throw new Error("请先整理并锁定正式设定，再开始自动写作");
  }
  const drift = (runtimeDeps.getFoundationDriftReport ?? getFoundationDriftReport)(input.projectId);
  if (drift.coreDrift) {
    throw new Error(drift.blockingReason ?? "请先整理正式设定，再开始自动写作");
  }

  if (input.invalidationReason) {
    await runtimeDeps.softInvalidateChapterRange(input.projectId, {
      fromChapter: input.fromChapter,
      reason: input.invalidationReason,
      reviewReason: input.reviewReason ?? null,
    });
  }

  const session = runtimeDeps.controlService.startOrResumeRun({
    projectId: input.projectId,
    fromChapter: input.fromChapter,
  });
  const progress = runtimeDeps.progressService.getRunProgressView(input.projectId);
  return ensureRestartResponse(progress, session);
}
