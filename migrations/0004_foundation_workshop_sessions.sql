CREATE TABLE IF NOT EXISTS `foundation_workshop_sessions` (
  `project_id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `status` text NOT NULL,
  `stage` text NOT NULL,
  `progress` integer DEFAULT 0 NOT NULL,
  `status_message` text DEFAULT '' NOT NULL,
  `user_message` text NOT NULL,
  `assistant_message` text DEFAULT '' NOT NULL,
  `error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `foundation_workshop_sessions_status_check` CHECK (`status` IN ('running', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_foundation_workshop_sessions_updated_at`
  ON `foundation_workshop_sessions` (`updated_at`);
