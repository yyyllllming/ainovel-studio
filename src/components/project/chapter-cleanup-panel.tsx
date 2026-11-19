"use client";

import { Trash2 } from "lucide-react";
import { CollapsibleSection } from "@/components/collapsible-section";

interface ChapterCleanupPanelProps {
  manuscriptMaxChapter: number;
  deleteStartChapter: number;
  deleteEndChapter: number;
  disabled: boolean;
  isRunning: boolean;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
  onDeleteRange: () => void;
}

export function ChapterCleanupPanel({
  manuscriptMaxChapter,
  deleteStartChapter,
  deleteEndChapter,
  disabled,
  isRunning,
  onStartChange,
  onEndChange,
  onDeleteRange,
}: ChapterCleanupPanelProps) {
  return (
    <CollapsibleSection
      title="章节整理"
      eyebrow="Cleanup"
      description="删除指定章节区间后，正文、版本和审核记录会一起清除，写作位置退回起始章节。"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="form-label">开始章节</span>
          <input
            type="number"
            min={1}
            max={manuscriptMaxChapter}
            className="form-input"
            value={deleteStartChapter}
            onChange={(event) => onStartChange(Number(event.target.value) || 1)}
          />
        </label>
        <label className="grid gap-2">
          <span className="form-label">结束章节</span>
          <input
            type="number"
            min={deleteStartChapter}
            max={manuscriptMaxChapter}
            className="form-input"
            value={deleteEndChapter}
            onChange={(event) => onEndChange(Number(event.target.value) || deleteStartChapter)}
          />
        </label>
      </div>
      <button
        className="btn-ghost mt-4 w-full justify-center text-[var(--danger)]"
        disabled={disabled}
        onClick={onDeleteRange}
      >
        <Trash2 className="h-4 w-4" />
        删除章节区间
      </button>
      {isRunning ? (
        <p className="mt-3 text-sm text-[var(--ink-soft)]">正在写作时不能删除章节，请先暂停。</p>
      ) : null}
    </CollapsibleSection>
  );
}
