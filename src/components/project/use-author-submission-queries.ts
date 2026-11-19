"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthorSubmissionFilters, AuthorSubmissionListItem } from "@/lib/types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string } } & T;
  if (!response.ok) throw new Error(payload.error?.message ?? "请求失败");
  return (payload.data ?? payload) as T;
}

export function useAuthorSubmissionQueries(projectId: string, filters: AuthorSubmissionFilters = {}) {
  const queryClient = useQueryClient();
  const filterKey = JSON.stringify(filters);
  const query = useQuery({
    queryKey: ["author-submissions", projectId, filterKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.chapterNo) params.set("chapterNo", String(filters.chapterNo));
      if (filters.status) params.set("status", filters.status);
      if (filters.source) params.set("source", filters.source);
      const suffix = params.size ? `?${params}` : "";
      return json<{ submissions: AuthorSubmissionListItem[] }>(`/api/projects/${projectId}/author-submissions${suffix}`);
    },
  });
  const invalidate = async (chapterNo?: number, submissionId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["author-submissions", projectId] }),
      submissionId ? queryClient.invalidateQueries({ queryKey: ["author-submission", projectId, submissionId] }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["progress", projectId] }),
      chapterNo ? queryClient.invalidateQueries({ queryKey: ["chapter", projectId, chapterNo] }) : Promise.resolve(),
    ]);
  };
  const action = useMutation({
    mutationFn: async (input: { submissionId: string; action: "review" | "approve"; body?: unknown; chapterNo: number }) => {
      const result = await json<unknown>(`/api/projects/${projectId}/author-submissions/${input.submissionId}/${input.action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body ?? {}),
      });
      return { result, ...input };
    },
    onSuccess: ({ submissionId, chapterNo }) => invalidate(chapterNo, submissionId),
  });
  return { query, action, invalidate };
}
