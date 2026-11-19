import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { readJsonLineStream } from "@/lib/json-line-stream";
import type {
  ChapterPlanningMode,
  NarrativePerson,
  PaceProfile,
  SeriesMode,
  StoryLength,
} from "@/lib/project-structure";
import type { WorkshopStreamEvent } from "@/lib/types";
import type { PublicLlmProfile } from "@/server/types/settings";
import { useToast } from "../toast";

interface IdeaDetailPayload {
  idea: {
    id: string;
    title: string;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  state: {
    updatedAt: string;
    draft: {
      premise: string;
      mainline: string;
      storyHook: string;
      desiredTone: string;
      characterIdeas: Array<{ name: string; role: string; goal: string; traits: string[] }>;
      worldviewIdeas: Array<{ name: string; description: string }>;
      relationshipIdeas: Array<{ source: string; target: string; label: string }>;
      unresolvedQuestions: string[];
    };
  } | null;
  messages: Array<{
    id: string;
    role: "assistant" | "user";
    content: string;
    createdAt: string;
  }>;
  projects: Array<{
    id: string;
    title: string;
    genre: string;
    style: string;
    targetChapters: number;
    premise: string;
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
    sourceIdeaId: string | null;
    status: string;
    updatedAt: string;
    deletedAt: string | null;
  }>;
}

interface CreateProjectInput {
  title: string;
  genre: string;
  seriesMode: SeriesMode;
  seriesTitle: string;
  seriesIndex?: number;
  storyLength: StoryLength;
  narrativePerson: NarrativePerson;
  chapterPlanningMode: ChapterPlanningMode;
  hasVolumes: boolean;
  plannedVolumes?: number;
  paceProfile?: PaceProfile;
  completionCriteria: string;
  hardChapterCap?: number;
  targetChapters?: number;
  assignments: Array<{ role: string; profileId: string }>;
}

export interface UseIdeaQueriesResult {
  ideaQuery: UseQueryResult<IdeaDetailPayload, Error>;
  profilesQuery: UseQueryResult<{ profiles: PublicLlmProfile[] }, Error>;
  saveTitleMutation: UseMutationResult<void, Error, string>;
  sendMutation: UseMutationResult<void, Error, {
    message: string;
    baseUpdatedAt?: string;
    profileId?: string;
    onEvent?: (event: WorkshopStreamEvent) => Promise<void> | void;
  }>;
  trashMutation: UseMutationResult<void, Error, boolean>;
  createProjectMutation: UseMutationResult<{ project: { id: string } }, Error, CreateProjectInput>;
}

export function useIdeaQueries(ideaId: string, initialIdea?: IdeaDetailPayload) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 组件卸载或新请求开始时中止旧的 fetch / reader，避免流继续读取并向已卸载组件 setState。
  const sendAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      sendAbortRef.current?.abort();
    };
  }, []);

  const ideaQuery = useQuery({
    queryKey: ["idea", ideaId],
    queryFn: () => apiGet<IdeaDetailPayload>(`/api/ideas/${ideaId}`),
    initialData: initialIdea,
  });

  const profilesQuery = useQuery({
    queryKey: ["idea-llm-profiles"],
    queryFn: () => apiGet<{ profiles: PublicLlmProfile[] }>("/api/settings/llm-profiles"),
  });

  const saveTitleMutation = useMutation({
    mutationFn: (title: string) => apiPut(`/api/ideas/${ideaId}`, { title }),
    onSuccess: async () => {
      toast("想法标题已保存。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["idea", ideaId] }),
        queryClient.invalidateQueries({ queryKey: ["ideas"] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "保存标题失败", "error"),
  });

  const sendMutation = useMutation({
    mutationFn: async (
      {
        message,
        baseUpdatedAt,
        profileId,
        onEvent,
      }: {
        message: string;
        baseUpdatedAt?: string;
        profileId?: string;
        onEvent?: (event: WorkshopStreamEvent) => Promise<void> | void;
      },
    ) => {
      sendAbortRef.current?.abort();
      const abortController = new AbortController();
      sendAbortRef.current = abortController;
      const { signal } = abortController;

      try {
        const response = await fetch(`/api/ideas/${ideaId}/workshop?stream=1`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ainovel-stream": "1",
          },
          body: JSON.stringify({
            message,
            baseUpdatedAt,
            profileId,
          }),
          signal,
        });

        let sawFinal = false;
        await readJsonLineStream<WorkshopStreamEvent>(response, async (event) => {
          if (signal.aborted) {
            return;
          }
          if (event.type === "error") {
            throw new Error(event.error || "想法工作区更新失败");
          }

          if (event.type === "final") {
            sawFinal = true;
          }

          await onEvent?.(event);
        }, { signal });

        if (!sawFinal && !signal.aborted) {
          throw new Error("想法共创未返回完成事件。");
        }
      } catch (error) {
        // 由本 hook 主动 abort（卸载或新请求）引起的取消，不作为错误向上抛。
        if (signal.aborted) {
          return;
        }
        throw error;
      } finally {
        if (sendAbortRef.current === abortController) {
          sendAbortRef.current = null;
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["idea", ideaId] }),
        queryClient.invalidateQueries({ queryKey: ["ideas"] }),
      ]);
    },
    onError: async (error) => {
      toast(error instanceof Error ? error.message : "想法工作区更新失败", "error");
      await queryClient.invalidateQueries({ queryKey: ["idea", ideaId] });
    },
  });

  const trashMutation = useMutation({
    mutationFn: (deleted: boolean) => apiPut(`/api/ideas/${ideaId}`, { deleted }),
    onSuccess: async (_, deleted) => {
      toast(deleted ? "想法已移入回收站。" : "想法已恢复。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["idea", ideaId] }),
        queryClient.invalidateQueries({ queryKey: ["ideas"] }),
        queryClient.invalidateQueries({ queryKey: ["ideas", "trash"] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "更新想法状态失败", "error"),
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiPost<{ project: { id: string } }>(`/api/ideas/${ideaId}/projects`, input),
    onSuccess: async () => {
      toast("项目已从想法创建。", "success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["idea", ideaId] }),
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
      ]);
    },
    onError: (error) => toast(error instanceof Error ? error.message : "创建项目失败", "error"),
  });

  return {
    ideaQuery,
    profilesQuery,
    saveTitleMutation,
    sendMutation,
    trashMutation,
    createProjectMutation,
  };
}
