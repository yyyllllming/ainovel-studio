import type { FoundationWorkshopDraft } from "./story.ts";
import type {
  StyleConfidence,
  StyleExcerpt,
  StyleProfile,
} from "./style.ts";
import type { StyleFingerprint } from "../style-fingerprint.ts";

export interface IdeaRecord {
  id: string;
  title: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaWorkshopMessage {
  id: string;
  ideaId: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
}

export interface IdeaWorkshopStateRecord {
  ideaId: string;
  draft: FoundationWorkshopDraft;
  updatedAt: string;
}

export interface AuthorCardSourceWork {
  title: string;
  author: string;
  projectId?: string | null;
  snapshotId?: string | null;
  bookCardId?: string | null;
  importId?: string | null;
}

export interface AuthorCardRecord {
  id: string;
  displayName: string;
  normalizedName: string;
  archivedAt: string | null;
  latestVersion: number | null;
  versionCount: number;
  latestConfidence: StyleConfidence | null;
  latestCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorCardVersionRecord {
  id: string;
  authorCardId: string;
  version: number;
  styleCard: string;
  styleProfile: StyleProfile;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  sampledExcerpts: StyleExcerpt[];
  confidence: StyleConfidence;
  sourceWorks: AuthorCardSourceWork[];
  createdAt: string;
}

export interface AuthorBookCardRecord {
  id: string;
  authorCardId: string;
  title: string;
  authorName?: string;
  styleCard: string;
  styleProfile: StyleProfile;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  sampledExcerpts: StyleExcerpt[];
  confidence: StyleConfidence;
  fingerprint?: StyleFingerprint | null;
  wordCount: number;
  chapterCount: number;
  sourceFileName?: string;
  createdAt: string;
}

export interface AuthorBookImportWarning {
  code: string;
  message: string;
  level: "info" | "warning";
}

export interface AuthorBookImportSamplePlan {
  indexes: number[];
  skippedShort: number[];
  total: number;
}

export interface AuthorBookImportChapterPreview {
  chapterNumber: number;
  title: string;
  summary: string;
  wordCount: number;
}

export interface AuthorBookImportPreviewRecord {
  id: string;
  authorCardId: string;
  title: string;
  authorName?: string;
  originalFileName: string;
  mediaType: string;
  sourceHash: string;
  wordCount: number;
  encoding: string;
  parseConfidence: StyleConfidence;
  parserMode: "heading_strict" | "heading_relaxed" | "marker" | "window_fallback";
  chapterCount: number;
  warnings: AuthorBookImportWarning[];
  samplePlan: AuthorBookImportSamplePlan;
  status: "active" | "consumed" | "expired";
  applyStatus: "pending" | "imported" | "completed";
  importId?: string | null;
  bookCardId?: string | null;
  lastError?: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string | null;
}

export interface AuthorTextImportRecord {
  id: string;
  authorCardId: string;
  title: string;
  authorName?: string;
  originalFileName: string;
  mediaType: string;
  sourceHash: string;
  wordCount: number;
  encoding: string;
  confidence: StyleConfidence;
  chapterCount: number;
  excerpts: StyleExcerpt[];
  sourceKind: "plain_import" | "book_import";
  bookCardStatus: "idle" | "pending" | "failed" | "completed";
  lastGenerationError?: string | null;
  createdAt: string;
}

export interface IdeaProjectSeedSnapshot {
  draft: FoundationWorkshopDraft;
  messages: Array<Pick<IdeaWorkshopMessage, "role" | "content" | "createdAt">>;
}
