/**
 * use-foundation-workshop-controller-utils.ts
 *
 * 从 use-foundation-workshop-controller.tsx 提取的纯函数、常量与类型。
 * 这些工具均无副作用，可独立单测。
 */

import type { ReactNode } from "react";
import type {
  ConversationMessage,
  StreamProgressState,
  StyleReferenceCandidate,
  StyleReferenceSelection,
  WorkshopActiveSession,
} from "@/lib/types";

// ─── 常量 ────────────────────────────────────────────────

export const STYLE_SAMPLE_DELIMITER = "\n\n---\n\n";
export const FOUNDATION_WORKSHOP_LIKELY_STUCK_MS = 180_000;

export const FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT =
  "上一次生成已中断，系统将自动沿用已生成片段继续共创。点右侧按钮可改为丢弃。";
export const FOUNDATION_WORKSHOP_DISCARD_TOOLTIP =
  "丢弃模式仅影响本次提交，下次生成会重新检测";

// ─── 类型 ────────────────────────────────────────────────

export type FoundationWorkshopResumeMode = "auto" | "discard";

// ─── 纯工具函数 ──────────────────────────────────────────

export function serializeStyleSamples(samples?: string[]) {
  return (samples ?? []).filter(Boolean).join(STYLE_SAMPLE_DELIMITER);
}

export function parseStyleSamples(raw: string) {
  return raw
    .split(/\n\s*---+\s*\n/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function getStyleReferenceKey(
  input: Pick<StyleReferenceCandidate, "kind" | "label" | "author" | "source"> | StyleReferenceSelection,
) {
  return [input.kind, input.label, input.author ?? "", input.source].join("::");
}

export function renderStyleReferenceLabel(
  reference: Pick<StyleReferenceCandidate, "kind" | "label" | "author">,
) {
  if (reference.kind === "author") {
    return reference.label;
  }
  return reference.author ? `《${reference.label}》 · ${reference.author}` : `《${reference.label}》`;
}

export function getStyleSourceLabel(
  source: "network" | "mixed" | StyleReferenceCandidate["source"],
) {
  if (source === "network") {
    return "联网结果";
  }
  if (source === "mixed") {
    return "联网 + 系统检索兜底";
  }
  return "系统检索兜底";
}

export function normalizeOptionalDigest(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

// ─── Session 相关判断 ────────────────────────────────────

export function isFoundationWorkshopSessionLikelyStuck(
  activeSession: WorkshopActiveSession | null | undefined,
  nowMs = Date.now(),
) {
  if (!activeSession || activeSession.status !== "running") {
    return false;
  }

  const updatedAtMs = Date.parse(activeSession.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return nowMs - updatedAtMs >= FOUNDATION_WORKSHOP_LIKELY_STUCK_MS;
}

export function getFoundationWorkshopResumeTarget(
  activeSession: WorkshopActiveSession | null | undefined,
  nowMs = Date.now(),
) {
  if (!activeSession || !activeSession.assistantMessage.trim()) {
    return null;
  }

  if (activeSession.status === "failed" || isFoundationWorkshopSessionLikelyStuck(activeSession, nowMs)) {
    return {
      sessionId: activeSession.sessionId,
      mode: "auto" as const,
      bannerText: FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT,
    };
  }

  return null;
}

export function getFoundationWorkshopResumeToggleLabel(mode: FoundationWorkshopResumeMode) {
  return mode === "auto" ? "改为丢弃中断片段" : "改为自动续接";
}

export function buildFoundationWorkshopRequestPayload(input: {
  message: string;
  activeSession: WorkshopActiveSession | null | undefined;
  resumeMode: FoundationWorkshopResumeMode;
  nowMs?: number;
}) {
  const payload: {
    message: string;
    resumeSessionId?: string | null;
  } = {
    message: input.message,
  };
  const resumeTarget = getFoundationWorkshopResumeTarget(input.activeSession, input.nowMs);
  if (!resumeTarget) {
    return payload;
  }

  payload.resumeSessionId = input.resumeMode === "discard" ? null : resumeTarget.sessionId;
  return payload;
}

export function deriveWorkshopProgressFromActiveSession(
  activeSession: WorkshopActiveSession | null | undefined,
) {
  if (!activeSession) {
    return null;
  }

  if (activeSession.status === "failed") {
    return {
      stage: "failed",
      progress: activeSession.progress,
      message: activeSession.error ?? activeSession.statusMessage,
    } satisfies StreamProgressState;
  }

  return {
    stage: activeSession.stage,
    progress: activeSession.progress,
    message: activeSession.statusMessage,
  } satisfies StreamProgressState;
}

// ─── 消息列表拼装 ────────────────────────────────────────

export function buildDisplayedWorkshopMessages(input: {
  baseMessages: ConversationMessage[];
  localPendingUserMessage: string;
  localStreamingAssistantMessage: string;
  isLocalStreaming: boolean;
  activeSession: WorkshopActiveSession | null | undefined;
}) {
  const items: ConversationMessage[] = [...input.baseMessages];
  const lastEntry = items.at(-1);
  const secondLastEntry = items.at(-2);
  const hasPersistedActiveUserMessage = Boolean(
    input.activeSession
    && lastEntry?.role === "user"
    && lastEntry?.content === input.activeSession.userMessage,
  );

  // final 之后 invalidate 刷新先于本地 pending 清理完成时，服务端已持久化同一轮
  // user/assistant 消息；这里去重，避免本地副本与服务端副本同屏闪现两份。
  const hasPersistedPendingUserMessage = Boolean(
    input.localPendingUserMessage
    && (
      (lastEntry?.role === "user" && lastEntry.content === input.localPendingUserMessage)
      || (
        secondLastEntry?.role === "user"
        && secondLastEntry.content === input.localPendingUserMessage
        && lastEntry?.role === "assistant"
        && lastEntry.content === input.localStreamingAssistantMessage
      )
    ),
  );

  if (input.localPendingUserMessage && !hasPersistedPendingUserMessage) {
    items.push({
      id: "pending-user-message",
      role: "user",
      content: input.localPendingUserMessage,
      createdAt: new Date().toISOString(),
      pending: true,
    });
  }

  if (input.isLocalStreaming) {
    const hasPersistedStreamingAssistantMessage = Boolean(
      input.localStreamingAssistantMessage
      && lastEntry?.role === "assistant"
      && lastEntry.content === input.localStreamingAssistantMessage,
    );
    if (!hasPersistedStreamingAssistantMessage) {
      items.push({
        id: "streaming-assistant-message",
        role: "assistant",
        content: input.localStreamingAssistantMessage,
        createdAt: new Date().toISOString(),
        pending: true,
      });
    }
    return items;
  }

  if (!input.activeSession) {
    return items;
  }

  if (!hasPersistedActiveUserMessage) {
    items.push({
      id: "active-session-user-message",
      role: "user",
      content: input.activeSession.userMessage,
      createdAt: input.activeSession.createdAt,
      pending: true,
    });
  }

  if (input.activeSession.assistantMessage) {
    items.push({
      id: "active-session-assistant-message",
      role: "assistant",
      content: input.activeSession.assistantMessage,
      createdAt: input.activeSession.updatedAt,
      pending: true,
    });
  }

  return items;
}

// ─── Progress UI 呈现 ───────────────────────────────────

export function resolveStreamingProgressPresentation(progress: StreamProgressState) {
  if (progress.stage === "draft_sync") {
    return {
      indeterminate: true,
      label: "正在同步草稿",
    };
  }

  return {
    indeterminate: false,
    label: `${Math.round(progress.progress)}%`,
  };
}

export function createStreamingProgressNode({
  title,
  detail,
  progress,
  indeterminate = false,
  label,
}: {
  title: string;
  detail: string;
  progress: number;
  indeterminate?: boolean;
  label?: string;
}): ReactNode {
  const progressLabel = label ?? `${Math.round(progress)}%`;
  return (
    <div className="rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
        <span className="text-xs font-medium text-[var(--ink-soft)]">{progressLabel}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--line)]">
        <div
          className={`h-full rounded-full bg-[var(--accent)] ${indeterminate ? "animate-pulse" : "transition-[width] duration-300 ease-out"}`}
          style={{ width: indeterminate ? "100%" : `${Math.max(6, Math.min(progress, 100))}%` }}
        />
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">{detail}</p>
    </div>
  );
}
