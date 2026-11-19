import "../server-only.ts";

import { createControlService } from "./control.service.ts";
import { createLauncherService } from "./launcher.service.ts";
import type { RunProgressView } from "./progress.service.ts";
import { createRunProgressService } from "./progress.service.ts";
import { createSessionReconciler } from "./session-reconciler.ts";
import { createSessionService } from "./session.service.ts";
import type { RunSessionRecord } from "../repositories/run-session.repository.ts";
import { projectIdSchema } from "../validation.ts";

const controlService = createControlService({
  launcher: createLauncherService(),
  sessionReconciler: createSessionReconciler(),
  sessionService: createSessionService(),
});

const progressService = createRunProgressService();

export interface RunPauseRouteDependencies {
  controlService: Pick<typeof controlService, "pauseRun">;
  progressService: Pick<typeof progressService, "getRunProgressView">;
}

function ensurePauseResponse(progress: RunProgressView, session: RunSessionRecord): RunProgressView {
  return {
    ...progress,
    running: false,
    stage: "paused",
    currentChapter: session.currentChapter ?? session.fromChapter ?? progress.currentChapter,
    desiredState: "paused",
    sessionId: session.sessionId,
    lifecycleStatus: session.lifecycleStatus,
    recoverable: true,
  };
}

export async function resolveRunPauseRequest(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
  deps: RunPauseRouteDependencies = {
    controlService,
    progressService,
  },
) {
  const { projectId } = await context.params;
  projectIdSchema.parse(projectId);
  const session = deps.controlService.pauseRun(projectId);
  const progress = deps.progressService.getRunProgressView(projectId);
  return ensurePauseResponse(progress, session);
}
