import "../server-only.ts";

import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import { conflict } from "../errors.ts";
import { buildFtsMatchQuery } from "../search-query.ts";
import type {
  CanonFact,
  ChapterDeltaRecord,
  ChapterReviewState,
  ConflictRecord,
  ContextPack,
  ContextUsage,
  PlannerQualitySummary,
  QuickAuditVerdict,
  ReviewLineage,
  ReviewMode,
  ReviewVerdict,
} from "../types.ts";
import { nowIso, safeJsonParse } from "../utils.ts";
import { type ReviewReportRecord, toChapterReviewState, toConflictRecord } from "./shared.ts";

export interface StyleDeltaNoteRecord {
  id: string;
  projectId: string;
  chapterNo: number;
  accepted: boolean;
  notes: string[];
  createdAt: string;
}

export interface ReviewContentIdentityOptions {
  currentContentHash: string | null;
  currentWindowContentHashes?: Record<string, string>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function assertReviewLineage(
  projectId: string,
  chapterNo: number,
  review: QuickAuditVerdict | ReviewVerdict,
  lineage: ReviewLineage,
) {
  if (
    !SHA256_PATTERN.test(lineage.contentHash)
    || !SHA256_PATTERN.test(lineage.promptHash)
    || !lineage.reviewerProfileId.trim()
    || !lineage.reviewSchemaVersion.trim()
    || (lineage.windowContentHash !== null && !SHA256_PATTERN.test(lineage.windowContentHash))
    || (review.reviewMode === "deep") !== (lineage.windowContentHash !== null)
  ) {
    throw conflict("审查血缘信息无效");
  }
  if (lineage.submissionId) {
    const submission = rawDb.prepare(
      "SELECT project_id, chapter_no, content_hash FROM chapter_submissions WHERE id = ?",
    ).get(lineage.submissionId) as Record<string, unknown> | undefined;
    if (
      !submission
      || String(submission.project_id) !== projectId
      || Number(submission.chapter_no) !== chapterNo
      || String(submission.content_hash) !== lineage.contentHash
    ) {
      throw conflict("审查作者稿归属无效");
    }
  }
  if (lineage.versionId) {
    const version = rawDb.prepare(
      "SELECT project_id, chapter_no FROM chapter_versions WHERE id = ?",
    ).get(lineage.versionId) as Record<string, unknown> | undefined;
    if (
      !version
      || String(version.project_id) !== projectId
      || Number(version.chapter_no) !== chapterNo
    ) {
      throw conflict("审查版本归属无效");
    }
  }
}

export function saveReviewReport(
  projectId: string,
  chapterNo: number,
  review: QuickAuditVerdict | ReviewVerdict,
  path: string,
  plannerQuality: PlannerQualitySummary | null,
  lineage: ReviewLineage,
) {
  assertReviewLineage(projectId, chapterNo, review, lineage);
  const id = nanoid();
  const now = nowIso();
  rawDb
    .prepare(`
      INSERT INTO review_reports (
        id, project_id, chapter_no, submission_id, version_id, content_hash, reviewer_profile_id,
        prompt_hash, review_schema_version, window_content_hash, verdict, review_mode, confidence, reason, fix_instructions, issues_json,
        trigger_reasons_json, style_checklist_hits_json, charter_violations_json, story_progression_json,
        genre_fulfillment_json, loop_risk_json, planner_quality_json, failure_category, repair_strategy,
        primary_delta_delivered, stuck_dimensions_json,
        window_start_chapter, window_end_chapter,
        earliest_affected_chapter, path, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      projectId,
      chapterNo,
      lineage.submissionId,
      lineage.versionId,
      lineage.contentHash,
      lineage.reviewerProfileId,
      lineage.promptHash,
      lineage.reviewSchemaVersion,
      lineage.windowContentHash,
      review.verdict,
      review.reviewMode,
      review.confidence,
      review.reason,
      review.fixInstructions,
      JSON.stringify(review.issues),
      JSON.stringify(review.triggerReasons ?? []),
      JSON.stringify(review.styleChecklistHits ?? []),
      JSON.stringify(review.charterViolations ?? []),
      JSON.stringify(review.storyProgression ?? {}),
      JSON.stringify(review.genreFulfillment ?? null),
      JSON.stringify(review.loopRisk ?? {}),
      JSON.stringify(plannerQuality ?? null),
      review.failureCategory ?? null,
      review.repairStrategy ?? null,
      review.primaryDeltaDelivered ?? null,
      JSON.stringify(review.stuckDimensions ?? []),
      review.reviewMode === "deep" ? review.windowStartChapter : null,
      review.reviewMode === "deep" ? review.windowEndChapter : null,
      review.reviewMode === "deep" ? review.earliestAffectedChapter : null,
      path,
      now,
    );
  return id;
}

export function listReviewReports(
  projectId: string,
  chapterNo?: number,
  options?: ReviewContentIdentityOptions,
): ReviewReportRecord[] {
  const sql = chapterNo !== undefined
    ? "SELECT * FROM review_reports WHERE project_id = ? AND chapter_no = ? ORDER BY created_at DESC, rowid DESC"
    : "SELECT * FROM review_reports WHERE project_id = ? ORDER BY created_at DESC, rowid DESC";
  const rows = chapterNo !== undefined
    ? (rawDb.prepare(sql).all(projectId, chapterNo) as Array<Record<string, unknown>>)
    : (rawDb.prepare(sql).all(projectId) as Array<Record<string, unknown>>);
  return rows.map((row) => {
    const contentHash = row.content_hash == null ? null : String(row.content_hash);
    const reviewMode = String(row.review_mode ?? "deep") as ReviewMode;
    const windowStartChapter = row.window_start_chapter ? Number(row.window_start_chapter) : null;
    const windowEndChapter = row.window_end_chapter ? Number(row.window_end_chapter) : null;
    const windowContentHash = row.window_content_hash == null ? null : String(row.window_content_hash);
    const currentWindowContentHash = windowStartChapter !== null && windowEndChapter !== null
      ? options?.currentWindowContentHashes?.[`${windowStartChapter}:${windowEndChapter}`]
      : undefined;
    const stale = !contentHash
      || options === undefined
      || contentHash !== options.currentContentHash
      || (reviewMode === "deep" && (
        !windowContentHash
        || currentWindowContentHash === undefined
        || windowContentHash !== currentWindowContentHash
      ));
    return {
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    submissionId: row.submission_id == null ? null : String(row.submission_id),
    versionId: row.version_id == null ? null : String(row.version_id),
    contentHash,
    reviewerProfileId: row.reviewer_profile_id == null ? null : String(row.reviewer_profile_id),
    promptHash: row.prompt_hash == null ? null : String(row.prompt_hash),
    reviewSchemaVersion: row.review_schema_version == null ? null : String(row.review_schema_version),
    windowContentHash,
    stale,
    verdict: String(row.verdict) as ReviewReportRecord["verdict"],
    reviewMode,
    confidence: Number(row.confidence),
    reason: String(row.reason),
    fixInstructions: String(row.fix_instructions),
    issues: safeJsonParse(String(row.issues_json), []),
    triggerReasons: safeJsonParse(String(row.trigger_reasons_json ?? "[]"), []),
    styleChecklistHits: safeJsonParse(String(row.style_checklist_hits_json ?? "[]"), []),
    charterViolations: safeJsonParse(String(row.charter_violations_json ?? "[]"), []),
    storyProgression: safeJsonParse(String(row.story_progression_json ?? "{}"), {
      risk: "watch",
      score: 0,
      summary: "",
      advancements: [],
      stallSignals: [],
      primaryDelta: null,
      deliveredDeltas: [],
    }),
    genreFulfillment: safeJsonParse(String(row.genre_fulfillment_json ?? "null"), null),
    loopRisk: safeJsonParse(String(row.loop_risk_json ?? "{}"), {
      risk: "watch",
      score: 0,
      summary: "",
      repetitionAxes: [],
      stuckDimensions: [],
    }),
    plannerQuality: safeJsonParse(String(row.planner_quality_json ?? "null"), null),
    failureCategory: row.failure_category ? String(row.failure_category) as ReviewReportRecord["failureCategory"] : undefined,
    repairStrategy: row.repair_strategy ? String(row.repair_strategy) as ReviewReportRecord["repairStrategy"] : undefined,
    primaryDeltaDelivered: row.primary_delta_delivered ? String(row.primary_delta_delivered) as ChapterDeltaRecord["primaryDeltaDelivered"] : null,
    stuckDimensions: safeJsonParse(String(row.stuck_dimensions_json ?? "[]"), []),
    windowStartChapter,
    windowEndChapter,
    earliestAffectedChapter: row.earliest_affected_chapter ? Number(row.earliest_affected_chapter) : null,
    path: String(row.path),
    createdAt: String(row.created_at),
    };
  });
}

export function getLatestReview(
  projectId: string,
  chapterNo: number,
  options: ReviewContentIdentityOptions,
) {
  return listReviewReports(projectId, chapterNo, options).find((report) => !report.stale) ?? null;
}

export function saveChapterDeltaRecord(record: ChapterDeltaRecord) {
  rawDb
    .prepare(`
      INSERT INTO chapter_delta_records (
        id, project_id, chapter_no, segment_id, segment_item_id, primary_delta_delivered,
        delivered_deltas_json, story_progression_json, genre_fulfillment_json, loop_risk_json,
        stuck_dimensions_json, arena_key, objective_key, antagonist_key, action_pattern,
        ending_move, mechanism_reveal_mode, motif_tokens_json, obligation_hits_json, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, chapter_no) DO UPDATE SET
        segment_id = excluded.segment_id,
        segment_item_id = excluded.segment_item_id,
        primary_delta_delivered = excluded.primary_delta_delivered,
        delivered_deltas_json = excluded.delivered_deltas_json,
        story_progression_json = excluded.story_progression_json,
        genre_fulfillment_json = excluded.genre_fulfillment_json,
        loop_risk_json = excluded.loop_risk_json,
        stuck_dimensions_json = excluded.stuck_dimensions_json,
        arena_key = excluded.arena_key,
        objective_key = excluded.objective_key,
        antagonist_key = excluded.antagonist_key,
        action_pattern = excluded.action_pattern,
        ending_move = excluded.ending_move,
        mechanism_reveal_mode = excluded.mechanism_reveal_mode,
        motif_tokens_json = excluded.motif_tokens_json,
        obligation_hits_json = excluded.obligation_hits_json,
        summary = excluded.summary,
        created_at = excluded.created_at
    `)
    .run(
      record.id,
      record.projectId,
      record.chapterNo,
      record.segmentId,
      record.segmentItemId,
      record.primaryDeltaDelivered ?? null,
      JSON.stringify(record.deliveredDeltas),
      JSON.stringify(record.storyProgression),
      JSON.stringify(record.genreFulfillment),
      JSON.stringify(record.loopRisk),
      JSON.stringify(record.stuckDimensions),
      record.arenaKey,
      record.objectiveKey,
      record.antagonistKey ?? null,
      record.actionPattern ?? null,
      record.endingMove ?? null,
      record.mechanismRevealMode ?? null,
      JSON.stringify(record.motifTokens ?? []),
      JSON.stringify(record.obligationHits),
      record.summary,
      record.createdAt,
    );
}

export function listChapterDeltaRecords(projectId: string, options?: { uptoChapter?: number }) {
  const rows = options?.uptoChapter
    ? (rawDb
      .prepare("SELECT * FROM chapter_delta_records WHERE project_id = ? AND chapter_no <= ? ORDER BY chapter_no ASC")
      .all(projectId, options.uptoChapter) as Array<Record<string, unknown>>)
    : (rawDb
      .prepare("SELECT * FROM chapter_delta_records WHERE project_id = ? ORDER BY chapter_no ASC")
      .all(projectId) as Array<Record<string, unknown>>);

  return rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    segmentId: row.segment_id ? String(row.segment_id) : null,
    segmentItemId: row.segment_item_id ? String(row.segment_item_id) : null,
    primaryDeltaDelivered: row.primary_delta_delivered ? String(row.primary_delta_delivered) as ChapterDeltaRecord["primaryDeltaDelivered"] : null,
    deliveredDeltas: safeJsonParse(String(row.delivered_deltas_json ?? "[]"), []),
    storyProgression: safeJsonParse(String(row.story_progression_json ?? "{}"), {
      risk: "watch",
      score: 0,
      summary: "",
      advancements: [],
      stallSignals: [],
      primaryDelta: null,
      deliveredDeltas: [],
    }),
    genreFulfillment: safeJsonParse(String(row.genre_fulfillment_json ?? "null"), null),
    loopRisk: safeJsonParse(String(row.loop_risk_json ?? "{}"), {
      risk: "watch",
      score: 0,
      summary: "",
      repetitionAxes: [],
      stuckDimensions: [],
    }),
    stuckDimensions: safeJsonParse(String(row.stuck_dimensions_json ?? "[]"), []),
    arenaKey: row.arena_key ? String(row.arena_key) : null,
    objectiveKey: row.objective_key ? String(row.objective_key) : null,
    antagonistKey: row.antagonist_key ? String(row.antagonist_key) : null,
    actionPattern: row.action_pattern ? String(row.action_pattern) as ChapterDeltaRecord["actionPattern"] : null,
    endingMove: row.ending_move ? String(row.ending_move) as ChapterDeltaRecord["endingMove"] : null,
    mechanismRevealMode: row.mechanism_reveal_mode ? String(row.mechanism_reveal_mode) as ChapterDeltaRecord["mechanismRevealMode"] : null,
    motifTokens: safeJsonParse(String(row.motif_tokens_json ?? "[]"), []),
    obligationHits: safeJsonParse(String(row.obligation_hits_json ?? "[]"), []),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at),
  } satisfies ChapterDeltaRecord));
}

export function saveStyleDeltaNotes(
  projectId: string,
  chapterNo: number,
  accepted: boolean,
  notes: string[],
) {
  rawDb
    .prepare(`
      INSERT INTO style_delta_notes (id, project_id, chapter_no, accepted, notes_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      nanoid(),
      projectId,
      chapterNo,
      accepted ? 1 : 0,
      JSON.stringify(notes),
      nowIso(),
    );
}

export function listStyleDeltaNotes(
  projectId: string,
  options?: { limit?: number; accepted?: boolean },
): StyleDeltaNoteRecord[] {
  const clauses = ["project_id = ?"];
  const args: Array<string | number> = [projectId];
  if (typeof options?.accepted === "boolean") {
    clauses.push("accepted = ?");
    args.push(options.accepted ? 1 : 0);
  }
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
  args.push(limit);
  return (
    rawDb
      .prepare(`
        SELECT * FROM style_delta_notes
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(...args) as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    accepted: Boolean(row.accepted),
    notes: safeJsonParse(String(row.notes_json ?? "[]"), []),
    createdAt: String(row.created_at),
  }));
}

export function saveContextPack(projectId: string, chapterNo: number, contextPack: ContextPack) {
  rawDb
    .prepare(`
      INSERT INTO context_packs (id, project_id, chapter_no, total_tokens, breakdown_json, conflicts_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      nanoid(),
      projectId,
      chapterNo,
      contextPack.totalTokens,
      JSON.stringify(contextPack.breakdown),
      JSON.stringify(contextPack.conflicts),
      nowIso(),
    );
}

export function saveReviewContextUsage(
  projectId: string,
  chapterNo: number,
  mode: ReviewMode,
  usage: ContextUsage,
) {
  const row = rawDb.prepare(`
    SELECT id, usage_json
    FROM context_packs
    WHERE project_id = ? AND chapter_no = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(projectId, chapterNo) as { id?: string; usage_json?: string | null } | undefined;
  if (!row?.id) {
    return false;
  }
  const existing = safeJsonParse<Record<string, ContextUsage>>(String(row.usage_json ?? "{}"), {});
  rawDb.prepare("UPDATE context_packs SET usage_json = ? WHERE id = ?")
    .run(JSON.stringify({ ...existing, [mode]: usage }), row.id);
  return true;
}

export function listContextPacks(projectId: string) {
  return rawDb
    .prepare("SELECT * FROM context_packs WHERE project_id = ? ORDER BY chapter_no DESC")
    .all(projectId) as Array<Record<string, unknown>>;
}

export function saveConflictRecords(projectId: string, chapterNo: number, records: ConflictRecord[]) {
  const deleteStmt = rawDb.prepare("DELETE FROM conflicts WHERE project_id = ? AND chapter_no = ?");
  const insertStmt = rawDb.prepare(`
    INSERT INTO conflicts (id, project_id, chapter_no, conflict_type, severity, message, resolution, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = nowIso();

  rawDb.transaction(() => {
    deleteStmt.run(projectId, chapterNo);
    for (const record of records) {
      insertStmt.run(
        record.id,
        projectId,
        chapterNo,
        record.type,
        record.severity,
        record.message,
        record.resolution ?? null,
        record.note ?? null,
        now,
      );
    }
  })();
}

export function listConflicts(projectId: string, chapterNo?: number) {
  const sql = chapterNo
    ? "SELECT * FROM conflicts WHERE project_id = ? AND chapter_no = ? ORDER BY created_at DESC"
    : "SELECT * FROM conflicts WHERE project_id = ? ORDER BY chapter_no DESC, created_at DESC";
  return chapterNo
    ? ((rawDb.prepare(sql).all(projectId, chapterNo) as Array<Record<string, unknown>>).map(toConflictRecord))
    : ((rawDb.prepare(sql).all(projectId) as Array<Record<string, unknown>>).map(toConflictRecord));
}

export function replaceCanonFactsForChapter(projectId: string, chapterNo: number, facts: CanonFact[]) {
  const deleteRows = rawDb.prepare("DELETE FROM canon_fact_index WHERE project_id = ? AND chapter_no = ?");
  const deleteFts = rawDb.prepare("DELETE FROM canon_fact_search WHERE project_id = ? AND chapter_no = ?");
  const insertRow = rawDb.prepare(`
    INSERT INTO canon_fact_index (id, project_id, chapter_no, type, content, keywords, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = rawDb.prepare(`
    INSERT INTO canon_fact_search (fact_id, project_id, chapter_no, content, keywords)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = nowIso();

  rawDb.transaction(() => {
    deleteRows.run(projectId, chapterNo);
    deleteFts.run(projectId, chapterNo);
    for (const fact of facts) {
      insertRow.run(
        fact.id,
        projectId,
        fact.chapterNo,
        fact.type,
        fact.content,
        fact.keywords.join(" "),
        JSON.stringify(fact.metadata),
        fact.timestamp || now,
      );
      insertFts.run(fact.id, projectId, fact.chapterNo, fact.content, fact.keywords.join(" "));
    }
  })();
}

interface ParsedContextKeywordQuery {
  p1: string[];
  p2: string[];
  p3: string[];
  entities: string[];
  terms: string[];
}

function parseContextKeywordQuery(query: string): ParsedContextKeywordQuery {
  const parsed: ParsedContextKeywordQuery = {
    p1: [],
    p2: [],
    p3: [],
    entities: [],
    terms: [],
  };

  const fallbackTerms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const lines = query
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.some((line) => line.includes("|"))) {
    parsed.terms = [...new Set(fallbackTerms)];
    return parsed;
  }

  for (const line of lines) {
    const [rawPrefix, ...rawValueParts] = line.split("|");
    const prefix = rawPrefix?.trim().toUpperCase();
    const value = rawValueParts.join("|").trim();
    if (!value) {
      continue;
    }
    parsed.terms.push(value);
    if (prefix === "P1") {
      parsed.p1.push(value);
    } else if (prefix === "P2") {
      parsed.p2.push(value);
    } else if (prefix === "P3") {
      parsed.p3.push(value);
    } else if (prefix === "ENTITY") {
      parsed.entities.push(value);
    }
  }

  parsed.p1 = [...new Set(parsed.p1)];
  parsed.p2 = [...new Set(parsed.p2)];
  parsed.p3 = [...new Set(parsed.p3)];
  parsed.entities = [...new Set(parsed.entities)];
  parsed.terms = [...new Set(parsed.terms)];

  return parsed;
}

function countExactPhraseHits(text: string, phrases: string[]) {
  return phrases.reduce((count, phrase) => count + (phrase.trim() && text.includes(phrase.trim()) ? 1 : 0), 0);
}

function typePriority(type: CanonFact["type"]) {
  switch (type) {
    case "foreshadow":
      return 1.3;
    case "plot_event":
      return 1.2;
    case "relationship":
      return 1.1;
    case "character_state":
      return 1.05;
    case "location_change":
      return 1;
    case "world_rule":
      return 0.98;
    case "timeline_marker":
      return 0.95;
    case "item_acquired":
      return 0.9;
    default:
      return 1;
  }
}

function buildCanonFactSearchSql(types: CanonFact["type"][] | undefined, beforeChapter: number | undefined) {
  const filters = [
    "canon_fact_search.project_id = ?",
    "canon_fact_search MATCH ?",
  ];
  const paramsKinds: Array<"projectId" | "matchQuery" | "beforeChapter" | "type" | "limit"> = [
    "projectId",
    "matchQuery",
  ];

  if (typeof beforeChapter === "number") {
    filters.push("idx.chapter_no < ?");
    paramsKinds.push("beforeChapter");
  }

  if (types?.length) {
    filters.push(`idx.type IN (${types.map(() => "?").join(", ")})`);
    paramsKinds.push(...types.map(() => "type" as const));
  }

  return {
    sql: `
      SELECT idx.*, bm25(canon_fact_search) AS rank
      FROM canon_fact_search
      JOIN canon_fact_index idx ON idx.id = canon_fact_search.fact_id
      WHERE ${filters.join(" AND ")}
      ORDER BY rank ASC
      LIMIT ?
    `,
    paramsKinds: [...paramsKinds, "limit" as const],
  };
}

export function searchCanonFacts(
  projectId: string,
  query: string,
  currentChapter: number,
  limit = 10,
  options?: {
    types?: CanonFact["type"][];
    beforeChapter?: number;
  },
): CanonFact[] {
  const parsedQuery = parseContextKeywordQuery(query);
  if (!parsedQuery.terms.length) {
    return [];
  }

  const matchQuery = buildFtsMatchQuery(parsedQuery.terms.join(" "));
  if (!matchQuery) {
    return [];
  }

  const sql = buildCanonFactSearchSql(options?.types, options?.beforeChapter);
  const typeValues = [...(options?.types ?? [])];
  let typeIndex = 0;
  const params = sql.paramsKinds.map((kind) => {
    switch (kind) {
      case "projectId":
        return projectId;
      case "matchQuery":
        return matchQuery;
      case "beforeChapter":
        return options?.beforeChapter ?? currentChapter;
      case "type":
        return typeValues[typeIndex++];
      case "limit":
        return limit * 5;
      default:
        return null;
    }
  });
  const rows = rawDb.prepare(sql.sql).all(...params) as Array<Record<string, unknown>>;

  return rows
    .map((row) => {
      const fact = {
        id: String(row.id),
        type: row.type as CanonFact["type"],
        chapterNo: Number(row.chapter_no),
        content: String(row.content),
        metadata: safeJsonParse(String(row.metadata_json), {}),
        timestamp: String(row.created_at),
        keywords: String(row.keywords).split(/\s+/).filter(Boolean),
      } satisfies CanonFact;
      const searchableText = `${fact.content}\n${fact.keywords.join(" ")}`;
      const p1Hits = countExactPhraseHits(searchableText, parsedQuery.p1);
      const p2Hits = countExactPhraseHits(searchableText, parsedQuery.p2);
      const p3Hits = countExactPhraseHits(searchableText, parsedQuery.p3);
      const entityHits = countExactPhraseHits(searchableText, parsedQuery.entities);
      const baseScore = 1 / (1 + Math.max(0, Number(row.rank ?? 0)));
      const chapterDistance = Math.max(0, currentChapter - fact.chapterNo);
      const chapterDecay = Math.exp(-0.18 * chapterDistance);
      const rerankScore =
        baseScore * 35
        + p1Hits * 90
        + p2Hits * 40
        + p3Hits * 18
        + entityHits * 55
        + chapterDecay * 22
        + typePriority(fact.type) * 10;
      return {
        fact,
        score: rerankScore,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.fact);
}

export function upsertSummaryIndex(
  projectId: string,
  chapterNo: number,
  entries: Array<{ level: "brief" | "detailed" | "full"; content: string; path: string; keywords: string[] }>,
) {
  const deleteRows = rawDb.prepare("DELETE FROM summary_index WHERE project_id = ? AND chapter_no = ?");
  const deleteFts = rawDb.prepare("DELETE FROM summary_search WHERE project_id = ? AND chapter_no = ?");
  const insertRow = rawDb.prepare(`
    INSERT INTO summary_index (id, project_id, chapter_no, level, content, keywords, path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = rawDb.prepare(`
    INSERT INTO summary_search (summary_id, project_id, chapter_no, level, content, keywords)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = nowIso();

  rawDb.transaction(() => {
    deleteRows.run(projectId, chapterNo);
    deleteFts.run(projectId, chapterNo);
    for (const entry of entries) {
      const id = nanoid();
      insertRow.run(id, projectId, chapterNo, entry.level, entry.content, entry.keywords.join(" "), entry.path, now);
      insertFts.run(id, projectId, chapterNo, entry.level, entry.content, entry.keywords.join(" "));
    }
  })();
}

export function getSummaryEntries(projectId: string) {
  return rawDb
    .prepare("SELECT * FROM summary_index WHERE project_id = ? ORDER BY chapter_no DESC")
    .all(projectId) as Array<Record<string, unknown>>;
}

export function searchSummaries(projectId: string, query: string, currentChapter: number) {
  const parsedQuery = parseContextKeywordQuery(query);
  const matchQuery = buildFtsMatchQuery(parsedQuery.terms.join(" "));
  const results: Array<{ chapterNo: number; level: string; content: string; path: string }> = [];

  const recentRows = rawDb
    .prepare(`
      SELECT chapter_no, level, content, path
      FROM summary_index
      WHERE project_id = ? AND chapter_no < ? AND level = 'full'
      ORDER BY chapter_no DESC
      LIMIT 3
    `)
    .all(projectId, currentChapter) as Array<Record<string, unknown>>;

  for (const row of recentRows) {
    results.push({
      chapterNo: Number(row.chapter_no),
      level: String(row.level),
      content: String(row.content),
      path: String(row.path),
    });
  }

  const midRows = rawDb
    .prepare(`
      SELECT chapter_no, level, content, path
      FROM summary_index
      WHERE project_id = ? AND chapter_no < ? AND chapter_no >= ? AND level = 'detailed'
      ORDER BY chapter_no DESC
      LIMIT 7
    `)
    .all(projectId, currentChapter - 3, Math.max(1, currentChapter - 10)) as Array<Record<string, unknown>>;

  for (const row of midRows) {
    results.push({
      chapterNo: Number(row.chapter_no),
      level: String(row.level),
      content: String(row.content),
      path: String(row.path),
    });
  }

  if (matchQuery) {
    const olderRows = rawDb
      .prepare(`
        SELECT idx.chapter_no AS chapter_no, idx.level AS level, idx.content AS content, idx.path AS path, bm25(summary_search) AS rank
        FROM summary_search
        JOIN summary_index idx ON idx.id = summary_search.summary_id
        WHERE summary_search.project_id = ? AND summary_search MATCH ? AND idx.chapter_no < ? AND idx.level = 'brief'
        ORDER BY rank ASC
        LIMIT 8
      `)
      .all(projectId, matchQuery, Math.max(1, currentChapter - 10)) as Array<Record<string, unknown>>;

    for (const row of olderRows) {
      results.push({
        chapterNo: Number(row.chapter_no),
        level: String(row.level),
        content: String(row.content),
        path: String(row.path),
      });
    }
  }

  const seen = new Set<string>();
  return results.filter((entry) => {
    const key = `${entry.chapterNo}:${entry.level}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function getChapterReviewState(projectId: string, chapterNo: number) {
  const row = rawDb
    .prepare("SELECT * FROM chapter_review_states WHERE project_id = ? AND chapter_no = ?")
    .get(projectId, chapterNo) as Record<string, unknown> | undefined;
  return row ? toChapterReviewState(row) : null;
}

export function listChapterReviewStates(projectId: string) {
  const rows = rawDb
    .prepare("SELECT * FROM chapter_review_states WHERE project_id = ? ORDER BY chapter_no ASC")
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map(toChapterReviewState);
}

export function upsertChapterReviewState(input: {
  projectId: string;
  chapterNo: number;
  status: ChapterReviewState["status"];
  quickCheckedAt?: string | null;
  deepCheckedAt?: string | null;
  openWindowId?: string | null;
  lastReviewMode?: ReviewMode | null;
  latestConfidence?: number;
  earliestAffectedChapter?: number | null;
}) {
  const now = nowIso();
  rawDb
    .prepare(`
      INSERT INTO chapter_review_states (
        id, project_id, chapter_no, status, quick_checked_at, deep_checked_at, open_window_id,
        last_review_mode, latest_confidence, earliest_affected_chapter, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, chapter_no) DO UPDATE SET
        status = excluded.status,
        quick_checked_at = COALESCE(excluded.quick_checked_at, chapter_review_states.quick_checked_at),
        deep_checked_at = COALESCE(excluded.deep_checked_at, chapter_review_states.deep_checked_at),
        open_window_id = COALESCE(excluded.open_window_id, chapter_review_states.open_window_id),
        last_review_mode = COALESCE(excluded.last_review_mode, chapter_review_states.last_review_mode),
        latest_confidence = excluded.latest_confidence,
        earliest_affected_chapter = excluded.earliest_affected_chapter,
        updated_at = excluded.updated_at
    `)
    .run(
      nanoid(),
      input.projectId,
      input.chapterNo,
      input.status,
      input.quickCheckedAt ?? null,
      input.deepCheckedAt ?? null,
      input.openWindowId ?? null,
      input.lastReviewMode ?? null,
      input.latestConfidence ?? 0,
      input.earliestAffectedChapter ?? null,
      now,
    );

  return getChapterReviewState(input.projectId, input.chapterNo);
}

export function lockChapterReviewWindow(projectId: string, startChapter: number, endChapter: number, openWindowId: string) {
  const now = nowIso();
  rawDb
    .prepare(`
      UPDATE chapter_review_states
      SET status = 'deep_locked',
          deep_checked_at = ?,
          open_window_id = ?,
          last_review_mode = 'deep',
          earliest_affected_chapter = NULL,
          updated_at = ?
      WHERE project_id = ? AND chapter_no BETWEEN ? AND ?
    `)
    .run(now, openWindowId, now, projectId, startChapter, endChapter);
}
