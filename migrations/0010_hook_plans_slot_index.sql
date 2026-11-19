ALTER TABLE `hook_plans` ADD `slot_index` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `hook_plans` ADD `lifecycle_status` text NOT NULL DEFAULT 'planned';
--> statement-breakpoint
ALTER TABLE `hook_plans` ADD `deferred_until_chapter` integer;
--> statement-breakpoint
UPDATE `hook_plans`
SET `lifecycle_status` = CASE
  WHEN `planning_status` = 'cancelled' THEN 'cancelled'
  ELSE 'planned'
END;
--> statement-breakpoint
DROP INDEX IF EXISTS `hook_plans_project_chapter_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `hook_plans_project_chapter_slot_idx` ON `hook_plans` (`project_id`, `chapter_no`, `slot_index`);
