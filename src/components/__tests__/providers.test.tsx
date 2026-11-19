import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryFunction } from "@tanstack/react-query";
import { AppProviders } from "@/app/providers";

const capturedClientRef: { current: QueryClient | null } = { current: null };

function CaptureClient() {
  const client = useQueryClient();
  useEffect(() => {
    capturedClientRef.current = client;
  });
  return null;
}

function ProbeQuery({ queryKey, queryFn }: { queryKey: string[]; queryFn: QueryFunction<unknown> }) {
  useQuery({
    queryKey,
    queryFn,
    retry: false,
  });
  return null;
}

function ProbeMutation({ label, withLocalOnError }: { label: string; withLocalOnError: boolean }) {
  const mutation = useMutation({
    mutationFn: async () => {
      throw new Error(label);
    },
    ...(withLocalOnError ? { onError: () => undefined } : {}),
  });
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      trigger-{label}
    </button>
  );
}

describe("AppProviders error toasts", () => {
  it("toasts a first-load query failure once and dedupes repeated failures within the window", async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error("查询失败了"));
    render(
      <AppProviders>
        <CaptureClient />
        <ProbeQuery queryKey={["boom"]} queryFn={queryFn} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("查询失败了")).toHaveLength(1);
    });

    // 轮询/重试场景：同一查询同一错误在去重窗口内不再追加 toast。
    await act(async () => {
      await capturedClientRef.current?.refetchQueries({ queryKey: ["boom"] });
    });

    expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("查询失败了")).toHaveLength(1);
  });

  it("stays silent when a background refetch fails after data was already loaded", async () => {
    const queryFn = vi.fn()
      .mockResolvedValueOnce("ok")
      .mockRejectedValue(new Error("后台刷新失败"));

    render(
      <AppProviders>
        <CaptureClient />
        <ProbeQuery queryKey={["flaky"]} queryFn={queryFn} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await capturedClientRef.current?.refetchQueries({ queryKey: ["flaky"] });
    });

    expect(queryFn).toHaveBeenCalledTimes(2);
    // 已有数据可以继续展示，后台失败不该打断用户。
    expect(screen.queryByText("后台刷新失败")).not.toBeInTheDocument();
  });

  it("skips the global mutation toast when the mutation already handles onError locally", async () => {
    render(
      <AppProviders>
        <ProbeMutation label="局部错误" withLocalOnError />
        <ProbeMutation label="全局错误" withLocalOnError={false} />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole("button", { name: "trigger-局部错误" }));
    fireEvent.click(screen.getByRole("button", { name: "trigger-全局错误" }));

    // 没有局部 onError 的 mutation 仍由全局兜底弹一次。
    expect(await screen.findByText("全局错误")).toBeInTheDocument();
    expect(screen.getAllByText("全局错误")).toHaveLength(1);
    // 自带 onError 的 mutation 不再被全局重复弹错。
    expect(screen.queryByText("局部错误")).not.toBeInTheDocument();
  });
});
