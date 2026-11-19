/**
 * useFoundationDraft — 管理草稿消息 localStorage 持久化、resume 偏好与 pending 状态。
 * 从 use-foundation-workshop-controller.tsx 提取。
 */

import { useEffect, useState } from "react";
import { getFoundationWorkshopDraftStorageKey } from "@/lib/foundation-workshop-draft";
import type { WorkshopActiveSession } from "@/lib/types";
import {
  type FoundationWorkshopResumeMode,
  FOUNDATION_WORKSHOP_DISCARD_TOOLTIP,
  getFoundationWorkshopResumeTarget,
  getFoundationWorkshopResumeToggleLabel,
} from "./use-foundation-workshop-controller-utils";

export interface UseFoundationDraftOptions {
  projectId: string;
  activeSession: WorkshopActiveSession | null | undefined;
  isLocalStreaming: boolean;
}

export function useFoundationDraft({
  projectId,
  activeSession,
  isLocalStreaming,
}: UseFoundationDraftOptions) {
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return window.localStorage.getItem(getFoundationWorkshopDraftStorageKey(projectId)) ?? "";
  });

  const [pendingUserMessage, setPendingUserMessage] = useState("");

  const [resumePreference, setResumePreference] = useState<{
    sessionId: string | null;
    mode: FoundationWorkshopResumeMode;
  }>({
    sessionId: null,
    mode: "auto",
  });

  const resumeTarget = !isLocalStreaming
    ? getFoundationWorkshopResumeTarget(activeSession)
    : null;

  const resumeMode =
    resumeTarget?.sessionId && resumePreference.sessionId === resumeTarget.sessionId
      ? resumePreference.mode
      : "auto";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (message.trim()) {
      window.localStorage.setItem(getFoundationWorkshopDraftStorageKey(projectId), message);
      return;
    }
    window.localStorage.removeItem(getFoundationWorkshopDraftStorageKey(projectId));
  }, [projectId, message]);

  function clearMessage() {
    setMessage("");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(getFoundationWorkshopDraftStorageKey(projectId));
    }
  }

  function restoreMessage(text: string) {
    setMessage(text);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(getFoundationWorkshopDraftStorageKey(projectId), text);
    }
  }

  function toggleResumeMode() {
    setResumePreference({
      sessionId: resumeTarget?.sessionId ?? null,
      mode: resumeMode === "auto" ? "discard" : "auto",
    });
  }

  function resetResumePreference() {
    setResumePreference({ sessionId: null, mode: "auto" });
  }

  const resumeBanner = resumeTarget
    ? {
        text: resumeTarget.bannerText,
        toggleLabel: getFoundationWorkshopResumeToggleLabel(resumeMode),
        tooltip: FOUNDATION_WORKSHOP_DISCARD_TOOLTIP,
      }
    : null;

  return {
    message,
    setMessage,
    clearMessage,
    restoreMessage,
    pendingUserMessage,
    setPendingUserMessage,
    hasPendingMessage: message.trim().length > 0,
    resumeMode,
    resumeTarget,
    resumeBanner,
    toggleResumeMode,
    resetResumePreference,
  };
}
