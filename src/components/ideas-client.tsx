"use client";

import Link from "next/link";
import { Lightbulb, PlusCircle, RefreshCcw, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { BouncyTitle } from "./bouncy-title";
import { TaffyMark } from "./taffy-mark";
import { toneAt } from "./tone";
import { useToast } from "./toast.tsx";
import { useCardTilt } from "./use-card-tilt";
import { usePopReveal } from "./use-pop-reveal";

interface IdeaSummary {
  idea: {
    id: string;
    title: string;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  preview: string;
  updatedAt: string;
  projectCount: number;
}

export function IdeasClient({
  initialIdeas,
}: {
  initialIdeas?: { ideas: IdeaSummary[] };
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draftTitle, setDraftTitle] = useState("");
  const [showTrash, setShowTrash] = useState(false);

  const ideasQuery = useQuery({
    queryKey: ["ideas"],
    queryFn: () => apiGet<{ ideas: IdeaSummary[] }>("/api/ideas"),
    initialData: initialIdeas,
    refetchOnMount: false,
  });

  const trashQuery = useQuery({
    queryKey: ["ideas", "trash"],
    queryFn: () => apiGet<{ ideas: IdeaSummary[] }>("/api/ideas/trash"),
    enabled: showTrash,
  });

  const createMutation = useMutation({
    mutationFn: () => apiPost<{ idea: IdeaSummary }>("/api/ideas", { title: draftTitle.trim() }),
    onSuccess: async () => {
      setDraftTitle("");
      toast("想法已创建。", "success");
      await queryClient.invalidateQueries({ queryKey: ["ideas"] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "创建想法失败", "error"),
  });

  const restoreMutation = useMutation({
    mutationFn: (ideaId: string) => apiPut(`/api/ideas/${ideaId}`, { deleted: false }),
    onSuccess: async () => {
      toast("想法已恢复。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ideas"] }),
        queryClient.invalidateQueries({ queryKey: ["ideas", "trash"] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "恢复想法失败", "error"),
  });

  const ideas = ideasQuery.data?.ideas ?? [];
  const trashedIdeas = trashQuery.data?.ideas ?? [];

  const revealScope = useRef<HTMLDivElement>(null);
  usePopReveal(revealScope);
  useCardTilt(revealScope, [ideasQuery.data, showTrash]);

  return (
    <div ref={revealScope} className="min-h-screen w-full px-6 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section data-reveal className="workspace-panel candy-top overflow-hidden p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="section-title">Ideas</p>
              <BouncyTitle
                text="想法库"
                className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]"
              />
              <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
                先在这里把人物、世界观、主线和开场火花慢慢聊透，再从任意想法一键开项目，taffy 都帮你记着喵。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => createMutation.mutate()}
                className="btn-primary"
                disabled={createMutation.isPending}
              >
                <PlusCircle className="h-4 w-4" />
                {createMutation.isPending ? "创建中…" : "新建想法"}
              </button>
              <button
                onClick={() => setShowTrash((current) => !current)}
                className="btn-secondary"
              >
                <Trash2 className="h-4 w-4" />
                {showTrash ? "关闭回收站" : "打开回收站"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="workspace-item active p-4">
              <label className="form-label">新想法标题</label>
              <input
                className="form-input mt-2"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder="例如：会遗失记忆的骗子"
              />
              <p className="mt-3 text-sm text-[var(--ink-soft)]">
                不填也可以，系统会先用“未命名想法”占位，后面再改。
              </p>
            </div>
            <div className="workspace-item active p-4">
              <p className="section-title">Library</p>
              <p className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">{ideas.length}</p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">当前可继续补充的想法数</p>
            </div>
          </div>
        </section>

        {showTrash ? (
          <section className="workspace-panel anim-pop-in p-6">
            <div className="mb-5">
              <p className="section-title">Trash</p>
              <h2 className="mt-1 text-2xl font-semibold [font-family:var(--font-serif)]">想法回收站</h2>
            </div>
            <div className="grid gap-3">
              {trashedIdeas.length ? trashedIdeas.map((entry) => (
                <div key={entry.idea.id} className="workspace-item active px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-[var(--ink)]">{entry.idea.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                        {entry.preview || "这个想法还在等待继续补充。"}
                      </p>
                    </div>
                    <button
                      className="btn-ghost px-3 py-2 text-xs"
                      onClick={() => restoreMutation.mutate(entry.idea.id)}
                      disabled={restoreMutation.isPending}
                    >
                      <RefreshCcw className="h-3.5 w-3.5" />
                      恢复
                    </button>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-[var(--ink-soft)]">回收站里空空的喵。</p>
              )}
            </div>
          </section>
        ) : (
          <section className="anim-pop-in grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ideas.length ? ideas.map((entry, index) => (
              <Link
                key={entry.idea.id}
                href={`/ideas/${entry.idea.id}`}
                data-reveal-scroll
                data-tilt
                data-tone={toneAt(index)}
                className="workspace-panel tone-card flex flex-col p-6 hover:bg-[var(--panel-muted)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="section-title">Idea</p>
                    <h2 className="mt-2 line-clamp-2 text-xl font-semibold [font-family:var(--font-serif)]">
                      {entry.idea.title}
                    </h2>
                  </div>
                  <span className="workspace-pill shrink-0 px-3 py-1.5 text-xs text-[var(--ink-soft)]">
                    已开 {entry.projectCount} 个项目
                  </span>
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-7 text-[var(--ink-soft)]">
                  {entry.preview || "还没有沉淀出一句完整 premise，进去继续聊就好。"}
                </p>
                <div className="mt-auto flex items-center gap-2 pt-5 text-[var(--ink-soft)]">
                  <Lightbulb className="h-4 w-4 text-[var(--tone)]" />
                  <span className="font-mono text-[11px]">
                    更新于 {new Date(entry.updatedAt).toLocaleString("zh-CN")}
                  </span>
                </div>
              </Link>
            )) : (
              <section data-reveal className="workspace-panel p-10 text-center md:col-span-2 xl:col-span-3">
                <div className="mx-auto flex max-w-2xl flex-col items-center">
                  <div className="taffy-chip float-y mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-3xl">
                    <TaffyMark size={64} className="h-16 w-16" />
                  </div>
                  <h2 className="gradient-text text-3xl font-semibold [font-family:var(--font-serif)]">先把第一个想法留下来喵</h2>
                  <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">
                    以后你可以在想法区慢慢补，等时机成熟再从这里开项目，不用每次都在项目里重新讲一遍。
                  </p>
                </div>
              </section>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
