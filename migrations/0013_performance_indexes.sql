-- Performance indexes for high-traffic tables.
-- All CREATE INDEX IF NOT EXISTS so the migration is idempotent across
-- existing databases that may have been hot-patched.

CREATE INDEX IF NOT EXISTS idx_chapter_versions_project_chapter
  ON chapter_versions(project_id, chapter_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_review_reports_project_chapter_created
  ON review_reports(project_id, chapter_no, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_review_reports_project_created
  ON review_reports(project_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_foundation_workshop_messages_project_created
  ON foundation_workshop_messages(project_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_context_packs_project_chapter
  ON context_packs(project_id, chapter_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_conflicts_project_chapter
  ON conflicts(project_id, chapter_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_canon_fact_index_project_chapter_type
  ON canon_fact_index(project_id, chapter_no, type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_summary_index_project_chapter_level
  ON summary_index(project_id, chapter_no, level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_run_logs_project_created
  ON run_logs(project_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_card_messages_project_created
  ON project_card_messages(project_id, created_at);
