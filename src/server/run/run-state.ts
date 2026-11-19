import type { RunProgressPayload } from "../types.ts";

const ACTIVE_STAGES = new Set<RunProgressPayload["stage"]>([
  "blueprint",
  "context",
  "writing",
  "style_pass",
  "planning_repair",
  "review",
  "analysis",
]);

const STALE_RUN_MS = 180_000;
const DEFAULT_RESUME_STAGE: RunProgressPayload["stage"] = "blueprint";

type RunActiveStage = Exclude<
  RunProgressPayload["stage"],
  "idle" | "completed" | "manual_review" | "paused" | "interrupted" | "failed"
>;

function isActiveStage(stage: RunProgressPayload["stage"]): stage is RunActiveStage {
  return ACTIVE_STAGES.has(stage);
}

function parseHeartbeatAt(heartbeatAt: string | null | undefined) {
  if (!heartbeatAt) {
    return null;
  }
  const parsed = Date.parse(heartbeatAt);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getLastActiveRunStage(
  stage: RunProgressPayload["stage"],
  stageDetails?: RunProgressPayload["stageDetails"] | null,
): RunActiveStage | null {
  if (isActiveStage(stage)) {
    return stage;
  }
  const rememberedStage = stageDetails?.lifecycle?.lastActiveStage;
  return rememberedStage && isActiveStage(rememberedStage) ? rememberedStage : null;
}

export function mergeRunStageDetails(
  stage: RunProgressPayload["stage"],
  current: RunProgressPayload["stageDetails"] | null | undefined,
  patch: RunProgressPayload["stageDetails"] | null | undefined,
) {
  const next = {
    ...(current ?? {}),
    ...(patch ?? {}),
  };
  const lastActiveStage = getLastActiveRunStage(stage, next);
  if (!lastActiveStage && !next.lifecycle) {
    return next;
  }
  return {
    ...next,
    lifecycle: {
      ...(next.lifecycle ?? {}),
      ...(lastActiveStage ? { lastActiveStage } : {}),
    },
  };
}

export function resolveResumeStage(
  stage: RunProgressPayload["stage"],
  stageDetails?: RunProgressPayload["stageDetails"] | null,
) {
  return getLastActiveRunStage(stage, stageDetails) ?? DEFAULT_RESUME_STAGE;
}

export function isRunHeartbeatStale(
  heartbeatAt: string | null | undefined,
  now = Date.now(),
  thresholdMs = STALE_RUN_MS,
) {
  const parsed = parseHeartbeatAt(heartbeatAt);
  if (parsed === null) {
    return true;
  }
  return now - parsed > thresholdMs;
}

export function deriveEffectiveRunStage<TStage extends RunProgressPayload["stage"]>(
  stage: TStage,
  desiredState: string | null | undefined,
  heartbeatAt: string | null | undefined,
  now = Date.now(),
) {
  if (ACTIVE_STAGES.has(stage) && desiredState === "running" && isRunHeartbeatStale(heartbeatAt, now)) {
    return "interrupted" as RunProgressPayload["stage"];
  }

  return stage;
}

export function deriveRunProgressView(
  progress: RunProgressPayload,
  runSession: {
    desiredState?: RunProgressPayload["desiredState"] | null;
    heartbeatAt?: string | null;
  },
  now = Date.now(),
) {
  const effectiveStage = deriveEffectiveRunStage(progress.stage, runSession.desiredState, runSession.heartbeatAt, now);
  const heartbeatAt = runSession.heartbeatAt ?? null;
  const parsedHeartbeatAt = parseHeartbeatAt(heartbeatAt);
  const heartbeatAgeMs = parsedHeartbeatAt === null ? null : Math.max(0, now - parsedHeartbeatAt);
  const staleHeartbeat = runSession.desiredState === "running" && isRunHeartbeatStale(heartbeatAt, now);
  const lastActiveStage = getLastActiveRunStage(progress.stage, progress.stageDetails);
  const decoratedProgress = {
    ...progress,
    desiredState: runSession.desiredState ?? "idle",
    heartbeatAt,
    heartbeatAgeMs,
    staleHeartbeat,
    lastActiveStage,
  };

  if (effectiveStage === "interrupted") {
    return {
      ...decoratedProgress,
      running: false,
      stage: effectiveStage,
    };
  }

  return decoratedProgress;
}
