export type AuthorSubmissionStatus = "draft" | "queued" | "reviewing" | "needs_revision" | "approved" | "committed" | "failed";
export interface AuthorSubmissionListItem {
  id: string;
  batchId: string | null;
  projectId: string;
  chapterNo: number;
  title: string;
  source: "human" | "codex" | "import";
  contentPath: string;
  contentHash: string;
  status: AuthorSubmissionStatus;
  parentSubmissionId: string | null;
  committedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AuthorSubmissionFilters {
  chapterNo?: number;
  status?: AuthorSubmissionStatus;
  source?: AuthorSubmissionListItem["source"];
}
