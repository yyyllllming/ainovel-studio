CREATE TABLE `timeline_mutation_effects` (
	`operation_key` text PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`commit_id` text NOT NULL,
	`project_id` text NOT NULL,
	`chapter_no` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timeline_mutation_effects_identity_key_unique` ON `timeline_mutation_effects` (`identity_key`);--> statement-breakpoint
CREATE INDEX `idx_timeline_mutation_effects_project_chapter` ON `timeline_mutation_effects` (`project_id`,`chapter_no`);--> statement-breakpoint
ALTER TABLE `chapter_invalidations` ADD `operation_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chapter_invalidations_operation_chapter` ON `chapter_invalidations` (`operation_key`,`chapter_no`);