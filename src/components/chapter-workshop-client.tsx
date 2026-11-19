"use client";

import { memo, useCallback, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  FileDiff,
  FileText,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { CollapsibleSection } from "./collapsible-section.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { ChapterReviews } from "./chapter/chapter-reviews.tsx";
import { StreamingProgress } from "./progress-indicators.tsx";
import { usePopReveal } from "./use-pop-reveal";

type OptimizeAction =
  | "polish"
  | "expand"
  | "rewrite"
  | "enhance_emotion"
  | "add_dialogue"
  | "change_pov";

export interface ChapterPayload {
  chapterNo: number;
  content: string | null;
  liveDraft: {
    content: string;
    completed: boolean;
  } | null;
  blueprint: {
    chapterNo: number;
    sceneGoal: string;
    characters: string[];
    locations: string[];
    conflicts: string[];
    foreshadows: string[];
    emotionalTone: string;
    estimatedWords: number;
  } | null;
  versions: Array<{
    id: string;
    versionNo: number;
    temperature: number;
    excerpt: string;
    selected: boolean;
  }>;
  reviews: Array<{
    id: string;
    submissionId: string | null;
    versionId: string | null;
    contentHash: string | null;
    reviewerProfileId: string | null;
    promptHash: string | null;
    reviewSchemaVersion: string | null;
    windowContentHash: string | null;
    stale: boolean;
    reviewMode?: "quick" | "deep";
    verdict: string;
    confidence: number;
    reason: string;
    fixInstructions: string;
    createdAt: string;
    issues?: Array<{
      type: string;
      location: string;
      severity: "minor" | "major";
      evidence?: string;
    }>;
  }>;
  reviewState?: {
    status: "provisional" | "deep_locked" | "manual_review";
    latestConfidence: number;
  } | null;
  invalidatedHistory: Array<{
    id: string;
    chapterNo: number;
    rangeStartChapter: number;
    rangeEndChapter: number;
    reason: string;
    excerpt: string;
    reviewReason: string | null;
    invalidatedAt: string;
  }>;
  run: {
    running: boolean;
    stage:
      | "idle"
      | "blueprint"
      | "context"
      | "writing"
      | "style_pass"
      | "planning_repair"
      | "review"
      | "analysis"
      | "completed"
      | "manual_review"
      | "paused"
      | "interrupted"
      | "failed";
    currentChapter: number;
    currentPosition: number;
    wordCount: number;
    isCurrentChapter: boolean;
    isStreaming: boolean;
  };
  manualReview: {
    awaiting: boolean;
    reason: string | null;
    canApprove: boolean;
    canAutoPick: boolean;
    isLastChapter: boolean;
    earliestAffectedChapter: number | null;
    requiresWindowRestart: boolean;
  };
}

function stageLabel(stage: ChapterPayload["run"]["stage"]) {
  switch (stage) {
    case "blueprint":
      return "正在规划本章蓝图";
    case "context":
      return "正在装配上下文";
    case "writing":
      return "正文正在持续写入";
    case "style_pass":
      return "正在整理段落与文气";
    case "review":
      return "正在审核与收束";
    case "planning_repair":
      return "正在回修章节规划";
    case "analysis":
      return "正在整理分析结果";
    case "paused":
      return "写作已暂停";
    case "interrupted":
      return "运行已中断，等待恢复";
    case "failed":
      return "本章生成失败";
    case "completed":
      return "本章已完成";
    default:
      return "当前尚未开始写作";
  }
}

function WritingProgress({
  stage,
  wordCount,
  estimatedWords,
}: {
  stage: ChapterPayload["run"]["stage"];
  wordCount: number;
  estimatedWords?: number;
}) {
  const isActive =
    stage !== "idle" && stage !== "completed" && stage !== "failed";

  return (
    <StreamingProgress
      stageLabel={stageLabel(stage)}
      current={wordCount}
      total={estimatedWords}
      unit="字"
      active={isActive}
      className="mt-4"
    />
  );
}

interface ChapterVersionRowProps {
  versionId: string;
  versionNo: number;
  temperature: number;
  selected: boolean;
  excerpt: string;
  rollbackPending: boolean;
  onRollback: (versionId: string, versionNo: number) => void;
}

const ChapterVersionRow = memo(function ChapterVersionRow({
  versionId,
  versionNo,
  temperature,
  selected,
  excerpt,
  rollbackPending,
  onRollback,
}: ChapterVersionRowProps) {
  const handleRollback = useCallback(() => onRollback(versionId, versionNo), [onRollback, versionId, versionNo]);
  return (
    <div className="workspace-item active px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--ink)]">版本 {versionNo}</p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">temperature={temperature}</p>
        </div>
        <div className="flex items-center gap-2">
          {selected ? <StatusBadge status="completed" /> : null}
          <button className="btn-secondary px-3 py-1.5 text-xs" disabled={rollbackPending} onClick={handleRollback}>
            回滚
          </button>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{excerpt}</p>
    </div>
  );
});

export function ChapterWorkshopClient({
  projectId,
  chapterNo,
  initialChapter,
  initialConflicts,
}: {
  projectId: string;
  chapterNo: number;
  initialChapter?: ChapterPayload | null;
  initialConflicts?: { conflicts: Array<{ chapterNo: number; severity: string; message: string }> };
}) {
  const queryClient = useQueryClient();
  const revealScope = useRef<HTMLDivElement>(null);
  usePopReveal(revealScope);
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(240);
  const [action, setAction] = useState<OptimizeAction>("polish");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastPatch, setLastPatch] = useState<{ patchId?: string; preview?: string; patch?: unknown } | null>(null);

  const chapterQuery = useQuery({
    queryKey: ["chapter", projectId, chapterNo],
    queryFn: () => apiGet<ChapterPayload>(`/api/projects/${projectId}/chapters/${chapterNo}`),
    initialData: initialChapter ?? undefined,
    // 切章节时 initialData / 缓存直接显示；重新挂载时默认的 refetchOnMount 会在数据
    // 超过 staleTime 后后台重拉一次，避免重访非当前章节永远停留在过期缓存。
    staleTime: 5_000,
    refetchInterval: (query) => {
      const payload = query.state.data as ChapterPayload | undefined;
      if (payload?.run.isStreaming) {
        return 1000;
      }
      if (payload?.run.isCurrentChapter || payload?.manualReview.awaiting) {
        return 5000;
      }
      return false;
    },
  });

  const conflictQuery = useQuery({
    queryKey: ["chapter-conflicts", projectId],
    queryFn: () => apiGet<{ conflicts: Array<{ chapterNo: number; severity: string; message: string }> }>(`/api/projects/${projectId}/canon/conflicts`),
    initialData: initialConflicts,
    staleTime: 5_000,
    refetchInterval: chapterQuery.data?.run.isStreaming || chapterQuery.data?.run.isCurrentChapter
      ? 5000
      : false,
  });

  const simpleMutation = useMutation({
    mutationFn: (payload: { url: string; body?: unknown; success: string }) => apiPost(payload.url, payload.body).then(() => payload.success),
    onSuccess: async (message) => {
      setFeedback(message);
      await queryClient.invalidateQueries({ queryKey: ["chapter", projectId, chapterNo] });
      await queryClient.invalidateQueries({ queryKey: ["chapter-conflicts", projectId] });
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "操作失败"),
  });

  const handleRollbackVersion = useCallback(
    (versionId: string, versionNo: number) => {
      simpleMutation.mutate({
        url: `/api/projects/${projectId}/chapters/${chapterNo}/rollback`,
        body: { versionId },
        success: `已回滚到版本 ${versionNo}`,
      });
    },
    [simpleMutation, projectId, chapterNo],
  );

  const optimizeMutation = useMutation({
    mutationFn: () =>
      apiPost<{ patchId?: string; preview?: string; patch?: unknown }>(
        `/api/projects/${projectId}/chapters/${chapterNo}/optimize`,
        {
          selection: { start: selectionStart, end: selectionEnd },
          action,
        },
      ),
    onSuccess: (result) => {
      setLastPatch(result);
      setFeedback("已生成 Patch 预览");
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "生成 Patch 失败"),
  });

  const applyPatchMutation = useMutation({
    mutationFn: () =>
      apiPost(`/api/projects/${projectId}/chapters/${chapterNo}/apply-patch`, {
        patchId: lastPatch?.patchId,
        patch: lastPatch?.patch,
      }),
    onSuccess: async () => {
      // 清掉已应用的 patch，避免在已变更的正文上重复应用同一段替换
      setLastPatch(null);
      setFeedback("Patch 已应用");
      await queryClient.invalidateQueries({ queryKey: ["chapter", projectId, chapterNo] });
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "应用 Patch 失败"),
  });

  const manualReviewMutation = useMutation({
    mutationFn: (action: "approve_continue" | "retry_chapter" | "auto_pick_version") =>
      apiPost(`/api/projects/${projectId}/chapters/${chapterNo}/manual-review`, {
        action,
      }),
    onSuccess: async (_result, action) => {
      setFeedback(
        action === "retry_chapter"
          ? chapter?.manualReview.requiresWindowRestart && chapter.manualReview.earliestAffectedChapter
            ? `已归档旧时间线，自动写作将从第 ${chapter.manualReview.earliestAffectedChapter} 章重新开始。`
            : "已归档当前章节旧稿，自动写作将重新开始本章。"
          : action === "auto_pick_version"
            ? chapter?.manualReview.isLastChapter
              ? "系统已自动挑选最贴主线的一版并完成项目。"
              : "系统已自动挑选最贴主线的一版，并继续下一章。"
            : chapter?.manualReview.isLastChapter
              ? "已确认当前章节，项目已完成。"
              : "已确认当前章节，自动写作将从下一章继续。",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chapter", projectId, chapterNo] }),
        queryClient.invalidateQueries({ queryKey: ["chapter-conflicts", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
      ]);
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "人工确认操作失败"),
  });

  const chapter = chapterQuery.data;
  const filteredConflicts = (conflictQuery.data?.conflicts ?? []).filter((item) => item.chapterNo === chapterNo);
  const currentReviews = chapter?.reviews.filter((review) => !review.stale) ?? [];
  const staleReviews = chapter?.reviews.filter((review) => review.stale) ?? [];
  const chapterStatus = chapter?.manualReview.awaiting
    ? "manual_review"
    : chapter?.run.isStreaming
      ? "writing"
      : chapter?.run.isCurrentChapter && chapter.run.stage === "interrupted"
        ? "interrupted"
      : chapter?.content
        ? "completed"
        : chapter?.liveDraft?.content
          ? "draft"
          : "idle";
  const prefersLiveDraft = Boolean(chapter?.run.isCurrentChapter && chapter?.liveDraft?.content);
  const visibleContent = prefersLiveDraft
    ? chapter?.liveDraft?.content ?? chapter?.content ?? "当前还没有正文。先在项目页点击“开始写作”，或在这里生成多版本。"
    : chapter?.content ?? chapter?.liveDraft?.content ?? "当前还没有正文。先在项目页点击“开始写作”，或在这里生成多版本。";
  const contentStateLabel = chapter?.run.isStreaming
    ? "实时生成中"
    : prefersLiveDraft
      ? "已有暂存草稿"
      : chapter?.content
      ? "已有定稿"
      : chapter?.liveDraft?.content
        ? "已有暂存草稿"
        : "尚未定稿";

  return (
    <div ref={revealScope} className="flex h-[calc(100vh-1rem)] w-full">
      <div className="flex w-full flex-col lg:flex-row gap-4">
        <aside className="w-full lg:w-64 flex-shrink-0 flex flex-col gap-4 lg:sticky lg:top-6 lg:h-full overflow-hidden border-b lg:border-b-0 lg:border-r border-[var(--line)] pb-4 lg:pb-0 lg:pr-4">
          <div className="flex items-center justify-between px-2 py-1">
            <Link href={`/projects/${projectId}`} className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm">
              <ArrowLeft className="h-4 w-4" />
              返回项目工作台
            </Link>
            <StatusBadge status={chapterStatus} />
          </div>

          <div className="mt-4 px-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">Chapter Room</p>
            <h1 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">第 {chapterNo} 章</h1>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
              管理单章正文、审核返修、局部修改与本章版本。
            </p>
          </div>

          <div data-reveal className="mt-4 grid grid-cols-3 lg:grid-cols-1 gap-2">
            <div className="workspace-item active px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Versions</p>
              <p className="mt-2 text-lg font-semibold">{chapter?.versions.length ?? 0}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)] hidden lg:block">候选版本 / 回滚入口</p>
            </div>
            <div className="workspace-item active px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Conflicts</p>
              <p className="mt-2 text-lg font-semibold">{filteredConflicts.length}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)] hidden lg:block">当前章节一致性检查</p>
            </div>
            <div className="workspace-item active px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Patch</p>
              <p className="mt-2 text-lg font-semibold">{lastPatch ? "已生成" : "未生成"}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)] hidden lg:block">局部优化 / 改写</p>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <button
              className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              disabled={simpleMutation.isPending}
              onClick={() =>
                simpleMutation.mutate({
                  url: `/api/projects/${projectId}/chapters/${chapterNo}/generate-versions`,
                  success: "已生成 3 个候选版本",
                })
              }
            >
              <Sparkles className="h-4 w-4" />
              生成 3 个版本
            </button>
          </div>

          {chapter?.manualReview.awaiting ? (
            <div className="mt-4 workspace-item active px-4 py-4">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[var(--warn)]" />
                <p className="text-sm font-medium text-[var(--ink)]">等待人工确认</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
                {chapter.manualReview.requiresWindowRestart && chapter.manualReview.earliestAffectedChapter
                  ? `深审判断问题根源在更早章节，建议从第 ${chapter.manualReview.earliestAffectedChapter} 章起重跑当前窗口。`
                  : chapter.manualReview.reason || "先挑一个满意版本，或应用 Patch 定稿，再决定是继续下一章还是退回重写。"}
              </p>
            </div>
          ) : null}
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto w-full h-full p-4 lg:p-6 relative flex flex-col">
          <div data-reveal className="mx-auto w-full max-w-6xl gap-4 grid content-start pb-10">
            <section className="workspace-panel p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-soft)]">Writing Surface</p>
                <h2 className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">章节正文与局部修订</h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">
                  阅读正文，生成多版本、打局部 Patch 或回滚已有版本。自动写作进行中时，这里会按草稿实时刷新，不再等整章结束后一次性出现。
                </p>
              </div>
              <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                <span className="workspace-pill px-4 py-2">正文：{contentStateLabel}</span>
                <span className="workspace-pill px-4 py-2">阶段：{stageLabel(chapter?.run.stage ?? "idle")}</span>
              </div>
            </div>

            {feedback ? <p className="mt-4 text-sm text-[var(--ink-soft)]">{feedback}</p> : null}
            {chapter?.run.isCurrentChapter && (chapter.run.isStreaming || chapter.liveDraft?.content) ? (
              <WritingProgress
                stage={chapter.run.stage}
                wordCount={chapter.run.wordCount}
                estimatedWords={chapter.blueprint?.estimatedWords}
              />
            ) : null}

            {chapter?.manualReview.awaiting ? (
              <div className="mt-5 rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">这一章正在等你拍板</p>
                    <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
                      {chapter.manualReview.requiresWindowRestart && chapter.manualReview.earliestAffectedChapter
                        ? `深审判断问题根源在更早章节，系统会先把第 ${chapter.manualReview.earliestAffectedChapter} 章起的旧时间线归档，再从那里重跑。`
                        : chapter.manualReview.reason || "先挑一个满意版本，或应用 Patch 定稿，再决定是继续下一章还是退回重写。"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!chapter.manualReview.canApprove || manualReviewMutation.isPending}
                      onClick={() => manualReviewMutation.mutate("approve_continue")}
                    >
                      {chapter.manualReview.isLastChapter ? "采用当前正文并完成项目" : "采用当前正文并继续下一章"}
                    </button>
                    <button
                      className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!chapter.manualReview.canAutoPick || manualReviewMutation.isPending}
                      onClick={() => manualReviewMutation.mutate("auto_pick_version")}
                    >
                      自动选一版并继续
                    </button>
                    <button
                      className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={manualReviewMutation.isPending}
                      onClick={() => manualReviewMutation.mutate("retry_chapter")}
                    >
                      {chapter.manualReview.requiresWindowRestart && chapter.manualReview.earliestAffectedChapter
                        ? `从第 ${chapter.manualReview.earliestAffectedChapter} 章归档后重跑`
                        : "归档本章后重写"}
                    </button>
                  </div>
                </div>
                {!chapter.manualReview.canApprove ? (
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">
                    当前还没有已定稿正文。请先在“版本历史”里回滚一个候选版本，或先应用 Patch。
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,320px)]">
              <div className="workspace-item active p-4">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[var(--accent)]" />
                  <p className="text-sm font-medium text-[var(--ink)]">当前正文</p>
                </div>
                <textarea
                  readOnly
                  className="form-input mt-4 min-h-[30rem] resize-none rounded-2xl bg-[var(--surface-deep)] px-4 py-4 text-sm leading-8"
                  value={visibleContent}
                />
              </div>

              <div className="grid gap-4 content-start">
                <div className="workspace-item active p-4">
                  <div className="flex items-center gap-2">
                    <FileDiff className="h-4 w-4 text-[var(--accent)]" />
                    <p className="text-sm font-medium text-[var(--ink)]">局部优化 / Patch</p>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2 text-sm">
                      开始位置
                      <input className="form-input rounded-2xl" type="number" min={0} value={selectionStart} onChange={(event) => setSelectionStart(Number(event.target.value))} />
                    </label>
                    <label className="grid gap-2 text-sm">
                      结束位置
                      <input className="form-input rounded-2xl" type="number" min={0} value={selectionEnd} onChange={(event) => setSelectionEnd(Number(event.target.value))} />
                    </label>
                    <label className="grid gap-2 text-sm">
                      动作
                      <select className="form-input rounded-2xl" value={action} onChange={(event) => setAction(event.target.value as OptimizeAction)}>
                        <option value="polish">润色</option>
                        <option value="expand">扩写</option>
                        <option value="rewrite">改写</option>
                        <option value="enhance_emotion">强化情绪</option>
                        <option value="add_dialogue">添加对话</option>
                        <option value="change_pov">改写视角</option>
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button className="btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-60" disabled={optimizeMutation.isPending} onClick={() => optimizeMutation.mutate()}>
                      生成 Patch
                    </button>
                    <button className="btn-secondary flex-1" disabled={!lastPatch || applyPatchMutation.isPending} onClick={() => applyPatchMutation.mutate()}>
                      应用 Patch
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {lastPatch?.preview ? (
              <div className="mt-4">
                <CollapsibleSection
                  title="Patch 预览"
                  eyebrow="Patch"
                  description="局部修改先折起来，需要时再展开核对。"
                  defaultOpen
                  className="bg-[var(--panel-soft)]"
                >
                  <textarea
                    readOnly
                    className="form-input min-h-52 resize-none rounded-2xl bg-[var(--surface-deep)] px-4 py-4 text-sm leading-7"
                    value={lastPatch.preview}
                  />
                </CollapsibleSection>
              </div>
            ) : null}
          </section>
          </div>
        </main>

        <div className="w-full xl:w-80 flex-shrink-0" aria-label="审核与版本抽屉">
          <aside data-reveal className="grid gap-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-56px)] overflow-y-auto pb-6 pr-2">
            <CollapsibleSection
              title="冲突面板"
              eyebrow="Consistency"
              summaryRight={(
                <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                  {filteredConflicts.length} 条
                </span>
              )}
              defaultOpen={filteredConflicts.length > 0}
            >
              <div className="grid gap-3">
                {filteredConflicts.length ? filteredConflicts.map((conflict, index) => (
                  <div key={`${conflict.message}-${index}`} className="workspace-item active px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-[var(--ink)]">{conflict.message}</p>
                      <StatusBadge status={conflict.severity} />
                    </div>
                  </div>
                )) : <p className="text-sm text-[var(--ink-soft)]">当前章节暂无冲突。</p>}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="审核记录"
              eyebrow="Reviews"
              summaryRight={(
                <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                  {currentReviews.length} 条有效{staleReviews.length ? ` · ${staleReviews.length} 条历史` : ""}
                </span>
              )}
            >
              <div className="grid gap-3">
                {currentReviews.length ? <ChapterReviews reviews={currentReviews} /> : <p className="text-sm text-[var(--ink-soft)]">当前正文还没有有效审稿记录。</p>}
                {staleReviews.length ? (
                  <details className="workspace-item px-4 py-3 text-sm text-[var(--ink-soft)]">
                    <summary className="cursor-pointer font-medium">查看已失效审稿历史（{staleReviews.length}）</summary>
                    <div className="mt-3 grid gap-3">
                      {staleReviews.map((review) => (
                        <div key={review.id} className="border-l-2 border-[var(--line)] pl-3 opacity-75">
                          <p>已失效（正文已变化） · {review.reviewMode === "quick" ? "quick" : "deep"}</p>
                          <p className="mt-1">{review.reason}</p>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="版本历史"
              eyebrow="Version Stack"
              summaryRight={(
                <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                  {chapter?.versions.length ?? 0} 个
                </span>
              )}
              defaultOpen
            >
              <div className="grid gap-3">
                {chapter?.versions.length ? chapter.versions.map((version) => (
                  <ChapterVersionRow
                    key={version.id}
                    versionId={version.id}
                    versionNo={version.versionNo}
                    temperature={version.temperature}
                    selected={version.selected}
                    excerpt={version.excerpt}
                    rollbackPending={simpleMutation.isPending}
                    onRollback={handleRollbackVersion}
                  />
                )) : <p className="text-sm text-[var(--ink-soft)]">还没有版本历史。</p>}
              </div>
            </CollapsibleSection>

            <CollapsibleSection
              title="失效历史"
              eyebrow="Timeline"
              summaryRight={(
                <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                  {chapter?.invalidatedHistory.length ?? 0} 条
                </span>
              )}
            >
              <div className="grid gap-3">
                {chapter?.invalidatedHistory.length ? chapter.invalidatedHistory.map((entry) => (
                  <div key={entry.id} className="workspace-item active px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--ink)]">
                          第 {entry.chapterNo} 章失效归档
                        </p>
                        <p className="mt-1 text-xs text-[var(--ink-soft)]">
                          窗口 {entry.rangeStartChapter}-{entry.rangeEndChapter} · {new Date(entry.invalidatedAt).toLocaleString("zh-CN")}
                        </p>
                      </div>
                      <StatusBadge status="interrupted" />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{entry.reason}</p>
                    {entry.reviewReason ? (
                      <p className="mt-2 text-sm text-[var(--ink-soft)]">触发原因：{entry.reviewReason}</p>
                    ) : null}
                    <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{entry.excerpt || "该归档仅保留元数据。"}</p>
                  </div>
                )) : <p className="text-sm text-[var(--ink-soft)]">当前章节还没有失效归档。</p>}
              </div>
            </CollapsibleSection>
          </aside>
        </div>
      </div>
    </div>
  );
}
