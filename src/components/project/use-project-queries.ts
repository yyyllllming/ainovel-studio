import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type {
  LlmProfile,
  ProjectCardSummary,
  ProjectDetail,
  ProjectRunProgress,
  SteeringNoteScope,
} from "@/lib/types";
import type { NarrativePerson } from "@/lib/project-structure";
import { useToast } from "../toast";

export type WorkspaceTab = "chat" | "characterBook" | "worldBook" | "outline" | "authorSubmissions" | "models";

interface SimpleMutationInput {
  url: string;
  body?: unknown;
  success: string;
  redirectTo?: string;
  invalidateFoundationWorkshop?: boolean;
  afterSuccess?: () => void | Promise<void>;
}

export interface UseProjectQueriesResult {
  snapshotQuery: UseQueryResult<ProjectDetail, Error>;
  progressQuery: UseQueryResult<ProjectRunProgress, Error>;
  profilesQuery: UseQueryResult<{ profiles: LlmProfile[] }, Error>;
  cardsQuery: UseQueryResult<{ cards: ProjectCardSummary[]; candidateCount: number }, Error>;
  simpleMutation: UseMutationResult<string, Error, SimpleMutationInput>;
  saveAssignmentsMutation: UseMutationResult<void, Error, Array<{ role: string; profileId: string }>>;
  saveReviewPolicyMutation: UseMutationResult<void, Error, {
    cadenceChapters: number;
    deepReviewStartChapter: number;
    manualCheckpointChapters: number[];
  }>;
  saveNarrativePersonMutation: UseMutationResult<void, Error, NarrativePerson>;
  steeringMutation: UseMutationResult<void, Error, { instruction: string; scope: SteeringNoteScope }>;
}

export function useProjectQueries(
  projectId: string,
  activeTab: WorkspaceTab,
  showRightPanel: boolean,
  initialSnapshot?: ProjectDetail | null,
  initialProgress?: ProjectRunProgress | null,
  initialProfiles?: { profiles: LlmProfile[] },
  initialCards?: { cards: ProjectCardSummary[]; candidateCount?: number },
) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const snapshotQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiGet<ProjectDetail>(`/api/projects/${projectId}`),
    initialData: initialSnapshot ?? undefined,
    refetchOnMount: "always",
    refetchInterval: 8000,
  });

  const progressQuery = useQuery({
    queryKey: ["progress", projectId],
    queryFn: () => apiGet<ProjectRunProgress>(`/api/projects/${projectId}/run/progress`),
    initialData: initialProgress ?? undefined,
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const progress = query.state.data as ProjectRunProgress | undefined;
      if (!progress) {
        return 5000;
      }
      if (progress.running) {
        return 2000;
      }
      if (progress.stage === "paused" || progress.stage === "interrupted" || progress.stage === "manual_review") {
        return 5000;
      }
      return 5000;
    },
  });

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: () => apiGet<{ profiles: LlmProfile[] }>("/api/settings/llm-profiles"),
    initialData: initialProfiles,
    enabled: activeTab === "models",
    refetchOnMount: false,
  });

  const cardsQuery = useQuery({
    // 卡片库页用 ["cards", projectId, { includeDraft: true }] 拉含草稿的全集，
    // 这里追加 "confirmed" 区分缓存；invalidate 仍用 ["cards", projectId] 前缀同时失效两者。
    queryKey: ["cards", projectId, "confirmed"],
    queryFn: () => apiGet<{ cards: ProjectCardSummary[]; candidateCount: number }>(`/api/projects/${projectId}/cards`),
    initialData: initialCards
      ? {
        cards: initialCards.cards,
        candidateCount: initialCards.candidateCount ?? 0,
      }
      : undefined,
    enabled: showRightPanel || activeTab === "characterBook" || activeTab === "worldBook",
    refetchOnMount: false,
  });

  const simpleMutation = useMutation({
    mutationFn: async (input: SimpleMutationInput) => {
      await apiPost(input.url, input.body);
      return input.success;
    },
    onSuccess: async (message, input) => {
      toast(message, "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["cards", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["trash"] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        input.invalidateFoundationWorkshop
          ? queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] })
          : Promise.resolve(),
      ]);
      if (input.afterSuccess) {
        await input.afterSuccess();
      }
      if (input.redirectTo) {
        router.push(input.redirectTo);
      }
    },
    onError: (error) => toast(error instanceof Error ? error.message : "操作失败", "error"),
  });

  const saveAssignmentsMutation = useMutation({
    mutationFn: (assignments: Array<{ role: string; profileId: string }>) =>
      apiPut(`/api/projects/${projectId}/assignments`, { assignments }),
    onSuccess: async () => {
      toast("模型分配已保存", "success");
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存失败", "error"),
  });

  const saveReviewPolicyMutation = useMutation({
    mutationFn: (source: {
      cadenceChapters: number;
      deepReviewStartChapter: number;
      manualCheckpointChapters: number[];
    }) => {
      const forceTriggers = snapshotQuery.data?.resolvedReviewPolicy.forceTriggers ?? [];
      return apiPut(`/api/projects/${projectId}`, {
        reviewPolicy: {
          cadenceChapters: source.cadenceChapters,
          deepReviewStartChapter: source.deepReviewStartChapter,
          perChapterCheckMode: "minimal",
          forceTriggers,
          manualCheckpointChapters: source.manualCheckpointChapters,
        },
      });
    },
    onSuccess: async () => {
      toast("深审策略已保存", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存失败", "error"),
  });

  const saveNarrativePersonMutation = useMutation({
    mutationFn: (narrativePerson: NarrativePerson) => apiPut(`/api/projects/${projectId}`, { narrativePerson }),
    onSuccess: async () => {
      toast("叙事人称已保存", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存叙事人称失败", "error"),
  });

  const steeringMutation = useMutation({
    mutationFn: (input: { instruction: string; scope: SteeringNoteScope }) =>
      apiPost(`/api/projects/${projectId}/steering-notes`, input),
    onSuccess: async () => {
      toast("追加指令已保存。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存追加指令失败", "error"),
  });

  return {
    snapshotQuery,
    progressQuery,
    profilesQuery,
    cardsQuery,
    simpleMutation,
    saveAssignmentsMutation,
    saveReviewPolicyMutation,
    saveNarrativePersonMutation,
    steeringMutation,
  };
}
