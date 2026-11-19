"use client";

import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import type { AuthorBookImportPreview, AuthorTextImportDetail } from "@/lib/types";
import { formatConfidence, formatCount, formatDateTime } from "./author-utils";

function isSupportedImportFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".txt") || name.endsWith(".md");
}

function isSupportedBookImportFile(file: File) {
  return file.name.toLowerCase().endsWith(".txt");
}

export function AuthorImportSection({
  imports,
  selectedImportIds,
  uploadPending,
  bookImportPreviewPending,
  bookImportApplyPending,
  generatePending,
  deletingImportId,
  onToggleImport,
  onUpload,
  onCreateBookImportPreview,
  onApplyBookImportPreview,
  onDeleteImport,
  onGenerateSelected,
}: {
  imports: AuthorTextImportDetail[];
  selectedImportIds: string[];
  uploadPending: boolean;
  bookImportPreviewPending: boolean;
  bookImportApplyPending: boolean;
  generatePending: boolean;
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
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [bookImportFile, setBookImportFile] = useState<File | null>(null);
  const [bookImportTitle, setBookImportTitle] = useState("");
  const [bookImportAuthor, setBookImportAuthor] = useState("");
  const [bookImportError, setBookImportError] = useState<string | null>(null);
  const [bookImportPreview, setBookImportPreview] = useState<AuthorBookImportPreview | null>(null);
  const [bookImportEncoding, setBookImportEncoding] = useState("");
  const [bookImportEncodingCandidates, setBookImportEncodingCandidates] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const bookImportInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  function resetFilePicker() {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function resetBookImportPicker() {
    if (bookImportInputRef.current) {
      bookImportInputRef.current.value = "";
    }
  }

  function selectFile(nextFile: File | null) {
    if (!nextFile) {
      setFile(null);
      setSelectionError(null);
      resetFilePicker();
      return;
    }

    if (!isSupportedImportFile(nextFile)) {
      setSelectionError("当前仅支持 .txt / .md 文件。");
      setFile(null);
      resetFilePicker();
      return;
    }

    setFile(nextFile);
    setSelectionError(null);
  }

  function selectBookImportFile(nextFile: File | null) {
    if (!nextFile) {
      setBookImportFile(null);
      setBookImportError(null);
      setBookImportPreview(null);
      setBookImportEncodingCandidates([]);
      setBookImportEncoding("");
      resetBookImportPicker();
      return;
    }

    if (!isSupportedBookImportFile(nextFile)) {
      setBookImportError("拆书导入当前仅支持 .txt 文件。");
      setBookImportFile(null);
      setBookImportPreview(null);
      setBookImportEncodingCandidates([]);
      setBookImportEncoding("");
      resetBookImportPicker();
      return;
    }

    setBookImportFile(nextFile);
    setBookImportError(null);
    setBookImportPreview(null);
    setBookImportEncodingCandidates([]);
    setBookImportEncoding("");
  }

  function openFilePicker() {
    inputRef.current?.click();
  }

  function openBookImportPicker() {
    bookImportInputRef.current?.click();
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0] ?? null);
  }

  function handleBookImportInputChange(event: ChangeEvent<HTMLInputElement>) {
    selectBookImportFile(event.target.files?.[0] ?? null);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openFilePicker();
  }

  async function handleUpload() {
    if (!file) {
      return;
    }

    try {
      await onUpload({
        file,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
      });
    } catch {
      // 失败已由上层 mutation onError toast 提示，保留已选文件便于重试。
      return;
    }
    setFile(null);
    setTitle("");
    setAuthor("");
    setSelectionError(null);
    resetFilePicker();
  }

  async function handleCreateBookImportPreview() {
    if (!bookImportFile) {
      return;
    }

    let result: Awaited<ReturnType<typeof onCreateBookImportPreview>>;
    try {
      result = await onCreateBookImportPreview({
        file: bookImportFile,
        title: bookImportTitle.trim() || undefined,
        author: bookImportAuthor.trim() || undefined,
        encoding: bookImportEncoding.trim() || undefined,
      });
    } catch {
      // 失败已由上层 mutation onError toast 提示。
      return;
    }

    if (result.needsEncodingChoice) {
      setBookImportPreview(null);
      setBookImportEncodingCandidates(result.encodingCandidates ?? []);
      setBookImportEncoding((result.encodingCandidates ?? [])[0] ?? "");
      setBookImportError("编码判断不够稳定，请先手动选择编码再重新解析。");
      return;
    }

    if (result.preview) {
      setBookImportPreview(result.preview);
      setBookImportEncodingCandidates([]);
      setBookImportEncoding("");
      setBookImportError(null);
    }
  }

  async function handleApplyBookImportPreview() {
    if (!bookImportPreview) {
      return;
    }

    try {
      await onApplyBookImportPreview(bookImportPreview.previewId);
    } catch {
      // 失败已由上层 mutation onError toast 提示，保留预览便于重试。
      return;
    }
    setBookImportPreview(null);
    setBookImportEncodingCandidates([]);
    setBookImportEncoding("");
    setBookImportError(null);
    setBookImportFile(null);
    setBookImportTitle("");
    setBookImportAuthor("");
    resetBookImportPicker();
  }

  return (
    <div className="workspace-item active p-4">
      <div>
        <p className="section-title">Text Imports</p>
        <h3 className="mt-2 text-lg font-semibold text-[var(--ink)]">导入文本 · 分析</h3>
        <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
          在这里统一导入 TXT / MD，并从选中的文本直接生成书级风格卡。项目页不再承担这一步。
        </p>
      </div>

      <div className="mt-4 grid gap-3 rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-label="选择 TXT / MD 文件"
          accept=".txt,.md,text/plain,text/markdown"
          onChange={handleInputChange}
        />
        <div
          role="button"
          tabIndex={0}
          aria-label="点击选择 TXT / MD，或直接拖拽到这里"
          className={`rounded-3xl border px-4 py-5 text-left transition ${
            dragActive
              ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
              : "border-[var(--line)] bg-[var(--panel-soft)] hover:border-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
          }`}
          onClick={openFilePicker}
          onKeyDown={handleDropzoneKeyDown}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p className="text-sm font-medium text-[var(--ink)]">
            {dragActive ? "松开鼠标即可选择这个文件" : "点击选择 TXT / MD，或直接拖拽到这里"}
          </p>
          <p className="mt-2 text-xs leading-6 text-[var(--ink-soft)]">
            {file ? `已选择：${file.name}` : "未选择文件"}
          </p>
          <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">拖拽只会选中文件，仍需点击“导入文本”后才会上传。</p>
        </div>
        {selectionError ? (
          <p className="text-sm text-[var(--danger)]">{selectionError}</p>
        ) : null}
        <input
          className="form-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="书名（可选，不填则用文件名）"
        />
        <input
          className="form-input"
          value={author}
          onChange={(event) => setAuthor(event.target.value)}
          placeholder="作者名（可选，默认沿用当前作者卡名称）"
        />
        <button
          type="button"
          className="btn-primary w-fit px-4 py-2 text-sm"
          disabled={!file || uploadPending}
          onClick={handleUpload}
        >
          {uploadPending ? "导入中…" : "导入文本"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">拆书导入</p>
          <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">
            上传 TXT 后先做章节预览，再确认导入并自动生成书级风格卡。首版只支持强规则拆章和 fallback 切章。
          </p>
        </div>
        <input
          ref={bookImportInputRef}
          type="file"
          className="sr-only"
          aria-label="选择 TXT 文件进行拆书导入"
          accept=".txt,text/plain"
          onChange={handleBookImportInputChange}
        />
        <button
          type="button"
          className="btn-ghost w-fit px-4 py-2 text-sm"
          onClick={openBookImportPicker}
        >
          {bookImportFile ? `已选择：${bookImportFile.name}` : "选择 TXT 文件"}
        </button>
        <input
          className="form-input"
          value={bookImportTitle}
          onChange={(event) => setBookImportTitle(event.target.value)}
          placeholder="书名（可选，不填则用文件名）"
        />
        <input
          className="form-input"
          value={bookImportAuthor}
          onChange={(event) => setBookImportAuthor(event.target.value)}
          placeholder="作者名（可选，默认沿用当前作者卡名称）"
        />
        {bookImportEncodingCandidates.length ? (
          <select
            className="form-input"
            value={bookImportEncoding}
            onChange={(event) => setBookImportEncoding(event.target.value)}
          >
            {bookImportEncodingCandidates.map((encoding) => (
              <option key={encoding} value={encoding}>{encoding}</option>
            ))}
          </select>
        ) : null}
        {bookImportError ? (
          <p className="text-sm text-[var(--danger)]">{bookImportError}</p>
        ) : null}
        <button
          type="button"
          className="btn-primary w-fit px-4 py-2 text-sm"
          disabled={!bookImportFile || bookImportPreviewPending}
          onClick={() => void handleCreateBookImportPreview()}
        >
          {bookImportPreviewPending ? "预览生成中…" : "拆章预览"}
        </button>
        {bookImportPreview ? (
          <div className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
            <div>
              <p className="font-semibold text-[var(--ink)]">{bookImportPreview.title}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                {bookImportPreview.chapterCount} 章 · 编码 {bookImportPreview.encoding} · 解析 {bookImportPreview.parserMode} · 置信度 {formatConfidence(bookImportPreview.parseConfidence)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                采样章节索引：{bookImportPreview.samplePlan.indexes.map((index) => index + 1).join("、")}
              </p>
            </div>
            {bookImportPreview.warnings.length ? (
              <div className="grid gap-1">
                {bookImportPreview.warnings.slice(0, 4).map((warning, index) => (
                  <p key={`${warning.code}-${index}`} className="text-xs text-[var(--ink-soft)]">
                    [{warning.level}] {warning.message}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="grid gap-2 md:grid-cols-2">
              {bookImportPreview.chapters.slice(0, 6).map((chapter) => (
                <div key={`${chapter.chapterNumber}-${chapter.title}`} className="rounded-2xl border border-[var(--line)] px-3 py-2">
                  <p className="text-sm font-medium text-[var(--ink)]">
                    第{chapter.chapterNumber}章 · {chapter.title}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">{formatCount(chapter.wordCount)} 字</p>
                  <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">{chapter.summary}</p>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-secondary w-fit px-4 py-2 text-sm"
              disabled={bookImportApplyPending}
              onClick={() => void handleApplyBookImportPreview()}
            >
              {bookImportApplyPending ? "导入中…" : "确认导入并生成书卡"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3">
        {imports.length ? imports.map((entry) => {
          const selected = selectedImportIds.includes(entry.id);
          return (
            <label
              key={entry.id}
              className="grid gap-3 rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={selected}
                    onChange={() => onToggleImport(entry.id)}
                  />
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{entry.title}</p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {formatCount(entry.wordCount)} 字 · {entry.chapterCount} 章 · 置信度 {formatConfidence(entry.confidence)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {entry.originalFileName} · {formatDateTime(entry.createdAt)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {entry.sourceKind === "book_import" ? "拆书导入" : "普通导入"} · 书卡状态 {entry.bookCardStatus}
                      {entry.lastGenerationError ? ` · ${entry.lastGenerationError}` : ""}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost px-3 py-2 text-xs"
                  disabled={deletingImportId === entry.id}
                  onClick={() => void onDeleteImport(entry.id).catch(() => undefined)}
                >
                  {deletingImportId === entry.id ? "删除中…" : "删除"}
                </button>
              </div>
            </label>
          );
        }) : (
          <p className="text-sm text-[var(--ink-soft)]">还没有导入文本。</p>
        )}
      </div>

      <button
        type="button"
        className="btn-secondary mt-4 w-full justify-center"
        disabled={!selectedImportIds.length || generatePending}
        onClick={() => void onGenerateSelected().catch(() => undefined)}
      >
        {generatePending ? "生成中…" : `选中 ${selectedImportIds.length} 份文本 → 生成书级风格卡`}
      </button>
    </div>
  );
}
