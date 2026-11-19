import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import { routerRefreshMock } from "@/test/setup";
import { useFoundationQueries } from "@/components/foundation/use-foundation-queries";

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
type MutationMockOptions = UseMutationOptions<unknown, unknown, unknown, unknown>;

function Harness() {
  useFoundationQueries("project-1", null);
  return null;
}

describe("useFoundationQueries", () => {
  beforeEach(() => {
    useQueryMock.mockImplementation(() => ({
      data: undefined,
      state: { data: undefined },
    }) as unknown as ReturnType<typeof useQuery>);
    useMutationMock.mockImplementation((options: MutationMockOptions) => ({
      mutate: vi.fn(),
      isPending: false,
      options,
    }) as unknown as ReturnType<typeof useMutation>);
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      refetchQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useQueryClient>);
  });

  it("refreshes the page and actively refetches truth-source queries after foundation generation succeeds", async () => {
    render(<Harness />);

    const mutationOptions = useMutationMock.mock.calls.map(([options]) => options);
    const foundationMutationOptions = mutationOptions[0];
    if (!foundationMutationOptions?.onSuccess) {
      throw new Error("foundation mutation onSuccess should exist");
    }

    const queryClient = useQueryClientMock.mock.results[0]?.value as {
      invalidateQueries: ReturnType<typeof vi.fn>;
      refetchQueries: ReturnType<typeof vi.fn>;
    };

    await (foundationMutationOptions.onSuccess as (...args: unknown[]) => Promise<void>)(undefined, undefined, undefined, {});

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["foundation-workshop", "project-1"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["project", "project-1"] });
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({ queryKey: ["foundation-workshop", "project-1"], type: "active" });
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({ queryKey: ["project", "project-1"], type: "active" });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });
});
