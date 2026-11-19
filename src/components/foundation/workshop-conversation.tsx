"use client";

import type {
  ConversationMessage,
  StreamProgressState,
} from "@/lib/types";
import { CircleHelp, MessageSquareDashed } from "lucide-react";

interface WorkshopConversationProps {
  displayedMessages: ConversationMessage[];
  message: string;
  foundationLocked: boolean;
  coreDrift: boolean;
  blockingReason: string | null;
  isWorkshopStreaming: boolean;
  workshopProgress: StreamProgressState | null;
  workshopProgressNode: React.ReactNode;
  hasPendingMessage: boolean;
  readinessHint: string;
  nextFocus: string | null;
  resumeBanner: {
    text: string;
    toggleLabel: string;
    tooltip: string;
  } | null;
  foundationMutationPending: boolean;
  foundationLockedMutationPending: boolean;
  canGenerateFoundation: boolean;
  foundationExists: boolean;
  onMessageChange: (value: string) => void;
  onToggleResumeMode: () => void;
  onSubmit: () => void;
  onGenerateFoundation: () => void;
  onLockFoundation: () => void;
  messageListRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export function WorkshopConversation({
  displayedMessages,
  message,
  foundationLocked,
  coreDrift,
  blockingReason,
  isWorkshopStreaming,
  workshopProgress,
  workshopProgressNode,
  hasPendingMessage,
  readinessHint,
  nextFocus,
  resumeBanner,
  foundationMutationPending,
  foundationLockedMutationPending,
  canGenerateFoundation,
  foundationExists,
  onMessageChange,
  onToggleResumeMode,
  onSubmit,
  onGenerateFoundation,
  onLockFoundation,
  messageListRef,
  messagesEndRef,
}: WorkshopConversationProps) {
  const editingLocked = foundationLocked && !coreDrift;
  const generateButtonLabel = foundationMutationPending
    ? coreDrift && foundationLocked
      ? "重新整理中..."
      : "整理中..."
    : coreDrift && foundationLocked
      ? "重新整理正式设定"
      : "整理为正式设定";

  return (
    <div className="workspace-item active p-4">
      <div className="flex items-center gap-2">
        <MessageSquareDashed className="h-4 w-4 text-[var(--accent)]" />
        <p className="text-sm font-medium text-[var(--ink)]">第 2 步 · 设定输入与整理</p>
      </div>
      {resumeBanner ? (
        <div className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <p className="text-sm leading-6 text-[var(--ink)]">{resumeBanner.text}</p>
              <span
                aria-label="丢弃模式说明"
                className="mt-0.5 inline-flex text-[var(--ink-soft)]"
                title={resumeBanner.tooltip}
              >
                <CircleHelp className="h-4 w-4" />
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={onToggleResumeMode}
            >
              {resumeBanner.toggleLabel}
            </button>
          </div>
        </div>
      ) : null}
      {coreDrift && blockingReason ? (
        <div className="mt-4 rounded-2xl border border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4">
          <p className="text-sm leading-6 text-[var(--ink)]">{blockingReason}</p>
          <p className="mt-2 text-xs leading-6 text-[var(--ink-soft)]">
            当前正式设定虽然仍是锁定态，但你可以继续整理工坊内容，并重新整理正式设定来恢复一致。
          </p>
        </div>
      ) : null}
      {workshopProgressNode ? <div className="mt-4">{workshopProgressNode}</div> : null}
      <div ref={messageListRef} className="max-h-[26rem] space-y-3 overflow-y-auto pr-2">
        {displayedMessages.map((item) => (
          <div
            key={item.id}
            className={item.role === "assistant" ? "rounded-2xl bg-[color-mix(in_srgb,var(--azure)_8%,transparent)] p-4" : "ml-10 rounded-2xl bg-[var(--accent-soft)] p-4"}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              {item.role === "assistant" ? "塔菲" : "你"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">
              {item.content || (item.role === "assistant" && item.pending ? workshopProgress?.message : "")}
              {item.role === "assistant" && item.pending ? <span className="inline-block w-3">|</span> : null}
            </p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <textarea
        className="form-input mt-4 min-h-36 w-full resize-none rounded-2xl bg-[var(--surface-deep)] px-4 py-3 text-sm leading-7"
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        disabled={editingLocked || isWorkshopStreaming}
        placeholder="例如：我想让主角是一个嘴硬心软的骗子，他进入这套世界规则后，最大的代价是每说一次谎都会失去一段真实记忆。"
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="btn-primary"
          disabled={!message.trim() || isWorkshopStreaming || editingLocked}
          onClick={onSubmit}
        >
          {isWorkshopStreaming ? "整理中" : "提交更新"}
        </button>
        <button
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
          disabled={
            foundationMutationPending
            || editingLocked
            || isWorkshopStreaming
            || !canGenerateFoundation
            || hasPendingMessage
          }
          onClick={onGenerateFoundation}
        >
          {generateButtonLabel}
        </button>
        <button
          className="btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!foundationExists || foundationLocked || foundationLockedMutationPending || hasPendingMessage || isWorkshopStreaming}
          onClick={onLockFoundation}
        >
          {foundationLockedMutationPending ? "锁定中..." : "锁定正式设定"}
        </button>
      </div>
      {readinessHint ? <p className="mt-4 text-sm text-[var(--ink-soft)]">{readinessHint}</p> : null}
      {hasPendingMessage ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          你还有未提交的内容，先提交更新，再整理或锁定正式设定。
        </p>
      ) : null}
      <p className="mt-2 text-xs text-[var(--ink-soft)]">未提交的草稿会自动保存在本机，切换章节后回来也不会丢。</p>
      {nextFocus ? <p className="mt-2 text-sm text-[var(--ink-soft)]">下一步建议：{nextFocus}</p> : null}
    </div>
  );
}
