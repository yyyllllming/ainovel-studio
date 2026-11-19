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
import { projectIdSchema, runStartPayloadSchema } from "../validation.ts";

const controlService = createControlService({
  launcher: createLauncherService(),
  sessionReconciler: createSessionReconciler(),
  sessionService: createSessionService(),
});

const progressService = createRunProgressService();

export interface RunStartRouteDependencies {
  controlService: Pick<typeof controlService, "startOrResumeRun">;
  progressService: Pick<typeof progressService, "getRunProgressView">;
  getProject: typeof getProject;
  getFoundation: typeof getFoundation;
  isFoundationLocked: typeof isFoundationLocked;
  getFoundationDriftReport?: typeof getFoundationDriftReport;
}

const defaultDependencies: RunStartRouteDependencies = {
  controlService,
  progressService,
  getProject,
  getFoundation,
  isFoundationLocked,
  getFoundationDriftReport,
};

function clampFromChapter(fromChapter: number | undefined, hardChapterCap: number | null | undefined) {
  const safeTarget = Math.max(1, Math.trunc(fromChapter ?? 1));
  if (!hardChapterCap || !Number.isFinite(hardChapterCap)) {
    return safeTarget;
  }
  return Math.min(safeTarget, hardChapterCap);
}

function ensureStartResponse(progress: RunProgressView, session: RunSessionRecord): RunProgressView {
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

export async function resolveRunStartRequest(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
  deps: RunStartRouteDependencies = defaultDependencies,
) {
  const { projectId } = await context.params;
  projectIdSchema.parse(projectId);
  const payload = runStartPayloadSchema.parse(await request.json().catch(() => ({}))); // empty body is a valid start request
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

  const fromChapter = clampFromChapter(payload.fromChapter, project.hardChapterCap);
  const session = deps.controlService.startOrResumeRun({ projectId, fromChapter });
  const progress = deps.progressService.getRunProgressView(projectId);
  return ensureStartResponse(progress, session);
}
