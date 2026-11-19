export const CHAPTER_SUBMISSION_STATUSES = [
  "draft",
  "queued",
  "reviewing",
  "needs_revision",
  "approved",
  "committed",
  "failed",
] as const;

export type ChapterSubmissionStatus = (typeof CHAPTER_SUBMISSION_STATUSES)[number];

export const CHAPTER_SUBMISSION_SOURCES = ["human", "codex", "import"] as const;

export type ChapterSubmissionSource = (typeof CHAPTER_SUBMISSION_SOURCES)[number];

export const CHAPTER_SUBMISSION_BATCH_STATUSES = [
  "preview",
  "importing",
  "completed",
  "partial_failed",
  "failed",
] as const;

export type ChapterSubmissionBatchStatus = (typeof CHAPTER_SUBMISSION_BATCH_STATUSES)[number];

export interface ChapterSubmissionRecord {
  id: string;
  batchId: string | null;
  projectId: string;
  chapterNo: number;
  title: string;
  source: ChapterSubmissionSource;
  contentPath: string;
  contentHash: string;
  status: ChapterSubmissionStatus;
  parentSubmissionId: string | null;
  committedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewChapterSubmission {
  batchId?: string | null;
  projectId: string;
  chapterNo: number;
  title: string;
  source: ChapterSubmissionSource;
  contentPath: string;
  contentHash: string;
  status?: "draft";
  parentSubmissionId?: string | null;
}

export interface CreateSubmissionRevisionInput {
  parentSubmissionId: string;
  title: string;
  source: ChapterSubmissionSource;
  contentPath: string;
  contentHash: string;
}

export interface SubmissionFilters {
  batchId?: string;
  chapterNo?: number;
  source?: ChapterSubmissionSource;
  status?: ChapterSubmissionStatus;
}

export interface ChapterSubmissionListItem extends ChapterSubmissionRecord {
  batchStatus: ChapterSubmissionBatchStatus | null;
  batchSourceFileName: string | null;
}

export interface ChapterSubmissionBatchRecord {
  id: string;
  projectId: string;
  sourceFileName: string;
  sourceFileHash: string;
  chapterCount: number;
  status: ChapterSubmissionBatchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface NewSubmissionBatch {
  projectId: string;
  sourceFileName: string;
  sourceFileHash: string;
  chapterCount: number;
  status?: ChapterSubmissionBatchStatus;
}
