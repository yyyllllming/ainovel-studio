/**
 * ChapterBlueprint — 章节蓝图展示组件
 * 从 chapter-workshop-client.tsx 提取
 */

import type { ChapterPayload } from "../chapter-workshop-client";

interface ChapterBlueprintProps {
  blueprint: ChapterPayload["blueprint"];
}

export function ChapterBlueprint({ blueprint }: ChapterBlueprintProps) {
  if (!blueprint) {
    return (
      <div className="workspace-item active p-4">
        <p className="text-sm text-[var(--ink-soft)]">当前章节尚未生成蓝图。</p>
      </div>
    );
  }

  return (
    <div className="workspace-item active p-4">
      <h3 className="text-sm font-semibold text-[var(--ink)]">第 {blueprint.chapterNo} 章蓝图</h3>
      <div className="mt-4 grid gap-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Scene Goal</p>
          <p className="mt-1 leading-6 text-[var(--ink)]">{blueprint.sceneGoal}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Characters</p>
          <p className="mt-1 leading-6 text-[var(--ink)]">{blueprint.characters.join("、") || "无"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Locations</p>
          <p className="mt-1 leading-6 text-[var(--ink)]">{blueprint.locations.join("、") || "无"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Conflicts</p>
          <p className="mt-1 leading-6 text-[var(--ink)]">{blueprint.conflicts.join("、") || "无"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Foreshadows</p>
          <p className="mt-1 leading-6 text-[var(--ink)]">{blueprint.foreshadows.join("、") || "无"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Emotional Tone</p>
          <p className="mt-1 leading-6 text-[var(--ink)]">{blueprint.emotionalTone}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Estimated Words</p>
          <p className="mt-1 leading-6 text-[var(--ink)]">{blueprint.estimatedWords} 字</p>
        </div>
      </div>
    </div>
  );
}
