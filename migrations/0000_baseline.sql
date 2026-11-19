-- Baseline migration extracted from src/server/db/legacy-bootstrap.ts.
-- Keeps legacy schema creation idempotent so fresh and existing SQLite DBs initialize cleanly.

CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      genre TEXT NOT NULL,
      style TEXT NOT NULL,
      target_chapters INTEGER NOT NULL,
      premise TEXT NOT NULL,
      series_mode TEXT NOT NULL DEFAULT 'standalone',
      series_title TEXT,
      series_index INTEGER,
      story_length TEXT NOT NULL DEFAULT 'long',
      narrative_person TEXT NOT NULL DEFAULT 'third',
      chapter_planning_mode TEXT NOT NULL DEFAULT 'fixed',
      pace_profile TEXT NOT NULL DEFAULT 'medium',
      completion_criteria TEXT NOT NULL DEFAULT '',
      chapter_budget_min INTEGER,
      chapter_budget_target INTEGER,
      chapter_budget_max INTEGER,
      hard_chapter_cap INTEGER,
      story_contract_json TEXT NOT NULL DEFAULT '{}',
      steering_notes_json TEXT NOT NULL DEFAULT '[]',
      review_policy_json TEXT NOT NULL DEFAULT '{}',
      has_volumes INTEGER NOT NULL DEFAULT 0,
      planned_volumes INTEGER,
      source_idea_id TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS idea_workshop_states (
      idea_id TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS idea_workshop_messages (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS author_cards (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_author_cards_normalized_name
      ON author_cards(normalized_name);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS author_card_versions (
      id TEXT PRIMARY KEY,
      author_card_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      style_card TEXT NOT NULL,
      style_profile_json TEXT NOT NULL DEFAULT '{}',
      style_digest TEXT NOT NULL DEFAULT '',
      style_exemplars_json TEXT NOT NULL DEFAULT '[]',
      sampled_excerpts_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL,
      source_works_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS author_card_versions_author_version_idx
      ON author_card_versions(author_card_id, version);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS author_book_cards (
      id TEXT PRIMARY KEY,
      author_card_id TEXT NOT NULL REFERENCES author_cards(id),
      title TEXT NOT NULL,
      author_name TEXT,
      style_card TEXT NOT NULL,
      style_profile_json TEXT NOT NULL DEFAULT '{}',
      style_digest TEXT NOT NULL DEFAULT '',
      style_exemplars_json TEXT NOT NULL DEFAULT '[]',
      sampled_excerpts_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      chapter_count INTEGER NOT NULL DEFAULT 0,
      source_file_name TEXT,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS author_book_cards_author_idx
      ON author_book_cards(author_card_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS author_text_imports (
      id TEXT PRIMARY KEY,
      author_card_id TEXT NOT NULL REFERENCES author_cards(id),
      title TEXT NOT NULL,
      author_name TEXT,
      original_file_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      encoding TEXT NOT NULL,
      confidence TEXT NOT NULL,
      chapter_count INTEGER NOT NULL,
      excerpts_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS author_text_imports_author_idx
      ON author_text_imports(author_card_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_assignments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      model TEXT NOT NULL,
      temperature REAL NOT NULL,
      max_tokens INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS foundations (
      project_id TEXT PRIMARY KEY,
      premise_text TEXT NOT NULL,
      style_card TEXT NOT NULL,
      style_profile_json TEXT NOT NULL DEFAULT '{}',
      style_snapshot_id TEXT,
      style_snapshot_version INTEGER,
      style_digest TEXT NOT NULL DEFAULT '',
      style_exemplars_json TEXT NOT NULL DEFAULT '[]',
      characters_json TEXT NOT NULL,
      worldview_json TEXT NOT NULL,
      relationships_json TEXT NOT NULL,
      locked_at TEXT,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS foundation_workshop_states (
      project_id TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      ready_to_generate INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS foundation_workshop_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS style_reference_imports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      original_file_name TEXT NOT NULL,
      media_type TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      raw_file_path TEXT NOT NULL,
      normalized_file_path TEXT NOT NULL,
      word_count INTEGER NOT NULL,
      encoding TEXT NOT NULL,
      confidence TEXT NOT NULL,
      chapter_count INTEGER NOT NULL,
      excerpts_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS style_card_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      source_ids_json TEXT NOT NULL,
      style_card TEXT NOT NULL,
      style_profile_json TEXT NOT NULL DEFAULT '{}',
      style_digest TEXT NOT NULL,
      style_exemplars_json TEXT NOT NULL DEFAULT '[]',
      sampled_excerpts_json TEXT NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS style_card_snapshots_project_version_idx
      ON style_card_snapshots(project_id, version);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS blueprints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      scene_goal TEXT NOT NULL,
      characters_json TEXT NOT NULL,
      locations_json TEXT NOT NULL,
      conflicts_json TEXT NOT NULL,
      foreshadows_json TEXT NOT NULL,
      emotional_tone TEXT NOT NULL,
      estimated_words INTEGER NOT NULL,
      segment_id TEXT,
      segment_item_id TEXT,
      required_progress_delta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS blueprints_project_chapter_idx
      ON blueprints(project_id, chapter_no);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS run_states (
      project_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      desired_state TEXT NOT NULL DEFAULT 'idle',
      run_session_id TEXT,
      heartbeat_at TEXT,
      current_chapter INTEGER NOT NULL,
      total_chapters INTEGER NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      last_error TEXT,
      draft_file TEXT,
      current_position INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0,
      stage_details_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS run_sessions (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_seq INTEGER NOT NULL,
      restart_of_session_id TEXT,
      from_chapter INTEGER NOT NULL,
      target_chapter INTEGER,
      desired_state TEXT NOT NULL
        CHECK (desired_state IN ('running', 'pause_requested', 'stop_requested')),
      lifecycle_status TEXT NOT NULL
        CHECK (lifecycle_status IN (
          'queued',
          'launching',
          'running',
          'recovering',
          'paused',
          'interrupted',
          'completed',
          'failed',
          'stopped'
        )),
      pause_reason TEXT,
      stop_reason TEXT,
      owner_token TEXT,
      lease_epoch INTEGER NOT NULL DEFAULT 0,
      owner_pid INTEGER,
      owner_started_at TEXT,
      last_heartbeat_at TEXT,
      lease_expires_at TEXT,
      launch_nonce TEXT,
      launch_requested_at TEXT,
      launch_started_at TEXT,
      current_chapter INTEGER,
      current_stage TEXT,
      current_step_key TEXT,
      config_snapshot_id TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      started_at TEXT NOT NULL,
      terminal_at TEXT,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_sessions_project_open
      ON run_sessions(project_id)
      WHERE terminal_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_sessions_global_active
      ON run_sessions((1))
      WHERE terminal_at IS NULL
        AND lifecycle_status IN ('queued', 'launching', 'running', 'recovering');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_run_sessions_project_seq
      ON run_sessions(project_id, session_seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_run_sessions_lease_expiry
      ON run_sessions(lease_expires_at)
      WHERE terminal_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_run_sessions_status
      ON run_sessions(lifecycle_status, updated_at)
      WHERE terminal_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS run_checkpoints (
      checkpoint_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      checkpoint_seq INTEGER NOT NULL,
      chapter_no INTEGER NOT NULL,
      stage TEXT NOT NULL,
      step_key TEXT NOT NULL,
      step_status TEXT NOT NULL
        CHECK (step_status IN ('completed', 'skipped')),
      resume_cursor_json TEXT,
      artifact_refs_json TEXT,
      payload_json TEXT,
      lease_epoch INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES run_sessions(session_id) ON DELETE CASCADE,
      UNIQUE(session_id, checkpoint_seq),
      UNIQUE(session_id, chapter_no, step_key, step_status)
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_run_checkpoints_session_latest
      ON run_checkpoints(session_id, checkpoint_seq DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS run_events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      actor_type TEXT NOT NULL
        CHECK (actor_type IN ('web', 'runner', 'session_reconciler', 'commit_reconciler')),
      event_type TEXT NOT NULL,
      level TEXT NOT NULL
        CHECK (level IN ('info', 'warn', 'error')),
      chapter_no INTEGER,
      stage TEXT,
      step_key TEXT,
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES run_sessions(session_id) ON DELETE CASCADE
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_run_events_session_created
      ON run_events(session_id, created_at, event_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_run_events_level_created
      ON run_events(level, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS run_config_snapshots (
      config_snapshot_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      llm_profile_hash TEXT NOT NULL,
      review_policy_hash TEXT NOT NULL,
      style_profile_hash TEXT NOT NULL,
      prompt_pack_hash TEXT NOT NULL,
      structure_profile_hash TEXT,
      voice_pack_hash TEXT,
      project_voice_snapshot_hash TEXT,
      project_foundation_hash TEXT,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES run_sessions(session_id) ON DELETE CASCADE
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chapter_commits (
      commit_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      session_id TEXT,
      source_kind TEXT NOT NULL
        CHECK (source_kind IN ('run', 'workshop', 'rollback')),
      accepted_version_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL
        CHECK (state IN ('prepared', 'fs_applied', 'committed', 'needs_reconcile', 'failed')),
      manifest_json TEXT NOT NULL,
      stage_dir TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      fs_applied_at TEXT,
      committed_at TEXT,
      failed_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      reconcile_attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES run_sessions(session_id)
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chapter_commits_project_state
      ON chapter_commits(project_id, state, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chapter_commits_session
      ON chapter_commits(session_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chapter_commits_chapter
      ON chapter_commits(project_id, chapter_no, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifact_outbox (
      job_id TEXT PRIMARY KEY,
      commit_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      job_type TEXT NOT NULL
        CHECK (job_type IN ('chapter_artifact_sync')),
      state TEXT NOT NULL
        CHECK (state IN ('pending', 'claimed', 'done', 'failed')),
      claim_token TEXT,
      claim_epoch INTEGER NOT NULL DEFAULT 0,
      worker_id TEXT,
      claimed_at TEXT,
      claim_expires_at TEXT,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      done_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (commit_id) REFERENCES chapter_commits(commit_id) ON DELETE CASCADE,
      UNIQUE(commit_id, job_type)
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_artifact_outbox_claimable
      ON artifact_outbox(state, next_attempt_at, claim_expires_at, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS artifact_manifests (
      manifest_id TEXT PRIMARY KEY,
      commit_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      artifact_family TEXT NOT NULL
        CHECK (artifact_family IN ('chapter', 'blueprint', 'review')),
      relative_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      authority_source TEXT NOT NULL DEFAULT 'commit_manifest_v1',
      created_at TEXT NOT NULL,
      FOREIGN KEY (commit_id) REFERENCES chapter_commits(commit_id) ON DELETE CASCADE
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS artifact_manifests_commit_path_idx
      ON artifact_manifests(commit_id, relative_path);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_artifact_manifests_project_chapter_family
      ON artifact_manifests(project_id, chapter_no, artifact_family, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chapter_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      version_no INTEGER NOT NULL,
      temperature REAL NOT NULL,
      path TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS review_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      review_mode TEXT NOT NULL DEFAULT 'deep',
      confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      fix_instructions TEXT NOT NULL,
      issues_json TEXT NOT NULL,
      trigger_reasons_json TEXT NOT NULL DEFAULT '[]',
      style_checklist_hits_json TEXT NOT NULL DEFAULT '[]',
      charter_violations_json TEXT NOT NULL DEFAULT '[]',
      story_progression_json TEXT NOT NULL DEFAULT '{}',
      genre_fulfillment_json TEXT NOT NULL DEFAULT 'null',
      loop_risk_json TEXT NOT NULL DEFAULT '{}',
      planner_quality_json TEXT NOT NULL DEFAULT 'null',
      primary_delta_delivered TEXT,
      stuck_dimensions_json TEXT NOT NULL DEFAULT '[]',
      window_start_chapter INTEGER,
      window_end_chapter INTEGER,
      earliest_affected_chapter INTEGER,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS style_delta_notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      accepted INTEGER NOT NULL,
      notes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS context_packs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      breakdown_json TEXT NOT NULL,
      conflicts_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS canon_fact_index (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS summary_index (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      level TEXT NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS conflicts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      conflict_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      resolution TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS run_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS canon_fact_search USING fts5(
      fact_id UNINDEXED,
      project_id UNINDEXED,
      chapter_no UNINDEXED,
      content,
      keywords
    );
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS summary_search USING fts5(
      summary_id UNINDEXED,
      project_id UNINDEXED,
      chapter_no UNINDEXED,
      level UNINDEXED,
      content,
      keywords
    );
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_cards (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      card_type TEXT NOT NULL CHECK(card_type IN ('character', 'world')),
      name TEXT NOT NULL,
      draft_json TEXT NOT NULL DEFAULT '{}',
      meta_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed')),
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_project_cards_project_id ON project_cards(project_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_card_messages (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_card_messages_card_id ON project_card_messages(card_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS card_progressions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      target_path TEXT NOT NULL,
      mode TEXT NOT NULL,
      content TEXT NOT NULL,
      source_fact_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      review_state TEXT NOT NULL DEFAULT 'provisional',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_card_progressions_project_chapter
      ON card_progressions(project_id, chapter_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_card_progressions_card_id
      ON card_progressions(card_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chapter_review_states (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'provisional',
      quick_checked_at TEXT,
      deep_checked_at TEXT,
      open_window_id TEXT,
      last_review_mode TEXT,
      latest_confidence REAL NOT NULL DEFAULT 0,
      earliest_affected_chapter INTEGER,
      updated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS chapter_review_states_project_chapter_idx
      ON chapter_review_states(project_id, chapter_no);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chapter_invalidations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      range_start_chapter INTEGER NOT NULL,
      range_end_chapter INTEGER NOT NULL,
      reason TEXT NOT NULL,
      archived_path TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      review_reason TEXT,
      invalidated_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_chapter_invalidations_project_chapter
      ON chapter_invalidations(project_id, chapter_no, invalidated_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chapter_delta_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      segment_id TEXT,
      segment_item_id TEXT,
      primary_delta_delivered TEXT,
      delivered_deltas_json TEXT NOT NULL DEFAULT '[]',
      story_progression_json TEXT NOT NULL DEFAULT '{}',
      genre_fulfillment_json TEXT NOT NULL DEFAULT 'null',
      loop_risk_json TEXT NOT NULL DEFAULT '{}',
      stuck_dimensions_json TEXT NOT NULL DEFAULT '[]',
      arena_key TEXT,
      objective_key TEXT,
      antagonist_key TEXT,
      action_pattern TEXT,
      ending_move TEXT,
      mechanism_reveal_mode TEXT,
      motif_tokens_json TEXT NOT NULL DEFAULT '[]',
      obligation_hits_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS chapter_delta_records_project_chapter_idx
      ON chapter_delta_records(project_id, chapter_no);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_style_delta_notes_project_created_at ON style_delta_notes(project_id, created_at DESC);
