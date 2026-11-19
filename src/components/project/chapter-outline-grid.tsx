"use client";

import { memo } from "react";
import Link from "next/link";
import { BookOpenText, Play } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { BlueprintRunHealthSummary } from "@/lib/types/project";

interface ChapterOutlineUnit {
  chapterNo: number;
  hasContent: boolean;
  hasConflict: boolean;
  isCurrent: boolean;
  reviewStatus: "provisional" | "deep_locked" | "manual_review" | null;
  segmentTitle?: string | null;
  segmentIntent?: string | null;
  rewriteStatus?: "pending" | "ready" | "failed";
}

interface OutlineUnitCardProps {
  unit: ChapterOutlineUnit;
  projectId: string;
  storyLength: "short" | "medium" | "long";
  isRunning: boolean;
}

const OutlineUnitCard = memo(function OutlineUnitCard({
  unit,
  projectId,
  storyLength,
  isRunning,
}: OutlineUnitCardProps) {
  return (
    <Link
      href={`/projects/${projectId}/chapters/${unit.chapterNo}`}
      className="workspace-item active p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-base font-semibold text-[var(--ink)]">
          {storyLength === "short" ? `正文单元 ${unit.chapterNo}` : `第 ${unit.chapterNo} 章`}
        </p>
        <StatusBadge
          status={
            unit.reviewStatus === "manual_review"
              ? "manual_review"
              : unit.hasConflict
                ? "warn"
                : unit.hasContent
                  ? "completed"
                  : unit.isCurrent && isRunning
                    ? "writing"
                    : "draft"
          }
        />
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
        {unit.reviewStatus === "manual_review"
          ? "等待人工确认"
          : unit.hasContent
            ? "已有正文"
            : unit.isCurrent && isRunning
              ? "当前推进位置"
              : unit.isCurrent
                ? "下一章入口"
                : "待写作"}
      </p>
      {unit.segmentTitle ? (
        <p className="mt-3 text-sm font-medium leading-6 text-[var(--ink)]">{unit.segmentTitle}</p>
      ) : null}
      {unit.segmentIntent ? (
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{unit.segmentIntent}</p>
      ) : null}
      {!unit.hasContent && unit.rewriteStatus === "failed" ? (
        <p className="mt-2 text-xs leading-5 text-[var(--warning)]">叙事层改写失败，当前先回退 skeleton 展示。</p>
      ) : null}
    </Link>
  );
});

interface ChapterOutlineGridProps {
  projectId: string;
  storyLength: "short" | "medium" | "long";
  chapterPlanningMode: "fixed" | "dynamic";
  hardChapterCap?: number;
  unitLabel: string;
  currentChapterNo: number;
  currentVolumeLabel: string;
  currentVolumeGoal: string;
  currentMilestoneLabel?: string | null;
  currentMilestoneGoal?: string | null;
  needsMilestoneGeneration?: boolean;
  generatingMilestones?: boolean;
  onGenerateMilestones?: () => void;
  writtenChapterCount: number;
  forecastLabel: string;
  completionPercent: number;
  runStatisticsSummary: BlueprintRunHealthSummary;
  blueprintHealthRecommendationLabel: string;
  blueprintHealthSummaryText: string;
  blueprintHealthScoreText: string;
  nextPlan: string[];
  hasWrittenChapters: boolean;
  canStartRun: boolean;
  isCompleted: boolean;
  isStopping: boolean;
  isStopped: boolean;
  isPaused: boolean;
  isInterrupted: boolean;
  isRunning: boolean;
  units: ChapterOutlineUnit[];
  onTriggerPrimaryRun: () => void;
}

export function ChapterOutlineGrid({
  projectId,
  storyLength,
  chapterPlanningMode,
  hardChapterCap,
  unitLabel,
  currentChapterNo,
  currentVolumeLabel,
  currentVolumeGoal,
  currentMilestoneLabel,
  currentMilestoneGoal,
  needsMilestoneGeneration,
  generatingMilestones,
  onGenerateMilestones,
  writtenChapterCount,
  forecastLabel,
  completionPercent,
  runStatisticsSummary,
  blueprintHealthRecommendationLabel,
  blueprintHealthSummaryText,
  blueprintHealthScoreText,
  nextPlan,
  hasWrittenChapters,
  canStartRun,
  isCompleted,
  isStopping,
  isStopped,
  isPaused,
  isInterrupted,
  isRunning,
  units,
  onTriggerPrimaryRun,
}: ChapterOutlineGridProps) {
  return (
    <section className="workspace-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-title">Outline Board</p>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
            查看章节推进情况，启动写作或进入具体章节。
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn-primary"
            disabled={!canStartRun}
            onClick={onTriggerPrimaryRun}
          >
            <Play className="h-4 w-4" />
            {isCompleted
              ? "项目已完成"
              : isStopping
                ? "停止中…"
                : isStopped
                  ? `从第 ${currentChapterNo} ${unitLabel === "章节" ? "章" : "单元"}重新启动`
                  : isPaused || isInterrupted
                    ? `从第 ${currentChapterNo} ${unitLabel === "章节" ? "章" : "单元"}恢复写作`
                    : `从第 ${currentChapterNo} ${unitLabel === "章节" ? "章" : "单元"}继续写`}
          </button>
          <Link href={`/projects/${projectId}/chapters/${currentChapterNo}`} className="btn-secondary">
            <BookOpenText className="h-4 w-4" />
            进入当前{unitLabel}
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="workspace-item active p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">已写章节</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">{writtenChapterCount}</p>
        </div>
        <div className="workspace-item active p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">当前卷</p>
          <p className="mt-3 text-lg font-semibold text-[var(--ink)]">{currentVolumeLabel}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{currentVolumeGoal}</p>
          {currentMilestoneGoal ? (
            <p className="mt-2 text-xs leading-6 text-[var(--ink-soft)]">
              {currentMilestoneLabel ? `${currentMilestoneLabel}：` : ""}{currentMilestoneGoal}
            </p>
          ) : null}
          {needsMilestoneGeneration && onGenerateMilestones ? (
            <button
              type="button"
              className="btn-secondary mt-3"
              disabled={generatingMilestones}
              onClick={onGenerateMilestones}
            >
              {generatingMilestones ? "生成中…" : "生成卷级里程碑"}
            </button>
          ) : null}
        </div>
        <div className="workspace-item active p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">预计范围</p>
          <p className="mt-3 text-lg font-semibold text-[var(--ink)]">{forecastLabel}</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
            {chapterPlanningMode === "dynamic" ? `安全上限 ${hardChapterCap ?? 1} 章` : "固定章节模式"}
          </p>
        </div>
        <div className="workspace-item active p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">完结进度</p>
          <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">{completionPercent}%</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
            {nextPlan[0] ?? "等待故事合同生成下一阶段目标。"}
          </p>
        </div>
      </div>

      <div className="mt-3 workspace-item active p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">蓝图健康</p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
              最近 {runStatisticsSummary.sampleCount}/{runStatisticsSummary.windowSize} 次蓝图样本，只做决策支持，不会自动改候选数。
            </p>
          </div>
          <StatusBadge
            status={
              runStatisticsSummary.recommendation === "safe_to_try_2"
                ? "completed"
                : runStatisticsSummary.recommendation === "keep_3"
                  ? "warn"
                  : "draft"
            }
          />
        </div>
        <p className="mt-3 text-base font-semibold text-[var(--ink)]">{blueprintHealthRecommendationLabel}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{blueprintHealthSummaryText}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{blueprintHealthScoreText}</p>
      </div>

      <div className="mt-3 workspace-item active p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">下一步计划</p>
        <div className="mt-3 grid gap-2">
          {nextPlan.length ? nextPlan.map((item, index) => (
            <p key={`${item}-${index}`} className="rounded-2xl bg-[var(--panel-soft)] px-3 py-2 text-sm leading-6 text-[var(--ink)]">
              {item}
            </p>
          )) : (
            <p className="text-sm leading-6 text-[var(--ink-soft)]">下一步计划会在每章完成后滚动刷新。</p>
          )}
        </div>
      </div>

      <div className="mt-3 workspace-item active p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">沉浸预览</p>
            <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
              把已写章节合成整卷，切到独立大界面里通读，不再挤在项目页里看小窗。
            </p>
          </div>
          {hasWrittenChapters ? (
            <Link href={`/projects/${projectId}/preview`} className="btn-primary">
              <BookOpenText className="h-4 w-4" />
              打开沉浸预览
            </Link>
          ) : null}
        </div>

        {!hasWrittenChapters ? (
          <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">写出至少一章正文后，就能打开整卷预览页。</p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
            <span className="workspace-pill px-3 py-1.5">共 {writtenChapterCount} 章</span>
            <span className="workspace-pill px-3 py-1.5">支持阅读版 / Markdown / TXT</span>
            <span className="workspace-pill px-3 py-1.5">独立整屏界面</span>
          </div>
        )}
      </div>

      {chapterPlanningMode === "dynamic" ? (
        <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
          动态模式下只展示已写内容和当前推进位置。
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {units.map((unit) => (
          <OutlineUnitCard
            key={unit.chapterNo}
            unit={unit}
            projectId={projectId}
            storyLength={storyLength}
            isRunning={isRunning}
          />
        ))}
      </div>
    </section>
  );
}
