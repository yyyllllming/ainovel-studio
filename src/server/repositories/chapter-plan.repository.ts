import "../server-only.ts";

import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

import { rawDb } from "../db/client.ts";
import type { ChapterPlan, ChapterPlanGenerationState, ChapterPlanSource, ChapterPlanStatus } from "../types.ts";
import { nowIso } from "../utils.ts";
import { type ChapterPlanRecord, toChapterPlan } from "./shared.ts";

export interface UpsertReadyChapterPlanInput {
  projectId: string;
  chapterNo: number;
  purpose: string;
  plotSummary: string;
  requiredBeats: string[];
  keyEvents: string[];
  characterFocus: string[];
  relationshipShift: string;
  worldRuleUsage: string[];
  continuationAnchor: string;
  nextHook: string;
  hookSlots: ChapterPlan["hookSlots"];
  payoffTargets: string[];
  riskFlags: ChapterPlan["riskFlags"];
  riskComment?: string | null;
  status?: ChapterPlanStatus;
  source?: ChapterPlanSource;
  foundationDigest: string;
  storyContractDigest: string;
  inputDigest: string;
  generationId: number;
  generationState?: ChapterPlanGenerationState;
  generationToken?: string | null;
  generationStartedAt?: string | null;
  usedSegmentSummaryFallback?: boolean;
  segmentId?: string | null;
  segmentItemId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClaimGenerationInput {
  projectId: string;
  chapterNo: number;
  foundationDigest: string;
  storyContractDigest: string;
  inputDigest: string;
  generationToken: string;
  now?: string;
  leaseTimeoutMs: number;
  source?: ChapterPlanSource;
  segmentId?: string | null;
  segmentItemId?: string | null;
}

export function createChapterPlanRepository(input: { db?: Database.Database } = {}) {
  const db = input.db ?? rawDb;

  return {
    get(projectId: string, chapterNo: number): ChapterPlanRecord | null {
      const row = db
        .prepare("SELECT * FROM chapter_plans WHERE project_id = ? AND chapter_no = ?")
        .get(projectId, chapterNo) as Record<string, unknown> | undefined;

      return row ? toChapterPlan(row) : null;
    },

    list(projectId: string): ChapterPlanRecord[] {
      const rows = db
        .prepare("SELECT * FROM chapter_plans WHERE project_id = ? ORDER BY chapter_no ASC")
        .all(projectId) as Array<Record<string, unknown>>;

      return rows.map((row) => toChapterPlan(row));
    },

    claimGeneration(input: ClaimGenerationInput) {
      const now = input.now ?? nowIso();
      const startedAt = now;
      const cutoff = new Date(new Date(now).getTime() - input.leaseTimeoutMs).toISOString();
      const source = input.source ?? "generated";

      db.prepare(`
        INSERT INTO chapter_plans (
          id, project_id, chapter_no, purpose, plot_summary, required_beats_json, key_events_json,
          character_focus_json, relationship_shift, world_rule_usage_json, continuation_anchor, next_hook,
          hook_slots_json, payoff_targets_json, risk_flags_json, risk_comment, status, source, foundation_digest,
          story_contract_digest, input_digest, generation_id, generation_state, generation_token,
          generation_started_at, used_segment_summary_fallback, segment_id, segment_item_id, created_at, updated_at
        ) VALUES (?, ?, ?, '', '', '[]', '[]', '[]', '', '[]', '', '', '[]', '[]', '[]', NULL, 'draft', ?, ?, ?, ?, 1, 'generating', ?, ?, 0, ?, ?, ?, ?)
        ON CONFLICT(project_id, chapter_no) DO UPDATE SET
          status = 'draft',
          source = excluded.source,
          foundation_digest = excluded.foundation_digest,
          story_contract_digest = excluded.story_contract_digest,
          input_digest = excluded.input_digest,
          generation_id = chapter_plans.generation_id + 1,
          generation_state = 'generating',
          generation_token = excluded.generation_token,
          generation_started_at = excluded.generation_started_at,
          used_segment_summary_fallback = 0,
          segment_id = excluded.segment_id,
          segment_item_id = excluded.segment_item_id,
          updated_at = excluded.updated_at
        WHERE chapter_plans.generation_state != 'generating'
          OR chapter_plans.generation_started_at IS NULL
          OR chapter_plans.generation_started_at < ?
      `).run(
        nanoid(),
        input.projectId,
        input.chapterNo,
        source,
        input.foundationDigest,
        input.storyContractDigest,
        input.inputDigest,
        input.generationToken,
        startedAt,
        input.segmentId ?? null,
        input.segmentItemId ?? null,
        now,
        now,
        cutoff,
      );

      const plan = this.get(input.projectId, input.chapterNo);
      return {
        claimed: plan?.generationToken === input.generationToken,
        plan,
      };
    },

    upsertReady(plan: UpsertReadyChapterPlanInput): ChapterPlanRecord {
      const now = nowIso();
      const createdAt = plan.createdAt ?? now;
      const updatedAt = plan.updatedAt ?? now;
      const status = plan.status ?? "ready";
      const source = plan.source ?? "generated";
      const generationState = plan.generationState ?? "ready";
      const usedSegmentSummaryFallback = plan.usedSegmentSummaryFallback ?? source === "degraded_backfill";

      db.prepare(`
        INSERT INTO chapter_plans (
          id, project_id, chapter_no, purpose, plot_summary, required_beats_json, key_events_json,
          character_focus_json, relationship_shift, world_rule_usage_json, continuation_anchor, next_hook,
          hook_slots_json, payoff_targets_json, risk_flags_json, risk_comment, status, source, foundation_digest,
          story_contract_digest, input_digest, generation_id, generation_state, generation_token,
          generation_started_at, used_segment_summary_fallback, segment_id, segment_item_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, chapter_no) DO UPDATE SET
          purpose = excluded.purpose,
          plot_summary = excluded.plot_summary,
          required_beats_json = excluded.required_beats_json,
          key_events_json = excluded.key_events_json,
          character_focus_json = excluded.character_focus_json,
          relationship_shift = excluded.relationship_shift,
          world_rule_usage_json = excluded.world_rule_usage_json,
          continuation_anchor = excluded.continuation_anchor,
          next_hook = excluded.next_hook,
          hook_slots_json = excluded.hook_slots_json,
          payoff_targets_json = excluded.payoff_targets_json,
          risk_flags_json = excluded.risk_flags_json,
          risk_comment = excluded.risk_comment,
          status = excluded.status,
          source = excluded.source,
          foundation_digest = excluded.foundation_digest,
          story_contract_digest = excluded.story_contract_digest,
          input_digest = excluded.input_digest,
          generation_id = excluded.generation_id,
          generation_state = excluded.generation_state,
          generation_token = excluded.generation_token,
          generation_started_at = excluded.generation_started_at,
          used_segment_summary_fallback = excluded.used_segment_summary_fallback,
          segment_id = excluded.segment_id,
          segment_item_id = excluded.segment_item_id,
          updated_at = excluded.updated_at
      `).run(
        nanoid(),
        plan.projectId,
        plan.chapterNo,
        plan.purpose,
        plan.plotSummary,
        JSON.stringify(plan.requiredBeats),
        JSON.stringify(plan.keyEvents),
        JSON.stringify(plan.characterFocus),
        plan.relationshipShift,
        JSON.stringify(plan.worldRuleUsage),
        plan.continuationAnchor,
        plan.nextHook,
        JSON.stringify(plan.hookSlots),
        JSON.stringify(plan.payoffTargets),
        JSON.stringify(plan.riskFlags),
        plan.riskComment ?? null,
        status,
        source,
        plan.foundationDigest,
        plan.storyContractDigest,
        plan.inputDigest,
        plan.generationId,
        generationState,
        plan.generationToken ?? null,
        plan.generationStartedAt ?? null,
        usedSegmentSummaryFallback ? 1 : 0,
        plan.segmentId ?? null,
        plan.segmentItemId ?? null,
        createdAt,
        updatedAt,
      );

      const saved = this.get(plan.projectId, plan.chapterNo);
      if (!saved) {
        throw new Error(`章节计划保存失败：${plan.projectId}#${plan.chapterNo}`);
      }
      return saved;
    },
  };
}

const defaultRepository = createChapterPlanRepository();

export function getChapterPlan(projectId: string, chapterNo: number) {
  return defaultRepository.get(projectId, chapterNo);
}

export function listChapterPlans(projectId: string) {
  return defaultRepository.list(projectId);
}

export function upsertReadyChapterPlan(plan: UpsertReadyChapterPlanInput) {
  return defaultRepository.upsertReady(plan);
}
