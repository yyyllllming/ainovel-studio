import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import type {
  AuthorCardDetail,
  AuthorCardSummary,
  StyleReferenceCandidate,
  WorkshopActiveSession,
  WorkshopSnapshot,
} from "@/lib/types";
import { useState } from "react";
import { useToast } from "../toast";

export interface UseFoundationQueriesResult {
  workshopQuery: UseQueryResult<WorkshopSnapshot, Error>;
  authorCardsQuery: UseQueryResult<{ authors: AuthorCardSummary[] }, Error>;
  expandedAuthorQuery: UseQueryResult<AuthorCardDetail, Error>;
  foundationMutation: UseMutationResult<void, Error, void>;
  lockMutation: UseMutationResult<void, Error, void>;
  styleSearchMutation: UseMutationResult<
    { candidates: StyleReferenceCandidate[]; source: "network" | "mixed" | "ai_fallback" },
    Error,
    string
  >;
  structuredSuggestionsMutation: UseMutationResult<
    WorkshopSnapshot,
    Error,
    { action: "generate" | "refresh" | "apply" | "dismiss"; suggestionId?: string }
  >;
  applyAuthorCardMutation: UseMutationResult<void, Error, string>;
  applyBookCardMutation: UseMutationResult<void, Error, { authorCardId: string; bookCardId: string }>;
  styleCandidates: StyleReferenceCandidate[];
  styleSource: "network" | "mixed" | "ai_fallback" | null;
}

export function resolveFoundationWorkshopRefetchInterval(activeSession: WorkshopActiveSession | null | undefined) {
  return activeSession?.status === "running" ? 1500 : false;
}

export function useFoundationQueries(projectId: string, expandedAuthorId: string | null) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [styleCandidates, setStyleCandidates] = useState<StyleReferenceCandidate[]>([]);
  const [styleSource, setStyleSource] = useState<"network" | "mixed" | "ai_fallback" | null>(null);

  const workshopQuery = useQuery({
    queryKey: ["foundation-workshop", projectId],
    queryFn: () => apiGet<WorkshopSnapshot>(`/api/projects/${projectId}/foundation/workshop`),
    refetchInterval: (query) => resolveFoundationWorkshopRefetchInterval(query.state.data?.activeSession),
    refetchIntervalInBackground: true,
  });

  const authorCardsQuery = useQuery({
    queryKey: ["authors"],
    queryFn: () => apiGet<{ authors: AuthorCardSummary[] }>("/api/authors"),
  });

  const expandedAuthorQuery = useQuery({
    queryKey: ["author-card-selector", expandedAuthorId],
    queryFn: () => apiGet<AuthorCardDetail>(`/api/authors/${expandedAuthorId}`),
    enabled: Boolean(expandedAuthorId),
  });

  const foundationMutation = useMutation({
    mutationFn: () => apiPost(`/api/projects/${projectId}/foundation/generate`),
    onSuccess: async () => {
      toast("正式设定已同步。现在可以继续微调，确认无误后再开始写作。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
        queryClient.refetchQueries({ queryKey: ["foundation-workshop", projectId], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["project", projectId], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["progress", projectId], type: "active" }),
      ]);
      router.refresh();
    },
    onError: (error) => toast(error instanceof Error ? error.message : "整理正式设定失败", "error"),
  });

  const lockMutation = useMutation({
    mutationFn: () => apiPost(`/api/projects/${projectId}/foundation/lock`),
    onSuccess: async () => {
      toast("设定已锁定。下一步就可以生成蓝图和开始写作。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
        queryClient.refetchQueries({ queryKey: ["project", projectId], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["foundation-workshop", projectId], type: "active" }),
      ]);
      router.refresh();
    },
    onError: (error) => toast(error instanceof Error ? error.message : "锁定设定失败", "error"),
  });

  const styleSearchMutation = useMutation({
    mutationFn: (query: string) =>
      apiGet<{ candidates: StyleReferenceCandidate[]; source: "network" | "mixed" | "ai_fallback" }>(
        `/api/projects/${projectId}/foundation/style-search?query=${encodeURIComponent(query.trim())}`,
      ),
    onSuccess: ({ candidates, source }) => {
      setStyleCandidates(candidates);
      setStyleSource(source);
      toast("已更新文风候选。", "success");
    },
    onError: (error) => toast(error instanceof Error ? error.message : "搜索文风候选失败", "error"),
  });

  const structuredSuggestionsMutation = useMutation({
    mutationFn: (input: { action: "generate" | "refresh" | "apply" | "dismiss"; suggestionId?: string }) =>
      apiPost<WorkshopSnapshot>(`/api/projects/${projectId}/foundation/workshop/structured-suggestions`, input),
    onSuccess: async (_snapshot, input) => {
      const actionLabel = input.action === "generate"
        ? "已生成结构化建议。"
        : input.action === "refresh"
          ? "结构化建议已刷新。"
          : input.action === "apply"
            ? "建议已写回当前草稿。"
            : "建议已忽略。";
      toast(actionLabel, "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
        queryClient.refetchQueries({ queryKey: ["foundation-workshop", projectId], type: "active" }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "处理结构化建议失败", "error"),
  });

  const applyAuthorCardMutation = useMutation({
    mutationFn: (authorCardId: string) =>
      apiPost(`/api/projects/${projectId}/foundation/author-cards/${authorCardId}/apply`),
    onSuccess: async () => {
      toast("作者卡已应用到当前项目。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "应用作者卡失败", "error"),
  });

  const applyBookCardMutation = useMutation({
    mutationFn: (input: { authorCardId: string; bookCardId: string }) =>
      apiPost(`/api/authors/${input.authorCardId}/book-cards/${input.bookCardId}/apply`, { projectId }),
    onSuccess: async () => {
      toast("书级风格卡已应用到当前项目。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "应用书级风格卡失败", "error"),
  });

  return {
    workshopQuery,
    authorCardsQuery,
    expandedAuthorQuery,
    foundationMutation,
    lockMutation,
    styleSearchMutation,
    structuredSuggestionsMutation,
    applyAuthorCardMutation,
    applyBookCardMutation,
    styleCandidates,
    styleSource,
  };
}
