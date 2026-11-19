import "../server-only.ts";

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { rawDb } from "../db/client.ts";
import { nowIso } from "../utils.ts";
import {
  createArtifactOutboxRepository,
  type ArtifactOutboxRecord,
} from "../repositories/artifact-outbox.repository.ts";

export interface OutboxServiceDependencies {
  db: Database.Database;
  outboxRepo: ReturnType<typeof createArtifactOutboxRepository>;
  now: () => string;
  nextClaimToken: () => string;
  claimTtlMs: number;
  maxAttempts: number;
}

function addMilliseconds(isoString: string, ms: number) {
  return new Date(Date.parse(isoString) + ms).toISOString();
}

function runImmediate<T>(db: Database.Database, fn: () => T) {
  const transaction = db.transaction(fn);
  return transaction.immediate();
}

export function createOutboxService(input?: Partial<OutboxServiceDependencies>) {
  const db = input?.db ?? rawDb;
  const outboxRepo = input?.outboxRepo ?? createArtifactOutboxRepository({ db });
  const now = input?.now ?? nowIso;
  const nextClaimToken = input?.nextClaimToken ?? randomUUID;
  const claimTtlMs = input?.claimTtlMs ?? 120_000;
  const maxAttempts = input?.maxAttempts ?? 10;

  return {
    claimNextJob(workerId: string): ArtifactOutboxRecord | null {
      return runImmediate(db, () => {
        const currentTime = now();
        outboxRepo.requeueExpiredClaims(currentTime, currentTime);
        const job = outboxRepo.selectNextClaimable(currentTime);
        if (!job) {
          return null;
        }
        const claimToken = nextClaimToken();
        const changed = outboxRepo.claim({
          jobId: job.jobId,
          workerId,
          claimToken,
          claimedAt: currentTime,
          claimExpiresAt: addMilliseconds(currentTime, claimTtlMs),
          updatedAt: currentTime,
        });
        if (changed !== 1) {
          return null;
        }
        return outboxRepo.getByJobId(job.jobId);
      });
    },

    renewClaim(input: {
      jobId: string;
      claimToken: string;
      claimEpoch: number;
    }) {
      return runImmediate(db, () => {
        const currentTime = now();
        return outboxRepo.renewClaim({
          jobId: input.jobId,
          claimToken: input.claimToken,
          claimEpoch: input.claimEpoch,
          claimExpiresAt: addMilliseconds(currentTime, claimTtlMs),
          updatedAt: currentTime,
        }) === 1;
      });
    },

    releaseDone(input: {
      jobId: string;
      claimToken: string;
      claimEpoch: number;
    }) {
      return runImmediate(db, () => {
        const currentTime = now();
        return outboxRepo.releaseDone({
          jobId: input.jobId,
          claimToken: input.claimToken,
          claimEpoch: input.claimEpoch,
          doneAt: currentTime,
          updatedAt: currentTime,
        }) === 1;
      });
    },

    failJob(input: {
      jobId: string;
      claimToken: string;
      claimEpoch: number;
      retryable: boolean;
      nextAttemptAt: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }) {
      return runImmediate(db, () => {
        const currentTime = now();
        return outboxRepo.failJob({
          jobId: input.jobId,
          claimToken: input.claimToken,
          claimEpoch: input.claimEpoch,
          retryable: input.retryable,
          nextAttemptAt: input.nextAttemptAt,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          updatedAt: currentTime,
          maxAttempts,
        }) === 1;
      });
    },

    requeueExpiredClaims() {
      return runImmediate(db, () => {
        const currentTime = now();
        return outboxRepo.requeueExpiredClaims(currentTime, currentTime);
      });
    },

    peekEarliestPendingRetry() {
      return outboxRepo.peekEarliestPendingRetry(now());
    },
  };
}
