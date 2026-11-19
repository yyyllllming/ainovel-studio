"use client";

import { CollapsibleSection } from "@/components/collapsible-section";
import type { AuthorBookCardDetail } from "@/lib/types";
import { formatConfidence, formatCount, formatDateTime } from "./author-utils";

export function AuthorBookCardList({
  bookCards,
}: {
  bookCards: AuthorBookCardDetail[];
}) {
  return (
    <div className="workspace-item active p-4">
      <div>
        <p className="section-title">Book Cards</p>
        <h3 className="mt-2 text-lg font-semibold text-[var(--ink)]">书级风格卡</h3>
        <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
          每张卡对应一本导入文本，保留单书的节奏、对话、场景和钩子写法，后续可以作为合并 author 风格的底层素材。
        </p>
      </div>

      <div className="mt-4 grid gap-3">
        {bookCards.length ? bookCards.map((bookCard) => (
          <CollapsibleSection
            key={bookCard.id}
            title={bookCard.title}
            eyebrow="Book Style"
            description={`置信度 ${formatConfidence(bookCard.confidence)} · ${formatCount(bookCard.wordCount)} 字 · ${bookCard.chapterCount} 章 · ${formatDateTime(bookCard.createdAt)}`}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-3">
              <p className="text-sm leading-7 text-[var(--ink-soft)]">{bookCard.styleDigest}</p>
              <CollapsibleSection
                title="查看完整书级风格卡"
                eyebrow="Card"
                className="bg-[var(--panel-soft)]"
              >
                <pre className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">{bookCard.styleCard}</pre>
              </CollapsibleSection>
            </div>
          </CollapsibleSection>
        )) : (
          <p className="text-sm text-[var(--ink-soft)]">还没有书级风格卡。先导入文本，再从选中的导入记录生成。</p>
        )}
      </div>
    </div>
  );
}
