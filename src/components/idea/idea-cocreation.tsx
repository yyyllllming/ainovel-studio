"use client";

import { MessageSquareDashed } from "lucide-react";

interface IdeaCocreationProps {
  messages: Array<{
    id: string;
    role: "assistant" | "user";
    content: string;
    createdAt: string;
    pending?: boolean;
  }>;
  message: string;
  sendPending: boolean;
  updatedAtLabel: string | null;
  canSubmit: boolean;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
}

export function IdeaCocreation({
  messages,
  message,
  sendPending,
  updatedAtLabel,
  canSubmit,
  onMessageChange,
  onSubmit,
}: IdeaCocreationProps) {
  return (
    <section className="workspace-panel p-6">
      <div className="flex items-center gap-2">
        <MessageSquareDashed className="h-4 w-4 text-[var(--accent)]" />
        <h2 className="text-xl font-semibold">聊想法</h2>
      </div>
      <div className="mt-5 grid gap-3">
        {messages.map((item) => (
          <div
            key={item.id}
            className={[
              item.role === "assistant"
                ? "rounded-2xl bg-[color-mix(in_srgb,var(--azure)_8%,transparent)] p-4"
                : "ml-10 rounded-2xl bg-[var(--accent-soft)] p-4",
              item.pending ? "border border-[var(--line)]" : "",
            ].join(" ")}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
              {item.role === "assistant" ? "塔菲" : "你"}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">{item.content}</p>
          </div>
        ))}
      </div>
      <textarea
        className="form-input mt-4 min-h-36 w-full resize-none rounded-2xl bg-[var(--surface-deep)] px-4 py-3 text-sm leading-7 outline-none"
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        placeholder="随便写。角色、设定、冲突，或一句突然冒出来的念头都行。"
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          className="btn-primary"
          disabled={!message.trim() || sendPending || !canSubmit}
          onClick={onSubmit}
        >
          {sendPending ? "在想…" : "发送"}
        </button>
        <span className="workspace-pill px-3 py-2 text-sm text-[var(--ink-soft)]">
          更新时间 {updatedAtLabel ? new Date(updatedAtLabel).toLocaleString("zh-CN") : "载入中"}
        </span>
      </div>
    </section>
  );
}
