import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ManuscriptPreviewClient } from "@/components/manuscript-preview-client";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions } from "@tanstack/react-query";

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock("@/components/toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const useQueryMock = vi.mocked(useQuery);
type QueryMockOptions = UseQueryOptions<unknown, unknown, unknown, readonly unknown[]>;

function buildPreview(format: "md" | "txt") {
  return {
    title: "测试小说",
    format,
    generatedAt: "2026-06-11T00:00:00.000Z",
    chapterCount: 2,
    chapterNos: [1, 2],
    missingChapterNos: [],
    suggestedFileName: `novel.${format}`,
    content: "# 测试小说\n\n第一章正文",
    sections: [
      { chapterNo: 1, heading: "第一章 开端", paragraphs: ["段落一", "段落二"] },
      { chapterNo: 2, heading: "第二章 转折", paragraphs: ["段落三"] },
    ],
  };
}

function getLatestQueryOptions(format: "md" | "txt") {
  const calls = useQueryMock.mock.calls
    .map(([options]) => options as QueryMockOptions)
    .filter(
      (options) =>
        Array.isArray(options.queryKey)
        && options.queryKey[0] === "manuscript-preview-page"
        && options.queryKey[2] === format,
    );
  return calls[calls.length - 1];
}

describe("ManuscriptPreviewClient", () => {
  beforeEach(() => {
    useQueryMock.mockImplementation((options: QueryMockOptions) => {
      const data = typeof options.initialData === "function" ? undefined : options.initialData;
      return {
        data,
        isLoading: false,
        isError: false,
        error: null,
      } as unknown as ReturnType<typeof useQuery>;
    });
  });

  it("only enables the markdown query in reader mode and still renders the chapters", () => {
    render(
      <ManuscriptPreviewClient
        projectId="project-1"
        initialMarkdownPreview={buildPreview("md")}
        initialTextPreview={buildPreview("txt")}
      />,
    );

    // 全书 payload 体积大：reader/md 模式不应同时轮询 txt 全文。
    expect(getLatestQueryOptions("md")?.enabled).toBe(true);
    expect(getLatestQueryOptions("txt")?.enabled).toBe(false);

    // jsdom 没有 IntersectionObserver，懒挂载应回退为直接渲染段落。
    expect(screen.getByText("段落一")).toBeInTheDocument();
    expect(screen.getByText("段落三")).toBeInTheDocument();
  });

  it("flips the enabled flags when switching to the TXT view", () => {
    render(
      <ManuscriptPreviewClient
        projectId="project-1"
        initialMarkdownPreview={buildPreview("md")}
        initialTextPreview={buildPreview("txt")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "TXT" }));

    expect(getLatestQueryOptions("txt")?.enabled).toBe(true);
    expect(getLatestQueryOptions("md")?.enabled).toBe(false);
  });
});
