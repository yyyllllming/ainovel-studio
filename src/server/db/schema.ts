import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  genre: text("genre").notNull(),
  style: text("style").notNull(),
  targetChapters: integer("target_chapters").notNull(),
  premise: text("premise").notNull(),
  seriesMode: text("series_mode").notNull().default("standalone"),
  seriesTitle: text("series_title"),
  seriesIndex: integer("series_index"),
  storyLength: text("story_length").notNull().default("long"),
  narrativePerson: text("narrative_person").notNull().default("third"),
  chapterPlanningMode: text("chapter_planning_mode").notNull().default("fixed"),
  paceProfile: text("pace_profile").notNull().default("medium"),
  completionCriteria: text("completion_criteria").notNull().default(""),
  chapterBudgetMin: integer("chapter_budget_min"),
  chapterBudgetTarget: integer("chapter_budget_target"),
  chapterBudgetMax: integer("chapter_budget_max"),
  hardChapterCap: integer("hard_chapter_cap"),
  storyContractJson: text("story_contract_json").notNull().default("{}"),
  steeringNotesJson: text("steering_notes_json").notNull().default("[]"),
  reviewPolicyJson: text("review_policy_json").notNull().default("{}"),
  hasVolumes: integer("has_volumes", { mode: "boolean" }).notNull().default(false),
  plannedVolumes: integer("planned_volumes"),
  sourceIdeaId: text("source_idea_id"),
  status: text("status").notNull().default("draft"),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const ideas = sqliteTable("ideas", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const ideaWorkshopStates = sqliteTable("idea_workshop_states", {
  ideaId: text("idea_id").primaryKey(),
  draftJson: text("draft_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const ideaWorkshopMessages = sqliteTable(
  "idea_workshop_messages",
  {
    id: text("id").primaryKey(),
    ideaId: text("idea_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    ideaCreatedIdx: index("idx_idea_workshop_messages_idea_created").on(table.ideaId, table.createdAt),
  }),
);

export const authorCards = sqliteTable(
  "author_cards",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    normalizedNameIdx: index("idx_author_cards_normalized_name").on(table.normalizedName),
  }),
);

export const authorCardVersions = sqliteTable(
  "author_card_versions",
  {
    id: text("id").primaryKey(),
    authorCardId: text("author_card_id").notNull(),
    version: integer("version").notNull(),
    styleCard: text("style_card").notNull(),
    styleProfileJson: text("style_profile_json").notNull().default("{}"),
    styleDigest: text("style_digest").notNull().default(""),
    styleExemplarsJson: text("style_exemplars_json").notNull().default("[]"),
    sampledExcerptsJson: text("sampled_excerpts_json").notNull().default("[]"),
    confidence: text("confidence").notNull(),
    sourceWorksJson: text("source_works_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    authorVersionUnique: uniqueIndex("author_card_versions_author_version_idx").on(table.authorCardId, table.version),
  }),
);

export const authorBookCards = sqliteTable(
  "author_book_cards",
  {
    id: text("id").primaryKey(),
    authorCardId: text("author_card_id").notNull().references(() => authorCards.id),
    title: text("title").notNull(),
    authorName: text("author_name"),
    styleCard: text("style_card").notNull(),
    styleProfileJson: text("style_profile_json").notNull().default("{}"),
    styleDigest: text("style_digest").notNull().default(""),
    styleExemplarsJson: text("style_exemplars_json").notNull().default("[]"),
    sampledExcerptsJson: text("sampled_excerpts_json").notNull().default("[]"),
    confidence: text("confidence").notNull(),
    fingerprintJson: text("fingerprint_json").notNull().default("{}"),
    wordCount: integer("word_count").notNull().default(0),
    chapterCount: integer("chapter_count").notNull().default(0),
    sourceFileName: text("source_file_name"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    authorIdx: index("author_book_cards_author_idx").on(table.authorCardId),
  }),
);

export const authorTextImports = sqliteTable(
  "author_text_imports",
  {
    id: text("id").primaryKey(),
    authorCardId: text("author_card_id").notNull().references(() => authorCards.id),
    title: text("title").notNull(),
    authorName: text("author_name"),
    originalFileName: text("original_file_name").notNull(),
    mediaType: text("media_type").notNull(),
    sourceHash: text("source_hash").notNull(),
    wordCount: integer("word_count").notNull(),
    encoding: text("encoding").notNull(),
    confidence: text("confidence").notNull(),
    chapterCount: integer("chapter_count").notNull(),
    excerptsJson: text("excerpts_json").notNull().default("[]"),
    sourceKind: text("source_kind").notNull().default("plain_import"),
    bookCardStatus: text("book_card_status").notNull().default("idle"),
    lastGenerationError: text("last_generation_error"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    authorIdx: index("author_text_imports_author_idx").on(table.authorCardId),
  }),
);

export const authorBookImportPreviews = sqliteTable(
  "author_book_import_previews",
  {
    id: text("id").primaryKey(),
    authorCardId: text("author_card_id").notNull().references(() => authorCards.id),
    title: text("title").notNull(),
    authorName: text("author_name"),
    originalFileName: text("original_file_name").notNull(),
    mediaType: text("media_type").notNull(),
    sourceHash: text("source_hash").notNull(),
    wordCount: integer("word_count").notNull(),
    encoding: text("encoding").notNull(),
    parseConfidence: text("parse_confidence").notNull(),
    parserMode: text("parser_mode").notNull(),
    chapterCount: integer("chapter_count").notNull(),
    warningsJson: text("warnings_json").notNull().default("[]"),
    samplePlanJson: text("sample_plan_json").notNull().default("{\"indexes\":[],\"skippedShort\":[],\"total\":0}"),
    status: text("status").notNull().default("active"),
    applyStatus: text("apply_status").notNull().default("pending"),
    importId: text("import_id"),
    bookCardId: text("book_card_id"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (table) => ({
    authorIdx: index("author_book_import_previews_author_idx").on(table.authorCardId),
  }),
);

export const agentAssignments = sqliteTable("agent_assignments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  role: text("role").notNull(),
  profileId: text("profile_id").notNull(),
  model: text("model").notNull(),
  temperature: real("temperature").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const foundations = sqliteTable("foundations", {
  projectId: text("project_id").primaryKey(),
  premiseText: text("premise_text").notNull(),
  mainlineText: text("mainline_text").notNull().default(""),
  storyHookText: text("story_hook_text").notNull().default(""),
  styleCard: text("style_card").notNull(),
  styleProfileJson: text("style_profile_json").notNull().default("{}"),
  styleSnapshotId: text("style_snapshot_id"),
  styleSnapshotVersion: integer("style_snapshot_version"),
  styleDigest: text("style_digest").notNull().default(""),
  styleExemplarsJson: text("style_exemplars_json").notNull().default("[]"),
  charactersJson: text("characters_json").notNull(),
  worldviewJson: text("worldview_json").notNull(),
  relationshipsJson: text("relationships_json").notNull(),
  lockedAt: text("locked_at"),
  updatedAt: text("updated_at").notNull(),
});

export const styleReferenceImports = sqliteTable("style_reference_imports", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  author: text("author"),
  originalFileName: text("original_file_name").notNull(),
  mediaType: text("media_type").notNull(),
  sourceHash: text("source_hash").notNull(),
  rawFilePath: text("raw_file_path").notNull(),
  normalizedFilePath: text("normalized_file_path").notNull(),
  wordCount: integer("word_count").notNull(),
  encoding: text("encoding").notNull(),
  confidence: text("confidence").notNull(),
  chapterCount: integer("chapter_count").notNull(),
  excerptsJson: text("excerpts_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const styleCardSnapshots = sqliteTable(
  "style_card_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    mode: text("mode").notNull(),
    sourceIdsJson: text("source_ids_json").notNull(),
    styleCard: text("style_card").notNull(),
    styleProfileJson: text("style_profile_json").notNull().default("{}"),
    styleDigest: text("style_digest").notNull(),
    styleExemplarsJson: text("style_exemplars_json").notNull().default("[]"),
    sampledExcerptsJson: text("sampled_excerpts_json").notNull().default("[]"),
    confidence: text("confidence").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectVersionUnique: uniqueIndex("style_card_snapshots_project_version_idx").on(table.projectId, table.version),
  }),
);

export const foundationWorkshopStates = sqliteTable("foundation_workshop_states", {
  projectId: text("project_id").primaryKey(),
  draftJson: text("draft_json").notNull(),
  structuredSuggestionsJson: text("structured_suggestions_json"),
  readyToGenerate: integer("ready_to_generate", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const foundationWorkshopMessages = sqliteTable(
  "foundation_workshop_messages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectCreatedIdx: index("idx_foundation_workshop_messages_project_created").on(
      table.projectId,
      table.createdAt,
    ),
  }),
);

export const foundationWorkshopSessions = sqliteTable(
  "foundation_workshop_sessions",
  {
    projectId: text("project_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    progress: integer("progress").notNull().default(0),
    statusMessage: text("status_message").notNull().default(""),
    userMessage: text("user_message").notNull(),
    assistantMessage: text("assistant_message").notNull().default(""),
    error: text("error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    statusCheck: check(
      "foundation_workshop_sessions_status_check",
      sql`${table.status} IN ('running', 'failed')`,
    ),
    updatedAtIdx: index("idx_foundation_workshop_sessions_updated_at").on(table.updatedAt),
  }),
);

export const blueprints = sqliteTable(
  "blueprints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    sceneGoal: text("scene_goal").notNull(),
    charactersJson: text("characters_json").notNull(),
    locationsJson: text("locations_json").notNull(),
    conflictsJson: text("conflicts_json").notNull(),
    foreshadowsJson: text("foreshadows_json").notNull(),
    emotionalTone: text("emotional_tone").notNull(),
    estimatedWords: integer("estimated_words").notNull(),
    segmentId: text("segment_id"),
    segmentItemId: text("segment_item_id"),
    requiredProgressDelta: text("required_progress_delta"),
    sourcePlanGenerationId: integer("source_plan_generation_id"),
    hookGuidanceMode: text("hook_guidance_mode").notNull().default("unguided"),
    hookBindingsJson: text("hook_bindings_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectChapterUnique: uniqueIndex("blueprints_project_chapter_idx").on(table.projectId, table.chapterNo),
  }),
);

export const hookPlans = sqliteTable(
  "hook_plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    slotIndex: integer("slot_index").notNull().default(0),
    sourcePlanGenerationId: integer("source_plan_generation_id").notNull(),
    setupText: text("setup_text").notNull(),
    payoffWindowStartChapter: integer("payoff_window_start_chapter").notNull(),
    payoffWindowEndChapter: integer("payoff_window_end_chapter").notNull(),
    priority: text("priority").notNull().default("medium"),
    lifecycleStatus: text("lifecycle_status").notNull().default("planned"),
    deferredUntilChapter: integer("deferred_until_chapter"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectChapterSlotUnique: uniqueIndex("hook_plans_project_chapter_slot_idx").on(
      table.projectId,
      table.chapterNo,
      table.slotIndex,
    ),
  }),
);

export const chapterPlans = sqliteTable(
  "chapter_plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    purpose: text("purpose").notNull(),
    plotSummary: text("plot_summary").notNull(),
    requiredBeatsJson: text("required_beats_json").notNull().default("[]"),
    keyEventsJson: text("key_events_json").notNull().default("[]"),
    characterFocusJson: text("character_focus_json").notNull().default("[]"),
    relationshipShift: text("relationship_shift").notNull().default(""),
    worldRuleUsageJson: text("world_rule_usage_json").notNull().default("[]"),
    continuationAnchor: text("continuation_anchor").notNull().default(""),
    nextHook: text("next_hook").notNull().default(""),
    hookSlotsJson: text("hook_slots_json").notNull().default("[]"),
    payoffTargetsJson: text("payoff_targets_json").notNull().default("[]"),
    riskFlagsJson: text("risk_flags_json").notNull().default("[]"),
    riskComment: text("risk_comment"),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull().default("generated"),
    foundationDigest: text("foundation_digest").notNull().default(""),
    storyContractDigest: text("story_contract_digest").notNull().default(""),
    inputDigest: text("input_digest").notNull().default(""),
    generationId: integer("generation_id").notNull().default(1),
    generationState: text("generation_state").notNull().default("idle"),
    generationToken: text("generation_token"),
    generationStartedAt: text("generation_started_at"),
    usedSegmentSummaryFallback: integer("used_segment_summary_fallback", { mode: "boolean" }).notNull().default(false),
    segmentId: text("segment_id"),
    segmentItemId: text("segment_item_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectChapterUnique: uniqueIndex("chapter_plans_project_chapter_idx").on(table.projectId, table.chapterNo),
    statusCheck: check(
      "chapter_plans_status_check",
      sql`${table.status} IN ('draft', 'ready', 'stale', 'failed')`,
    ),
    sourceCheck: check(
      "chapter_plans_source_check",
      sql`${table.source} IN ('generated', 'lazy_backfill', 'degraded_backfill', 'manual_seed')`,
    ),
    generationStateCheck: check(
      "chapter_plans_generation_state_check",
      sql`${table.generationState} IN ('idle', 'generating', 'ready', 'failed', 'stale')`,
    ),
  }),
);

export const runStates = sqliteTable("run_states", {
  projectId: text("project_id").primaryKey(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  desiredState: text("desired_state").notNull().default("idle"),
  runSessionId: text("run_session_id"),
  heartbeatAt: text("heartbeat_at"),
  currentChapter: integer("current_chapter").notNull(),
  totalChapters: integer("total_chapters").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  lastError: text("last_error"),
  draftFile: text("draft_file"),
  currentPosition: integer("current_position").notNull().default(0),
  wordCount: integer("word_count").notNull().default(0),
  stageDetailsJson: text("stage_details_json").notNull().default("{}"),
  startedAt: text("started_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runSessions = sqliteTable(
  "run_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    projectId: text("project_id").notNull(),
    sessionSeq: integer("session_seq").notNull(),
    restartOfSessionId: text("restart_of_session_id"),
    fromChapter: integer("from_chapter").notNull(),
    targetChapter: integer("target_chapter"),
    desiredState: text("desired_state").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull(),
    pauseReason: text("pause_reason"),
    stopReason: text("stop_reason"),
    ownerToken: text("owner_token"),
    leaseEpoch: integer("lease_epoch").notNull().default(0),
    ownerPid: integer("owner_pid"),
    ownerStartedAt: text("owner_started_at"),
    lastHeartbeatAt: text("last_heartbeat_at"),
    leaseExpiresAt: text("lease_expires_at"),
    launchNonce: text("launch_nonce"),
    launchRequestedAt: text("launch_requested_at"),
    launchStartedAt: text("launch_started_at"),
    currentChapter: integer("current_chapter"),
    currentStage: text("current_stage"),
    currentStepKey: text("current_step_key"),
    configSnapshotId: text("config_snapshot_id"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    startedAt: text("started_at").notNull(),
    terminalAt: text("terminal_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    desiredStateCheck: check(
      "run_sessions_desired_state_check",
      sql`${table.desiredState} IN ('running', 'pause_requested', 'stop_requested')`,
    ),
    lifecycleStatusCheck: check(
      "run_sessions_lifecycle_status_check",
      sql`${table.lifecycleStatus} IN ('queued', 'launching', 'running', 'recovering', 'paused', 'interrupted', 'completed', 'failed', 'stopped')`,
    ),
    projectOpenUnique: uniqueIndex("uq_run_sessions_project_open")
      .on(table.projectId)
      .where(sql`${table.terminalAt} IS NULL`),
    globalActiveUnique: uniqueIndex("uq_run_sessions_global_active")
      .on(sql`(1)`)
      .where(sql`${table.terminalAt} IS NULL AND ${table.lifecycleStatus} IN ('queued', 'launching', 'running', 'recovering')`),
    projectSeqUnique: uniqueIndex("uq_run_sessions_project_seq").on(table.projectId, table.sessionSeq),
    leaseExpiryIdx: index("idx_run_sessions_lease_expiry")
      .on(table.leaseExpiresAt)
      .where(sql`${table.terminalAt} IS NULL`),
    statusIdx: index("idx_run_sessions_status")
      .on(table.lifecycleStatus, table.updatedAt)
      .where(sql`${table.terminalAt} IS NULL`),
  }),
);

export const runCheckpoints = sqliteTable(
  "run_checkpoints",
  {
    checkpointId: text("checkpoint_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    checkpointSeq: integer("checkpoint_seq").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    stage: text("stage").notNull(),
    stepKey: text("step_key").notNull(),
    stepStatus: text("step_status").notNull(),
    resumeCursorJson: text("resume_cursor_json"),
    artifactRefsJson: text("artifact_refs_json"),
    payloadJson: text("payload_json"),
    leaseEpoch: integer("lease_epoch").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    stepStatusCheck: check(
      "run_checkpoints_step_status_check",
      sql`${table.stepStatus} IN ('completed', 'skipped')`,
    ),
    sessionSeqUnique: uniqueIndex("run_checkpoints_session_checkpoint_seq_idx").on(table.sessionId, table.checkpointSeq),
    sessionChapterStepUnique: uniqueIndex("run_checkpoints_session_chapter_step_status_idx").on(
      table.sessionId,
      table.chapterNo,
      table.stepKey,
      table.stepStatus,
    ),
    sessionLatestIdx: index("idx_run_checkpoints_session_latest").on(table.sessionId, sql`${table.checkpointSeq} DESC`),
  }),
);

export const runEvents = sqliteTable(
  "run_events",
  {
    eventId: text("event_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    actorType: text("actor_type").notNull(),
    eventType: text("event_type").notNull(),
    level: text("level").notNull(),
    chapterNo: integer("chapter_no"),
    stage: text("stage"),
    stepKey: text("step_key"),
    message: text("message").notNull(),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    actorTypeCheck: check(
      "run_events_actor_type_check",
      sql`${table.actorType} IN ('web', 'runner', 'session_reconciler', 'commit_reconciler')`,
    ),
    levelCheck: check(
      "run_events_level_check",
      sql`${table.level} IN ('info', 'warn', 'error')`,
    ),
    sessionCreatedIdx: index("idx_run_events_session_created").on(table.sessionId, table.createdAt, table.eventId),
    levelCreatedIdx: index("idx_run_events_level_created").on(table.level, table.createdAt),
  }),
);

export const runConfigSnapshots = sqliteTable(
  "run_config_snapshots",
  {
    configSnapshotId: text("config_snapshot_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    llmProfileHash: text("llm_profile_hash").notNull(),
    reviewPolicyHash: text("review_policy_hash").notNull(),
    styleProfileHash: text("style_profile_hash").notNull(),
    promptPackHash: text("prompt_pack_hash").notNull(),
    structureProfileHash: text("structure_profile_hash"),
    voicePackHash: text("voice_pack_hash"),
    projectVoiceSnapshotHash: text("project_voice_snapshot_hash"),
    projectFoundationHash: text("project_foundation_hash"),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    sessionUnique: uniqueIndex("run_config_snapshots_session_id_idx").on(table.sessionId),
  }),
);

export const chapterCommits = sqliteTable(
  "chapter_commits",
  {
    commitId: text("commit_id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    sessionId: text("session_id"),
    sourceKind: text("source_kind").notNull(),
    acceptedVersionId: text("accepted_version_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").notNull(),
    manifestJson: text("manifest_json").notNull(),
    stageDir: text("stage_dir").notNull(),
    contentHash: text("content_hash").notNull(),
    fsAppliedAt: text("fs_applied_at"),
    committedAt: text("committed_at"),
    failedAt: text("failed_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    reconcileAttempts: integer("reconcile_attempts").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    sourceKindCheck: check(
      "chapter_commits_source_kind_check",
      sql`${table.sourceKind} IN ('run', 'workshop', 'rollback')`,
    ),
    stateCheck: check(
      "chapter_commits_state_check",
      sql`${table.state} IN ('prepared', 'fs_applied', 'committed', 'needs_reconcile', 'failed')`,
    ),
    idempotencyKeyUnique: uniqueIndex("chapter_commits_idempotency_key_idx").on(table.idempotencyKey),
    projectStateIdx: index("idx_chapter_commits_project_state").on(table.projectId, table.state, table.updatedAt),
    sessionIdx: index("idx_chapter_commits_session").on(table.sessionId, table.createdAt),
    chapterIdx: index("idx_chapter_commits_chapter").on(table.projectId, table.chapterNo, table.createdAt),
  }),
);

export const artifactOutbox = sqliteTable(
  "artifact_outbox",
  {
    jobId: text("job_id").primaryKey(),
    commitId: text("commit_id").notNull(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    jobType: text("job_type").notNull(),
    state: text("state").notNull(),
    claimToken: text("claim_token"),
    claimEpoch: integer("claim_epoch").notNull().default(0),
    workerId: text("worker_id"),
    claimedAt: text("claimed_at"),
    claimExpiresAt: text("claim_expires_at"),
    payloadJson: text("payload_json").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    doneAt: text("done_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    jobTypeCheck: check(
      "artifact_outbox_job_type_check",
      sql`${table.jobType} IN ('chapter_artifact_sync')`,
    ),
    stateCheck: check(
      "artifact_outbox_state_check",
      sql`${table.state} IN ('pending', 'claimed', 'done', 'failed')`,
    ),
    commitJobUnique: uniqueIndex("artifact_outbox_commit_job_type_idx").on(table.commitId, table.jobType),
    claimableIdx: index("idx_artifact_outbox_claimable").on(
      table.state,
      table.nextAttemptAt,
      table.claimExpiresAt,
      table.createdAt,
    ),
  }),
);

export const artifactManifests = sqliteTable(
  "artifact_manifests",
  {
    manifestId: text("manifest_id").primaryKey(),
    commitId: text("commit_id").notNull(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    artifactFamily: text("artifact_family").notNull(),
    relativePath: text("relative_path").notNull(),
    contentHash: text("content_hash").notNull(),
    authoritySource: text("authority_source").notNull().default("commit_manifest_v1"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    artifactFamilyCheck: check(
      "artifact_manifests_artifact_family_check",
      sql`${table.artifactFamily} IN ('chapter', 'blueprint', 'review')`,
    ),
    commitPathUnique: uniqueIndex("artifact_manifests_commit_path_idx").on(table.commitId, table.relativePath),
    projectChapterFamilyIdx: index("idx_artifact_manifests_project_chapter_family").on(
      table.projectId,
      table.chapterNo,
      table.artifactFamily,
      table.createdAt,
    ),
  }),
);

export const chapterInvalidations = sqliteTable(
  "chapter_invalidations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    rangeStartChapter: integer("range_start_chapter").notNull(),
    rangeEndChapter: integer("range_end_chapter").notNull(),
    reason: text("reason").notNull(),
    archivedPath: text("archived_path").notNull(),
    excerpt: text("excerpt").notNull(),
    reviewReason: text("review_reason"),
    operationKey: text("operation_key"),
    invalidatedAt: text("invalidated_at").notNull(),
  },
  (table) => ({
    projectChapterInvalidatedAtIdx: index("idx_chapter_invalidations_project_chapter").on(
      table.projectId,
      table.chapterNo,
      sql`${table.invalidatedAt} DESC`,
    ),
    operationChapterUniqueIdx: uniqueIndex("idx_chapter_invalidations_operation_chapter").on(
      table.operationKey,
      table.chapterNo,
    ),
  }),
);

export const timelineMutationEffects = sqliteTable(
  "timeline_mutation_effects",
  {
    operationKey: text("operation_key").primaryKey(),
    identityKey: text("identity_key").notNull().unique(),
    mutationIdentity: text("mutation_identity").notNull(),
    commitId: text("commit_id").notNull(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    state: text("state", { enum: ["pending", "done"] }).notNull().default("pending"),
    payloadJson: text("payload_json").notNull(),
    resultJson: text("result_json"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectChapterIdx: index("idx_timeline_mutation_effects_project_chapter").on(table.projectId, table.chapterNo),
    mutationIdentityIdx: index("idx_timeline_mutation_effects_identity").on(table.projectId, table.chapterNo, table.mutationIdentity),
  }),
);

export const chapterVersions = sqliteTable(
  "chapter_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    versionNo: integer("version_no").notNull(),
    temperature: real("temperature").notNull(),
    path: text("path").notNull(),
    excerpt: text("excerpt").notNull(),
    selected: integer("selected", { mode: "boolean" }).notNull().default(false),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectChapterIdx: index("idx_chapter_versions_project_chapter").on(
      table.projectId,
      table.chapterNo,
    ),
  }),
);

export const chapterSubmissionBatches = sqliteTable(
  "chapter_submission_batches",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    sourceFileHash: text("source_file_hash").notNull(),
    chapterCount: integer("chapter_count").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex("idx_submission_batches_identity").on(
      table.projectId,
      table.sourceFileHash,
    ),
    statusCheck: check(
      "chapter_submission_batches_status_check",
      sql`${table.status} IN ('preview','importing','completed','partial_failed','failed')`,
    ),
  }),
);

export const chapterSubmissions = sqliteTable(
  "chapter_submissions",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id"),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    title: text("title").notNull(),
    source: text("source").notNull(),
    contentPath: text("content_path").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull(),
    parentSubmissionId: text("parent_submission_id"),
    committedVersionId: text("committed_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    identityIdx: uniqueIndex("idx_chapter_submissions_identity").on(
      table.projectId,
      table.chapterNo,
      table.contentHash,
    ),
    batchIdx: index("idx_chapter_submissions_batch").on(table.batchId),
    parentIdx: index("idx_chapter_submissions_parent").on(table.parentSubmissionId),
    statusCheck: check(
      "chapter_submissions_status_check",
      sql`${table.status} IN ('draft','queued','reviewing','needs_revision','approved','committed','failed')`,
    ),
    sourceCheck: check(
      "chapter_submissions_source_check",
      sql`${table.source} IN ('human','codex','import')`,
    ),
  }),
);

export const reviewReports = sqliteTable(
  "review_reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    submissionId: text("submission_id"),
    versionId: text("version_id"),
    contentHash: text("content_hash"),
    reviewerProfileId: text("reviewer_profile_id"),
    promptHash: text("prompt_hash"),
    reviewSchemaVersion: text("review_schema_version"),
    windowContentHash: text("window_content_hash"),
    verdict: text("verdict").notNull(),
    reviewMode: text("review_mode").notNull().default("deep"),
    confidence: real("confidence").notNull(),
    reason: text("reason").notNull(),
    fixInstructions: text("fix_instructions").notNull(),
    issuesJson: text("issues_json").notNull(),
    triggerReasonsJson: text("trigger_reasons_json").notNull().default("[]"),
    styleChecklistHitsJson: text("style_checklist_hits_json").notNull().default("[]"),
    charterViolationsJson: text("charter_violations_json").notNull().default("[]"),
    storyProgressionJson: text("story_progression_json").notNull().default("{}"),
    genreFulfillmentJson: text("genre_fulfillment_json").notNull().default("null"),
    loopRiskJson: text("loop_risk_json").notNull().default("{}"),
    plannerQualityJson: text("planner_quality_json").notNull().default("null"),
    failureCategory: text("failure_category"),
    repairStrategy: text("repair_strategy"),
    primaryDeltaDelivered: text("primary_delta_delivered"),
    stuckDimensionsJson: text("stuck_dimensions_json").notNull().default("[]"),
    windowStartChapter: integer("window_start_chapter"),
    windowEndChapter: integer("window_end_chapter"),
    earliestAffectedChapter: integer("earliest_affected_chapter"),
    path: text("path").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectChapterCreatedIdx: index("idx_review_reports_project_chapter_created").on(
      table.projectId,
      table.chapterNo,
      sql`${table.createdAt} DESC`,
    ),
    projectCreatedIdx: index("idx_review_reports_project_created").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export const chapterDeltaRecords = sqliteTable(
  "chapter_delta_records",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    segmentId: text("segment_id"),
    segmentItemId: text("segment_item_id"),
    primaryDeltaDelivered: text("primary_delta_delivered"),
    deliveredDeltasJson: text("delivered_deltas_json").notNull().default("[]"),
    storyProgressionJson: text("story_progression_json").notNull().default("{}"),
    genreFulfillmentJson: text("genre_fulfillment_json").notNull().default("null"),
    loopRiskJson: text("loop_risk_json").notNull().default("{}"),
    stuckDimensionsJson: text("stuck_dimensions_json").notNull().default("[]"),
    arenaKey: text("arena_key"),
    objectiveKey: text("objective_key"),
    antagonistKey: text("antagonist_key"),
    actionPattern: text("action_pattern"),
    endingMove: text("ending_move"),
    mechanismRevealMode: text("mechanism_reveal_mode"),
    motifTokensJson: text("motif_tokens_json").notNull().default("[]"),
    obligationHitsJson: text("obligation_hits_json").notNull().default("[]"),
    summary: text("summary").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectChapterUnique: uniqueIndex("chapter_delta_records_project_chapter_idx").on(table.projectId, table.chapterNo),
  }),
);

export const styleDeltaNotes = sqliteTable(
  "style_delta_notes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    accepted: integer("accepted", { mode: "boolean" }).notNull(),
    notesJson: text("notes_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectCreatedAtIdx: index("idx_style_delta_notes_project_created_at").on(table.projectId, sql`${table.createdAt} DESC`),
  }),
);

export const contextPacks = sqliteTable(
  "context_packs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    totalTokens: integer("total_tokens").notNull(),
    breakdownJson: text("breakdown_json").notNull(),
    usageJson: text("usage_json"),
    conflictsJson: text("conflicts_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectChapterIdx: index("idx_context_packs_project_chapter").on(
      table.projectId,
      table.chapterNo,
    ),
  }),
);

export const canonFactIndex = sqliteTable(
  "canon_fact_index",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    type: text("type").notNull(),
    content: text("content").notNull(),
    keywords: text("keywords").notNull(),
    metadataJson: text("metadata_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectChapterTypeIdx: index("idx_canon_fact_index_project_chapter_type").on(
      table.projectId,
      table.chapterNo,
      table.type,
    ),
  }),
);

export const summaryIndex = sqliteTable(
  "summary_index",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    level: text("level").notNull(),
    content: text("content").notNull(),
    keywords: text("keywords").notNull(),
    path: text("path").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectChapterLevelIdx: index("idx_summary_index_project_chapter_level").on(
      table.projectId,
      table.chapterNo,
      table.level,
    ),
  }),
);

export const conflicts = sqliteTable(
  "conflicts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    conflictType: text("conflict_type").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    resolution: text("resolution"),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectChapterIdx: index("idx_conflicts_project_chapter").on(
      table.projectId,
      table.chapterNo,
    ),
  }),
);

export const runStatistics = sqliteTable(
  "run_statistics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    stage: text("stage").notNull(),
    metricsJson: text("metrics_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    stageCheck: check(
      "run_statistics_stage_check",
      sql`${table.stage} IN ('segment_rewrite', 'chapter_plan', 'blueprint', 'planning_repair', 'canon', 'conflict')`,
    ),
    projectChapterStageIdx: index("idx_run_statistics_project_chapter_stage").on(
      table.projectId,
      table.chapterNo,
      table.stage,
      sql`${table.createdAt} DESC`,
    ),
    projectCreatedIdx: index("idx_run_statistics_project_created").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export const runLogs = sqliteTable(
  "run_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    projectCreatedIdx: index("idx_run_logs_project_created").on(
      table.projectId,
      sql`${table.createdAt} DESC`,
    ),
  }),
);

export const projectCards = sqliteTable(
  "project_cards",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    cardType: text("card_type").notNull(),
    name: text("name").notNull(),
    draftJson: text("draft_json").notNull().default("{}"),
    metaJson: text("meta_json").notNull().default("{}"),
    status: text("status").notNull().default("draft"),
    confirmedAt: text("confirmed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    cardTypeCheck: check(
      "project_cards_card_type_check",
      sql`${table.cardType} IN ('character', 'world')`,
    ),
    statusCheck: check(
      "project_cards_status_check",
      sql`${table.status} IN ('draft', 'confirmed')`,
    ),
    projectIdx: index("idx_project_cards_project_id").on(table.projectId),
  }),
);

export const projectCardMessages = sqliteTable(
  "project_card_messages",
  {
    id: text("id").primaryKey(),
    cardId: text("card_id").notNull(),
    projectId: text("project_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    roleCheck: check(
      "project_card_messages_role_check",
      sql`${table.role} IN ('user', 'assistant')`,
    ),
    cardIdx: index("idx_card_messages_card_id").on(table.cardId),
    projectCreatedIdx: index("idx_project_card_messages_project_created").on(
      table.projectId,
      table.createdAt,
    ),
  }),
);

export const cardProgressions = sqliteTable(
  "card_progressions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    cardId: text("card_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    targetPath: text("target_path").notNull(),
    mode: text("mode").notNull(),
    content: text("content").notNull(),
    sourceFactIdsJson: text("source_fact_ids_json").notNull().default("[]"),
    status: text("status").notNull().default("active"),
    reviewState: text("review_state").notNull().default("provisional"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectChapterIdx: index("idx_card_progressions_project_chapter").on(table.projectId, table.chapterNo),
    cardIdx: index("idx_card_progressions_card_id").on(table.cardId),
  }),
);

export const chapterReviewStates = sqliteTable(
  "chapter_review_states",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    chapterNo: integer("chapter_no").notNull(),
    status: text("status").notNull().default("provisional"),
    quickCheckedAt: text("quick_checked_at"),
    deepCheckedAt: text("deep_checked_at"),
    openWindowId: text("open_window_id"),
    lastReviewMode: text("last_review_mode"),
    latestConfidence: real("latest_confidence").notNull().default(0),
    earliestAffectedChapter: integer("earliest_affected_chapter"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectChapterUnique: uniqueIndex("chapter_review_states_project_chapter_idx").on(table.projectId, table.chapterNo),
  }),
);
