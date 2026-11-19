ALTER TABLE `review_reports` ADD `failure_category` text;
--> statement-breakpoint
ALTER TABLE `review_reports` ADD `repair_strategy` text;
--> statement-breakpoint
CREATE TABLE `__new_run_statistics` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `chapter_no` integer NOT NULL,
  `stage` text NOT NULL,
  `metrics_json` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL,
  CONSTRAINT `run_statistics_stage_check` CHECK(`stage` IN ('segment_rewrite', 'chapter_plan', 'blueprint', 'planning_repair', 'canon', 'conflict'))
);
--> statement-breakpoint
INSERT INTO `__new_run_statistics` (`id`, `project_id`, `chapter_no`, `stage`, `metrics_json`, `created_at`)
SELECT `id`, `project_id`, `chapter_no`, `stage`, `metrics_json`, `created_at` FROM `run_statistics`;
--> statement-breakpoint
DROP TABLE `run_statistics`;
--> statement-breakpoint
ALTER TABLE `__new_run_statistics` RENAME TO `run_statistics`;
--> statement-breakpoint
CREATE INDEX `idx_run_statistics_project_chapter_stage` ON `run_statistics` (`project_id`, `chapter_no`, `stage`, `created_at` DESC);
--> statement-breakpoint
CREATE INDEX `idx_run_statistics_project_created` ON `run_statistics` (`project_id`, `created_at` DESC);
