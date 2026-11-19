import { describe, expect, it, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChapterWorkshopClient } from "@/components/chapter-workshop-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
    useQueryClient: vi.fn(),
  };
});

const useQueryMock = vi.mocked(useQuery);
const useMutationMock = vi.mocked(useMutation);
const useQueryClientMock = vi.mocked(useQueryClient);
type QueryMockOptions = UseQueryOptions<unknown, unknown, unknown, readonly unknown[]>;

const initialChapter = {
  chapterNo: 1,
  content: null,
  liveDraft: null,
  blueprint: null,
  versions: [],
  reviews: [],
  reviewState: null,
  invalidatedHistory: [],
  run: {
    running: false,
    stage: "idle" as const,
    currentChapter: 1,
    currentPosition: 0,
    wordCount: 0,
    isCurrentChapter: true,
    isStreaming: false,
  },
  manualReview: {
    awaiting: false,
    reason: null,
    canApprove: false,
    canAutoPick: false,
    isLastChapter: false,
    earliestAffectedChapter: null,
    requiresWindowRestart: false,
  },
};

describe("ChapterWorkshopClient refresh policy", () => {
  beforeEach(() => {
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useQueryClient>);
    useMutationMock.mockImplementation(() => ({
      mutate: vi.fn(),
      isPending: false,
    }) as unknown as ReturnType<typeof useMutation>);
    useQueryMock.mockImplementation((options: QueryMockOptions) => {
      const data = typeof options.initialData === "function" ? undefined : options.initialData;
      return {
        data,
        state: { data },
      } as unknown as ReturnType<typeof useQuery>;
    });
  });

  it("refetches stale chapter data on remount and keeps the current chapter polling", () => {
    render(
      <ChapterWorkshopClient
        projectId="project-1"
        chapterNo={1}
        initialChapter={initialChapter}
        initialConflicts={{ conflicts: [] }}
      />,
    );

    const chapterQueryOptions = useQueryMock.mock.calls
      .map(([options]) => options)
      .find((options) => Array.isArray(options.queryKey) && options.queryKey[0] === "chapter");
    const refetchInterval = chapterQueryOptions?.refetchInterval;

    // 不再关闭 refetchOnMount：非当前章节的缓存条目重挂载时要能后台重拉，
    // 否则 Runner 推进后重访章节会永远停在过期状态。
    expect(chapterQueryOptions?.refetchOnMount).toBeUndefined();
    expect(chapterQueryOptions?.staleTime).toBe(5_000);
    expect(typeof refetchInterval).toBe("function");
    if (typeof refetchInterval !== "function") {
      throw new Error("chapter query should provide a polling policy");
    }
    expect(
      refetchInterval({
        state: {
          data: initialChapter,
        },
      } as Parameters<typeof refetchInterval>[0]),
    ).toBe(5000);
    expect(
      refetchInterval({
        state: {
          data: {
            ...initialChapter,
            run: {
              ...initialChapter.run,
              running: true,
              stage: "writing",
              isStreaming: true,
            },
          },
        },
      } as Parameters<typeof refetchInterval>[0]),
    ).toBe(1000);
    // 非当前章节不轮询，刷新依赖 refetchOnMount 默认行为。
    expect(
      refetchInterval({
        state: {
          data: {
            ...initialChapter,
            run: {
              ...initialChapter.run,
              isCurrentChapter: false,
            },
          },
        },
      } as Parameters<typeof refetchInterval>[0]),
    ).toBe(false);
  });

  it("lets stale chapter conflicts refresh on remount as well", () => {
    render(
      <ChapterWorkshopClient
        projectId="project-1"
        chapterNo={1}
        initialChapter={initialChapter}
        initialConflicts={{ conflicts: [] }}
      />,
    );

    const conflictQueryOptions = useQueryMock.mock.calls
      .map(([options]) => options)
      .find((options) => Array.isArray(options.queryKey) && options.queryKey[0] === "chapter-conflicts");

    expect(conflictQueryOptions?.refetchOnMount).toBeUndefined();
    expect(conflictQueryOptions?.staleTime).toBe(5_000);
  });
});
