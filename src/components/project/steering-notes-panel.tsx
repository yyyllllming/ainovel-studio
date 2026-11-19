"use client";

import type { SteeringNote, SteeringNoteScope } from "@/lib/types";
import { CollapsibleSection } from "@/components/collapsible-section";

interface SteeringNotesPanelProps {
  scope: SteeringNoteScope;
  instruction: string;
  notes: SteeringNote[];
  pending: boolean;
  onScopeChange: (value: SteeringNoteScope) => void;
  onInstructionChange: (value: string) => void;
  onSave: () => void;
}

export function SteeringNotesPanel({
  scope,
  instruction,
  notes,
  pending,
  onScopeChange,
  onInstructionChange,
  onSave,
}: SteeringNotesPanelProps) {
  return (
    <CollapsibleSection
      title="追加指令"
      eyebrow="Steering"
      description="写作中途补的新要求默认收在这里，不再一路摊到底。"
    >
      <div className="grid gap-3">
        <label className="grid gap-2">
          <span className="form-label">作用范围</span>
          <select
            className="form-input"
            value={scope}
            onChange={(event) => onScopeChange(event.target.value as SteeringNoteScope)}
          >
            <option value="next_arc">只影响下一段剧情</option>
            <option value="current_volume">影响当前卷</option>
            <option value="persistent">持续生效</option>
          </select>
        </label>
        <label className="grid gap-2">
          <span className="form-label">新要求</span>
          <textarea
            className="form-input min-h-[120px] resize-none"
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            placeholder="例如：下一段剧情让主角主动做一次错误判断，别急着解释，让代价先发生。"
          />
        </label>
        <button
          className="btn-primary w-full justify-center"
          disabled={!instruction.trim() || pending}
          onClick={onSave}
        >
          {pending ? "保存中…" : "保存追加指令"}
        </button>
      </div>

      <div className="mt-4 grid gap-2">
        {notes.length ? notes.map((note) => (
          <div key={note.id} className="workspace-item active p-3 text-sm">
            <p className="font-semibold text-[var(--ink)]">
              {note.scope === "persistent" ? "持续指令" : note.scope === "current_volume" ? "当前卷指令" : "下一段指令"}
            </p>
            <p className="mt-2 leading-6 text-[var(--ink-soft)]">{note.instruction}</p>
          </div>
        )) : (
          <p className="text-sm text-[var(--ink-soft)]">当前没有额外追加指令。</p>
        )}
      </div>
    </CollapsibleSection>
  );
}
