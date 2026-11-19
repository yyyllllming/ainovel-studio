"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BookOpenText, Copy, Download, FileText, Text } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { useToast } from "./toast.tsx";

type ManuscriptPreviewFormat = "txt" | "md";
type DisplayMode = "reader" | ManuscriptPreviewFormat;

interface ManuscriptPreviewPayload {
  title: string;
  format: ManuscriptPreviewFormat;
  generatedAt: string;
  chapterCount: number;
  chapterNos: number[];
  missingChapterNos: number[];
  suggestedFileName: string;
  content: string;
  sections: Array<{
    chapterNo: number;
    heading: string;
    paragraphs: string[];
  }>;
}

interface ChapterSectionProps {
  chapterNo: number;
  heading: string;
  paragraphs: string[];
  pureReaderMode: boolean;
}

const ChapterSection = memo(function ChapterSection({
  chapterNo,
  heading,
  paragraphs,
  pureReaderMode,
}: ChapterSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  // 长篇全量挂载会一次性产生数万个段落节点：先渲染占位，滚动到视口附近再挂载正文。
  // 无 IntersectionObserver 的环境（SSR/旧浏览器）直接挂载正文。
  const [contentVisible, setContentVisible] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (contentVisible) {
      return;
    }
    const node = sectionRef.current;
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setContentVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "1600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [contentVisible]);

  // 占位高度按字数粗估，真实段落挂载后由实际布局接管。
  const estimatedHeight = useMemo(() => {
    const totalChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
    const lines = Math.max(paragraphs.length, Math.ceil(totalChars / 36));
    return lines * 46 + paragraphs.length * 24;
  }, [paragraphs]);

  const paragraphClass = pureReaderMode
    ? "text-[20px] leading-[2.28] md:text-[22px]"
    : "text-[18px] leading-[2.15] md:text-[20px]";
  return (
    <section
      ref={sectionRef}
      id={`chapter-${chapterNo}`}
      data-chapter-no={chapterNo}
      className="scroll-mt-28"
    >
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--reading-ink-soft)]">
          第 {String(chapterNo).padStart(3, "0")} 章
        </p>
        <h3 className="mt-3 text-3xl font-semibold [font-family:var(--font-serif)] text-[var(--reading-ink)] md:text-4xl">
          {heading}
        </h3>
      </div>
      {contentVisible ? (
        <div className="space-y-6">
          {paragraphs.map((paragraph, index) => (
            <p
              key={`${chapterNo}-${index}`}
              className={`tracking-[0.01em] text-[var(--reading-ink)] indent-[2em] ${paragraphClass}`}
            >
              {paragraph}
            </p>
          ))}
        </div>
      ) : (
        <div aria-hidden style={{ height: estimatedHeight }} />
      )}
    </section>
  );
});

function PreviewToolbarButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--shadow-soft)]"
          : "border border-[var(--line)] bg-[var(--panel)] text-[var(--ink-soft)] hover:bg-[var(--panel-muted)]"
      }`}
    >
      {children}
    </button>
  );
}

export function ManuscriptPreviewClient({
  projectId,
  initialMarkdownPreview,
  initialTextPreview,
}: {
  projectId: string;
  initialMarkdownPreview?: ManuscriptPreviewPayload | null;
  initialTextPreview?: ManuscriptPreviewPayload | null;
}) {
  const { toast } = useToast();
  const [displayMode, setDisplayMode] = useState<DisplayMode>("reader");
  const [readerChromeHidden, setReaderChromeHidden] = useState(false);
  const [activeChapterNo, setActiveChapterNo] = useState(0);
  const [readProgress, setReadProgress] = useState(0);
  const readerScrollRef = useRef<HTMLDivElement | null>(null);

  // 全书 payload 体积大：只拉取并轮询当前展示格式，禁用的一侧不发请求也不轮询。
  const markdownPreviewQuery = useQuery({
    queryKey: ["manuscript-preview-page", projectId, "md"],
    queryFn: () => apiGet<ManuscriptPreviewPayload>(`/api/projects/${projectId}/manuscript-preview?format=md`),
    initialData: initialMarkdownPreview ?? undefined,
    enabled: displayMode !== "txt",
    refetchOnMount: false,
    refetchInterval: 30000,
  });

  const textPreviewQuery = useQuery({
    queryKey: ["manuscript-preview-page", projectId, "txt"],
    queryFn: () => apiGet<ManuscriptPreviewPayload>(`/api/projects/${projectId}/manuscript-preview?format=txt`),
    initialData: initialTextPreview ?? undefined,
    enabled: displayMode === "txt",
    refetchOnMount: false,
    refetchInterval: 30000,
  });

  const activePreviewQuery = displayMode === "txt" ? textPreviewQuery : markdownPreviewQuery;
  const preview = markdownPreviewQuery.data ?? textPreviewQuery.data;
  const rawPreview = displayMode === "txt" ? textPreviewQuery.data : markdownPreviewQuery.data ?? textPreviewQuery.data;
  const chapters = useMemo(() => preview?.sections ?? [], [preview?.sections]);
  const hasError = activePreviewQuery.isError;
  const errorMessage = activePreviewQuery.error instanceof Error
    ? activePreviewQuery.error.message
    : "读取正文预览失败";
  const copyLabel = displayMode === "txt" ? "复制 TXT" : displayMode === "md" ? "复制 Markdown" : "复制 Markdown";
  const downloadLabel = displayMode === "txt" ? "下载 TXT" : displayMode === "md" ? "下载 Markdown" : "下载 Markdown";

  const activeExport = useMemo(
    () => (displayMode === "txt" ? textPreviewQuery.data : markdownPreviewQuery.data ?? textPreviewQuery.data),
    [displayMode, markdownPreviewQuery.data, textPreviewQuery.data],
  );
  const canExportCurrent = Boolean(activeExport?.content && preview?.chapterCount);
  const chapterKey = chapters.map((chapter) => chapter.chapterNo).join(",");
  const effectiveActiveChapterNo = chapters.some((chapter) => chapter.chapterNo === activeChapterNo)
    ? activeChapterNo
    : chapters[0]?.chapterNo ?? 0;
  const effectiveReadProgress = chapters.length ? readProgress : 0;
  const activeChapterIndex = chapters.findIndex((chapter) => chapter.chapterNo === effectiveActiveChapterNo);
  const previousChapterNo = activeChapterIndex > 0 ? chapters[activeChapterIndex - 1]?.chapterNo ?? null : null;
  const nextChapterNo = activeChapterIndex >= 0 && activeChapterIndex < chapters.length - 1
    ? chapters[activeChapterIndex + 1]?.chapterNo ?? null
    : null;
  const pureReaderMode = displayMode === "reader" && readerChromeHidden;

  useEffect(() => {
    if (displayMode !== "reader") {
      return;
    }

    const container = readerScrollRef.current;
    if (!container || !chapters.length) {
      return;
    }

    let frame = 0;
    const updateReaderProgress = () => {
      frame = 0;
      const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
      const progress = Math.round((container.scrollTop / maxScroll) * 100);
      setReadProgress(progress);

      const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-chapter-no]"));
      let currentChapter = sections[0] ? Number(sections[0].dataset.chapterNo ?? 0) : 0;
      const threshold = container.scrollTop + 220;

      for (const section of sections) {
        if (section.offsetTop <= threshold) {
          currentChapter = Number(section.dataset.chapterNo ?? currentChapter);
        } else {
          break;
        }
      }

      setActiveChapterNo((previous) => (previous === currentChapter ? previous : currentChapter));
    };

    const handleScroll = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(updateReaderProgress);
    };

    updateReaderProgress();
    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [displayMode, chapterKey, chapters.length]);

  function jumpToChapter(chapterNo: number | null) {
    if (!chapterNo) {
      return;
    }
    const section = document.getElementById(`chapter-${chapterNo}`);
    section?.scrollIntoView({ behavior: "auto", block: "start" });
  }

  async function handleCopy() {
    const content = activeExport?.content ?? "";
    if (!content) {
      toast("当前没有可复制的整稿内容", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      toast(`${copyLabel}已复制`, "success");
    } catch {
      toast("复制失败", "error");
    }
  }

  function handleDownload() {
    const content = activeExport?.content ?? "";
    const filename = activeExport?.suggestedFileName ?? `${preview?.title ?? "novel"}.${displayMode === "txt" ? "txt" : "md"}`;
    if (!content) {
      toast("当前没有可下载的整稿内容", "error");
      return;
    }
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-deep)_100%)]">
      <header
        className={`absolute inset-x-0 top-0 z-20 border-b border-[var(--line)] bg-[var(--sidebar)] backdrop-blur-md transition-all duration-200 ${
          pureReaderMode ? "pointer-events-none -translate-y-full opacity-0" : "translate-y-0 opacity-100"
        }`}
      >
        <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between gap-4 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href={`/projects/${projectId}`} className="btn-secondary">
              <ArrowLeft className="h-4 w-4" />
              返回项目
            </Link>
            <div className="min-w-0">
              <p className="section-title">正文预览</p>
              <h1 className="truncate text-2xl font-semibold [font-family:var(--font-serif)] text-[var(--ink)] md:text-3xl">
                {preview?.title ?? "正文预览"}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <PreviewToolbarButton active={displayMode === "reader"} onClick={() => setDisplayMode("reader")}>
              <BookOpenText className="h-4 w-4" />
              阅读版
            </PreviewToolbarButton>
            <PreviewToolbarButton active={displayMode === "md"} onClick={() => setDisplayMode("md")}>
              <FileText className="h-4 w-4" />
              Markdown
            </PreviewToolbarButton>
            <PreviewToolbarButton active={displayMode === "txt"} onClick={() => setDisplayMode("txt")}>
              <Text className="h-4 w-4" />
              TXT
            </PreviewToolbarButton>
            {displayMode === "reader" ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReaderChromeHidden((current) => !current)}
              >
                {pureReaderMode ? "退出纯净" : "纯净模式"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopy}
              disabled={!canExportCurrent}
            >
              <Copy className="h-4 w-4" />
              {copyLabel}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleDownload}
              disabled={!canExportCurrent}
            >
              <Download className="h-4 w-4" />
              {downloadLabel}
            </button>
          </div>
        </div>
      </header>

      <div
        className={`mx-auto grid h-full max-w-[1800px] gap-6 px-4 pb-6 pt-6 md:px-8 ${
          pureReaderMode ? "lg:grid-cols-1" : "pt-[104px] lg:grid-cols-[280px_minmax(0,1fr)]"
        }`}
      >
        <aside
          className={`hidden h-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-panel)] lg:flex lg:flex-col ${
            pureReaderMode ? "lg:hidden" : ""
          }`}
        >
          <div>
            <p className="section-title">Overview</p>
            <div className="mt-4 grid gap-3">
              <div className="workspace-item active p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">已收录章节</p>
                <p className="mt-2 text-3xl font-semibold text-[var(--ink)]">{preview?.chapterCount ?? 0}</p>
              </div>
              <div className="workspace-item active p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">更新时间</p>
                <p className="mt-2 text-sm leading-6 text-[var(--ink)]">
                  {preview?.generatedAt ? new Date(preview.generatedAt).toLocaleString("zh-CN") : "载入中"}
                </p>
              </div>
              <div className="workspace-item active p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">文件建议</p>
                <p className="mt-2 break-all text-sm leading-6 text-[var(--ink)]">
                  {activeExport?.suggestedFileName ?? "novel.md"}
                </p>
              </div>
              {preview?.missingChapterNos.length ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--danger)]">缺章提醒</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--danger)]">
                    {preview.missingChapterNos.join("、")}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6 min-h-0 flex-1 overflow-hidden">
            <p className="section-title">章节定位</p>
            <div className="mt-3 h-full space-y-2 overflow-y-auto pr-1">
              {chapters.map((chapter) => (
                <button
                  key={chapter.chapterNo}
                  type="button"
                  onClick={() => jumpToChapter(chapter.chapterNo)}
                  className={`block rounded-[18px] border px-4 py-3 text-left text-sm transition ${
                    activeChapterNo === chapter.chapterNo
                      ? "border-[color-mix(in_srgb,var(--accent)_32%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--line)] bg-[var(--panel-muted)] text-[var(--ink)] hover:bg-[var(--hover)]"
                  }`}
                >
                  {chapter.heading}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-panel)]">
          {activePreviewQuery.isLoading && !rawPreview ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-lg text-[var(--ink-soft)]">
              正在拼接整卷正文…
            </div>
          ) : hasError ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-lg text-[var(--danger)]">
              {errorMessage}
            </div>
          ) : !preview?.chapterCount ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-lg text-[var(--ink-soft)]">
              还没有可预览的正文，先生成至少一章再来。
            </div>
          ) : displayMode === "reader" ? (
            <div ref={readerScrollRef} className="h-full overflow-y-auto">
              <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-6 lg:hidden">
                <div className="flex flex-wrap gap-2">
                  {chapters.map((chapter) => (
                    <button
                      key={chapter.chapterNo}
                      type="button"
                      onClick={() => jumpToChapter(chapter.chapterNo)}
                      className={`rounded-full px-3 py-1.5 text-sm transition ${
                        effectiveActiveChapterNo === chapter.chapterNo
                          ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                          : "workspace-pill text-[var(--ink-soft)]"
                      }`}
                    >
                      {chapter.heading}
                    </button>
                  ))}
                </div>
              </div>

              <article className={`mx-auto px-5 py-8 md:px-10 lg:py-12 ${pureReaderMode ? "max-w-5xl lg:px-6" : "max-w-4xl lg:px-14"}`}>
                <div
                  className={`rounded-3xl border border-[var(--line)] bg-[var(--reading-paper)] px-6 py-8 shadow-[var(--shadow-panel)] md:px-10 md:py-12 ${
                    pureReaderMode ? "lg:px-20" : "lg:px-16"
                  }`}
                >
                  <div className={`border-b border-[var(--line)] ${pureReaderMode ? "pb-6" : "pb-8"}`}>
                    <p className="text-center text-[11px] font-semibold uppercase tracking-[0.32em] text-[var(--reading-ink-soft)]">Full Manuscript</p>
                    <h2 className="mt-4 text-center text-4xl font-semibold [font-family:var(--font-serif)] tracking-[0.06em] text-[var(--reading-ink)] md:text-5xl">
                      {preview.title}
                    </h2>
                    <p className="mt-4 text-center text-sm leading-7 text-[var(--reading-ink-soft)]">
                      共 {preview.chapterCount} 章，当前阅读模式已按整卷顺序排好。
                    </p>
                  </div>

                  <div className={`space-y-14 ${pureReaderMode ? "mt-8" : "mt-10"}`}>
                    {chapters.map((chapter) => (
                      <ChapterSection
                        key={chapter.chapterNo}
                        chapterNo={chapter.chapterNo}
                        heading={chapter.heading}
                        paragraphs={chapter.paragraphs}
                        pureReaderMode={pureReaderMode}
                      />
                    ))}
                  </div>
                </div>
              </article>
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-4 py-4 md:px-8 md:py-6">
              <div className="mx-auto max-w-6xl rounded-2xl border border-[var(--line)] bg-[var(--panel-muted)] p-5 shadow-[var(--shadow-soft)] md:p-8">
                <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-7 text-[var(--ink)] md:text-[14px]">
                  {rawPreview?.content ?? ""}
                </pre>
              </div>
            </div>
          )}
        </main>
      </div>

      {displayMode === "reader" && preview?.chapterCount ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-30 flex max-w-[calc(100vw-2rem)] flex-col gap-3 md:bottom-7 md:right-7">
          {pureReaderMode ? (
            <div className="pointer-events-auto flex justify-end">
              <button
                type="button"
                className="rounded-full border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--ink)] shadow-[var(--shadow-soft)]"
                onClick={() => setReaderChromeHidden(false)}
              >
                退出纯净
              </button>
            </div>
          ) : null}

          <div className="pointer-events-auto rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-[var(--shadow-panel)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]">阅读进度</p>
                <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                  {effectiveActiveChapterNo ? `第 ${String(effectiveActiveChapterNo).padStart(3, "0")} 章` : "正文预览"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]">全卷</p>
                <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{effectiveReadProgress}%</p>
              </div>
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--line)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ease-out"
                style={{ width: `${Math.max(0, Math.min(100, effectiveReadProgress))}%` }}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={!previousChapterNo}
                onClick={() => jumpToChapter(previousChapterNo)}
              >
                上一章
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!nextChapterNo}
                onClick={() => jumpToChapter(nextChapterNo)}
              >
                下一章
              </button>
              <button
                type="button"
                className={pureReaderMode ? "btn-primary" : "btn-secondary"}
                onClick={() => setReaderChromeHidden((current) => !current)}
              >
                {pureReaderMode ? "纯净中" : "纯净模式"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
