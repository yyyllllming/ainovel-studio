"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, FileUp, Loader2, RefreshCw, SearchCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

type Submission = {
  id: string;
  chapterNo: number;
  title: string;
  source: "human" | "codex" | "import";
  status: "draft" | "queued" | "reviewing" | "needs_revision" | "approved" | "committed" | "failed";
  contentHash: string;
  parentSubmissionId: string | null;
  committedVersionId: string | null;
};
type SubmissionPreview = {
  previewId: string;
  chapterCount: number;
  chapters: Array<{ chapterNo: number; title: string; characterCount: number; contentHash: string }>;
};

const STATUS_LABEL: Record<Submission["status"], string> = {
  draft: "待审",
  queued: "排队中",
  reviewing: "审查中",
  needs_revision: "需修订",
  approved: "已通过",
  committed: "已提交",
  failed: "失败",
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string }; message?: string } & T;
  if (!response.ok) throw new Error(payload.error?.message ?? payload.message ?? "请求失败");
  return (payload.data ?? payload) as T;
}

export function AuthorSubmissionWorkbench({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [chapterNo, setChapterNo] = useState(1);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [startChapterNo, setStartChapterNo] = useState(1);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState<{ id: string; title: string; content: string } | null>(null);
  const [overrideApproval, setOverrideApproval] = useState<{ id: string; chapterNo: number; reason: string } | null>(null);
  const [pendingPreview, setPendingPreview] = useState<SubmissionPreview | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | Submission["status"]>("all");
  const [chapterFilter, setChapterFilter] = useState("");
  const queueScrollRef = useRef<HTMLDivElement>(null);

  const filteredSubmissions = useMemo(
    () => submissions.filter((submission) => (
      (statusFilter === "all" || submission.status === statusFilter)
      && (!chapterFilter || submission.chapterNo === Number(chapterFilter))
    )),
    [chapterFilter, statusFilter, submissions],
  );
  const queueVirtualizer = useVirtualizer({
    count: filteredSubmissions.length,
    getScrollElement: () => queueScrollRef.current,
    estimateSize: () => 176,
    overscan: 4,
    initialRect: { width: 1024, height: 672 },
  });
  const measuredQueueRows = queueVirtualizer.getVirtualItems();
  const visibleQueueRows = measuredQueueRows.length > 0
    ? measuredQueueRows
    : filteredSubmissions.slice(0, 5).map((_, index) => ({ index, start: index * 176 }));

  const refresh = useCallback(async () => {
    const payload = await requestJson<{ submissions: Submission[] }>(`/api/projects/${projectId}/author-submissions`);
    setSubmissions(payload.submissions);
  }, [projectId]);

  useEffect(() => {
    void refresh().catch((nextError) => setError(nextError instanceof Error ? nextError.message : "读取作者稿失败"));
  }, [refresh]);

  async function runAction(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["author-submissions", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["chapter", projectId] }),
      ]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "操作失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function importSingle(event: FormEvent) {
    event.preventDefault();
    await runAction("single", async () => {
      const preview = await requestJson<SubmissionPreview>(`/api/projects/${projectId}/author-submissions/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "single", chapterNo, title, content, source: "codex" }),
      });
      setPendingPreview(preview);
      setMessage(`已生成第 ${chapterNo} 章预览，请核对后确认导入`);
    });
  }

  async function importFile(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    await runAction("file", async () => {
      const form = new FormData();
      form.set("file", file);
      form.set("startChapterNo", String(startChapterNo));
      form.set("source", "import");
      const preview = await requestJson<SubmissionPreview>(`/api/projects/${projectId}/author-submissions/preview`, {
        method: "POST",
        body: form,
      });
      setPendingPreview(preview);
      setMessage(`${file.name} 已解析出 ${preview.chapterCount} 章，请核对后确认导入`);
    });
  }

  return (
    <section className="grid gap-5" aria-label="作者稿工作台">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={importSingle} className="paper-panel grid gap-3 p-5">
          <div>
            <p className="section-title">Codex Author</p>
            <h2 className="mt-1 text-xl font-semibold">粘贴单章正文</h2>
          </div>
          <label className="grid gap-1 text-sm">章节号<input className="input" type="number" min={1} value={chapterNo} onChange={(event) => setChapterNo(Number(event.target.value))} /></label>
          <label className="grid gap-1 text-sm">章节标题<input className="input" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="grid gap-1 text-sm">完整正文<textarea className="input min-h-64 resize-y leading-7" required value={content} onChange={(event) => setContent(event.target.value)} /></label>
          <button className="btn-primary" disabled={busyKey !== null} type="submit">
            {busyKey === "single" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}生成导入预览
          </button>
        </form>

        <form onSubmit={importFile} className="paper-panel grid content-start gap-3 p-5">
          <div><p className="section-title">Batch Import</p><h2 className="mt-1 text-xl font-semibold">导入 Markdown / TXT</h2></div>
          <label className="grid gap-1 text-sm">起始章节<input className="input" type="number" min={1} value={startChapterNo} onChange={(event) => setStartChapterNo(Number(event.target.value))} /></label>
          <label className="grid gap-1 text-sm">稿件文件<input className="input" type="file" accept=".md,.txt,text/plain,text/markdown" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          <p className="text-sm leading-6 text-[var(--ink-soft)]">批量导入会先解析章节边界，再创建不可变作者稿；不会调用 Writer。</p>
          <button className="btn-secondary" disabled={!file || busyKey !== null} type="submit">
            {busyKey === "file" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}解析并预览
          </button>
        </form>
      </div>

      {message ? <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

      {pendingPreview ? <section className="paper-panel grid gap-3 p-5" aria-label="作者稿导入预览">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="section-title">Preview Before Import</p><h2 className="mt-1 text-xl font-semibold">确认 {pendingPreview.chapterCount} 章边界</h2></div><button type="button" className="btn-ghost" onClick={() => setPendingPreview(null)}>放弃预览</button></div>
        <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--line)]" role="list" aria-label="预览章节列表">
          {pendingPreview.chapters.map((chapter) => <div key={`${chapter.chapterNo}:${chapter.contentHash}`} role="listitem" className="grid grid-cols-[5rem_minmax(0,1fr)_7rem] gap-3 border-b border-[var(--line)] px-4 py-3 text-sm last:border-b-0"><span>第 {chapter.chapterNo} 章</span><span className="truncate">{chapter.title}</span><span className="text-right text-[var(--ink-soft)]">{chapter.characterCount} 字</span></div>)}
        </div>
        <button type="button" className="btn-primary" disabled={busyKey !== null} onClick={() => void runAction("confirm-import", async () => {
          await requestJson(`/api/projects/${projectId}/author-submissions/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previewId: pendingPreview.previewId }) });
          setMessage(`${pendingPreview.chapterCount} 章已导入待审队列`);
          setPendingPreview(null);
          setTitle("");
          setContent("");
          setFile(null);
        })}>确认导入</button>
      </section> : null}

      <div className="paper-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-4">
          <div><p className="section-title">Review Queue</p><h2 className="mt-1 text-xl font-semibold">作者稿审查与提交</h2></div>
          <div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="submission-status-filter">状态筛选</label><select id="submission-status-filter" className="input w-32" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">全部状态</option>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="sr-only" htmlFor="submission-chapter-filter">章节筛选</label><input id="submission-chapter-filter" className="input w-28" inputMode="numeric" placeholder="章节号" value={chapterFilter} onChange={(event) => setChapterFilter(event.target.value)} /></div>
          <button type="button" className="btn-ghost" onClick={() => void runAction("refresh", async () => refresh())} disabled={busyKey !== null}><RefreshCw className="h-4 w-4" />刷新</button>
        </div>
        {filteredSubmissions.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--ink-soft)]">没有符合条件的作者稿。</p>
        ) : (
          <div
            ref={queueScrollRef}
            className="max-h-[42rem] overflow-y-auto p-4"
            role="list"
            aria-label="作者稿审查队列"
            data-virtual-count={filteredSubmissions.length}
          >
            <div className="relative w-full" style={{ height: queueVirtualizer.getTotalSize() }}>
              {visibleQueueRows.map((virtualRow) => {
                const submission = filteredSubmissions[virtualRow.index];
                if (!submission) return null;
                return (
                  <article
                    key={submission.id}
                    ref={queueVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    role="listitem"
                    className="absolute left-0 top-0 w-full pb-3"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <div className="rounded-xl border border-[var(--line)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><p className="text-sm text-[var(--ink-soft)]">第 {submission.chapterNo} 章 · {submission.source}</p><h3 className="mt-1 font-semibold">{submission.title}</h3><p className="mt-1 font-mono text-xs text-[var(--ink-faint)]">{submission.contentHash.slice(0, 16)}</p></div>
                        <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs">{STATUS_LABEL[submission.status]}</span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {["draft", "failed"].includes(submission.status) ? <button type="button" className="btn-secondary" disabled={busyKey !== null} onClick={() => void runAction(`review:${submission.id}`, async () => {
                          const result = await requestJson<{ deep: { reason: string }; submission: Submission }>(`/api/projects/${projectId}/author-submissions/${submission.id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                          setMessage(result.deep.reason);
                        })}><SearchCheck className="h-4 w-4" />运行 Quick + Deep</button> : null}
                        {submission.status === "needs_revision" ? <>
                          <button type="button" className="btn-secondary" onClick={() => setRevision({ id: submission.id, title: submission.title, content: "" })}>提交修订稿</button>
                          <button type="button" className="btn-ghost" disabled={busyKey !== null} onClick={() => setOverrideApproval({ id: submission.id, chapterNo: submission.chapterNo, reason: "" })}>有理由人工批准</button>
                        </> : null}
                        {submission.status === "approved" || submission.status === "committed" ? <button type="button" className="btn-primary" disabled={busyKey !== null} onClick={() => void runAction(`approve:${submission.id}`, async () => {
                          await requestJson(`/api/projects/${projectId}/author-submissions/${submission.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                          setMessage(`第 ${submission.chapterNo} 章已提交为正式正文`);
                        })}><CheckCircle2 className="h-4 w-4" />{submission.status === "committed" ? "重新同步" : "批准为正式正文"}</button> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {revision ? <form className="paper-panel grid gap-3 p-5" onSubmit={(event) => { event.preventDefault(); void runAction(`revise:${revision.id}`, async () => {
        const next = await requestJson<Submission>(`/api/projects/${projectId}/author-submissions/${revision.id}/revise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: revision.title, content: revision.content, source: "codex" }) });
        setRevision(null);
        setMessage(`修订稿 ${next.id} 已创建，请重新审查`);
      }); }}>
        <h2 className="text-xl font-semibold">提交修订稿</h2>
        <label className="grid gap-1 text-sm">标题<input className="input" required value={revision.title} onChange={(event) => setRevision({ ...revision, title: event.target.value })} /></label>
        <label className="grid gap-1 text-sm">修订后完整正文<textarea className="input min-h-64 resize-y leading-7" required value={revision.content} onChange={(event) => setRevision({ ...revision, content: event.target.value })} /></label>
        <div className="flex gap-2"><button type="submit" className="btn-primary">保存修订稿</button><button type="button" className="btn-ghost" onClick={() => setRevision(null)}>取消</button></div>
      </form> : null}

      {overrideApproval ? <form className="paper-panel grid gap-3 p-5" onSubmit={(event) => { event.preventDefault(); void runAction(`override:${overrideApproval.id}`, async () => {
        await requestJson(`/api/projects/${projectId}/author-submissions/${overrideApproval.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ humanOverride: true, overrideReason: overrideApproval.reason }),
        });
        setMessage(`第 ${overrideApproval.chapterNo} 章已由人工覆盖审查并提交为正式正文`);
        setOverrideApproval(null);
      }); }}>
        <h2 className="text-xl font-semibold">人工覆盖审查</h2>
        <p className="text-sm leading-6 text-[var(--ink-soft)]">仅在已核对审查证据、确认继续返修会偏离作者意图时使用；原因会写入项目运行日志。</p>
        <label className="grid gap-1 text-sm">覆盖原因<textarea className="input min-h-32 resize-y leading-7" required maxLength={1000} value={overrideApproval.reason} onChange={(event) => setOverrideApproval({ ...overrideApproval, reason: event.target.value })} /></label>
        <div className="flex gap-2"><button type="submit" className="btn-primary" disabled={busyKey !== null}>确认人工批准</button><button type="button" className="btn-ghost" onClick={() => setOverrideApproval(null)}>取消</button></div>
      </form> : null}
    </section>
  );
}
