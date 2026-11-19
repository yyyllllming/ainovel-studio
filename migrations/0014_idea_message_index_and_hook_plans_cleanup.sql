-- idea_workshop_messages is queried by (idea_id, created_at) on every workshop
-- chat load; add the covering index that 0013 added for the sibling tables.
CREATE INDEX IF NOT EXISTS idx_idea_workshop_messages_idea_created
  ON idea_workshop_messages(idea_id, created_at);
--> statement-breakpoint
-- 0010 migrated hook_plans.planning_status into lifecycle_status but left the
-- old column behind; drop it so the table matches schema.ts again.
ALTER TABLE `hook_plans` DROP COLUMN `planning_status`;
