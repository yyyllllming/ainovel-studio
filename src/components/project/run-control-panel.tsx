"use client";

import Link from "next/link";
import { Play, RotateCcw, Square, Trash2 } from "lucide-react";
import type {
  ProjectDetail,
  ProjectInvalidatedHistoryEntry,
  ProjectRunProgress,
  SteeringNote,
  SteeringNoteScope,
} from "@/lib/types";
import { getNarrativePersonLabel, type NarrativePerson } from "@/lib/project-structure";
import { CollapsibleSection } from "@/components/collapsible-section";
import { StatusBadge } from "@/components/status-badge";
import { ChapterCleanupPanel } from "./chapter-cleanup-panel.tsx";
import { SteeringNotesPanel } from "./steering-notes-panel.tsx";

interface RunControlPanelProps {
  projectId: string;
  activeTabLabel: string;
  project: ProjectDetail["project"] | undefined;
  progress: ProjectRunProgress | undefined;
  currentVolumeLabel: string;
  forecastLabel: string;
  completionPercent: number;
  activeSteeringNotes: SteeringNote[];
  invalidatedHistory: ProjectInvalidatedHistoryEntry[];
  latestLogs: Array<{ level: string; message: string; createdAt: string }>;
  cardStats: { total: number; confirmed: number; character: number; world: number };
  foundationStatusLabel: string;
  coreDrift: boolean;
  blockingReason: string | null;
  conflictCount: number;
  controlStateLabel: string;
  lastActiveStageLabel: string;
  heartbeatLabel: string;
  canStartRun: boolean;
  isRunning: boolean;
  isStopping: boolean;
  isStopped: boolean;
  isPaused: boolean;
  isInterrupted: boolean;
  isCompleted: boolean;
  hasWrittenChapters: boolean;
  nextHint: string;
  manuscriptMaxChapter: number;
  deleteStartChapter: number;
  deleteEndChapter: number;
  simpleMutationPending: boolean;
  steeringScope: SteeringNoteScope;
  steeringInstruction: string;
  effectiveNarrativePerson: NarrativePerson;
  saveNarrativePersonPending: boolean;
  steeringPending: boolean;
  novelExport: ProjectDetail["novelExport"] | undefined;
  onClose: () => void;
  onTriggerPrimaryRun: () => void;
  onPauseRun: () => void;
  onStopRun: () => void;
  onDeleteStartChange: (value: number) => void;
  onDeleteEndChange: (value: number) => void;
  onDeleteRange: () => void;
  onSteeringScopeChange: (value: SteeringNoteScope) => void;
  onSteeringInstructionChange: (value: string) => void;
  onSaveSteering: () => void;
  onNarrativePersonChange: (value: NarrativePerson) => void;
  onSaveNarrativePerson: () => void;
  onResetToFoundationWorkshop: () => void;
  onDeleteProject: () => void;
}

export function RunControlPanel({
  projectId,
  activeTabLabel,
  project,
  progress,
  currentVolumeLabel,
  forecastLabel,
  completionPercent,
  activeSteeringNotes,
  invalidatedHistory,
  latestLogs,
  cardStats,
  foundationStatusLabel,
  coreDrift,
  blockingReason,
  conflictCount,
  controlStateLabel,
  lastActiveStageLabel,
  heartbeatLabel,
  canStartRun,
  isRunning,
  isStopping,
  isStopped,
  isPaused,
  isInterrupted,
  isCompleted,
  hasWrittenChapters,
  nextHint,
  manuscriptMaxChapter,
  deleteStartChapter,
  deleteEndChapter,
  simpleMutationPending,
  steeringScope,
  steeringInstruction,
  effectiveNarrativePerson,
  saveNarrativePersonPending,
  steeringPending,
  novelExport,
  onClose,
  onTriggerPrimaryRun,
  onPauseRun,
  onStopRun,
  onDeleteStartChange,
  onDeleteEndChange,
  onDeleteRange,
  onSteeringScopeChange,
  onSteeringInstructionChange,
  onSaveSteering,
  onNarrativePersonChange,
  onSaveNarrativePerson,
  onResetToFoundationWorkshop,
  onDeleteProject,
}: RunControlPanelProps) {
  return (
    <div className="fixed right-0 top-0 z-40 h-screen w-80 overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] shadow-[var(--shadow-panel)]">
      <div className="sticky top-0 flex items-center justify-between border-b border-[var(--line)] bg-[var(--panel-muted)] px-5 py-4">
        <p className="font-semibold text-[var(--ink)]">项目信息</p>
        <button onClick={onClose} className="text-[var(--ink-soft)] hover:text-[var(--ink)]">
          ✕
        </button>
      </div>
      <div className="grid gap-4 p-5">
        <CollapsibleSection title="运行控制" eyebrow="Controls" defaultOpen>
          <div className="grid gap-3">
            {coreDrift && blockingReason ? (
              <div className="rounded-2xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-4 py-3 text-sm leading-6 text-[var(--ink)]">
                {blockingReason}
              </div>
            ) : null}
            <button
              className="btn-primary w-full justify-center"
              disabled={!canStartRun}
              onClick={onTriggerPrimaryRun}
            >
              <Play className="h-4 w-4" />
              {isStopping
                ? "停止中…"
                : isRunning
                  ? "写作中…"
                  : isCompleted
                    ? "项目已完成"
                    : isStopped
                      ? "重新启动写作"
                      : isPaused || isInterrupted
                        ? "恢复写作"
                        : "开始写作"}
            </button>
            {isRunning ? (
              <div className="grid gap-3">
                <button
                  className="btn-ghost w-full justify-center text-[var(--danger)]"
                  disabled={isStopping}
                  onClick={onPauseRun}
                >
                  <RotateCcw className="h-4 w-4" />
                  {isStopping ? "停止中…" : "暂停写作"}
                </button>
                <button
                  className="btn-ghost w-full justify-center text-[var(--danger)]"
                  disabled={isStopping}
                  onClick={onStopRun}
                >
                  <Square className="h-4 w-4" />
                  {isStopping ? "停止中…" : "停止写作"}
                </button>
              </div>
            ) : null}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="当前信息" eyebrow="Project" defaultOpen>
          <div className="grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">当前页签</span>
              <span className="font-semibold text-[var(--ink)]">{activeTabLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">当前单元</span>
              <span className="font-semibold text-[var(--ink)]">
                {project?.storyLength === "short" ? `正文单元 ${progress?.currentChapter ?? 1}` : `第 ${progress?.currentChapter ?? 1} 章`}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">控制状态</span>
              <span className="font-semibold text-[var(--ink)]">{controlStateLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">最近活跃阶段</span>
              <span className="font-semibold text-[var(--ink)]">{lastActiveStageLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">最后心跳</span>
              <span className="text-right font-semibold text-[var(--ink)]">
                {heartbeatLabel}
                {progress?.staleHeartbeat ? "（已过期）" : ""}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">规划模式</span>
              <span className="font-semibold text-[var(--ink)]">{project?.chapterPlanningMode === "dynamic" ? "动态估算" : "固定章节"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">叙事人称</span>
              <span className="font-semibold text-[var(--ink)]">
                {project ? getNarrativePersonLabel(project.narrativePerson) : "第三人称"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">当前卷</span>
              <span className="font-semibold text-[var(--ink)]">{currentVolumeLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">预计范围</span>
              <span className="font-semibold text-[var(--ink)]">{forecastLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">完结进度</span>
              <span className="font-semibold text-[var(--ink)]">{completionPercent}%</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">设定状态</span>
              <span className="font-semibold text-[var(--ink)]">{foundationStatusLabel}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">角色书</span>
              <span className="font-semibold text-[var(--ink)]">{cardStats.character}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[var(--ink-soft)]">世界书</span>
              <span className="font-semibold text-[var(--ink)]">{cardStats.world}</span>
            </div>
          </div>
        </CollapsibleSection>

        <ChapterCleanupPanel
          manuscriptMaxChapter={manuscriptMaxChapter}
          deleteStartChapter={deleteStartChapter}
          deleteEndChapter={deleteEndChapter}
          disabled={!project || simpleMutationPending || isRunning}
          isRunning={isRunning}
          onStartChange={onDeleteStartChange}
          onEndChange={onDeleteEndChange}
          onDeleteRange={onDeleteRange}
        />

        <CollapsibleSection
          title="失效历史"
          eyebrow="Timeline"
          description="窗口级重跑时，旧正文不会直接消失，会先归档到这里。"
        >
          <div className="grid gap-3">
            {invalidatedHistory.length ? invalidatedHistory.map((entry) => (
              <div key={entry.id} className="workspace-item active px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">第 {entry.chapterNo} 章旧时间线</p>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      窗口 {entry.rangeStartChapter}-{entry.rangeEndChapter}
                    </p>
                  </div>
                  <StatusBadge status="interrupted" />
                </div>
                <p className="mt-3 leading-6 text-[var(--ink-soft)]">{entry.reason}</p>
                {entry.reviewReason ? (
                  <p className="mt-2 leading-6 text-[var(--ink-soft)]">触发原因：{entry.reviewReason}</p>
                ) : null}
                <p className="mt-2 text-xs text-[var(--ink-soft)]">
                  {new Date(entry.invalidatedAt).toLocaleString("zh-CN")}
                </p>
              </div>
            )) : (
              <p className="text-sm text-[var(--ink-soft)]">当前还没有失效归档。</p>
            )}
          </div>
        </CollapsibleSection>

        <SteeringNotesPanel
          scope={steeringScope}
          instruction={steeringInstruction}
          notes={activeSteeringNotes}
          pending={steeringPending}
          onScopeChange={onSteeringScopeChange}
          onInstructionChange={onSteeringInstructionChange}
          onSave={onSaveSteering}
        />

        <CollapsibleSection title="连续性" eyebrow="Consistency">
          <div className="grid gap-3">
            <div className="workspace-item active px-4 py-3 text-sm">
              <p className="font-semibold text-[var(--ink)]">提醒</p>
              <p className="mt-2 text-[var(--ink-soft)]">{conflictCount} 条</p>
            </div>
            <div className="workspace-item active px-4 py-3 text-sm">
              <p className="font-semibold text-[var(--ink)]">已确认卡片</p>
              <p className="mt-2 text-[var(--ink-soft)]">{cardStats.confirmed} / {cardStats.total}</p>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="叙事设置"
          eyebrow="Voice"
          description="现有项目也可以改整部小说的人称，不必重新建项目。"
        >
          <div className="grid gap-3">
            <label className="grid gap-2">
              <span className="form-label">叙事人称</span>
              <select
                className="form-input"
                value={effectiveNarrativePerson}
                onChange={(event) => onNarrativePersonChange(event.target.value as NarrativePerson)}
              >
                <option value="third">第三人称</option>
                <option value="first">第一人称</option>
              </select>
            </label>
            <button
              className="btn-primary w-full justify-center"
              disabled={saveNarrativePersonPending || effectiveNarrativePerson === project?.narrativePerson}
              onClick={onSaveNarrativePerson}
            >
              {saveNarrativePersonPending ? "保存中…" : "保存叙事人称"}
            </button>
          </div>
        </CollapsibleSection>

        {latestLogs.length > 0 ? (
          <CollapsibleSection
            title="运行日志"
            eyebrow="Logs"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {latestLogs.length} 条
              </span>
            )}
          >
            <div className="grid gap-1">
              {latestLogs.map((log, index) => (
                <p
                  key={`${log.createdAt}-${index}`}
                  className={`font-mono text-[11px] leading-5 ${
                    log.level === "error"
                      ? "text-[var(--danger)]"
                      : log.level === "warn"
                        ? "text-[var(--warn)]"
                        : "text-[var(--ink-soft)]"
                  }`}
                >
                  {log.message}
                </p>
              ))}
            </div>
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection title="导出" eyebrow="Export">
          {hasWrittenChapters ? (
            <Link href={`/projects/${projectId}/preview`} className="btn-secondary mb-3 w-full justify-center">
              打开沉浸预览
            </Link>
          ) : null}
          {novelExport?.status === "ready" ? (
            <p className="break-all rounded-xl bg-[var(--panel-soft)] px-3 py-2 font-mono text-[11px] text-[var(--ink-soft)]">
              {novelExport.path}
            </p>
          ) : novelExport?.status === "failed" ? (
            <p className="text-sm text-[var(--danger)]">{novelExport.error ?? "导出失败"}</p>
          ) : (
            <p className="text-sm text-[var(--ink-soft)]">项目完成后会自动导出 TXT；写作过程中可直接进入独立沉浸预览页通读整卷。</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="小提示" eyebrow="Hint">
          <p className="text-sm leading-7 text-[var(--ink-soft)]">{nextHint}</p>
        </CollapsibleSection>

        <CollapsibleSection
          title="危险操作"
          eyebrow="Danger"
          description="这些操作会永久清理当前正文相关产物，请确认后再执行。"
        >
          <div className="grid gap-3">
            <button
              className="btn-ghost w-full justify-center text-[var(--danger)]"
              disabled={!project || simpleMutationPending || isRunning}
              onClick={onResetToFoundationWorkshop}
            >
              <RotateCcw className="h-4 w-4" />
              重置到设定工坊
            </button>
            <button
              className="btn-ghost w-full justify-center text-[var(--danger)]"
              onClick={onDeleteProject}
            >
              <Trash2 className="h-4 w-4" />
              删除项目
            </button>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
