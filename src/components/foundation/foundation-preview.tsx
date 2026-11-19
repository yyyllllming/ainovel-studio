"use client";

import { memo, useCallback } from "react";
import type {
  FoundationCharacterRejection,
  FoundationCharacterSuggestion,
  DerivedFoundationMeta,
  FoundationDraft,
  FoundationPayload,
  FoundationStructuredSuggestions,
} from "@/lib/types";
import { ScrollText, Sparkles } from "lucide-react";
import { CollapsibleSection } from "@/components/collapsible-section";
import { StatusBadge } from "@/components/status-badge";

interface StructuredSuggestionRowProps {
  id: string;
  title: string;
  body: React.ReactNode;
  disabled: boolean;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
}

const StructuredSuggestionRow = memo(function StructuredSuggestionRow({
  id,
  title,
  body,
  disabled,
  onApply,
  onDismiss,
}: StructuredSuggestionRowProps) {
  const handleApply = useCallback(() => onApply(id), [onApply, id]);
  const handleDismiss = useCallback(() => onDismiss(id), [onDismiss, id]);
  return (
    <div className="workspace-item active grid gap-3 p-3">
      <div>
        <p className="font-semibold text-[var(--ink)]">{title}</p>
        {body}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={disabled} onClick={handleApply}>
          写入草稿
        </button>
        <button type="button" className="btn-secondary" disabled={disabled} onClick={handleDismiss}>
          忽略
        </button>
      </div>
    </div>
  );
});

interface FoundationPreviewProps {
  draft?: FoundationDraft | null;
  derivedFoundation: FoundationPayload | null;
  derivedFoundationMeta: DerivedFoundationMeta | null;
  aiCharacterSuggestions?: FoundationCharacterSuggestion[];
  rejectionStats?: { total: number };
  recentRejections?: FoundationCharacterRejection[];
  structuredSuggestions: FoundationStructuredSuggestions | null;
  foundation: FoundationPayload | null;
  foundationLocked: boolean;
  coreDrift: boolean;
  readyToGenerate: boolean;
  structuredSuggestionsMutationPending: boolean;
  onGenerateStructuredSuggestions: () => void;
  onRefreshStructuredSuggestions: () => void;
  onApplyStructuredSuggestion: (suggestionId: string) => void;
  onDismissStructuredSuggestion: (suggestionId: string) => void;
  draftProgressNode: React.ReactNode;
}

function FoundationPreviewImpl({
  draft,
  derivedFoundation,
  derivedFoundationMeta,
  aiCharacterSuggestions,
  rejectionStats,
  recentRejections,
  structuredSuggestions,
  foundation,
  foundationLocked,
  coreDrift,
  readyToGenerate,
  structuredSuggestionsMutationPending,
  onGenerateStructuredSuggestions,
  onRefreshStructuredSuggestions,
  onApplyStructuredSuggestion,
  onDismissStructuredSuggestion,
  draftProgressNode,
}: FoundationPreviewProps) {
  const hasStructuredSuggestions = Boolean(
    structuredSuggestions
    && (structuredSuggestions.characters.length > 0 || structuredSuggestions.worldRules.length > 0),
  );
  const structuredSuggestionCount = (structuredSuggestions?.characters.length ?? 0) + (structuredSuggestions?.worldRules.length ?? 0);
  const structuredSuggestionsActionDisabled = structuredSuggestionsMutationPending || (foundationLocked && !coreDrift);
  const structuredSuggestionsAreFresh = structuredSuggestions?.status === "fresh";

  return (
    <div className="grid gap-4">
      <div className="workspace-panel p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            <h3 className="text-lg font-semibold">当前工作草案</h3>
          </div>
          {readyToGenerate ? <StatusBadge status="foundation_ready" /> : null}
        </div>
        <div className="mt-4 grid gap-4 text-sm text-[var(--ink-soft)]">
          {draftProgressNode}
          <CollapsibleSection
            title="结构化建议"
            eyebrow="Suggestions"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {structuredSuggestionCount} 条
              </span>
            )}
            defaultOpen={Boolean(hasStructuredSuggestions)}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-3 text-sm text-[var(--ink-soft)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[var(--ink)]">面向当前草稿的可应用建议</span>
                  {structuredSuggestions ? (
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {structuredSuggestions.status === "fresh"
                        ? "Fresh"
                        : structuredSuggestions.status === "stale"
                          ? "Stale"
                          : "Empty"}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={structuredSuggestionsActionDisabled}
                  onClick={structuredSuggestions ? onRefreshStructuredSuggestions : onGenerateStructuredSuggestions}
                >
                  {structuredSuggestionsMutationPending
                    ? "处理中..."
                    : structuredSuggestions
                      ? "刷新建议"
                      : "生成建议"}
                </button>
              </div>
              {!structuredSuggestions ? (
                <p>当前还没有结构化建议，可以先生成一轮，把潜在角色和世界规则拉成可操作项。</p>
              ) : structuredSuggestions.status === "stale" ? (
                <p>这批建议基于旧草稿生成，暂时只供参考；要继续应用，请先刷新。</p>
              ) : structuredSuggestions.status === "empty" ? (
                <p>当前草稿已经把可提炼的建议吃得差不多了，暂时没有新的结构化建议。</p>
              ) : null}
              {structuredSuggestions?.characters.length ? (
                <div className="grid gap-2">
                  <p className="font-semibold text-[var(--ink)]">角色建议</p>
                  {structuredSuggestions.characters.map((character) => (
                    <StructuredSuggestionRow
                      key={character.id}
                      id={character.id}
                      title={character.canonicalName}
                      body={(
                        <>
                          <p className="mt-1 leading-7">{character.role} / 目标：{character.goal}</p>
                          <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">
                            {character.traits.join(" / ")}
                            {character.rationale ? ` · ${character.rationale}` : ""}
                          </p>
                        </>
                      )}
                      disabled={!structuredSuggestionsAreFresh || structuredSuggestionsActionDisabled}
                      onApply={onApplyStructuredSuggestion}
                      onDismiss={onDismissStructuredSuggestion}
                    />
                  ))}
                </div>
              ) : null}
              {structuredSuggestions?.worldRules.length ? (
                <div className="grid gap-2">
                  <p className="font-semibold text-[var(--ink)]">世界规则建议</p>
                  {structuredSuggestions.worldRules.map((rule) => (
                    <StructuredSuggestionRow
                      key={rule.id}
                      id={rule.id}
                      title={rule.name}
                      body={(
                        <>
                          <p className="mt-1 leading-7">{rule.description}</p>
                          {rule.rationale ? (
                            <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">{rule.rationale}</p>
                          ) : null}
                        </>
                      )}
                      disabled={!structuredSuggestionsAreFresh || structuredSuggestionsActionDisabled}
                      onApply={onApplyStructuredSuggestion}
                      onDismiss={onDismissStructuredSuggestion}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title="核心概念"
            eyebrow="Draft"
            description="Premise、主线、钩子和语气基调集中看。"
            defaultOpen
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-4 text-sm text-[var(--ink-soft)]">
              <div>
                <p className="font-semibold text-[var(--ink)]">Premise</p>
                <p className="mt-2 leading-7">{draft?.premise || "还在整理中。"}</p>
              </div>
              <div>
                <p className="font-semibold text-[var(--ink)]">主线梗概</p>
                <p className="mt-2 leading-7">{draft?.mainline || "主线还在打磨中。"}</p>
              </div>
              <div>
                <p className="font-semibold text-[var(--ink)]">故事钩子</p>
                <p className="mt-2 leading-7">{draft?.storyHook || "待补充。"}</p>
              </div>
              <div>
                <p className="font-semibold text-[var(--ink)]">语气基调</p>
                <p className="mt-2 leading-7">
                  {draft?.desiredTone && draft.desiredTone !== "default"
                    ? draft.desiredTone
                    : "尚未设定。"}
                </p>
              </div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title="角色草案"
            eyebrow="Characters"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {draft?.characterIdeas.length ?? 0} 人
              </span>
            )}
            defaultOpen={Boolean((draft?.characterIdeas.length ?? 0) > 0 && (draft?.characterIdeas.length ?? 0) <= 2)}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
              {draft?.characterIdeas.length ? draft.characterIdeas.map((character) => (
                <div key={`${character.name}-${character.role}`} className="workspace-item active p-3">
                  <p className="font-semibold text-[var(--ink)]">{character.name}</p>
                  <p className="mt-1 leading-7">{character.role} / 目标：{character.goal}</p>
                </div>
              )) : <p>当前没有结构化角色草案；整理正式设定时会从对话中补抽实名角色。</p>}
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title="世界观草案"
            eyebrow="World"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {draft?.worldviewIdeas.length ?? 0} 条
              </span>
            )}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
              {draft?.worldviewIdeas.length ? draft.worldviewIdeas.map((rule) => (
                <div key={rule.name} className="workspace-item active p-3">
                  <p className="font-semibold text-[var(--ink)]">{rule.name}</p>
                  <p className="mt-1 leading-7">{rule.description}</p>
                </div>
              )) : <p>还没有稳定的世界规则草案。</p>}
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title="待回答问题"
            eyebrow="Loose Ends"
            summaryRight={(
              <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                {draft?.unresolvedQuestions.length ?? 0} 条
              </span>
            )}
            className="bg-[var(--panel-soft)]"
          >
            <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
              {draft?.unresolvedQuestions.length ? draft.unresolvedQuestions.map((question, index) => (
                <div key={`${question}-${index}`} className="workspace-item active p-3">{question}</div>
              )) : <p>当前草案没有明显缺口，可以尝试整理正式设定。</p>}
            </div>
          </CollapsibleSection>
        </div>
      </div>

      <div className="workspace-panel p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-[var(--accent)]" />
            <h3 className="text-lg font-semibold">第 3 步 · 正式设定</h3>
          </div>
          {foundation ? <StatusBadge status={foundationLocked ? "foundation_locked" : "foundation_ready"} /> : null}
        </div>
        {!foundation && !derivedFoundation ? (
          <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">工作草案就绪后，点击“整理为正式设定”生成可锁定的最终版本。</p>
        ) : (
          <div className="mt-4 grid gap-4 text-sm text-[var(--ink-soft)]">
            {derivedFoundation ? (
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-muted)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">候选正式稿</p>
                    <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">
                      根据当前草稿、确认卡和文风约束实时推导，还没有写进项目正式稿。
                    </p>
                  </div>
                  {derivedFoundationMeta?.coverage ? (
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {derivedFoundationMeta.coverage.characterCount} 角 / {derivedFoundationMeta.coverage.worldviewCount} 规
                    </span>
                  ) : null}
                </div>
                {derivedFoundationMeta?.staleComparedToPersisted ? (
                  <p className="mt-3 text-sm leading-6 text-[var(--ink)]">
                    草稿比已保存正式稿更新。点击“整理为正式设定”后，右侧正式稿才会同步。
                  </p>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
                    当前候选稿和已保存正式稿一致，继续补充时这里会先变化。
                  </p>
                )}
              </div>
            ) : null}
            {derivedFoundation ? (
              <>
                <CollapsibleSection
                  title="候选 premise"
                  eyebrow="Derived"
                  defaultOpen
                  className="bg-[var(--panel-soft)]"
                >
                  <p className="text-sm leading-7 text-[var(--ink-soft)]">{derivedFoundation.premise}</p>
                </CollapsibleSection>
                <CollapsibleSection
                  title="AI 建议角色"
                  eyebrow="Derived Characters"
                  summaryRight={(
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {aiCharacterSuggestions?.length ?? 0} 人
                    </span>
                  )}
                  className="bg-[var(--panel-soft)]"
                >
                  <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                    {(aiCharacterSuggestions?.length ?? 0) > 0 ? aiCharacterSuggestions?.map((character, index) => (
                      <div key={`${character.canonicalName}-${character.role}-${index}`} className="workspace-item active p-3">
                        <p className="font-semibold text-[var(--ink)]">{character.canonicalName}</p>
                        <p className="mt-1 leading-7">{character.role} / 目标：{character.goal}</p>
                      </div>
                    )) : <p>当前没有新的 AI 角色建议。</p>}
                  </div>
                </CollapsibleSection>
                <CollapsibleSection
                  title="已拒绝"
                  eyebrow="Rejected"
                  summaryRight={(
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {rejectionStats?.total ?? 0} 条
                    </span>
                  )}
                  className="bg-[var(--panel-soft)]"
                >
                  <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                    {(recentRejections?.length ?? 0) > 0 ? recentRejections?.map((item, index) => (
                      <div key={`${item.rawName}-${item.reason}-${index}`} className="workspace-item active p-3">
                        <p className="font-semibold text-[var(--ink)]">{item.rawName}</p>
                        <p className="mt-1 leading-7">{item.reason}</p>
                      </div>
                    )) : <p>当前没有新的脏角色候选。</p>}
                  </div>
                </CollapsibleSection>
                <CollapsibleSection
                  title="候选世界观"
                  eyebrow="Derived World"
                  summaryRight={(
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {derivedFoundation.worldview.length} 条
                    </span>
                  )}
                  className="bg-[var(--panel-soft)]"
                >
                  <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                    {derivedFoundation.worldview.map((rule) => (
                      <div key={rule.name} className="workspace-item active p-3">
                        <p className="font-semibold text-[var(--ink)]">{rule.name}</p>
                        <p className="mt-1 leading-7">{rule.description}</p>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              </>
            ) : null}
            {foundation ? (
              <div className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--azure)_8%,transparent)] p-4">
                <p className="font-semibold text-[var(--ink)]">已保存正式设定</p>
                <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">
                  只有点过“整理为正式设定”的版本才会写进项目和后续写作流程。
                </p>
              </div>
            ) : null}
            {foundation ? (
              <>
                <CollapsibleSection
                  title="最终 premise"
                  eyebrow="Foundation"
                  defaultOpen={!derivedFoundation}
                  className="bg-[var(--panel-soft)]"
                >
                  <p className="text-sm leading-7 text-[var(--ink-soft)]">{foundation.premise}</p>
                </CollapsibleSection>
                <CollapsibleSection
                  title="固定角色"
                  eyebrow="Characters"
                  summaryRight={(
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {foundation.characters.length} 人
                    </span>
                  )}
                  className="bg-[var(--panel-soft)]"
                >
                  <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                    {foundation.characters.map((character) => (
                      <div key={`${character.name}-${character.role}`} className="workspace-item active p-3">
                        <p className="font-semibold text-[var(--ink)]">{character.name}</p>
                        <p className="mt-1 leading-7">{character.role} / 目标：{character.goal}</p>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
                <CollapsibleSection
                  title="正式世界观"
                  eyebrow="World"
                  summaryRight={(
                    <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
                      {foundation.worldview.length} 条
                    </span>
                  )}
                  className="bg-[var(--panel-soft)]"
                >
                  <div className="grid gap-2 text-sm text-[var(--ink-soft)]">
                    {foundation.worldview.map((rule) => (
                      <div key={rule.name} className="workspace-item active p-3">
                        <p className="font-semibold text-[var(--ink)]">{rule.name}</p>
                        <p className="mt-1 leading-7">{rule.description}</p>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export const FoundationPreview = memo(FoundationPreviewImpl);
