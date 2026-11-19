"use client";

import { memo } from "react";
import Link from "next/link";
import type {
  AuthorCardDetail,
  AuthorCardSummary,
  FoundationDraft,
  SourceIdeaSummary,
  StyleReferenceCandidate,
  StyleReferenceSelection,
} from "@/lib/types";
import { CollapsibleSection } from "@/components/collapsible-section";
import { StatusBadge } from "@/components/status-badge";

interface StyleReferenceSelectorProps {
  projectId: string;
  draft?: FoundationDraft | null;
  sourceIdea?: SourceIdeaSummary | null;
  authorCards: AuthorCardSummary[];
  expandedAuthorId: string | null;
  expandedAuthorDetail?: AuthorCardDetail | null;
  authorCardDetailLoading: boolean;
  applyAuthorCardPending: boolean;
  applyBookCardPending: boolean;
  activeStyleDigest: string;
  onApplyAuthorCard: (authorCardId: string) => void;
  onApplyBookCard: (bookCardId: string) => void;
  onToggleAuthorCard: (authorCardId: string) => void;
  styleQuery: string;
  onStyleQueryChange: (value: string) => void;
  onSearch: () => void;
  styleSearchPending: boolean;
  isStyleStreaming: boolean;
  styleSourceLabel: string | null;
  referencePool: StyleReferenceCandidate[];
  primaryStyleKey: string;
  secondaryStyleKeys: string[];
  getReferenceKey: (
    input: Pick<StyleReferenceCandidate, "kind" | "label" | "author" | "source"> | StyleReferenceSelection,
  ) => string;
  renderReferenceLabel: (reference: Pick<StyleReferenceCandidate, "kind" | "label" | "author">) => string;
  onSelectPrimary: (key: string) => void;
  onToggleSecondary: (key: string) => void;
  manualGuidance: string;
  onManualGuidanceChange: (value: string) => void;
  avoidances: string;
  onAvoidancesChange: (value: string) => void;
  styleSamples: string;
  styleSampleDelimiter: string;
  onStyleSamplesChange: (value: string) => void;
  onSave: () => void;
  styleProgressNode: React.ReactNode;
  visibleStyleCard: string;
}

function normalizeDigest(input?: string | null) {
  return input?.trim() ?? "";
}

function getBookCardDedupKey(bookCard: AuthorCardDetail["bookCards"][number]) {
  const sourceFileName = bookCard.sourceFileName?.trim().toLowerCase();
  if (sourceFileName) {
    return `source:${sourceFileName}`;
  }
  return `title:${bookCard.title.trim().toLowerCase()}`;
}

function getVisibleBookCards(
  bookCards: AuthorCardDetail["bookCards"],
  activeStyleDigest: string,
) {
  const order: string[] = [];
  const grouped = new Map<string, AuthorCardDetail["bookCards"]>();

  for (const bookCard of bookCards) {
    const key = getBookCardDedupKey(bookCard);
    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.push(key);
    }
    grouped.get(key)?.push(bookCard);
  }

  return order
    .map((key) => {
      const entries = grouped.get(key) ?? [];
      const appliedMatch = activeStyleDigest
        ? entries.find((entry) => normalizeDigest(entry.styleDigest) === activeStyleDigest)
        : undefined;
      const selected = appliedMatch
        ?? [...entries].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

      return selected
        ? {
            bookCard: selected,
            hiddenCount: Math.max(0, entries.length - 1),
          }
        : null;
    })
    .filter((entry): entry is { bookCard: AuthorCardDetail["bookCards"][number]; hiddenCount: number } => Boolean(entry));
}

function StyleReferenceSelectorImpl({
  projectId,
  draft,
  sourceIdea,
  authorCards,
  expandedAuthorId,
  expandedAuthorDetail,
  authorCardDetailLoading,
  applyAuthorCardPending,
  applyBookCardPending,
  activeStyleDigest,
  onApplyAuthorCard,
  onApplyBookCard,
  onToggleAuthorCard,
  styleQuery,
  onStyleQueryChange,
  onSearch,
  styleSearchPending,
  isStyleStreaming,
  styleSourceLabel,
  referencePool,
  primaryStyleKey,
  secondaryStyleKeys,
  getReferenceKey,
  renderReferenceLabel,
  onSelectPrimary,
  onToggleSecondary,
  manualGuidance,
  onManualGuidanceChange,
  avoidances,
  onAvoidancesChange,
  styleSamples,
  styleSampleDelimiter,
  onStyleSamplesChange,
  onSave,
  styleProgressNode,
  visibleStyleCard,
}: StyleReferenceSelectorProps) {
  const normalizedActiveStyleDigest = normalizeDigest(activeStyleDigest);
  const visibleBookCards = expandedAuthorDetail
    ? getVisibleBookCards(expandedAuthorDetail.bookCards, normalizedActiveStyleDigest)
    : [];
  const currentAuthorVersion = normalizedActiveStyleDigest && expandedAuthorDetail
    ? expandedAuthorDetail.versions.find((entry) => normalizeDigest(entry.styleDigest) === normalizedActiveStyleDigest) ?? null
    : null;
  const currentBookEntry = normalizedActiveStyleDigest
    ? visibleBookCards.find(({ bookCard }) => normalizeDigest(bookCard.styleDigest) === normalizedActiveStyleDigest) ?? null
    : null;
  const appliedStyleSummary = !normalizedActiveStyleDigest
    ? "当前项目还没有应用作者卡或书级风格卡。"
    : currentBookEntry
      ? `当前项目已应用：书级风格《${currentBookEntry.bookCard.title}》`
      : currentAuthorVersion
        ? `当前项目已应用：作者风格「${expandedAuthorDetail?.card.displayName ?? "未命名作者"}」`
        : "当前项目已应用一张外部文风卡。展开对应作者后会标出具体来源。";

  return (
    <div className="workspace-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="section-title">Style Steering</p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--ink)]">第 1 步 · 先定作品 / 作者文风</h3>
          <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
            从你认可的作品或作者中提炼叙事节奏、对话气质和审稿约束，先定下来，下面的设定整理会立刻沿用。
          </p>
        </div>
        {draft?.styleSteeringCard ? <StatusBadge status="foundation_ready" /> : null}
      </div>

      <div className="mt-4 grid gap-4 text-sm text-[var(--ink-soft)]">
        {sourceIdea ? (
          <CollapsibleSection
            title="来源想法快照"
            eyebrow="Seed"
            description={sourceIdea.deletedAt ? "来源想法已归档，项目里保留的是创建时快照。" : "这是创建项目时带进来的想法快照。"}
            defaultOpen
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-3 text-sm text-[var(--ink-soft)]">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-[var(--ink)]">{sourceIdea.title}</p>
                <Link href={`/ideas/${sourceIdea.id}`} className="btn-ghost px-3 py-2 text-xs">
                  返回想法区
                </Link>
              </div>
              <p className="leading-7">{sourceIdea.draft?.premise || sourceIdea.draft?.mainline || "这份想法快照还没有一句完整摘要。"}</p>
            </div>
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection
          title="全局作者卡"
          eyebrow="Author Cards"
          description="项目页现在只负责从全局库选卡应用。需要导入 TXT、生成书级风格卡、合并作者风格时，请直接进入作者卡库。"
          defaultOpen={Boolean(sourceIdea)}
          className="bg-[var(--panel-soft)]"
        >
          <div className="grid gap-3">
            <div className={`rounded-2xl border px-4 py-3 ${
              normalizedActiveStyleDigest
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] bg-[var(--panel-soft)]"
            }`}>
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">Current Style</p>
              <p className="mt-2 text-sm font-medium text-[var(--ink)]">{appliedStyleSummary}</p>
            </div>
            {authorCards.length ? authorCards.map((card) => (
              <div key={card.id} className="workspace-item active p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--ink)]">{card.displayName}</p>
                      {expandedAuthorId === card.id && currentAuthorVersion ? (
                        <span className="workspace-pill">当前已应用</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-[var(--ink-soft)]">
                      {card.versionCount} 个版本 · 最新 v{card.latestVersion ?? "-"} · 置信度 {card.latestConfidence ?? "未知"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost px-3 py-2 text-xs"
                      onClick={() => onToggleAuthorCard(card.id)}
                    >
                      {expandedAuthorId === card.id ? "收起书卡" : "展开书卡"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-3 py-2 text-xs"
                      disabled={applyAuthorCardPending || (expandedAuthorId === card.id && Boolean(currentAuthorVersion))}
                      onClick={() => onApplyAuthorCard(card.id)}
                    >
                      {expandedAuthorId === card.id && currentAuthorVersion ? "当前已应用" : "应用作者风格"}
                    </button>
                  </div>
                </div>
                {expandedAuthorId === card.id ? (
                  <div className="mt-4 grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                    {authorCardDetailLoading ? (
                      <p className="text-sm text-[var(--ink-soft)]">正在载入这位作者的书级风格卡…</p>
                    ) : expandedAuthorDetail ? (
                      <>
                        {expandedAuthorDetail.versions[0] ? (
                          <p className="text-sm leading-7 text-[var(--ink-soft)]">
                            {expandedAuthorDetail.versions[0].styleDigest}
                          </p>
                        ) : (
                          <p className="text-sm text-[var(--ink-soft)]">这个作者还没有合并后的 author 风格。</p>
                        )}
                        <div className="grid gap-2">
                          {visibleBookCards.length ? visibleBookCards.map(({ bookCard, hiddenCount }) => {
                            const isCurrentBook = normalizeDigest(bookCard.styleDigest) === normalizedActiveStyleDigest;
                            return (
                              <div
                                key={bookCard.id}
                                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3"
                              >
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-[var(--ink)]">{bookCard.title}</p>
                                    {isCurrentBook ? <span className="workspace-pill">当前已应用</span> : null}
                                  </div>
                                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                    书级风格卡 · 置信度 {bookCard.confidence} · {new Date(bookCard.createdAt).toLocaleString("zh-CN")}
                                  </p>
                                  {hiddenCount > 0 ? (
                                    <p className="mt-1 text-xs text-[var(--ink-faint)]">同源重复版本已折叠 {hiddenCount} 张。</p>
                                  ) : null}
                                  <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">{bookCard.styleDigest}</p>
                                </div>
                                <button
                                  type="button"
                                  className="btn-secondary px-3 py-2 text-xs"
                                  disabled={applyBookCardPending || isCurrentBook}
                                  onClick={() => onApplyBookCard(bookCard.id)}
                                >
                                  {isCurrentBook ? "当前已应用" : "应用此书风格"}
                                </button>
                              </div>
                            );
                          }) : (
                            <p className="text-sm text-[var(--ink-soft)]">这个作者还没有书级风格卡。</p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-[var(--ink-soft)]">暂时无法读取作者卡详情。</p>
                    )}
                  </div>
                ) : null}
              </div>
            )) : (
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                全局作者卡库还没有内容。先去作者卡库创建作者并导入文本，生成后的作者卡和书卡都会在这里可用。
              </div>
            )}
            <Link href="/authors" className="btn-ghost w-fit px-3 py-2 text-xs">
              打开作者卡库
            </Link>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="使用说明"
          eyebrow="Guide"
          description="这块会保留，但默认不必一直摊开。"
          className="bg-[var(--panel-soft)]"
        >
          <p className="text-sm leading-7 text-[var(--ink-soft)]">
            搜索候选后，选 1 个主参考和最多 2 个辅参考，再补充想借鉴和想规避的要素，系统会边生成边显示风格约束卡。
          </p>
        </CollapsibleSection>

        <div>
          <label className="form-label">联网搜索书 / 作者候选</label>
          <div className="mt-2 flex gap-2">
            <input
              className="form-input flex-1"
              value={styleQuery}
              onChange={(event) => onStyleQueryChange(event.target.value)}
              placeholder="例如：冷峻现实、悬疑推进、群像作者"
            />
            <button
              className="btn-secondary"
              disabled={!styleQuery.trim() || styleSearchPending || isStyleStreaming}
              onClick={onSearch}
            >
              {styleSearchPending ? "搜索中…" : "搜索候选"}
            </button>
          </div>
          {styleSourceLabel ? (
            <p className="mt-2 text-xs text-[var(--ink-soft)]">当前来源：{styleSourceLabel}</p>
          ) : null}
        </div>

        <div className="grid gap-3">
          {referencePool.length ? referencePool.map((candidate) => {
            const key = getReferenceKey(candidate);
            const isPrimary = primaryStyleKey === key;
            const isSecondary = secondaryStyleKeys.includes(key);
            return (
              <div key={`${projectId}-${key}`} className="workspace-item active p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{renderReferenceLabel(candidate)}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                      {candidate.kind === "book" ? "书" : "作者"} · {candidate.source === "network" ? "联网" : "系统检索"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={isPrimary ? "btn-primary px-3 py-2 text-xs" : "btn-secondary px-3 py-2 text-xs"}
                      disabled={isStyleStreaming}
                      onClick={() => onSelectPrimary(key)}
                    >
                      {isPrimary ? "主参考" : "设为主参考"}
                    </button>
                    <button
                      type="button"
                      className={isSecondary ? "btn-primary px-3 py-2 text-xs" : "btn-ghost px-3 py-2 text-xs"}
                      disabled={isStyleStreaming || (!isSecondary && secondaryStyleKeys.length >= 2)}
                      onClick={() => onToggleSecondary(key)}
                    >
                      {isSecondary ? "辅参考已选" : "设为辅参考"}
                    </button>
                  </div>
                </div>
                <p className="mt-3 leading-7">{candidate.hint}</p>
                {candidate.origin ? <p className="mt-2 text-xs text-[var(--ink-soft)]">来源：{candidate.origin}</p> : null}
              </div>
            );
          }) : (
            <p>先搜一次候选，或者直接沿用已经确认的主辅参考。</p>
          )}
        </div>

        <div className="grid gap-3">
          <label className="grid gap-2">
            <span className="form-label">想借什么</span>
            <textarea
              className="form-input min-h-[84px] resize-none"
              value={manualGuidance}
              onChange={(event) => onManualGuidanceChange(event.target.value)}
              disabled={isStyleStreaming}
              placeholder="例如：借节奏的利落、对话的潜台词密度、情绪推进的克制感。"
            />
          </label>
          <label className="grid gap-2">
            <span className="form-label">不要什么</span>
            <textarea
              className="form-input min-h-[84px] resize-none"
              value={avoidances}
              onChange={(event) => onAvoidancesChange(event.target.value)}
              disabled={isStyleStreaming}
              placeholder="例如：不要大段解释性总结、不要句式平均化、不要空泛心理复述。"
            />
          </label>
          <label className="grid gap-2">
            <span className="form-label">代表性样本文本（可选）</span>
            <textarea
              className="form-input min-h-[120px] resize-y"
              value={styleSamples}
              onChange={(event) => onStyleSamplesChange(event.target.value)}
              disabled={isStyleStreaming}
              placeholder={`可粘贴 1-3 段你认可的代表性文本；多段之间用 ${styleSampleDelimiter.trim()} 分隔。`}
            />
          </label>
        </div>

        <button
          className="btn-primary w-full justify-center"
          disabled={!primaryStyleKey || isStyleStreaming}
          onClick={onSave}
        >
          {isStyleStreaming ? "文风约束卡生成中" : "确认文风约束卡"}
        </button>

        {styleProgressNode}

        {visibleStyleCard ? (
          <CollapsibleSection
            title="当前风格卡"
            eyebrow="Style Card"
            description="长文本默认折起，需要时再展开细看。"
            defaultOpen={false}
            className="bg-[var(--panel-soft)]"
          >
            <pre className="whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">{visibleStyleCard}</pre>
          </CollapsibleSection>
        ) : (
          <p className="text-sm text-[var(--ink-soft)]">确认主辅参考后，系统将生成风格约束卡。</p>
        )}
      </div>
    </div>
  );
}

export const StyleReferenceSelector = memo(StyleReferenceSelectorImpl);
