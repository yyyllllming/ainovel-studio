import "../server-only.ts";

import Database from "better-sqlite3";
import { rawDb } from "../db/client.ts";
import { nowIso } from "../utils.ts";
import { safeParseJson } from "../utils/safe-json.ts";
import {
  createRunCheckpointRepository,
  type RunCheckpointRecord,
  type RunCheckpointStepStatus,
} from "../repositories/run-checkpoint.repository.ts";
import { createRunSessionRepository } from "../repositories/run-session.repository.ts";

export interface ResumeCursor {
  chapterNo: number | null;
  nextStepKey:
    | "chapter.context_ready"
    | "chapter.blueprint_accepted"
    | "chapter.draft_generated"
    | "chapter.review_passed"
    | "chapter.finalization_committed";
  draftCheckpointPath: string | null;
}

export interface CheckpointServiceOptions {
  db?: Database.Database;
  now?: () => string;
}

function parseArtifactRefs(artifactRefsJson: string | null) {
  if (!artifactRefsJson) {
    return {};
  }
  return safeParseJson<{
    draftCheckpointPath?: string;
  }>(artifactRefsJson, {}) ?? {};
}

export function createCheckpointService(input?: CheckpointServiceOptions) {
  const db = input?.db ?? rawDb;
  const now = input?.now ?? nowIso;
  const checkpointRepo = createRunCheckpointRepository({ db });

  return {
    insertCompletedCheckpoint(input: {
      sessionId: string;
      checkpointSeq: number;
      chapterNo: number;
      stage: string;
      stepKey: RunCheckpointRecord["stepKey"];
      stepStatus: RunCheckpointStepStatus;
      resumeCursorJson?: string | null;
      artifactRefsJson?: string | null;
      payloadJson?: string | null;
      leaseEpoch: number;
    }) {
      const existing = checkpointRepo.findCompletedStep({
        sessionId: input.sessionId,
        chapterNo: input.chapterNo,
        stepKey: input.stepKey,
        stepStatus: input.stepStatus,
      });

      if (existing) {
        return existing;
      }

      return checkpointRepo.insertCompletedCheckpoint({
        ...input,
        createdAt: now(),
      });
    },

    loadLatestCheckpoint(sessionId: string) {
      return checkpointRepo.getLatestCompleted(sessionId);
    },

    buildResumeCursor(sessionId: string): ResumeCursor {
      const checkpoint = checkpointRepo.getLatestCompleted(sessionId);
      if (!checkpoint) {
        return {
          chapterNo: null,
          nextStepKey: "chapter.context_ready",
          draftCheckpointPath: null,
        };
      }

      const artifactRefs = parseArtifactRefs(checkpoint.artifactRefsJson);

      switch (checkpoint.stepKey) {
        case "chapter.context_ready":
          return {
            chapterNo: checkpoint.chapterNo,
            nextStepKey: "chapter.blueprint_accepted",
            draftCheckpointPath: artifactRefs.draftCheckpointPath ?? null,
          };
        case "chapter.blueprint_accepted":
          return {
            chapterNo: checkpoint.chapterNo,
            nextStepKey: "chapter.draft_generated",
            draftCheckpointPath: artifactRefs.draftCheckpointPath ?? null,
          };
        case "chapter.draft_generated":
          return {
            chapterNo: checkpoint.chapterNo,
            nextStepKey: "chapter.review_passed",
            draftCheckpointPath: artifactRefs.draftCheckpointPath ?? null,
          };
        case "chapter.review_passed":
          return {
            chapterNo: checkpoint.chapterNo,
            nextStepKey: "chapter.finalization_committed",
            draftCheckpointPath: artifactRefs.draftCheckpointPath ?? null,
          };
        case "chapter.finalization_committed":
          return {
            chapterNo: checkpoint.chapterNo + 1,
            nextStepKey: "chapter.context_ready",
            draftCheckpointPath: null,
          };
        default:
          throw new Error(`Unknown checkpoint step_key: ${checkpoint.stepKey}`);
      }
    },
  };
}

export function recordChapterFinalizationCheckpoint(input: {
  sessionId: string | null | undefined;
  chapterNo: number;
  db?: Database.Database;
  now?: () => string;
}) {
  if (!input.sessionId) {
    return null;
  }
  const db = input.db ?? rawDb;
  const sessionRepo = createRunSessionRepository({ db });
  const session = sessionRepo.getBySessionId(input.sessionId);
  // Legacy in-process session ids have no run_sessions row; nothing to checkpoint.
  if (!session) {
    return null;
  }

  const checkpointService = createCheckpointService({ db, now: input.now });
  const latest = checkpointService.loadLatestCheckpoint(input.sessionId);
  return checkpointService.insertCompletedCheckpoint({
    sessionId: input.sessionId,
    checkpointSeq: (latest?.checkpointSeq ?? 0) + 1,
    chapterNo: input.chapterNo,
    stage: "analysis",
    stepKey: "chapter.finalization_committed",
    stepStatus: "completed",
    leaseEpoch: session.leaseEpoch,
  });
}
