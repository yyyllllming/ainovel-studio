import { describe, expect, it, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useProjectQueries } from "@/components/project/use-project-queries";
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

vi.mock("@/components/toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const useQueryMock = vi.mocked(useQuery);
const useMutationMock = vi.mocked(useMutation);
const useQueryClientMock = vi.mocked(useQueryClient);
type QueryMockOptions = UseQueryOptions<unknown, unknown, unknown, readonly unknown[]>;

function Harness() {
  useProjectQueries(
    "project-1",
    "outline",
    false,
    {
      runState: {
        stage: "idle",
      },
    } as never,
    {
      running: false,
      stage: "idle",
    } as never,
  );
  return null;
}

describe("useProjectQueries refresh policy", () => {
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

  it("forces project snapshot and progress queries to refresh on mount", () => {
    render(<Harness />);

    const calls = useQueryMock.mock.calls.map(([options]) => options);
    const snapshotQueryOptions = calls.find((options) => Array.isArray(options.queryKey) && options.queryKey[0] === "project");
    const progressQueryOptions = calls.find((options) => Array.isArray(options.queryKey) && options.queryKey[0] === "progress");

    expect(snapshotQueryOptions?.refetchOnMount).toBe("always");
    expect(progressQueryOptions?.refetchOnMount).toBe("always");
  });

  it("scopes the confirmed-only cards cache away from the card library's includeDraft cache", () => {
    render(<Harness />);

    const cardsQueryOptions = useQueryMock.mock.calls
      .map(([options]) => options)
      .find((options) => Array.isArray(options.queryKey) && options.queryKey[0] === "cards");

    // 卡片库页用 ["cards", projectId, { includeDraft: true }]；两个 queryFn 不能共用同一条缓存。
    expect(cardsQueryOptions?.queryKey).toEqual(["cards", "project-1", "confirmed"]);
  });

  it("keeps progress polling even when the initial payload says idle", () => {
    render(<Harness />);

    const progressQueryOptions = useQueryMock.mock.calls
      .map(([options]) => options)
      .find((options) => Array.isArray(options.queryKey) && options.queryKey[0] === "progress");
    const refetchInterval = progressQueryOptions?.refetchInterval;

    expect(typeof refetchInterval).toBe("function");
    if (typeof refetchInterval !== "function") {
      throw new Error("progress query should provide a polling policy");
    }
    expect(
      refetchInterval({
        state: {
          data: {
            running: false,
            stage: "idle",
          },
        },
      } as Parameters<typeof refetchInterval>[0]),
    ).toBe(5000);
  });
});
