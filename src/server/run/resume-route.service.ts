import "../server-only.ts";

import { notFound } from "../errors.ts";
import { getFoundation, isFoundationLocked } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { getRunState } from "../repositories/run.repository.ts";
import { getFoundationDriftReport } from "../services/foundation-truth-source.service.ts";
import type { RunSessionRecord } from "../repositories/run-session.repository.ts";
import { createRunSessionRepository } from "../repositories/run-session.repository.ts";
import { createControlService } from "./control.service.ts";
import { createLauncherService } from "./launcher.service.ts";
import type { RunProgressView } from "./progress.service.ts";
import { createRunProgressService } from "./progress.service.ts";
import { createSessionReconciler } from "./session-reconciler.ts";
import { createSessionService } from "./session.service.ts";
import { projectIdSchema } from "../validation.ts";

const controlService = createControlService({
  launcher: createLauncherService(),
  sessionReconciler: createSessionReconciler(),
  sessionService: createSessionService(),
});

const progressService = createRunProgressService();
const sessionRepo = createRunSessionRepository();

export interface RunResumeRouteDependencies {
  controlService: Pick<typeof controlService, "startOrResumeRun">;
  progressService: Pick<typeof progressService, "getRunProgressView">;
  getProject: typeof getProject;
  getFoundation: typeof getFoundation;
  isFoundationLocked: typeof isFoundationLocked;
  getFoundationDriftReport?: typeof getFoundationDriftReport;
  getOpenSessionByProjectId: typeof sessionRepo.getOpenSessionByProjectId;
  getRunState?: typeof getRunState;
}

const defaultDependencies: RunResumeRouteDependencies = {
  controlService,
  progressService,
  getProject,
  getFoundation,
  isFoundationLocked,
  getFoundationDriftReport,
  getOpenSessionByProjectId: sessionRepo.getOpenSessionByProjectId,
  getRunState,
};

function resolveResumeChapter(projectId: string, deps: RunResumeRouteDependencies) {
  const openSession = deps.getOpenSessionByProjectId(projectId);
  if (!openSession) {
    throw new Error("没有可恢复的运行会话");
  }
  if (openSession.currentChapter != null) {
    return {
      fromChapter: openSession.currentChapter,
      existingSession: openSession,
    };
  }
  // Older sessions never mirrored progress into run_sessions.current_chapter.
  // run_state carries the real chapter for runs owned by this session, so prefer it
  // over from_chapter — otherwise resume would regenerate from the original start
  // and overwrite already finalized chapters.
  const state = (deps.getRunState ?? getRunState)(projectId);
  const fallbackChapter =
    state && state.runSessionId === openSession.sessionId ? state.currentChapter : null;
  return {
    fromChapter: fallbackChapter ?? openSession.fromChapter,
    existingSession: openSession,
  };
}

function ensureResumeResponse(progress: RunProgressView, session: RunSessionRecord): RunProgressView {
  if (!["queued", "launching", "running", "recovering"].includes(session.lifecycleStatus)) {
    return progress;
  }

  const resumeStage =
    (session.currentStage as RunProgressView["stage"] | null)
    ?? progress.lastActiveStage
    ?? null;
  return {
    ...progress,
    running: true,
    stage:
      progress.stage === "paused" || progress.stage === "interrupted" || progress.stage === "idle"
        ? (resumeStage ?? "blueprint")
        : progress.stage,
    currentChapter: session.currentChapter ?? session.fromChapter ?? progress.currentChapter,
    desiredState: "running",
    heartbeatAt: session.lastHeartbeatAt,
    sessionId: session.sessionId,
    lifecycleStatus: session.lifecycleStatus,
    recoverable: false,
  };
}

export async function resolveRunResumeRequest(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
  deps: RunResumeRouteDependencies = defaultDependencies,
) {
  const { projectId } = await context.params;
  projectIdSchema.parse(projectId);
  const project = deps.getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  if (!deps.getFoundation(projectId) || !deps.isFoundationLocked(projectId)) {
    throw new Error("请先整理并锁定正式设定，再开始自动写作");
  }
  const drift = (deps.getFoundationDriftReport ?? getFoundationDriftReport)(projectId);
  if (drift.coreDrift) {
    throw new Error(drift.blockingReason ?? "请先整理正式设定，再开始自动写作");
  }

  const { fromChapter } = resolveResumeChapter(projectId, deps);
  const session = deps.controlService.startOrResumeRun({ projectId, fromChapter });
  const progress = deps.progressService.getRunProgressView(projectId);
  return ensureResumeResponse(progress, session);
}
