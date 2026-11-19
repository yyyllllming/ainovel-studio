import "../server-only.ts";

import { createSessionService } from "../run/session.service.ts";
import { getRunState } from "../repositories/run.repository.ts";

export interface ChapterSessionGuardDependencies {
  getOpenSessionByProjectId: ReturnType<typeof createSessionService>["getOpenSessionByProjectId"];
  getRunStage: (projectId: string) => string | null;
}

export function createChapterSessionGuard(input?: Partial<ChapterSessionGuardDependencies>) {
  const deps = {
    getOpenSessionByProjectId: createSessionService().getOpenSessionByProjectId,
    getRunStage: (projectId: string) => getRunState(projectId)?.stage ?? null,
    ...input,
  } as ChapterSessionGuardDependencies;

  return {
    assertNoOpenSession(
      projectId: string,
      actionLabel: string,
      options?: {
        allowDuringManualReview?: boolean;
      },
    ) {
      const session = deps.getOpenSessionByProjectId(projectId);
      if (!session || session.terminalAt) {
        return;
      }
      if (options?.allowDuringManualReview && deps.getRunStage(projectId) === "manual_review") {
        return;
      }

      throw new Error(
        `当前存在未关闭的运行会话（${session.lifecycleStatus}），请先停止或关闭后再${actionLabel}`,
      );
    },
  };
}
