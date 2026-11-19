CREATE TABLE `chapter_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `chapter_no` integer NOT NULL,
  `purpose` text NOT NULL,
  `plot_summary` text NOT NULL,
  `required_beats_json` text NOT NULL DEFAULT '[]',
  `key_events_json` text NOT NULL DEFAULT '[]',
  `character_focus_json` text NOT NULL DEFAULT '[]',
  `relationship_shift` text NOT NULL DEFAULT '',
  `world_rule_usage_json` text NOT NULL DEFAULT '[]',
  `continuation_anchor` text NOT NULL DEFAULT '',
  `next_hook` text NOT NULL DEFAULT '',
  `payoff_targets_json` text NOT NULL DEFAULT '[]',
  `risk_flags_json` text NOT NULL DEFAULT '[]',
  `risk_comment` text,
  `status` text NOT NULL DEFAULT 'draft',
  `source` text NOT NULL DEFAULT 'generated',
  `foundation_digest` text NOT NULL DEFAULT '',
  `story_contract_digest` text NOT NULL DEFAULT '',
  `input_digest` text NOT NULL DEFAULT '',
  `generation_id` integer NOT NULL DEFAULT 1,
  `generation_state` text NOT NULL DEFAULT 'idle',
  `generation_token` text,
  `generation_started_at` text,
  `used_segment_summary_fallback` integer NOT NULL DEFAULT 0,
  `segment_id` text,
  `segment_item_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `chapter_plans_status_check` CHECK(`status` IN ('draft', 'ready', 'stale', 'failed')),
  CONSTRAINT `chapter_plans_source_check` CHECK(`source` IN ('generated', 'lazy_backfill', 'degraded_backfill', 'manual_seed')),
  CONSTRAINT `chapter_plans_generation_state_check` CHECK(`generation_state` IN ('idle', 'generating', 'ready', 'failed', 'stale'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_plans_project_chapter_idx` ON `chapter_plans` (`project_id`, `chapter_no`);
--> statement-breakpoint
ALTER TABLE `blueprints` ADD `source_plan_generation_id` integer;
