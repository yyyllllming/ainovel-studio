import "../server-only.ts";

import { createCommitReconciler, runCommitReconcilerPass } from "./commit-reconciler.ts";
import { syncCommittedChapterArtifacts } from "./sync-committed-artifacts.service.ts";
import { safeParseJson } from "../utils/safe-json.ts";

async function main() {
  const reconciler = createCommitReconciler({
    runOutboxJob: async (job) => {
      const payload = safeParseJson<{
        projectId?: string;
        chapterNo?: number;
        reviewStatus?: "provisional" | "deep_locked";
      }>(job.payloadJson);
      if (!payload) {
        process.emitWarning(`commit outbox payload 损坏，已跳过 job=${job.jobId}`);
        return;
      }
      await syncCommittedChapterArtifacts(
        payload.projectId ?? job.projectId,
        payload.chapterNo ?? job.chapterNo,
        {
          reviewStatus: payload.reviewStatus ?? "provisional",
        },
      );
    },
  });

  await runCommitReconcilerPass({
    reconciler,
    workerId: `commit-reconciler:${process.pid}`,
  });
}

main().catch((error) => {
  console.error("[commit-reconciler] fatal:", error);
  process.exitCode = 1;
});
