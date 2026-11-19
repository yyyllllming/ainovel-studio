"use client";

import { memo } from "react";
import type { SourceIdeaSummary } from "@/lib/types";

interface WorkshopHeaderProps {
  foundationLocked: boolean;
  readyToGenerate: boolean;
  sourceIdea?: SourceIdeaSummary | null;
}

function WorkshopHeaderImpl({ foundationLocked, readyToGenerate, sourceIdea }: WorkshopHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-soft)]">Foundation Workshop</p>
        <h2 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">设定工坊与正式设定工作区</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">
          先选文风参考，再进入设定整理；所有关键生成步骤都会给即时进度和实时内容反馈，避免只看到静态等待态。
        </p>
        {sourceIdea ? (
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--ink-soft)]">
            这是从想法库带进来的 seeded 项目。先选作者卡或文风，再把已有想法整理成正式设定，不用重新从零聊起。
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">Step 1 先定文风</span>
          <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">Step 2 整理设定</span>
          <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">Step 3 整理并锁定</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="workspace-pill px-3 py-1 text-xs text-[var(--ink-soft)]">
          {foundationLocked ? "已锁定" : readyToGenerate ? "可整理正式设定" : "整理中"}
        </span>
      </div>
    </div>
  );
}

export const WorkshopHeader = memo(WorkshopHeaderImpl);
