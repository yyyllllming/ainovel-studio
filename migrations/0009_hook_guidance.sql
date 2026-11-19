ALTER TABLE `blueprints` ADD `hook_guidance_mode` text NOT NULL DEFAULT 'unguided';
--> statement-breakpoint
ALTER TABLE `blueprints` ADD `hook_bindings_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE `hook_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `chapter_no` integer NOT NULL,
  `source_plan_generation_id` integer NOT NULL,
  `setup_text` text NOT NULL,
  `payoff_window_start_chapter` integer NOT NULL,
  `payoff_window_end_chapter` integer NOT NULL,
  `priority` text NOT NULL DEFAULT 'medium',
  `planning_status` text NOT NULL DEFAULT 'planned',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hook_plans_project_chapter_idx` ON `hook_plans` (`project_id`, `chapter_no`);
