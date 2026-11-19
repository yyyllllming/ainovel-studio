/**
 * useWorkshopStream — 管理 Foundation Workshop 的流式生成与 Style Steering 保存。
 * 从 use-foundation-workshop-controller.tsx 提取。
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { readJsonLineStream } from "@/lib/json-line-stream";
import { apiGet } from "@/lib/api";
import type {
  StreamProgressState,
  StyleStreamEvent,
  StyleStreamProgressState,
  WorkshopSnapshot,
  WorkshopStreamEvent,
} from "@/lib/types";
import { useToast } from "../toast";
import { useStreamRenderer } from "../use-stream-renderer";
import {
  buildFoundationWorkshopRequestPayload,
  type FoundationWorkshopResumeMode,
} from "./use-foundation-workshop-controller-utils";
import type { UseFoundationDraftOptions } from "./use-foundation-draft";
import type { UseStyleReferencesOptions } from "./use-style-references";

export interface UseWorkshopStreamOptions {
  projectId: string;
  draft: UseStyleReferencesOptions["draft"];
  draftHooks: {
    clearMessage: () => void;
    restoreMessage: (text: string) => void;
    setPendingUserMessage: (value: string) => void;
    resetResumePreference: () => void;
    /** 提交时实时读取 resume 偏好（draftHook 在本 hook 之后声明，用回调解环）。 */
    getResumeMode: () => FoundationWorkshopResumeMode;
  };
  styleHooks: {
    buildStylePayload: () => ReturnType<ReturnType<typeof import("./use-style-references").useStyleReferences>["buildStylePayload"]>;
    setStyleProgress: (value: StyleStreamProgressState | null | ((current: StyleStreamProgressState | null) => StyleStreamProgressState | null)) => void;
    resetStyleInputs: () => void;
  };
  activeSession: UseFoundationDraftOptions["activeSession"];
}

export function useWorkshopStream({
  projectId,
  draft,
  draftHooks,
  styleHooks,
  activeSession,
}: UseWorkshopStreamOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [workshopProgress, setWorkshopProgress] = useState<StreamProgressState | null>(null);
  const [nextFocus, setNextFocus] = useState<string | null>(null);

  const {
    renderedText: streamingAssistantMessage,
    reset: resetStreamRenderer,
    pushDelta,
    flush: flushStreamRenderer,
  } = useStreamRenderer();

  const isLocalStreaming = Boolean(workshopProgress);

  // 组件卸载或新请求开始时中止旧的 fetch / reader，避免 setState on unmounted。
  const isMountedRef = useRef(true);
  const workshopAbortRef = useRef<AbortController | null>(null);
  const styleAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      workshopAbortRef.current?.abort();
      styleAbortRef.current?.abort();
    };
  }, []);
  const safeSetWorkshopProgress: typeof setWorkshopProgress = (value) => {
    if (!isMountedRef.current) return;
    setWorkshopProgress(value);
  };
  const safeSetNextFocus: typeof setNextFocus = (value) => {
    if (!isMountedRef.current) return;
    setNextFocus(value);
  };

  async function handleSendWorkshopMessage(message: string, foundationLocked: boolean) {
    const outgoingMessage = message.trim();
    if (!outgoingMessage || foundationLocked || isLocalStreaming) {
      return;
    }

    draftHooks.setPendingUserMessage(outgoingMessage);
    resetStreamRenderer();
    safeSetWorkshopProgress({
      stage: "context",
      progress: 8,
      message: "已收到你的想法，正在整理当前设定上下文。",
    });
    draftHooks.clearMessage();

    workshopAbortRef.current?.abort();
    const abortController = new AbortController();
    workshopAbortRef.current = abortController;
    const { signal } = abortController;

    try {
      const payload = buildFoundationWorkshopRequestPayload({
        message: outgoingMessage,
        activeSession,
        resumeMode: draftHooks.getResumeMode(),
      });
      draftHooks.resetResumePreference();

      const response = await fetch(`/api/projects/${projectId}/foundation/workshop?stream=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ainovel-stream": "1",
        },
        body: JSON.stringify(payload),
        signal,
      });

      let sawFinal = false;
      await readJsonLineStream<WorkshopStreamEvent>(response, async (event) => {
        if (signal.aborted || !isMountedRef.current) {
          return;
        }
        if (event.type === "error") {
          throw new Error(event.error || "工作区更新失败");
        }

        if (event.type === "status") {
          safeSetWorkshopProgress((current) => ({
            stage: event.stage ?? current?.stage ?? "running",
            progress: event.progress ?? current?.progress ?? 0,
            message: event.message ?? current?.message ?? "设定流程正在处理中。",
          }));
          return;
        }

        if (event.type === "assistant_delta") {
          pushDelta(event.delta ?? "", { replace: event.replace });
          safeSetWorkshopProgress((current) => current
            ? {
                ...current,
                progress: event.progress ?? current.progress,
              }
            : {
                stage: "replying",
                progress: event.progress ?? 28,
                message: "设定流程开始整理回复。",
              });
          return;
        }

        if (event.type === "final") {
          sawFinal = true;
          flushStreamRenderer();
          if (typeof event.nextFocus === "string") {
            safeSetNextFocus(event.nextFocus);
          }
          safeSetWorkshopProgress({
            stage: "done",
            progress: event.progress ?? 100,
            message: "工作草案已同步完成。",
          });
          toast("设定流程已更新工作草案。", "success");
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
            queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
          ]);
          draftHooks.setPendingUserMessage("");
          resetStreamRenderer();
          safeSetWorkshopProgress(null);
        }
      }, { signal });
      // 流被干净关闭却没发 final（如服务端崩溃后 EOF）时，走 catch 统一恢复 UI，
      // 避免 workshopProgress 永久非空导致输入区锁死。
      if (!sawFinal) {
        throw new Error("设定流程未返回完成事件。");
      }
    } catch (error) {
      // 由本组件主动 abort 引起的取消，不再处理 UI 状态
      if (signal.aborted || !isMountedRef.current) {
        return;
      }
      draftHooks.setPendingUserMessage("");
      resetStreamRenderer();
      safeSetWorkshopProgress(null);
      let durableSession: WorkshopSnapshot["activeSession"] = null;
      try {
        const refreshed = await queryClient.fetchQuery({
          queryKey: ["foundation-workshop", projectId],
          queryFn: () => apiGet<WorkshopSnapshot>(`/api/projects/${projectId}/foundation/workshop`),
        });
        durableSession = refreshed.activeSession;
      } catch {
        durableSession = null;
      }
      if (!durableSession || durableSession.userMessage !== outgoingMessage) {
        draftHooks.restoreMessage(outgoingMessage);
      }
      toast(error instanceof Error ? error.message : "工作区更新失败", "error");
    } finally {
      if (workshopAbortRef.current === abortController) {
        workshopAbortRef.current = null;
      }
    }
  }

  async function handleSaveStyleSteering(isStyleStreaming: boolean) {
    if (isStyleStreaming) {
      return;
    }

    let payload: ReturnType<typeof styleHooks.buildStylePayload>;
    try {
      payload = styleHooks.buildStylePayload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存文风约束失败", "error");
      return;
    }

    styleHooks.setStyleProgress({
      stage: "context",
      progress: 10,
      message: "正在汇总参考作品、作者和你的偏好。",
      preview: draft?.styleSteeringCard ?? "",
    });

    styleAbortRef.current?.abort();
    const abortController = new AbortController();
    styleAbortRef.current = abortController;
    const { signal } = abortController;

    try {
      const response = await fetch(`/api/projects/${projectId}/foundation/workshop/style-steering?stream=1`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-ainovel-stream": "1",
        },
        body: JSON.stringify(payload),
        signal,
      });

      let sawFinal = false;
      await readJsonLineStream<StyleStreamEvent>(response, async (event) => {
        if (signal.aborted || !isMountedRef.current) {
          return;
        }
        if (event.type === "error") {
          throw new Error(event.error || "保存文风约束失败");
        }

        if (event.type === "status") {
          styleHooks.setStyleProgress((current: StyleStreamProgressState | null) => ({
            stage: event.stage ?? current?.stage ?? "running",
            progress: event.progress ?? current?.progress ?? 0,
            message: event.message ?? current?.message ?? "正在整理文风约束卡。",
            preview: current?.preview ?? draft?.styleSteeringCard ?? "",
          }));
          return;
        }

        if (event.type === "style_delta") {
          styleHooks.setStyleProgress((current: StyleStreamProgressState | null) => ({
            stage: current?.stage ?? "drafting",
            progress: event.progress ?? current?.progress ?? 0,
            message: current?.message ?? "正在生成可长期沿用的文风约束卡。",
            preview: event.replace ? (event.delta ?? "") : `${current?.preview ?? ""}${event.delta ?? ""}`,
          }));
          return;
        }

        if (event.type === "final") {
          sawFinal = true;
          styleHooks.setStyleProgress((current: StyleStreamProgressState | null) => current
            ? {
                ...current,
                progress: event.progress ?? 100,
                message: "文风约束卡已同步完成。",
              }
            : {
                stage: "done",
                progress: event.progress ?? 100,
                message: "文风约束卡已同步完成。",
                preview: draft?.styleSteeringCard ?? "",
              });
          toast("文风约束卡已确认，后续生成会持续沿用。", "success");
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["foundation-workshop", projectId] }),
            queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
          ]);
          styleHooks.resetStyleInputs();
        }
      }, { signal });
      // 同上：缺失 final 时主动抛错，避免 styleProgress 卡住导致保存按钮锁死。
      if (!sawFinal) {
        throw new Error("文风约束生成未返回完成事件。");
      }
    } catch (error) {
      if (signal.aborted || !isMountedRef.current) {
        return;
      }
      styleHooks.setStyleProgress(null);
      toast(error instanceof Error ? error.message : "保存文风约束失败", "error");
    } finally {
      if (styleAbortRef.current === abortController) {
        styleAbortRef.current = null;
      }
    }
  }

  return {
    workshopProgress,
    isLocalStreaming,
    streamingAssistantMessage,
    nextFocus,
    handleSendWorkshopMessage,
    handleSaveStyleSteering,
  };
}
