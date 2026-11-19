import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useIdeaQueries } from "@/components/idea/use-idea-queries";

const toastMock = vi.fn();

vi.mock("@/components/toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

function createHarness() {
  const apiRef: { current: ReturnType<typeof useIdeaQueries> | null } = { current: null };

  function Harness() {
    const api = useIdeaQueries("idea-1");
    useEffect(() => {
      apiRef.current = api;
    });
    return null;
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );

  return { apiRef, view };
}

function neverEndingStreamResponse() {
  const stream = new ReadableStream<Uint8Array>({ start() {} });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

describe("useIdeaQueries workshop stream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts the in-flight workshop stream when the hook unmounts", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.signal) {
        signals.push(init.signal);
      }
      return neverEndingStreamResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { apiRef, view } = createHarness();

    act(() => {
      apiRef.current?.sendMutation.mutate({ message: "补一个新设定" });
    });
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]?.aborted).toBe(false);

    view.unmount();
    expect(signals[0]?.aborted).toBe(true);

    // 主动 abort 不应被当成错误向用户弹 toast。
    await act(async () => {});
    expect(toastMock).not.toHaveBeenCalledWith("想法共创未返回完成事件。", "error");
  });

  it("aborts the previous stream when a new message is sent", async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.signal) {
        signals.push(init.signal);
      }
      return neverEndingStreamResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const { apiRef } = createHarness();

    act(() => {
      apiRef.current?.sendMutation.mutate({ message: "第一条" });
    });
    await waitFor(() => expect(signals).toHaveLength(1));

    act(() => {
      apiRef.current?.sendMutation.mutate({ message: "第二条" });
    });
    await waitFor(() => expect(signals).toHaveLength(2));

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("still surfaces an error when the stream ends without a final event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"type":"status","stage":"context"}\n', {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRef } = createHarness();

    await act(async () => {
      await expect(
        apiRef.current?.sendMutation.mutateAsync({ message: "补一个新设定" }),
      ).rejects.toThrow("想法共创未返回完成事件。");
    });
  });
});
