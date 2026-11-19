import "../server-only.ts";

import { notFound } from "../errors.ts";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import {
  createChapterCommitRepository,
  type ChapterCommitRecord,
  type ChapterCommitSourceKind,
} from "../repositories/chapter-commit.repository.ts";
import { createArtifactOutboxRepository } from "../repositories/artifact-outbox.repository.ts";
import { rawDb } from "../db/client.ts";
import {
  cleanupCommitStage,
  commitStageManifestSchema,
  promoteCommitStage,
  type CommitStageManifest,
} from "../project-files.ts";
import { nowIso } from "../utils.ts";
import { createArtifactManifestService } from "../infrastructure/artifacts/artifact-manifest.service.ts";
import { safeParseJsonSchema } from "../utils/safe-json.ts";
import { registerTimelineMutationEffect } from "./timeline-mutation-effect.ts";

export interface ChapterCommitServiceDependencies {
  db: Database.Database;
  commitRepo: ReturnType<typeof createChapterCommitRepository>;
  outboxRepo: ReturnType<typeof createArtifactOutboxRepository>;
  artifactManifestService: ReturnType<typeof createArtifactManifestService>;
  now: () => string;
  nextId: (prefix: "commit" | "job") => string;
  promoteCommitStage: typeof promoteCommitStage;
  cleanupCommitStage: typeof cleanupCommitStage;
  createOutboxPayload: (commit: ChapterCommitRecord) => string;
}

function parseManifest(manifestJson: string) {
  const manifest = safeParseJsonSchema(manifestJson, commitStageManifestSchema);
  if (!manifest) {
    throw new Error("commit manifest 数据损坏，无法解析");
  }
  return manifest as CommitStageManifest;
}

export function createChapterCommitService(input?: Partial<ChapterCommitServiceDependencies>) {
  const db = input?.db ?? rawDb;
  const commitRepo = input?.commitRepo ?? createChapterCommitRepository({ db });
  const outboxRepo = input?.outboxRepo ?? createArtifactOutboxRepository({ db });
  const artifactManifestService = input?.artifactManifestService ?? createArtifactManifestService({ db });
  const now = input?.now ?? nowIso;
  const nextId = input?.nextId ?? ((prefix: "commit" | "job") => `${prefix}_${nanoid()}`);
  const promote = input?.promoteCommitStage ?? promoteCommitStage;
  const cleanupStage = input?.cleanupCommitStage ?? cleanupCommitStage;
  const createOutboxPayload = input?.createOutboxPayload ?? ((commit: ChapterCommitRecord) =>
    JSON.stringify({
      commitId: commit.commitId,
      projectId: commit.projectId,
      chapterNo: commit.chapterNo,
    }));

  return {
    async prepareCommit(input: {
      projectId: string;
      chapterNo: number;
      sessionId: string | null;
      sourceKind: ChapterCommitSourceKind;
      acceptedVersionId: string;
      idempotencyKey: string;
      manifest: CommitStageManifest;
      stageDir: string;
      contentHash: string;
    }) {
      const existing = commitRepo.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return existing;
      }

      const timestamp = now();
      const prepared = commitRepo.insertPrepared({
        commitId: nextId("commit"),
        projectId: input.projectId,
        chapterNo: input.chapterNo,
        sessionId: input.sessionId,
        sourceKind: input.sourceKind,
        acceptedVersionId: input.acceptedVersionId,
        idempotencyKey: input.idempotencyKey,
        manifestJson: JSON.stringify(input.manifest),
        stageDir: input.stageDir,
        contentHash: input.contentHash,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      artifactManifestService.replaceCommitManifest({
        commitId: prepared.commitId,
        projectId: input.projectId,
        chapterNo: input.chapterNo,
        manifest: input.manifest,
        createdAt: timestamp,
      });

      return prepared;
    },

    async applyStagedFiles(commitId: string) {
      const commit = commitRepo.getByCommitId(commitId);
      if (!commit) {
        throw notFound("commit 不存在");
      }

      await promote(
        commit.projectId,
        commit.stageDir,
        artifactManifestService.readAuthoritativeManifest({
          commitId,
          fallbackManifest: parseManifest(commit.manifestJson),
        }),
      );
    },

    async markFsApplied(commitId: string) {
      const timestamp = now();
      const changed = commitRepo.markFsApplied(commitId, timestamp, timestamp);
      if (changed !== 1) {
        // 状态守卫拒绝更新时重读状态：已 committed 的 commit（幂等重放场景）无需也不允许退回 fs_applied。
        const current = commitRepo.getByCommitId(commitId);
        if (current?.state === "committed") {
          return;
        }
        throw new Error("commit 标记 fs_applied 失败");
      }
    },

    async finalizeCommit(commitId: string, effect?: {
      operationKey: string;
      identityKey: string;
      mutationIdentity: string;
      payloadJson: string;
    }) {
      // 先读后写的事务必须用 immediate，避免 WAL 多进程下 deferred 升级写锁时 SQLITE_BUSY(SNAPSHOT)。
      const finalizeTxn = db.transaction(() => {
        const commit = commitRepo.getByCommitId(commitId);
        if (!commit) {
          throw notFound("commit 不存在");
        }
        if (commit.state !== "fs_applied" && commit.state !== "committed") {
          throw new Error("commit 还不能 finalize");
        }

        const finalizedAt = now();
        if (effect) {
          registerTimelineMutationEffect(db, {
            ...effect,
            commitId: commit.commitId,
            projectId: commit.projectId,
            chapterNo: commit.chapterNo,
            timestamp: finalizedAt,
          });
        }
        const existingJob = outboxRepo.getByCommitAndType(commit.commitId, "chapter_artifact_sync");
        const jobActive = existingJob?.state === "pending" || existingJob?.state === "claimed";
        if (commit.state === "committed" && jobActive) {
          return commit;
        }

        db.prepare("UPDATE chapter_versions SET selected = 0 WHERE project_id = ? AND chapter_no = ?")
          .run(commit.projectId, commit.chapterNo);
        db.prepare("UPDATE chapter_versions SET selected = 1 WHERE id = ?")
          .run(commit.acceptedVersionId);

        if (!existingJob) {
          outboxRepo.insertPending({
            jobId: nextId("job"),
            commitId: commit.commitId,
            projectId: commit.projectId,
            chapterNo: commit.chapterNo,
            jobType: "chapter_artifact_sync",
            payloadJson: createOutboxPayload(commit),
            createdAt: finalizedAt,
            updatedAt: finalizedAt,
          });
        } else if (!jobActive) {
          // 同一 commit 被重新 finalize（如重复回滚到同一版本）：旧 job 已 done/failed，
          // 必须重置为 pending 重新同步 canon 产物，否则事实表停留在中间版本。
          outboxRepo.resetToPending(existingJob.jobId, finalizedAt);
        }

        if (commit.state !== "committed") {
          const changed = commitRepo.markCommitted(commitId, finalizedAt, finalizedAt);
          if (changed !== 1) {
            throw new Error("commit finalize 失败");
          }
        }

        return commitRepo.getByCommitId(commitId) as ChapterCommitRecord;
      });

      const record = finalizeTxn.immediate();
      // commit 已落库，stage 副本不再需要；清理失败不影响主流程。
      await cleanupStage(record.stageDir).catch(() => undefined);
      return record;
    },
  };
}
