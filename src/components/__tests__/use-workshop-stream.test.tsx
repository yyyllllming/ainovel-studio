import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkshopActiveSession } from "@/lib/types";
import {
  useWorkshopStream,
  type UseWorkshopStreamOptions,
} from "@/components/foundation/use-workshop-stream";
import type { FoundationWorkshopResumeMode } from "@/components/foundation/use-foundation-workshop-controller-utils";

const toastMock = vi.fn();

vi.mock("@/components/toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// catch 分支会通过 fetchQuery 拉取最新快照判断是否还原输入框；这里让它失败走 restoreMessage。
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockRejectedValue(new Error("network down")),
}));

const failedSession: WorkshopActiveSession = {
  projectId: "project-1",
  sessionId: "session-1",
  status: "failed",
  stage: "replying",
  progress: 40,
  statusMessage: "生成中断",
  userMessage: "上一轮消息",
  assistantMessage: "已生成的一半回复",
  error: "boom",
  createdAt: "2026-04-06T10:00:00.000Z",
  updatedAt: "2026-04-06T10:00:08.000Z",
};

function jsonLineResponse(events: Array<Record<string, unknown>>) {
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function createHarness({
  getResumeMode = () => "auto",
  activeSession = null,
}: {
  getResumeMode?: () => FoundationWorkshopResumeMode;
  activeSession?: WorkshopActiveSession | null;
} = {}) {
  const apiRef: { current: ReturnType<typeof useWorkshopStream> | null } = { current: null };
  const draftHooks = {
    clearMessage: vi.fn(),
    restoreMessage: vi.fn(),
    setPendingUserMessage: vi.fn(),
    resetResumePreference: vi.fn(),
    getResumeMode,
  };
  const styleHooks = {
    buildStylePayload: vi.fn(),
    setStyleProgress: vi.fn(),
    resetStyleInputs: vi.fn(),
  } as unknown as UseWorkshopStreamOptions["styleHooks"];

  function Harness() {
    const api = useWorkshopStream({
      projectId: "project-1",
      draft: null,
      draftHooks,
      styleHooks,
      activeSession,
    });
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

  return { apiRef, draftHooks, styleHooks, view };
}

describe("useWorkshopStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits with resumeSessionId null when the live resume preference is discard", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonLineResponse([{ type: "final", progress: 100 }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRef } = createHarness({
      getResumeMode: () => "discard",
      activeSession: failedSession,
    });

    await act(async () => {
      await apiRef.current?.handleSendWorkshopMessage("继续推进", false);
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      message: "继续推进",
      resumeSessionId: null,
    });
  });

  it("submits with the recoverable sessionId when the resume preference stays auto", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonLineResponse([{ type: "final", progress: 100 }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRef } = createHarness({
      getResumeMode: () => "auto",
      activeSession: failedSession,
    });

    await act(async () => {
      await apiRef.current?.handleSendWorkshopMessage("继续推进", false);
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      message: "继续推进",
      resumeSessionId: "session-1",
    });
  });

  it("recovers the workshop UI when the stream closes without a final event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonLineResponse([{ type: "status", stage: "context", progress: 12, message: "整理中" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRef, draftHooks } = createHarness();

    await act(async () => {
      await apiRef.current?.handleSendWorkshopMessage("继续推进", false);
    });

    expect(toastMock).toHaveBeenCalledWith("设定流程未返回完成事件。", "error");
    expect(apiRef.current?.workshopProgress).toBeNull();
    expect(apiRef.current?.isLocalStreaming).toBe(false);
    expect(draftHooks.setPendingUserMessage).toHaveBeenLastCalledWith("");
    expect(draftHooks.restoreMessage).toHaveBeenCalledWith("继续推进");
  });

  it("recovers the style saving UI when the stream closes without a final event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonLineResponse([{ type: "status", stage: "context", progress: 10, message: "汇总中" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { apiRef, styleHooks } = createHarness();

    await act(async () => {
      await apiRef.current?.handleSaveStyleSteering(false);
    });

    expect(toastMock).toHaveBeenCalledWith("文风约束生成未返回完成事件。", "error");
    expect(styleHooks.setStyleProgress).toHaveBeenLastCalledWith(null);
  });
});
