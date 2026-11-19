CREATE TABLE `chapter_submission_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_file_name` text NOT NULL,
	`source_file_hash` text NOT NULL,
	`chapter_count` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "chapter_submission_batches_status_check" CHECK("chapter_submission_batches"."status" IN ('preview','importing','completed','partial_failed','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_submission_batches_identity` ON `chapter_submission_batches` (`project_id`,`source_file_hash`);--> statement-breakpoint
CREATE TABLE `chapter_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text,
	`project_id` text NOT NULL,
	`chapter_no` integer NOT NULL,
	`title` text NOT NULL,
	`source` text NOT NULL,
	`content_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`parent_submission_id` text,
	`committed_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "chapter_submissions_status_check" CHECK("chapter_submissions"."status" IN ('draft','queued','reviewing','needs_revision','approved','committed','failed')),
	CONSTRAINT "chapter_submissions_source_check" CHECK("chapter_submissions"."source" IN ('human','codex','import'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chapter_submissions_identity` ON `chapter_submissions` (`project_id`,`chapter_no`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_chapter_submissions_batch` ON `chapter_submissions` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_chapter_submissions_parent` ON `chapter_submissions` (`parent_submission_id`);--> statement-breakpoint
ALTER TABLE `review_reports` ADD `submission_id` text;--> statement-breakpoint
ALTER TABLE `review_reports` ADD `version_id` text;--> statement-breakpoint
ALTER TABLE `review_reports` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `review_reports` ADD `reviewer_profile_id` text;--> statement-breakpoint
ALTER TABLE `review_reports` ADD `prompt_hash` text;--> statement-breakpoint
ALTER TABLE `review_reports` ADD `review_schema_version` text;
