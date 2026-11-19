import { describe, expect, it } from "vitest";
import type { ConversationMessage, WorkshopActiveSession } from "@/lib/types";
import { resolveFoundationWorkshopRefetchInterval } from "@/components/foundation/use-foundation-queries";
import {
  FOUNDATION_WORKSHOP_DISCARD_TOOLTIP,
  FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT,
  buildDisplayedWorkshopMessages,
  buildFoundationWorkshopRequestPayload,
  deriveWorkshopProgressFromActiveSession,
  getFoundationWorkshopResumeToggleLabel,
  getFoundationWorkshopResumeTarget,
  isFoundationWorkshopSessionLikelyStuck,
  resolveStreamingProgressPresentation,
} from "@/components/foundation/use-foundation-workshop-controller";

const baseMessages: ConversationMessage[] = [
  {
    id: "history-1",
    role: "assistant",
    content: "先把目前的世界规则整理一下。",
    createdAt: "2026-04-06T10:00:00.000Z",
  },
];

const activeSession: WorkshopActiveSession = {
  projectId: "project-1",
  sessionId: "session-1",
  status: "running",
  stage: "draft_sync",
  progress: 96,
  statusMessage: "正在同步共创草案和下一步焦点。",
  userMessage: "把主角身上的寄生关系变得更危险。",
  assistantMessage: "可以让它在共享感官的同时吞掉一部分自我边界。",
  error: null,
  createdAt: "2026-04-06T10:00:00.000Z",
  updatedAt: "2026-04-06T10:00:08.000Z",
};

describe("foundation durable session helpers", () => {
  it("refetches while a durable workshop session is still running", () => {
    expect(resolveFoundationWorkshopRefetchInterval(activeSession)).toBe(1500);
    expect(
      resolveFoundationWorkshopRefetchInterval({
        ...activeSession,
        status: "failed",
      }),
    ).toBe(false);
    expect(resolveFoundationWorkshopRefetchInterval(null)).toBe(false);
  });

  it("rebuilds pending workshop messages from the durable active session", () => {
    expect(buildDisplayedWorkshopMessages({
      baseMessages,
      localPendingUserMessage: "",
      localStreamingAssistantMessage: "",
      isLocalStreaming: false,
      activeSession,
    })).toEqual([
      ...baseMessages,
      {
        id: "active-session-user-message",
        role: "user",
        content: "把主角身上的寄生关系变得更危险。",
        createdAt: "2026-04-06T10:00:00.000Z",
        pending: true,
      },
      {
        id: "active-session-assistant-message",
        role: "assistant",
        content: "可以让它在共享感官的同时吞掉一部分自我边界。",
        createdAt: "2026-04-06T10:00:08.000Z",
        pending: true,
      },
    ]);
  });

  it("prefers the live in-memory stream over the durable session mirror", () => {
    expect(buildDisplayedWorkshopMessages({
      baseMessages,
      localPendingUserMessage: "本地还在流式里的用户消息",
      localStreamingAssistantMessage: "本地还在流式里的助手回复",
      isLocalStreaming: true,
      activeSession,
    })).toEqual([
      ...baseMessages,
      {
        id: "pending-user-message",
        role: "user",
        content: "本地还在流式里的用户消息",
        createdAt: expect.any(String),
        pending: true,
      },
      {
        id: "streaming-assistant-message",
        role: "assistant",
        content: "本地还在流式里的助手回复",
        createdAt: expect.any(String),
        pending: true,
      },
    ]);
  });

  it("dedupes the local pending exchange once the same round is persisted after final", () => {
    const persisted: ConversationMessage[] = [
      ...baseMessages,
      {
        id: "persisted-user",
        role: "user",
        content: "把主角身上的寄生关系变得更危险。",
        createdAt: "2026-04-06T10:00:00.000Z",
      },
      {
        id: "persisted-assistant",
        role: "assistant",
        content: "可以让它在共享感官的同时吞掉一部分自我边界。",
        createdAt: "2026-04-06T10:00:08.000Z",
      },
    ];

    expect(buildDisplayedWorkshopMessages({
      baseMessages: persisted,
      localPendingUserMessage: "把主角身上的寄生关系变得更危险。",
      localStreamingAssistantMessage: "可以让它在共享感官的同时吞掉一部分自我边界。",
      isLocalStreaming: true,
      activeSession: null,
    })).toEqual(persisted);
  });

  it("dedupes the pending user message when the server persists it mid-stream", () => {
    const persisted: ConversationMessage[] = [
      ...baseMessages,
      {
        id: "persisted-user",
        role: "user",
        content: "把主角身上的寄生关系变得更危险。",
        createdAt: "2026-04-06T10:00:00.000Z",
      },
    ];

    expect(buildDisplayedWorkshopMessages({
      baseMessages: persisted,
      localPendingUserMessage: "把主角身上的寄生关系变得更危险。",
      localStreamingAssistantMessage: "正在生成的回复",
      isLocalStreaming: true,
      activeSession: null,
    })).toEqual([
      ...persisted,
      {
        id: "streaming-assistant-message",
        role: "assistant",
        content: "正在生成的回复",
        createdAt: expect.any(String),
        pending: true,
      },
    ]);
  });

  it("keeps a re-sent identical message visible while the new reply is still streaming", () => {
    const persisted: ConversationMessage[] = [
      {
        id: "old-user",
        role: "user",
        content: "继续推进",
        createdAt: "2026-04-06T09:00:00.000Z",
      },
      {
        id: "old-assistant",
        role: "assistant",
        content: "上一轮的回复。",
        createdAt: "2026-04-06T09:00:08.000Z",
      },
    ];

    expect(buildDisplayedWorkshopMessages({
      baseMessages: persisted,
      localPendingUserMessage: "继续推进",
      localStreamingAssistantMessage: "",
      isLocalStreaming: true,
      activeSession: null,
    })).toEqual([
      ...persisted,
      {
        id: "pending-user-message",
        role: "user",
        content: "继续推进",
        createdAt: expect.any(String),
        pending: true,
      },
      {
        id: "streaming-assistant-message",
        role: "assistant",
        content: "",
        createdAt: expect.any(String),
        pending: true,
      },
    ]);
  });

  it("derives progress UI from the durable session when the page remounts", () => {
    expect(deriveWorkshopProgressFromActiveSession(activeSession)).toEqual({
      stage: "draft_sync",
      progress: 96,
      message: "正在同步共创草案和下一步焦点。",
    });

    expect(
      deriveWorkshopProgressFromActiveSession({
        ...activeSession,
        status: "failed",
        error: "draft sync failed",
      }),
    ).toEqual({
      stage: "failed",
      progress: 96,
      message: "draft sync failed",
    });
  });

  it("switches draft sync into an indeterminate progress presentation", () => {
    expect(resolveStreamingProgressPresentation({
      stage: "draft_sync",
      progress: 96,
      message: "正在同步共创草案和下一步焦点。",
    })).toEqual({
      indeterminate: true,
      label: "正在同步草稿",
    });

    expect(resolveStreamingProgressPresentation({
      stage: "replying",
      progress: 72,
      message: "设定助手开始共创回复。",
    })).toEqual({
      indeterminate: false,
      label: "72%",
    });
  });

  it("treats running sessions as likely stuck from 180 seconds onward", () => {
    expect(
      isFoundationWorkshopSessionLikelyStuck({
        ...activeSession,
        updatedAt: "2026-04-06T10:00:01.000Z",
      }, Date.parse("2026-04-06T10:02:59.999Z")),
    ).toBe(false);

    expect(
      isFoundationWorkshopSessionLikelyStuck({
        ...activeSession,
        updatedAt: "2026-04-06T10:00:00.000Z",
      }, Date.parse("2026-04-06T10:03:00.000Z")),
    ).toBe(true);

    expect(
      isFoundationWorkshopSessionLikelyStuck({
        ...activeSession,
        updatedAt: "2026-04-06T10:00:00.000Z",
      }, Date.parse("2026-04-06T10:03:00.001Z")),
    ).toBe(true);
  });

  it("detects recoverable sessions from failed or likely-stuck partial replies", () => {
    expect(getFoundationWorkshopResumeTarget({
      ...activeSession,
      status: "failed",
    })).toEqual({
      sessionId: "session-1",
      mode: "auto",
      bannerText: FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT,
    });

    expect(
      getFoundationWorkshopResumeTarget({
        ...activeSession,
        updatedAt: "2026-04-06T10:00:00.000Z",
      }, Date.parse("2026-04-06T10:03:00.000Z")),
    ).toEqual({
      sessionId: "session-1",
      mode: "auto",
      bannerText: FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT,
    });

    expect(
      getFoundationWorkshopResumeTarget({
        ...activeSession,
        assistantMessage: "",
      }, Date.parse("2026-04-06T10:03:00.000Z")),
    ).toBeNull();
  });

  it("builds the request payload for auto-resume, discard-once, and legacy fallback", () => {
    expect(
      buildFoundationWorkshopRequestPayload({
        message: "继续推进",
        activeSession: {
          ...activeSession,
          status: "failed",
        },
        resumeMode: "auto",
      }),
    ).toEqual({
      message: "继续推进",
      resumeSessionId: "session-1",
    });

    expect(
      buildFoundationWorkshopRequestPayload({
        message: "继续推进",
        activeSession: {
          ...activeSession,
          status: "failed",
        },
        resumeMode: "discard",
      }),
    ).toEqual({
      message: "继续推进",
      resumeSessionId: null,
    });

    expect(
      buildFoundationWorkshopRequestPayload({
        message: "继续推进",
        activeSession: null,
        resumeMode: "auto",
      }),
    ).toEqual({
      message: "继续推进",
    });
  });

  it("exposes the exact resume toggle labels and discard tooltip copy", () => {
    expect(getFoundationWorkshopResumeToggleLabel("auto")).toBe("改为丢弃中断片段");
    expect(getFoundationWorkshopResumeToggleLabel("discard")).toBe("改为自动续接");
    expect(FOUNDATION_WORKSHOP_DISCARD_TOOLTIP).toBe("丢弃模式仅影响本次提交，下次生成会重新检测");
  });
});
