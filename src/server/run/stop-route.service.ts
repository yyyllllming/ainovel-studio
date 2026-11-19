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

export interface RunStopRouteDependencies {
  controlService: Pick<typeof controlService, "stopRun">;
  progressService: Pick<typeof progressService, "getRunProgressView">;
}

function ensureStopResponse(progress: RunProgressView, session: RunSessionRecord): RunProgressView {
  const stopping = ["queued", "launching", "running", "recovering"].includes(session.lifecycleStatus)
    && session.desiredState === "stop_requested";
  const stage =
    stopping
      ? ((session.currentStage as RunProgressView["stage"] | null) ?? progress.stage ?? "blueprint")
      : progress.stage;

  return {
    ...progress,
    running: stopping,
    stage,
    currentChapter: session.currentChapter ?? session.fromChapter ?? progress.currentChapter,
    desiredState: "stopped",
    sessionId: session.sessionId,
    lifecycleStatus: session.lifecycleStatus,
    recoverable: false,
  };
}

export async function resolveRunStopRequest(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
  deps: RunStopRouteDependencies = {
    controlService,
    progressService,
  },
) {
  const { projectId } = await context.params;
  projectIdSchema.parse(projectId);
  const session = deps.controlService.stopRun(projectId);
  const progress = deps.progressService.getRunProgressView(projectId);
  return ensureStopResponse(progress, session);
}
