import "../server-only.ts";

import { nanoid } from "nanoid";
import { rawDb } from "../db/client.ts";
import { nowIso } from "../utils.ts";
import { type ChapterInvalidationRecord, type ChapterVersionRecord } from "./shared.ts";

export function saveChapterVersion(input: Omit<ChapterVersionRecord, "id" | "createdAt">) {
  const id = nanoid();
  const now = nowIso();
  rawDb
    .prepare(`
      INSERT INTO chapter_versions (
        id, project_id, chapter_no, version_no, temperature, path, excerpt, selected, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      input.projectId,
      input.chapterNo,
      input.versionNo,
      input.temperature,
      input.path,
      input.excerpt,
      input.selected ? 1 : 0,
      input.source,
      now,
    );
  return id;
}

export function listChapterVersions(projectId: string, chapterNo: number): ChapterVersionRecord[] {
  const rows = rawDb
    .prepare(`
      SELECT * FROM chapter_versions
      WHERE project_id = ? AND chapter_no = ?
      ORDER BY version_no DESC, created_at DESC
    `)
    .all(projectId, chapterNo) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    versionNo: Number(row.version_no),
    temperature: Number(row.temperature),
    path: String(row.path),
    excerpt: String(row.excerpt),
    selected: Boolean(row.selected),
    source: String(row.source),
    createdAt: String(row.created_at),
  }));
}

export function getChapterVersion(versionId: string) {
  const row = rawDb
    .prepare("SELECT * FROM chapter_versions WHERE id = ?")
    .get(versionId) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    versionNo: Number(row.version_no),
    temperature: Number(row.temperature),
    path: String(row.path),
    excerpt: String(row.excerpt),
    selected: Boolean(row.selected),
    source: String(row.source),
    createdAt: String(row.created_at),
  } satisfies ChapterVersionRecord;
}

export function getNextVersionNo(projectId: string, chapterNo: number) {
  const row = rawDb
    .prepare("SELECT MAX(version_no) AS max_no FROM chapter_versions WHERE project_id = ? AND chapter_no = ?")
    .get(projectId, chapterNo) as Record<string, unknown> | undefined;
  return Number(row?.max_no ?? 0) + 1;
}

export function markVersionSelected(projectId: string, chapterNo: number, versionId: string) {
  rawDb.transaction(() => {
    rawDb
      .prepare("UPDATE chapter_versions SET selected = 0 WHERE project_id = ? AND chapter_no = ?")
      .run(projectId, chapterNo);
    rawDb
      .prepare("UPDATE chapter_versions SET selected = 1 WHERE id = ?")
      .run(versionId);
  })();
}

export function appendChapterInvalidations(
  rows: Array<Omit<ChapterInvalidationRecord, "id">>,
) {
  if (!rows.length) {
    return;
  }
  const insert = rawDb.prepare(`
    INSERT INTO chapter_invalidations (
      id, project_id, chapter_no, range_start_chapter, range_end_chapter, reason, archived_path, excerpt, review_reason, operation_key, invalidated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(operation_key, chapter_no) DO NOTHING
  `);

  rawDb.transaction(() => {
    for (const row of rows) {
      insert.run(
        nanoid(),
        row.projectId,
        row.chapterNo,
        row.rangeStartChapter,
        row.rangeEndChapter,
        row.reason,
        row.archivedPath,
        row.excerpt,
        row.reviewReason,
        row.operationKey,
        row.invalidatedAt,
      );
    }
  })();
}

export function listChapterInvalidations(projectId: string, chapterNo?: number): ChapterInvalidationRecord[] {
  const rows = chapterNo
    ? rawDb
      .prepare(`
        SELECT * FROM chapter_invalidations
        WHERE project_id = ? AND chapter_no = ?
        ORDER BY invalidated_at DESC
      `)
      .all(projectId, chapterNo)
    : rawDb
      .prepare(`
        SELECT * FROM chapter_invalidations
        WHERE project_id = ?
        ORDER BY invalidated_at DESC, chapter_no DESC
      `)
      .all(projectId);

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    rangeStartChapter: Number(row.range_start_chapter),
    rangeEndChapter: Number(row.range_end_chapter),
    reason: String(row.reason),
    archivedPath: String(row.archived_path),
    excerpt: String(row.excerpt),
    reviewReason: row.review_reason ? String(row.review_reason) : null,
    operationKey: row.operation_key ? String(row.operation_key) : null,
    invalidatedAt: String(row.invalidated_at),
  }));
}

export function deleteChapterRangeRecords(
  projectId: string,
  startChapter: number,
  endChapter: number,
  options?: { preserveInvalidations?: boolean },
) {
  const statements = [
    "DELETE FROM blueprints WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM review_reports WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM style_delta_notes WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM context_packs WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM conflicts WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM canon_fact_index WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM canon_fact_search WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM summary_index WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM summary_search WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM run_statistics WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM timeline_mutation_effects WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM chapter_versions WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM chapter_delta_records WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    // 软失效流程必须保留 chapter_invalidations：它是 auto window repair 的循环计数依据。
    ...(options?.preserveInvalidations
      ? []
      : ["DELETE FROM chapter_invalidations WHERE project_id = ? AND chapter_no BETWEEN ? AND ?"]),
    "DELETE FROM card_progressions WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM chapter_review_states WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM chapter_plans WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM hook_plans WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
    "DELETE FROM artifact_outbox WHERE project_id = ? AND chapter_no BETWEEN ? AND ?",
  ].map((sql) => rawDb.prepare(sql));

  // 被删除章节的 commit 标记为 failed，防止 reconciler 用残留 stage 复活已删除的章节正文，
  // 也防止 committed 无 job 的 commit 被重新入队 sync。
  const failCommits = rawDb.prepare(`
    UPDATE chapter_commits
    SET state = 'failed',
        failed_at = ?,
        last_error_code = 'chapter_deleted',
        last_error_message = '章节区间已删除，commit 不再生效',
        updated_at = ?
    WHERE project_id = ? AND chapter_no BETWEEN ? AND ?
      AND state != 'failed'
  `);

  rawDb.transaction(() => {
    for (const statement of statements) {
      statement.run(projectId, startChapter, endChapter);
    }
    const now = nowIso();
    failCommits.run(now, now, projectId, startChapter, endChapter);
  })();
}
