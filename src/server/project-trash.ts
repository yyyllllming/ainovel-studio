import { deriveEffectiveRunStage } from "./run/run-state.ts";
import type { RunProgressPayload } from "./types.ts";

const TRASH_SAFE_STAGES = new Set<RunProgressPayload["stage"]>([
  "idle",
  "completed",
  "failed",
  "manual_review",
  "paused",
  "interrupted",
]);

export const PROJECT_PURGE_TABLES = [
  "project_card_messages",
  "project_cards",
  "foundation_workshop_sessions",
  "foundation_workshop_messages",
  "foundation_workshop_states",
  "foundations",
  "style_reference_imports",
  "style_card_snapshots",
  "chapter_submissions",
  "chapter_submission_batches",
  "agent_assignments",
  "chapter_plans",
  "hook_plans",
  "blueprints",
  "context_packs",
  "chapter_versions",
  "review_reports",
  "chapter_review_states",
  "chapter_delta_records",
  "canon_fact_index",
  "canon_fact_search",
  "summary_index",
  "summary_search",
  "conflicts",
  "run_statistics",
  "timeline_mutation_effects",
  "chapter_commits",
  "artifact_outbox",
  "artifact_manifests",
  "run_sessions",
  "run_states",
  "run_logs",
  "card_progressions",
  "chapter_invalidations",
  "style_delta_notes",
] as const;

export function canTrashProjectForStage(stage: RunProgressPayload["stage"] | null | undefined) {
  return !stage || TRASH_SAFE_STAGES.has(stage);
}

export function resolveTrashStage(input: {
  stage?: RunProgressPayload["stage"] | null;
  status?: string | null;
  desiredState?: string | null;
  heartbeatAt?: string | null;
}) {
  const baseStage = (input.stage ?? input.status ?? null) as RunProgressPayload["stage"] | null;
  if (!baseStage) {
    return null;
  }
  return deriveEffectiveRunStage(baseStage, input.desiredState, input.heartbeatAt);
}

export function canTrashProjectForRunState(input: {
  stage?: RunProgressPayload["stage"] | null;
  status?: string | null;
  desiredState?: string | null;
  heartbeatAt?: string | null;
}) {
  return canTrashProjectForStage(resolveTrashStage(input));
}
