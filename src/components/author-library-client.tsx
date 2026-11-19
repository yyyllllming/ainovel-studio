"use client";

import { useMemo, useState } from "react";
import { PenTool } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { getEffectivePublicLlmProfileId, getUsablePublicLlmProfiles } from "@/lib/llm-profile";
import type { AuthorBookImportPreview, AuthorCardDetail, AuthorCardSummary } from "@/lib/types";
import { AuthorDetailPanel } from "@/components/author/author-detail-panel";
import { formatConfidence } from "@/components/author/author-utils";
import { LlmProfileSelector } from "@/components/llm-profile-selector";
import { useToast } from "@/components/toast";
import type { PublicLlmProfile } from "@/server/types/settings";

export function AuthorLibraryClient({
  initialAuthors,
  initialAuthorDetail,
  initialSelectedId,
}: {
  initialAuthors?: { authors: AuthorCardSummary[] };
  initialAuthorDetail?: AuthorCardDetail | null;
  initialSelectedId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [newAuthorName, setNewAuthorName] = useState("");
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([]);
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);
  const authorsQuery = useQuery({
    queryKey: ["authors"],
    queryFn: () => apiGet<{ authors: AuthorCardSummary[] }>("/api/authors"),
    initialData: initialAuthors,
    refetchOnMount: false,
  });

  const selectedAuthorId = selectedId ?? authorsQuery.data?.authors[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ["author-card", selectedAuthorId],
    queryFn: () => apiGet<AuthorCardDetail>(`/api/authors/${selectedAuthorId}`),
    enabled: Boolean(selectedAuthorId),
    initialData: selectedAuthorId && selectedAuthorId === initialSelectedId ? initialAuthorDetail ?? undefined : undefined,
    refetchOnMount: false,
  });

  const profilesQuery = useQuery({
    queryKey: ["author-library-llm-profiles"],
    queryFn: () => apiGet<{ profiles: PublicLlmProfile[] }>("/api/settings/llm-profiles"),
    refetchOnMount: false,
  });

  const usableProfiles = getUsablePublicLlmProfiles(profilesQuery.data?.profiles ?? []);

  const [selectedProfileId, setSelectedProfileId] = useState("");

  const effectiveProfileId = useMemo(() => {
    return getEffectivePublicLlmProfileId(selectedProfileId, usableProfiles);
  }, [selectedProfileId, usableProfiles]);

  const createAuthorMutation = useMutation({
    mutationFn: (displayName: string) =>
      apiPost<{ result: { card: AuthorCardSummary; created: boolean } }>("/api/authors", {
        action: "create",
        displayName,
      }),
    onSuccess: async ({ result }) => {
      setNewAuthorName("");
      setSelectedImportIds([]);
      setSelectedId(result.card.id);
      await queryClient.invalidateQueries({ queryKey: ["authors"] });
      await queryClient.invalidateQueries({ queryKey: ["author-card", result.card.id] });
      toast(result.created ? "作者卡已创建。" : "已存在同名作者卡，已直接切换过去。", "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "创建作者卡失败", "error"),
  });

  const uploadImportMutation = useMutation({
    mutationFn: async (input: { file: File; title?: string; author?: string }) => {
      if (!selectedAuthorId) {
        throw new Error("请先选择作者卡。");
      }

      const formData = new FormData();
      formData.append("file", input.file);
      if (input.title) {
        formData.append("title", input.title);
      }
      if (input.author) {
        formData.append("author", input.author);
      }

      const response = await fetch(`/api/authors/${selectedAuthorId}/imports`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json() as { import?: { id: string }; error?: string };
      if (!response.ok || !payload.import) {
        throw new Error(payload.error || "导入文本失败");
      }
      return payload.import;
    },
    onSuccess: async (payload) => {
      setSelectedImportIds((current) => Array.from(new Set([...current, payload.id])));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["author-card", selectedAuthorId] }),
        queryClient.invalidateQueries({ queryKey: ["authors"] }),
      ]);
      toast("文本已导入，现在可以生成书级风格卡。", "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "导入文本失败", "error"),
  });

  const previewBookImportMutation = useMutation({
    mutationFn: async (input: { file: File; title?: string; author?: string; encoding?: string }) => {
      if (!selectedAuthorId) {
        throw new Error("请先选择作者卡。");
      }

      const formData = new FormData();
      formData.append("file", input.file);
      if (input.title) {
        formData.append("title", input.title);
      }
      if (input.author) {
        formData.append("author", input.author);
      }
      if (input.encoding) {
        formData.append("encoding", input.encoding);
      }

      const response = await fetch(`/api/authors/${selectedAuthorId}/book-import/preview`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json() as {
        previewId?: string;
        preview?: AuthorBookImportPreview;
        needsEncodingChoice?: boolean;
        encodingCandidates?: string[];
        error?: string;
      } & Partial<AuthorBookImportPreview>;
      if (!response.ok) {
        throw new Error(payload.error || "创建拆书预览失败");
      }

      if (payload.needsEncodingChoice) {
        return {
          needsEncodingChoice: true,
          encodingCandidates: payload.encodingCandidates ?? [],
        };
      }

      const preview = payload.previewId
        ? {
            previewId: payload.previewId,
            title: payload.title ?? "",
            authorName: payload.authorName ?? "",
            originalFileName: payload.originalFileName ?? "",
            encoding: payload.encoding ?? "",
            parseConfidence: payload.parseConfidence ?? "medium",
            parserMode: payload.parserMode ?? "heading_relaxed",
            chapterCount: payload.chapterCount ?? 0,
            warnings: payload.warnings ?? [],
            samplePlan: payload.samplePlan ?? { indexes: [], skippedShort: [], total: 0 },
            chapters: payload.chapters ?? [],
          } satisfies AuthorBookImportPreview
        : null;

      if (!preview) {
        throw new Error("拆书预览返回为空");
      }

      return { preview };
    },
    onError: (error) => toast(error instanceof Error ? error.message : "创建拆书预览失败", "error"),
  });

  const applyBookImportMutation = useMutation({
    mutationFn: async (previewId: string) => {
      if (!selectedAuthorId) {
        throw new Error("请先选择作者卡。");
      }
      const profileId = effectiveProfileId;
      if (!profileId) {
        throw new Error("未找到可用的 LLM Profile，请先在设置页启用至少一个带 API Key 和默认模型的 Profile。");
      }
      return apiPost<{ status: "imported" | "completed"; importId: string; bookCardId?: string | null }>(
        `/api/authors/${selectedAuthorId}/book-import/apply`,
        { previewId, profileId },
      );
    },
    onSuccess: async (payload) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["author-card", selectedAuthorId] }),
        queryClient.invalidateQueries({ queryKey: ["authors"] }),
      ]);
      toast(
        payload.status === "completed"
          ? "拆书导入已完成，书级风格卡已生成。"
          : "文本已导入，但书卡生成失败。你可以稍后从导入列表继续生成。",
        payload.status === "completed" ? "success" : "info",
      );
    },
    onError: (error) => toast(error instanceof Error ? error.message : "确认拆书导入失败", "error"),
  });

  const deleteImportMutation = useMutation({
    mutationFn: async (importId: string) => {
      if (!selectedAuthorId) {
        throw new Error("请先选择作者卡。");
      }

      setDeletingImportId(importId);
      const response = await fetch(`/api/authors/${selectedAuthorId}/imports`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ importId }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "删除导入记录失败");
      }
    },
    onSuccess: async (_payload, importId) => {
      setSelectedImportIds((current) => current.filter((entry) => entry !== importId));
      await queryClient.invalidateQueries({ queryKey: ["author-card", selectedAuthorId] });
      toast("导入记录已删除。", "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "删除导入记录失败", "error"),
    onSettled: () => setDeletingImportId(null),
  });

  const generateBookCardsMutation = useMutation({
    mutationFn: () => {
      if (!selectedAuthorId) {
        throw new Error("请先选择作者卡。");
      }
      const profileId = effectiveProfileId;
      if (!profileId) {
        throw new Error("未找到可用的 LLM Profile，请先在设置页启用至少一个带 API Key 和默认模型的 Profile。");
      }
      return apiPost(`/api/authors/${selectedAuthorId}/book-cards`, {
        importIds: selectedImportIds,
        profileId,
      });
    },
    onSuccess: async () => {
      setSelectedImportIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["author-card", selectedAuthorId] }),
        queryClient.invalidateQueries({ queryKey: ["authors"] }),
      ]);
      toast("书级风格卡已生成。", "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "生成书级风格卡失败", "error"),
  });

  const mergeAuthorMutation = useMutation({
    mutationFn: () => {
      if (!selectedAuthorId) {
        throw new Error("请先选择作者卡。");
      }
      const profileId = effectiveProfileId;
      if (!profileId) {
        throw new Error("未找到可用的 LLM Profile，请先在设置页启用至少一个带 API Key 和默认模型的 Profile。");
      }
      return apiPost(`/api/authors/${selectedAuthorId}/merge`, { profileId });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["author-card", selectedAuthorId] }),
        queryClient.invalidateQueries({ queryKey: ["authors"] }),
      ]);
      toast("作者风格已重新合并。", "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "合并作者风格失败", "error"),
  });

  return (
    <div className="min-h-screen w-full px-6 py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="workspace-panel overflow-hidden p-8">
          <p className="section-title">Authors</p>
          <h1 className="mt-2 text-3xl font-semibold [font-family:var(--font-serif)]">全局作者卡库</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">
            作者卡页面现在就是统一创作入口。先新建作者，再导入文本、生成书级风格卡，最后合并成可被项目直接应用的 author 级风格。
          </p>
        </section>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="workspace-panel p-4">
            <div className="mb-4 flex items-center gap-2">
              <PenTool className="h-4 w-4 text-[var(--accent)]" />
              <h2 className="text-lg font-semibold">作者列表</h2>
            </div>

            <div className="grid gap-3 rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
              <input
                className="form-input"
                value={newAuthorName}
                onChange={(event) => setNewAuthorName(event.target.value)}
                placeholder="新建作者名"
              />
              <button
                type="button"
                className="btn-primary w-full justify-center"
                disabled={!newAuthorName.trim() || createAuthorMutation.isPending}
                onClick={() => createAuthorMutation.mutate(newAuthorName.trim())}
              >
                {createAuthorMutation.isPending ? "创建中…" : "新建作者"}
              </button>
            </div>

            <div className="mt-4 grid gap-2">
              {(authorsQuery.data?.authors ?? []).map((author) => (
                <button
                  key={author.id}
                  type="button"
                  className={`workspace-item p-4 text-left ${selectedAuthorId === author.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedImportIds([]);
                    setSelectedId(author.id);
                  }}
                >
                  <p className="font-semibold text-[var(--ink)]">{author.displayName}</p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {author.versionCount} 个 author 版本 · 最新置信度 {formatConfidence(author.latestConfidence)}
                  </p>
                </button>
              ))}
              {!authorsQuery.data?.authors.length ? (
                <p className="text-sm text-[var(--ink-soft)]">作者卡库还没有内容，先创建一个作者开始导入。</p>
              ) : null}
            </div>
          </aside>

          <div className="grid gap-4">
            <LlmProfileSelector
              title="书卡生成 / 作者合并模型"
              description="生成书级风格卡和合并作者风格时，都会使用这里选中的 Profile，不再默认取第一个可用配置。"
              usableProfiles={usableProfiles}
              selectedProfileId={effectiveProfileId}
              profilesLoading={profilesQuery.isLoading}
              onProfileChange={setSelectedProfileId}
            />

            <AuthorDetailPanel
              detail={detailQuery.data ?? null}
              selectedImportIds={selectedImportIds}
              uploadPending={uploadImportMutation.isPending}
              bookImportPreviewPending={previewBookImportMutation.isPending}
              bookImportApplyPending={applyBookImportMutation.isPending}
              generatePending={generateBookCardsMutation.isPending}
              mergePending={mergeAuthorMutation.isPending}
              deletingImportId={deletingImportId}
              onToggleImport={(importId) =>
                setSelectedImportIds((current) =>
                  current.includes(importId)
                    ? current.filter((entry) => entry !== importId)
                    : [...current, importId],
                )}
              onUpload={(input) => uploadImportMutation.mutateAsync(input).then(() => undefined)}
              onCreateBookImportPreview={(input) => previewBookImportMutation.mutateAsync(input)}
              onApplyBookImportPreview={(previewId) => applyBookImportMutation.mutateAsync(previewId).then(() => undefined)}
              onDeleteImport={(importId) => deleteImportMutation.mutateAsync(importId).then(() => undefined)}
              onGenerateSelected={() => generateBookCardsMutation.mutateAsync().then(() => undefined)}
              onMerge={() => mergeAuthorMutation.mutate()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
