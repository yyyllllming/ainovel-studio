import "../server-only.ts";

import {
  cleanupCommitStage,
  commitStageManifestSchema,
  inspectCommitStage,
  scanCommitStageResidues,
  type CommitStageManifest,
} from "../project-files.ts";
import { nowIso } from "../utils.ts";
import { createChapterCommitRepository } from "../repositories/chapter-commit.repository.ts";
import { createArtifactOutboxRepository, type ArtifactOutboxRecord } from "../repositories/artifact-outbox.repository.ts";
import { listProjects } from "../repositories/project.repository.ts";
import { createChapterCommitService } from "./chapter-commit.service.ts";
import { createOutboxService } from "./outbox.service.ts";
import { safeParseJsonSchema } from "../utils/safe-json.ts";

export interface CommitReconcilerDependencies {
  commitRepo: ReturnType<typeof createChapterCommitRepository>;
  outboxRepo: ReturnType<typeof createArtifactOutboxRepository>;
  commitService: ReturnType<typeof createChapterCommitService>;
  outboxService: ReturnType<typeof createOutboxService>;
  inspectCommitStage: typeof inspectCommitStage;
  scanCommitStageResidues: typeof scanCommitStageResidues;
  cleanupCommitStage: typeof cleanupCommitStage;
  listProjectIds: () => string[];
  runOutboxJob: (job: ArtifactOutboxRecord) => Promise<void>;
  now: () => string;
  buildNextAttemptAt: (attempts: number, now: string) => string;
  isRetryableError: (error: unknown) => boolean;
  renewClaimIntervalMs: number;
  logWarning: (message: string) => void;
}

// 这些错误由确定性的业务状态导致（蓝图/正文/项目缺失、数据损坏），重试不可能成功。
const PERMANENT_OUTBOX_ERROR_PATTERNS = [
  /缺少章节蓝图/u,
  /正式章节正文不存在/u,
  /项目或设定丢失/u,
  /commit manifest 数据损坏/u,
];

export function isRetryableOutboxJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return !PERMANENT_OUTBOX_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function parseManifest(manifestJson: string) {
  const manifest = safeParseJsonSchema(manifestJson, commitStageManifestSchema);
  if (!manifest) {
    throw new Error("commit manifest 数据损坏，无法解析");
  }
  return manifest as CommitStageManifest;
}

export function createCommitReconciler(input?: Partial<CommitReconcilerDependencies>) {
  const commitRepo = input?.commitRepo ?? createChapterCommitRepository();
  const commitService = input?.commitService ?? createChapterCommitService();
  const outboxService = input?.outboxService ?? createOutboxService();
  const inspectStage = input?.inspectCommitStage ?? inspectCommitStage;
  const scanStageResidues = input?.scanCommitStageResidues ?? scanCommitStageResidues;
  const cleanupStage = input?.cleanupCommitStage ?? cleanupCommitStage;
  const listProjectIds = input?.listProjectIds ?? (() => listProjects().map((project) => project.id));
  const runOutboxJob = input?.runOutboxJob ?? (async () => undefined);
  const now = input?.now ?? nowIso;
  const buildNextAttemptAt = input?.buildNextAttemptAt ?? ((attempts: number, currentTime: string) =>
    new Date(Date.parse(currentTime) + Math.min(300_000, 30_000 * (attempts + 1))).toISOString());
  const isRetryableError = input?.isRetryableError ?? isRetryableOutboxJobError;
  const renewClaimIntervalMs = input?.renewClaimIntervalMs ?? 40_000;
  const logWarning = input?.logWarning ?? ((message: string) => console.warn(`[commit-reconciler] ${message}`));

  return {
    async reconcileCommitsTick(limit = 50) {
      let reconciled = 0;
      const candidates = commitRepo.listReconcileCandidates(limit);

      for (const commit of candidates) {
        try {
          if (commit.state === "prepared" || commit.state === "needs_reconcile") {
            // 同章已有更新的 committed commit 时本 commit 已被取代：
            // 重放其 stage 会用旧正文覆盖更新内容，直接标记失败。
            if (commitRepo.hasNewerCommittedCommit(commit.projectId, commit.chapterNo, commit.createdAt, commit.commitId)) {
              commitRepo.markFailed(
                commit.commitId,
                now(),
                "superseded",
                "同章存在更新的 committed commit，跳过陈旧 stage 重放",
                now(),
              );
              reconciled += 1;
              continue;
            }

            const state = await inspectStage(commit.projectId, commit.stageDir, parseManifest(commit.manifestJson));
            if (state.finalFilesMatchManifest) {
              await commitService.markFsApplied(commit.commitId);
            } else if (state.stageReady) {
              await commitService.applyStagedFiles(commit.commitId);
              await commitService.markFsApplied(commit.commitId);
            } else if (!state.stageDirExists) {
              commitRepo.markFailed(
                commit.commitId,
                now(),
                "missing_stage_dir",
                "commit staging directory is missing",
                now(),
              );
              reconciled += 1;
              continue;
            } else {
              commitRepo.markNeedsReconcile(
                commit.commitId,
                "staging_manifest_mismatch",
                `stage files not ready: ${state.missingFiles.join(", ")}`,
                now(),
              );
              commitRepo.bumpReconcileAttempt(commit.commitId, now());
              reconciled += 1;
              continue;
            }
          }

          if (commit.state === "fs_applied" || commit.state === "committed" || commit.state === "prepared") {
            await commitService.finalizeCommit(commit.commitId);
          } else if (commit.state === "needs_reconcile") {
            const refreshed = commitRepo.getByCommitId(commit.commitId);
            if (refreshed?.state === "fs_applied" || refreshed?.state === "committed") {
              await commitService.finalizeCommit(commit.commitId);
            }
          }
          reconciled += 1;
        } catch (error) {
          commitRepo.markNeedsReconcile(
            commit.commitId,
            "reconcile_failed",
            error instanceof Error ? error.message : "unknown reconcile failure",
            now(),
          );
          commitRepo.bumpReconcileAttempt(commit.commitId, now());
        }
      }

      return {
        reconciled,
      };
    },

    async drainOutbox(workerId: string, maxJobs = 8) {
      let drained = 0;

      while (drained < maxJobs) {
        const job = outboxService.claimNextJob(workerId);
        if (!job) {
          break;
        }

        // 长 LLM job 会超过 claim TTL；定期续约避免过期后被新 spawn 的 reconciler 抢占并发执行。
        const renewTimer = setInterval(() => {
          try {
            const renewed = outboxService.renewClaim({
              jobId: job.jobId,
              claimToken: job.claimToken ?? "",
              claimEpoch: job.claimEpoch,
            });
            if (!renewed) {
              logWarning(`outbox job ${job.jobId} claim 续约失败，可能已被其他进程接管`);
            }
          } catch (renewError) {
            logWarning(
              `outbox job ${job.jobId} claim 续约异常：${renewError instanceof Error ? renewError.message : "unknown"}`,
            );
          }
        }, renewClaimIntervalMs);

        try {
          await runOutboxJob(job);
          const released = outboxService.releaseDone({
            jobId: job.jobId,
            claimToken: job.claimToken ?? "",
            claimEpoch: job.claimEpoch,
          });
          if (!released) {
            logWarning(`outbox job ${job.jobId} 完成后释放 claim 失败，结果可能已被其他进程覆盖`);
          }
        } catch (error) {
          const currentTime = now();
          const retryable = isRetryableError(error);
          const failed = outboxService.failJob({
            jobId: job.jobId,
            claimToken: job.claimToken ?? "",
            claimEpoch: job.claimEpoch,
            retryable,
            nextAttemptAt: retryable
              ? buildNextAttemptAt(job.attempts, currentTime)
              : null,
            errorCode: error instanceof Error ? error.name : "outbox_job_failed",
            errorMessage: error instanceof Error ? error.message : "unknown outbox failure",
          });
          if (!failed) {
            logWarning(`outbox job ${job.jobId} 标记失败未生效，claim 可能已被其他进程接管`);
          }
        } finally {
          clearInterval(renewTimer);
        }

        drained += 1;
      }

      return drained;
    },

    // 清理已进入终态 (committed/failed) 的 commit 的 stage 残留目录；
    // 无对应 commit 记录的目录可能是尚未写入 DB 的进行中 commit，保留不动。
    async cleanupStageResidues() {
      let removed = 0;

      for (const projectId of listProjectIds()) {
        const residues = await scanStageResidues(projectId);
        for (const residue of residues) {
          const commit = commitRepo.getByStageDir(projectId, residue.stageDir);
          if (commit && (commit.state === "committed" || commit.state === "failed")) {
            await cleanupStage(residue.stageDir);
            removed += 1;
          }
        }
      }
      return removed;
    },

    peekNextRetryAt() {
      return outboxService.peekEarliestPendingRetry();
    },
  };
}

export async function runCommitReconcilerPass(input: {
  reconciler: {
    reconcileCommitsTick: (limit?: number) => Promise<{ reconciled: number }>;
    drainOutbox: (workerId: string, maxJobs?: number) => Promise<number>;
    peekNextRetryAt: () => string | null;
    cleanupStageResidues: () => Promise<number>;
  };
  workerId: string;
  maxJobsPerDrain?: number;
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const maxWaitMs = input.maxWaitMs ?? 330_000;
  const deadline = nowMs() + maxWaitMs;
  const maxJobs = input.maxJobsPerDrain ?? 8;

  while (nowMs() <= deadline) {
    await input.reconciler.reconcileCommitsTick();
    const drained = await input.reconciler.drainOutbox(input.workerId, maxJobs);
    const nextAt = input.reconciler.peekNextRetryAt();
    if (!nextAt) break;
    const wait = Date.parse(nextAt) - nowMs();
    if (wait <= 0) {
      if (drained === 0) break;
      continue;
    }
    if (wait > deadline - nowMs()) break;
    await sleep(wait);
  }

  await input.reconciler.cleanupStageResidues();
}
