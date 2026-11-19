"use client";

import type { CardTab, ProjectCard } from "@/lib/types";
import { MessageSquareDashed } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { autoMetaLabel } from "./card-editor-utils.ts";

interface CardListSidebarProps {
  activeTab: CardTab;
  cards: ProjectCard[];
  isLoading: boolean;
  selectedCardId: string | null;
  onSelectCard: (cardId: string) => void;
}

export function CardListSidebar({
  activeTab,
  cards,
  isLoading,
  selectedCardId,
  onSelectCard,
}: CardListSidebarProps) {
  return (
    <div className="workspace-sidebar grid auto-rows-min gap-2 p-3">
      <div className="mb-2 flex items-center justify-between px-2">
        <div>
          <p className="text-sm font-semibold">{activeTab === "character" ? "角色卡列表" : "世界书列表"}</p>
          <p className="text-xs text-[var(--ink-soft)]">
            {activeTab === "character" ? "人物、组织、关系" : "规则、地点、势力"}
          </p>
        </div>
        <MessageSquareDashed className="h-4 w-4 text-[var(--ink-soft)]" />
      </div>

      {isLoading ? <LoadingSkeleton variant="list" count={3} /> : null}
      {cards.length === 0 && !isLoading ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)] px-4 py-6 text-sm text-[var(--ink-soft)]">
          还没有{activeTab === "character" ? "角色卡" : "世界书"}。
          <div className="mt-2 leading-6">
            先在设定工坊里整理正式设定，或直接点击右上角创建一张新卡。
          </div>
        </div>
      ) : null}

      {cards.map((card) => (
        <button
          key={card.id}
          onClick={() => onSelectCard(card.id)}
          className={`workspace-item w-full p-3 text-left transition ${
            selectedCardId === card.id
              ? "active"
              : "border-[var(--line)] bg-[var(--panel-soft)] hover:bg-[var(--hover)]"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{card.name}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                {card.cardType === "character" ? "角色设定" : "世界规则"}
              </p>
              {card.cardType === "character" && (card.meta.origin || card.meta.importance) ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.values(autoMetaLabel(card.meta))
                    .filter(Boolean)
                    .map((label) => (
                      <span
                        key={`${card.id}-${label}`}
                        className="rounded-full bg-[var(--panel-muted)] px-2 py-0.5 text-[10px] text-[var(--ink-soft)]"
                      >
                        {label}
                      </span>
                    ))}
                </div>
              ) : null}
            </div>
            <StatusBadge status={card.status} />
          </div>
        </button>
      ))}
    </div>
  );
}
