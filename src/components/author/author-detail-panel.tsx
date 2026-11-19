"use client";

import type { AuthorBookImportPreview, AuthorCardDetail } from "@/lib/types";
import { AuthorBookCardList } from "./author-book-card-list";
import { AuthorImportSection } from "./author-import-section";
import { AuthorMergedStyle } from "./author-merged-style";
import { formatConfidence, formatDateTime } from "./author-utils";

export function AuthorDetailPanel({
  detail,
  selectedImportIds,
  uploadPending,
  bookImportPreviewPending,
  bookImportApplyPending,
  generatePending,
  mergePending,
  deletingImportId,
  onToggleImport,
  onUpload,
  onCreateBookImportPreview,
  onApplyBookImportPreview,
  onDeleteImport,
  onGenerateSelected,
  onMerge,
}: {
  detail: AuthorCardDetail | null;
  selectedImportIds: string[];
  uploadPending: boolean;
  bookImportPreviewPending: boolean;
  bookImportApplyPending: boolean;
  generatePending: boolean;
  mergePending: boolean;
  deletingImportId: string | null;
  onToggleImport: (importId: string) => void;
  onUpload: (input: { file: File; title?: string; author?: string }) => Promise<void>;
  onCreateBookImportPreview: (input: {
    file: File;
    title?: string;
    author?: string;
    encoding?: string;
  }) => Promise<{ preview?: AuthorBookImportPreview; needsEncodingChoice?: boolean; encodingCandidates?: string[] }>;
  onApplyBookImportPreview: (previewId: string) => Promise<void>;
  onDeleteImport: (importId: string) => Promise<void>;
  onGenerateSelected: () => Promise<void>;
  onMerge: () => void;
}) {
  if (!detail) {
    return (
      <section className="workspace-panel p-6">
        <p className="text-sm text-[var(--ink-soft)]">先从左侧选择一个作者，或者新建一个作者卡。</p>
      </section>
    );
  }

  const latestVersion = detail.versions[0] ?? null;
  const updatedAt = detail.card.updatedAt ?? latestVersion?.createdAt ?? new Date().toISOString();

  return (
    <section className="workspace-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-title">Author Card</p>
          <h2 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">{detail.card.displayName}</h2>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            {detail.card.versionCount} 个 author 版本 · 最新置信度 {formatConfidence(detail.card.latestConfidence)} · 最近更新 {formatDateTime(updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
          <span className="workspace-pill px-3 py-1.5">导入 {detail.imports.length}</span>
          <span className="workspace-pill px-3 py-1.5">书卡 {detail.bookCards.length}</span>
          <span className="workspace-pill px-3 py-1.5">版本 {detail.versions.length}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        <AuthorMergedStyle
          latestVersion={latestVersion}
          authorProfile={detail.authorProfile}
          canMerge={detail.bookCards.length >= 2}
          mergePending={mergePending}
          onMerge={onMerge}
        />
        <AuthorImportSection
          imports={detail.imports}
          selectedImportIds={selectedImportIds}
          uploadPending={uploadPending}
          bookImportPreviewPending={bookImportPreviewPending}
          bookImportApplyPending={bookImportApplyPending}
          generatePending={generatePending}
          deletingImportId={deletingImportId}
          onToggleImport={onToggleImport}
          onUpload={onUpload}
          onCreateBookImportPreview={onCreateBookImportPreview}
          onApplyBookImportPreview={onApplyBookImportPreview}
          onDeleteImport={onDeleteImport}
          onGenerateSelected={onGenerateSelected}
        />
        <AuthorBookCardList bookCards={detail.bookCards} />
      </div>
    </section>
  );
}
