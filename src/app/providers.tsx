"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState } from "react";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { ToastProvider, useToast } from "@/components/toast";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "请求失败，请稍后重试。";
}

// 同一查询的同一错误在该窗口内只弹一次 toast，避免轮询失败时刷屏。
const QUERY_ERROR_TOAST_DEDUPE_MS = 30_000;

function QueryProviders({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [client] = useState(() => {
    const lastQueryErrorToastAt = new Map<string, number>();

    return new QueryClient({
      queryCache: new QueryCache({
        onError: (error, query) => {
          // 后台轮询/刷新失败时已有数据可继续展示，只在首次加载失败时提示。
          if (query.state.data !== undefined) {
            return;
          }
          const message = getErrorMessage(error);
          const dedupeKey = `${query.queryHash}:${message}`;
          const now = Date.now();
          if (now - (lastQueryErrorToastAt.get(dedupeKey) ?? 0) < QUERY_ERROR_TOAST_DEDUPE_MS) {
            return;
          }
          lastQueryErrorToastAt.set(dedupeKey, now);
          toast(message, "error");
        },
      }),
      mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
          // mutation 自带 onError（多数已各自 toast）时跳过全局兜底，避免同一错误弹两条。
          if (mutation.options.onError) {
            return;
          }
          toast(getErrorMessage(error), "error");
        },
      }),
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          staleTime: 300_000,
          gcTime: 1_800_000,
        },
      },
    });
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <QueryProviders>{children}</QueryProviders>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}
