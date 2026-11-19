CREATE TABLE IF NOT EXISTS `run_statistics` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `chapter_no` integer NOT NULL,
  `stage` text NOT NULL,
  `metrics_json` text DEFAULT '{}' NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `run_statistics_stage_check` CHECK (`stage` IN ('segment_rewrite', 'blueprint', 'canon', 'conflict'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_run_statistics_project_chapter_stage`
  ON `run_statistics` (`project_id`, `chapter_no`, `stage`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_run_statistics_project_created`
  ON `run_statistics` (`project_id`, `created_at` DESC);
