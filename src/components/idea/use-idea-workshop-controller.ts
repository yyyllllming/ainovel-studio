"use client";

import { useEffect, useMemo, useState } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { WorkshopMessage, WorkshopStreamEvent } from "@/lib/types";
import { useStreamRenderer } from "../use-stream-renderer";

type SendIdeaWorkshopVariables = {
  message: string;
  baseUpdatedAt?: string;
  profileId?: string;
  onEvent?: (event: WorkshopStreamEvent) => Promise<void> | void;
};

interface UseIdeaWorkshopControllerInput {
  messages: WorkshopMessage[];
  baseUpdatedAt?: string;
  effectiveProfileId: string;
  canSubmit: boolean;
  sendMutation: UseMutationResult<void, Error, SendIdeaWorkshopVariables>;
}

export function useIdeaWorkshopController({
  messages,
  baseUpdatedAt,
  effectiveProfileId,
  canSubmit,
  sendMutation,
}: UseIdeaWorkshopControllerInput) {
  const [message, setMessage] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const {
    renderedText: streamingAssistantMessage,
    reset: resetStreamRenderer,
    pushDelta,
    flush: flushStreamRenderer,
  } = useStreamRenderer();

  const displayedMessages = useMemo<WorkshopMessage[]>(() => {
    const items = [...messages];

    if (pendingUserMessage) {
      items.push({
        id: "idea-pending-user-message",
        role: "user",
        content: pendingUserMessage,
        createdAt: new Date().toISOString(),
        pending: true,
      });
    }

    if (streamingAssistantMessage) {
      items.push({
        id: "idea-streaming-assistant-message",
        role: "assistant",
        content: streamingAssistantMessage,
        createdAt: new Date().toISOString(),
        pending: true,
      });
    }

    return items;
  }, [messages, pendingUserMessage, streamingAssistantMessage]);

  useEffect(() => {
    if (!pendingUserMessage && !streamingAssistantMessage) {
      return;
    }

    const hasPersistedUserMessage = !pendingUserMessage
      || messages.some((entry) => entry.role === "user" && entry.content === pendingUserMessage);
    const hasPersistedAssistantMessage = !streamingAssistantMessage
      || messages.some((entry) => entry.role === "assistant" && entry.content === streamingAssistantMessage);

    if (hasPersistedUserMessage && hasPersistedAssistantMessage) {
      const timer = window.setTimeout(() => {
        setPendingUserMessage("");
        resetStreamRenderer();
        setIsStreaming(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [messages, pendingUserMessage, resetStreamRenderer, streamingAssistantMessage]);

  function handleSubmit() {
    const outgoingMessage = message.trim();
    if (!outgoingMessage || !canSubmit || isStreaming || sendMutation.isPending) {
      return;
    }

    setPendingUserMessage(outgoingMessage);
    resetStreamRenderer();
    setIsStreaming(true);
    setMessage("");

    sendMutation.mutate(
      {
        message: outgoingMessage,
        baseUpdatedAt,
        profileId: effectiveProfileId || undefined,
        onEvent: async (event) => {
          if (event.type === "assistant_delta") {
            pushDelta(event.delta ?? "", { replace: event.replace });
            return;
          }

          if (event.type === "final") {
            flushStreamRenderer();
            setIsStreaming(false);
          }
        },
      },
      {
        onError: () => {
          setMessage(outgoingMessage);
          setPendingUserMessage("");
          resetStreamRenderer();
          setIsStreaming(false);
        },
      },
    );
  }

  return {
    message,
    displayedMessages,
    isStreaming,
    setMessage,
    handleSubmit,
  };
}
