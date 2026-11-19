"use client";

import { useRef } from "react";
import Link from "next/link";
import { useVirtualizer } from "@tanstack/react-virtual";
import { StatusBadge } from "@/components/status-badge";

interface ChapterUnit {
  chapterNo: number;
  hasContent: boolean;
  hasConflict: boolean;
  isCurrent: boolean;
  reviewStatus: "provisional" | "deep_locked" | "manual_review" | null;
}

interface ProjectChapterListProps {
  projectId: string;
  projectStoryLength: "short" | "medium" | "long";
  units: ChapterUnit[];
  isRunning: boolean;
}

const VIRTUALIZE_THRESHOLD = 30;
const ESTIMATED_ROW_HEIGHT = 76;

export function ProjectChapterList({
  projectId,
  projectStoryLength,
  units,
  isRunning,
}: ProjectChapterListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = units.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: units.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 6,
    enabled: shouldVirtualize,
  });

  function renderRow(unit: ChapterUnit) {
    return (
      <Link
        href={`/projects/${projectId}/chapters/${unit.chapterNo}`}
        className="workspace-item active flex items-center justify-between px-4 py-3"
      >
        <div>
          <p className="text-sm font-semibold text-[var(--ink)]">
            {projectStoryLength === "short" ? `正文单元 ${unit.chapterNo}` : `第 ${unit.chapterNo} 章`}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-soft)]">
            {unit.reviewStatus === "manual_review"
              ? "等待人工确认"
              : unit.hasContent
                ? "已有正文"
                : unit.isCurrent
                  ? "当前推进位置"
                  : "待写作"}
          </p>
        </div>
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
                    : unit.isCurrent
                      ? "idle"
                      : "draft"
          }
        />
      </Link>
    );
  }

  if (!shouldVirtualize) {
    return (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
        <p className="section-title px-1">Manuscript</p>
        <div className="mt-3 grid gap-2">
          {units.map((unit) => (
            <div key={unit.chapterNo}>{renderRow(unit)}</div>
          ))}
        </div>
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
      <p className="section-title px-1">Manuscript</p>
      <div
        className="relative mt-3"
        style={{ height: totalSize }}
      >
        {items.map((virtualRow) => {
          const unit = units[virtualRow.index];
          if (!unit) {
            return null;
          }
          return (
            <div
              key={unit.chapterNo}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 pb-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderRow(unit)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
