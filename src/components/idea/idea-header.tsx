"use client";

import Link from "next/link";
import { ArrowLeft, PlusCircle, Save, Trash2 } from "lucide-react";
import { LlmProfileSelector } from "@/components/llm-profile-selector";

interface IdeaHeaderProps {
  ideaTitle: string | null;
  titleValue: string;
  onTitleChange: (value: string) => void;
  saveTitleDisabled: boolean;
  saveTitlePending: boolean;
  onSaveTitle: () => void;
  showCreateProject: boolean;
  onToggleCreateProject: () => void;
  trashPending: boolean;
  onTrash: () => void;
  projectsCount: number;
  usableProfiles: Array<{ id: string; name: string; defaultModel: string }>;
  selectedProfileId: string;
  profilesLoading: boolean;
  onProfileChange: (value: string) => void;
}

export function IdeaHeader({
  ideaTitle,
  titleValue,
  onTitleChange,
  saveTitleDisabled,
  saveTitlePending,
  onSaveTitle,
  showCreateProject,
  onToggleCreateProject,
  trashPending,
  onTrash,
  projectsCount,
  usableProfiles,
  selectedProfileId,
  profilesLoading,
  onProfileChange,
}: IdeaHeaderProps) {
  return (
    <section className="workspace-panel overflow-hidden p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <Link href="/" className="btn-ghost w-fit">
            <ArrowLeft className="h-4 w-4" />
            返回想法库
          </Link>
          <p className="section-title mt-5">Idea Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">{ideaTitle ?? "载入中"}</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
            先在这里慢慢把想法沉淀下来。等你觉得差不多了，再从这份想法直接开项目。
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={onToggleCreateProject}>
            <PlusCircle className="h-4 w-4" />
            {showCreateProject ? "收起建项表单" : "从这个想法开项目"}
          </button>
          <button className="btn-secondary" disabled={trashPending} onClick={onTrash}>
            <Trash2 className="h-4 w-4" />
            移入回收站
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="workspace-item active p-4">
          <label className="form-label">想法标题</label>
          <div className="mt-2 flex gap-3">
            <input className="form-input flex-1" value={titleValue} onChange={(event) => onTitleChange(event.target.value)} />
            <button className="btn-secondary" disabled={saveTitleDisabled || saveTitlePending} onClick={onSaveTitle}>
              <Save className="h-4 w-4" />
              保存
            </button>
          </div>
        </div>
        <div className="workspace-item active p-4">
          <p className="section-title">Projects</p>
          <p className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">{projectsCount}</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">从这份想法开出的项目数</p>
        </div>
      </div>

      <LlmProfileSelector
        className="mt-4 workspace-item active p-4"
        title="聊想法用的模型"
        description="这边选的模型只负责陪你聊想法，下面建项目时再另说。"
        usableProfiles={usableProfiles}
        selectedProfileId={selectedProfileId}
        profilesLoading={profilesLoading}
        onProfileChange={onProfileChange}
      />
    </section>
  );
}
