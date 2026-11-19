"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import {
  buildProjectStructureSummary,
  type ChapterPlanningMode,
  type NarrativePerson,
  type PaceProfile,
  type SeriesMode,
  type StoryLength,
} from "@/lib/project-structure";
import { useConfirm } from "./confirm-dialog.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { useToast } from "./toast.tsx";

interface TrashedProject {
  id: string;
  title: string;
  genre: string;
  style: string;
  targetChapters: number;
  seriesMode: SeriesMode;
  seriesTitle: string | null;
  seriesIndex: number | null;
  storyLength: StoryLength;
  narrativePerson: NarrativePerson;
  chapterPlanningMode: ChapterPlanningMode;
  paceProfile: PaceProfile;
  completionCriteria: string;
  chapterBudgetMin: number;
  chapterBudgetTarget: number;
  chapterBudgetMax: number;
  hardChapterCap: number;
  hasVolumes: boolean;
  plannedVolumes: number | null;
  status: string;
  deletedAt: string;
}

export function TrashPanelClient() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [error, setError] = useState<string | null>(null);

  const trashQuery = useQuery({
    queryKey: ["trash"],
    queryFn: () => apiGet<{ projects: TrashedProject[] }>("/api/projects/trash"),
  });

  const restoreMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiPost(`/api/projects/${projectId}/restore`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setError(null);
      toast("项目已恢复", "success");
    },
    onError: (e: Error) => setError(e.message),
  });

  const purgeMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiPost(`/api/projects/${projectId}/purge`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setError(null);
      toast("项目已永久删除", "success");
    },
    onError: (e: Error) => setError(e.message),
  });

  const handlePurge = async (project: TrashedProject) => {
    const confirmed = await confirm({
      title: `永久删除「${project.title}」`,
      description:
        "此操作会彻底清除该项目的所有数据，包括章节正文、设定、卡片和审核记录。删除后将无法恢复。",
      confirmLabel: "永久删除",
      cancelLabel: "取消",
      variant: "danger",
    });
    if (confirmed) {
      purgeMutation.mutate(project.id);
    }
  };

  const projects = trashQuery.data?.projects ?? [];

  return (
    <section className="workspace-panel p-5">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-soft)]">Trash</p>
        <h2 className="mt-2 text-xl font-semibold [font-family:var(--font-serif)]">回收站</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">已删除的项目可在此恢复或永久清除。</p>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] px-4 py-2 text-sm text-[var(--danger)]">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline">关闭</button>
        </div>
      )}

      <div className="mt-5 grid gap-3">
        {trashQuery.isLoading && (
          <p className="text-sm text-[var(--ink-soft)]">加载中…</p>
        )}
        {projects.length === 0 && !trashQuery.isLoading && (
          <p className="text-sm text-[var(--ink-soft)]">回收站为空。</p>
        )}
        {projects.map((project) => (
          <div
            key={project.id}
            className="workspace-item active p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold">{project.title}</h3>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  {project.genre} · {buildProjectStructureSummary(project)}
                </p>
                <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">
                  删除于 {new Date(project.deletedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusBadge status={project.status} />
                <div className="flex gap-2">
                  <button
                    onClick={() => restoreMutation.mutate(project.id)}
                    disabled={restoreMutation.isPending}
                    className="rounded-xl bg-[var(--accent)]/10 px-3 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20 disabled:opacity-50"
                  >
                    恢复
                  </button>
                  <button
                    onClick={() => handlePurge(project)}
                    disabled={purgeMutation.isPending}
                    className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] px-3 py-1 text-xs text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] disabled:opacity-50"
                  >
                    永久删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
