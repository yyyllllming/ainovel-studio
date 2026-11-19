import "../server-only.ts";

import Database from "better-sqlite3";
import { nanoid } from "nanoid";

import { rawDb } from "../db/client.ts";
import { conflict } from "../errors.ts";
import type {
  ChapterSubmissionBatchRecord,
  ChapterSubmissionBatchStatus,
  ChapterSubmissionListItem,
  ChapterSubmissionRecord,
  ChapterSubmissionStatus,
  CreateSubmissionRevisionInput,
  NewChapterSubmission,
  NewSubmissionBatch,
  SubmissionFilters,
} from "../types.ts";
import { nowIso } from "../utils.ts";

const ALLOWED_TRANSITIONS = {
  draft: ["queued", "failed"],
  queued: ["reviewing", "failed"],
  reviewing: ["needs_revision", "approved", "failed"],
  needs_revision: ["queued", "failed"],
  approved: ["committed", "failed"],
  committed: [],
  failed: ["queued"],
} as const satisfies Record<ChapterSubmissionStatus, readonly ChapterSubmissionStatus[]>;

function canTransition(current: ChapterSubmissionStatus, next: ChapterSubmissionStatus) {
  return (ALLOWED_TRANSITIONS[current] as readonly ChapterSubmissionStatus[]).includes(next);
}

function isSqliteBusy(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "SQLITE_BUSY";
}

function mapSubmission(row: Record<string, unknown>): ChapterSubmissionRecord {
  return {
    id: String(row.id),
    batchId: row.batch_id == null ? null : String(row.batch_id),
    projectId: String(row.project_id),
    chapterNo: Number(row.chapter_no),
    title: String(row.title),
    source: String(row.source) as ChapterSubmissionRecord["source"],
    contentPath: String(row.content_path),
    contentHash: String(row.content_hash),
    status: String(row.status) as ChapterSubmissionStatus,
    parentSubmissionId: row.parent_submission_id == null ? null : String(row.parent_submission_id),
    committedVersionId: row.committed_version_id == null ? null : String(row.committed_version_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapBatch(row: Record<string, unknown>): ChapterSubmissionBatchRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sourceFileName: String(row.source_file_name),
    sourceFileHash: String(row.source_file_hash),
    chapterCount: Number(row.chapter_count),
    status: String(row.status) as ChapterSubmissionBatchStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createChapterSubmissionRepository(input?: { db?: Database.Database }) {
  const db = input?.db ?? rawDb;

  const getById = (id: string): ChapterSubmissionRecord | null => {
    const row = db.prepare("SELECT * FROM chapter_submissions WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapSubmission(row) : null;
  };

  const getBatchById = (id: string): ChapterSubmissionBatchRecord | null => {
    const row = db.prepare("SELECT * FROM chapter_submission_batches WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapBatch(row) : null;
  };

  const assertSubmissionReferences = (record: NewChapterSubmission) => {
    if (record.batchId) {
      const batch = getBatchById(record.batchId);
      if (!batch || batch.projectId !== record.projectId) {
        throw conflict("作者稿批次归属无效");
      }
    }
    if (record.parentSubmissionId) {
      const parent = getById(record.parentSubmissionId);
      if (
        !parent
        || parent.projectId !== record.projectId
        || parent.chapterNo !== record.chapterNo
      ) {
        throw conflict("作者稿修订归属无效");
      }
    }
  };

  const assertCompatibleSubmissionReplay = (
    existing: ChapterSubmissionRecord,
    record: NewChapterSubmission,
  ) => {
    if (
      existing.batchId !== (record.batchId ?? null)
      || existing.title !== record.title
      || existing.source !== record.source
      || existing.contentPath !== record.contentPath
      || existing.parentSubmissionId !== (record.parentSubmissionId ?? null)
    ) {
      throw conflict("作者稿内容身份已变化");
    }
  };

  const createOrGet = (record: NewChapterSubmission): ChapterSubmissionRecord => {
    if (record.status !== undefined && record.status !== "draft") {
      throw conflict("作者稿初始状态无效");
    }
    assertSubmissionReferences(record);

    const id = nanoid();
    const now = nowIso();
    db.prepare(`
      INSERT INTO chapter_submissions (
        id, batch_id, project_id, chapter_no, title, source, content_path, content_hash,
        status, parent_submission_id, committed_version_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, ?, ?)
      ON CONFLICT(project_id, chapter_no, content_hash) DO NOTHING
    `).run(
      id,
      record.batchId ?? null,
      record.projectId,
      record.chapterNo,
      record.title,
      record.source,
      record.contentPath,
      record.contentHash,
      record.parentSubmissionId ?? null,
      now,
      now,
    );

    const row = db.prepare(`
      SELECT * FROM chapter_submissions
      WHERE project_id = ? AND chapter_no = ? AND content_hash = ?
    `).get(record.projectId, record.chapterNo, record.contentHash) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`作者稿保存失败：${record.projectId}#${record.chapterNo}`);
    }
    const saved = mapSubmission(row);
    assertCompatibleSubmissionReplay(saved, record);
    return saved;
  };

  return {
    createOrGet,

    getById,

    listByProject(projectId: string, filters: SubmissionFilters = {}): ChapterSubmissionListItem[] {
      const clauses = ["s.project_id = ?"];
      const params: Array<string | number> = [projectId];
      if (filters.batchId !== undefined) {
        clauses.push("s.batch_id = ?");
        params.push(filters.batchId);
      }
      if (filters.chapterNo !== undefined) {
        clauses.push("s.chapter_no = ?");
        params.push(filters.chapterNo);
      }
      if (filters.source !== undefined) {
        clauses.push("s.source = ?");
        params.push(filters.source);
      }
      if (filters.status !== undefined) {
        clauses.push("s.status = ?");
        params.push(filters.status);
      }

      const rows = db.prepare(`
        SELECT
          s.*,
          b.status AS batch_status,
          b.source_file_name AS batch_source_file_name
        FROM chapter_submissions s
        LEFT JOIN chapter_submission_batches b
          ON b.id = s.batch_id
         AND b.project_id = s.project_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY s.chapter_no ASC, s.created_at ASC, s.id ASC
      `).all(...params) as Array<Record<string, unknown>>;

      return rows.map((row) => ({
        ...mapSubmission(row),
        batchStatus: row.batch_status == null ? null : String(row.batch_status) as ChapterSubmissionBatchStatus,
        batchSourceFileName: row.batch_source_file_name == null ? null : String(row.batch_source_file_name),
      }));
    },

    transition(id: string, next: ChapterSubmissionStatus): ChapterSubmissionRecord {
      const current = getById(id);
      // The approved -> committed edge must carry a real version ID, so only
      // attachCommittedVersion may perform it.
      if (!current || next === "committed" || !canTransition(current.status, next)) {
        throw conflict("作者稿状态已变化");
      }

      const result = db.prepare(`
        UPDATE chapter_submissions
        SET status = ?, updated_at = ?
        WHERE id = ? AND status = ?
      `).run(next, nowIso(), id, current.status);
      if (result.changes === 0) {
        throw conflict("作者稿状态已变化");
      }
      return getById(id)!;
    },

    approveWithOverride(id: string): ChapterSubmissionRecord {
      const current = getById(id);
      if (!current || current.status === "committed") {
        throw conflict("作者稿状态已变化");
      }
      db.prepare(`
        UPDATE chapter_submissions
        SET status = 'approved', updated_at = ?
        WHERE id = ? AND status != 'committed'
      `).run(nowIso(), id);
      return getById(id)!;
    },

    createRevision(input: CreateSubmissionRevisionInput): ChapterSubmissionRecord {
      const parent = getById(input.parentSubmissionId);
      if (!parent) {
        throw conflict("作者稿状态已变化");
      }
      if (parent.contentHash === input.contentHash) {
        throw conflict("作者稿修订内容未变化");
      }
      const revision = createOrGet({
        batchId: parent.batchId,
        projectId: parent.projectId,
        chapterNo: parent.chapterNo,
        title: input.title,
        source: input.source,
        contentPath: input.contentPath,
        contentHash: input.contentHash,
        parentSubmissionId: parent.id,
      });
      if (revision.parentSubmissionId !== parent.id) {
        throw conflict("作者稿修订归属已变化");
      }
      return revision;
    },

    attachCommittedVersion(id: string, versionId: string): ChapterSubmissionRecord {
      const attach = db.transaction(() => {
        const current = getById(id);
        const version = db.prepare(`
          SELECT project_id, chapter_no
          FROM chapter_versions
          WHERE id = ?
        `).get(versionId) as Record<string, unknown> | undefined;
        if (
          !current
          || !version
          || String(version.project_id) !== current.projectId
          || Number(version.chapter_no) !== current.chapterNo
        ) {
          throw conflict("作者稿版本归属无效");
        }
        if (current.status === "committed" && current.committedVersionId === versionId) {
          return current;
        }

        const result = db.prepare(`
          UPDATE chapter_submissions
          SET status = 'committed', committed_version_id = ?, updated_at = ?
          WHERE id = ? AND status = 'approved'
        `).run(versionId, nowIso(), id);
        if (result.changes === 0) {
          throw conflict("作者稿状态已变化");
        }
        return getById(id)!;
      });
      try {
        return attach.immediate();
      } catch (error) {
        if (isSqliteBusy(error)) {
          throw conflict("作者稿状态已变化");
        }
        throw error;
      }
    },

    createOrGetBatch(input: NewSubmissionBatch): ChapterSubmissionBatchRecord {
      const id = nanoid();
      const now = nowIso();
      db.prepare(`
        INSERT INTO chapter_submission_batches (
          id, project_id, source_file_name, source_file_hash, chapter_count, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, source_file_hash) DO NOTHING
      `).run(
        id,
        input.projectId,
        input.sourceFileName,
        input.sourceFileHash,
        input.chapterCount,
        input.status ?? "preview",
        now,
        now,
      );

      const row = db.prepare(`
        SELECT * FROM chapter_submission_batches
        WHERE project_id = ? AND source_file_hash = ?
      `).get(input.projectId, input.sourceFileHash) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error(`作者稿批次保存失败：${input.projectId}`);
      }
      const saved = mapBatch(row);
      if (saved.chapterCount !== input.chapterCount) {
        throw conflict("作者稿批次内容身份已变化");
      }
      return saved;
    },

    setBatchStatus(id: string, status: ChapterSubmissionBatchStatus): ChapterSubmissionBatchRecord {
      const result = db.prepare(`
        UPDATE chapter_submission_batches
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(status, nowIso(), id);
      if (result.changes === 0) {
        throw conflict("作者稿批次状态已变化");
      }
      return getBatchById(id)!;
    },
  };
}
