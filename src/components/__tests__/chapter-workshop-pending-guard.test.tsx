import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChapterWorkshopClient, type ChapterPayload } from "@/components/chapter-workshop-client";
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

const initialChapter: ChapterPayload = {
  chapterNo: 1,
  content: "已有正文",
  liveDraft: null,
  blueprint: null,
  versions: [
    {
      id: "version-1",
      versionNo: 1,
      temperature: 0.7,
      excerpt: "节选",
      selected: false,
    },
  ],
  reviews: [],
  reviewState: null,
  invalidatedHistory: [],
  run: {
    running: false,
    stage: "idle" as const,
    currentChapter: 1,
    currentPosition: 0,
    wordCount: 0,
    isCurrentChapter: false,
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

function setupMocks(isPending: boolean) {
  useQueryClientMock.mockReturnValue({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useQueryClient>);
  useMutationMock.mockImplementation(() => ({
    mutate: vi.fn(),
    isPending,
  }) as unknown as ReturnType<typeof useMutation>);
  useQueryMock.mockImplementation((options: QueryMockOptions) => {
    const data = typeof options.initialData === "function" ? undefined : options.initialData;
    return {
      data,
      state: { data },
    } as unknown as ReturnType<typeof useQuery>;
  });
}

function renderWorkshop(chapter = initialChapter) {
  render(
    <ChapterWorkshopClient
      projectId="project-1"
      chapterNo={1}
      initialChapter={chapter}
      initialConflicts={{ conflicts: [] }}
    />,
  );
}

describe("ChapterWorkshopClient pending guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables expensive action buttons while a mutation is in flight", () => {
    setupMocks(true);
    renderWorkshop();

    // 双击防抖：生成版本 / 生成 Patch / 回滚都不能在 pending 期间重复触发昂贵的 LLM 调用。
    expect(screen.getByRole("button", { name: "生成 3 个版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成 Patch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "回滚" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "应用 Patch" })).toBeDisabled();
  });

  it("keeps the buttons clickable when no mutation is pending", () => {
    setupMocks(false);
    renderWorkshop();

    expect(screen.getByRole("button", { name: "生成 3 个版本" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "生成 Patch" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "回滚" })).toBeEnabled();
    // 尚未生成 patch 时应用按钮保持禁用。
    expect(screen.getByRole("button", { name: "应用 Patch" })).toBeDisabled();
  });

  it("separates stale review history from current review results", () => {
    setupMocks(false);
    renderWorkshop({
      ...initialChapter,
      reviews: [
        {
          id: "review-current",
          submissionId: null,
          versionId: null,
          contentHash: "a".repeat(64),
          reviewerProfileId: "reviewer",
          promptHash: "b".repeat(64),
          reviewSchemaVersion: "quick-audit-v1",
          windowContentHash: null,
          stale: false,
          reviewMode: "quick" as const,
          verdict: "pass",
          confidence: 0.9,
          reason: "当前正文有效报告",
          fixInstructions: "无需返工",
          createdAt: new Date(0).toISOString(),
        },
        {
          id: "review-stale",
          submissionId: null,
          versionId: null,
          contentHash: "c".repeat(64),
          reviewerProfileId: "reviewer",
          promptHash: "d".repeat(64),
          reviewSchemaVersion: "quick-audit-v1",
          windowContentHash: null,
          stale: true,
          reviewMode: "quick" as const,
          verdict: "pass",
          confidence: 0.99,
          reason: "旧正文报告",
          fixInstructions: "旧建议",
          createdAt: new Date(0).toISOString(),
        },
      ],
    });

    expect(screen.getByText("1 条有效 · 1 条历史")).toBeInTheDocument();
    expect(screen.getByText("当前正文有效报告")).toBeInTheDocument();
    expect(screen.getByText("已失效（正文已变化） · quick")).toBeInTheDocument();
  });
});
