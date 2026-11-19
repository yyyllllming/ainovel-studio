"use client";

import type {
  CardEditorState,
  CardMessage,
  CardProgression,
  ProjectCard,
} from "@/lib/types";
import { BookMarked, PenSquare } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import {
  autoMetaLabel,
  normalizeList,
  normalizeText,
} from "./card-editor-utils.ts";

function DetailBlock({
  label,
  value,
}: {
  label: string;
  value: string | string[] | null | undefined;
}) {
  const listValue = Array.isArray(value) ? value.filter(Boolean) : [];
  const textValue = Array.isArray(value) ? "" : value?.trim() ?? "";
  const isEmpty = listValue.length === 0 && !textValue;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">{label}</p>
      {isEmpty ? (
        <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">暂无内容</p>
      ) : listValue.length ? (
        <div className="mt-2 grid gap-2">
          {listValue.map((item, index) => (
            <p key={`${label}-${index}`} className="text-sm leading-7 text-[var(--ink)]">
              {item}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--ink)]">{textValue}</p>
      )}
    </div>
  );
}

interface CardDetailPanelProps {
  card: ProjectCard | null;
  editMode: boolean;
  editorState: CardEditorState;
  onEditorStateChange: (updater: (previous: CardEditorState) => CardEditorState) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggleConfirm: () => void;
  onDelete: () => void;
  confirmPending: boolean;
  deletePending: boolean;
  updatePending: boolean;
  progressions: CardProgression[];
  messages: CardMessage[];
  workshopMessage: string;
  onWorkshopMessageChange: (value: string) => void;
  onWorkshopSubmit: () => void;
  workshopPending: boolean;
}

export function CardDetailPanel({
  card,
  editMode,
  editorState,
  onEditorStateChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleConfirm,
  onDelete,
  confirmPending,
  deletePending,
  updatePending,
  progressions,
  messages,
  workshopMessage,
  onWorkshopMessageChange,
  onWorkshopSubmit,
  workshopPending,
}: CardDetailPanelProps) {
  if (!card) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-8">
        <div className="text-center">
          <p className="text-sm font-medium text-[var(--ink)]">选择左侧卡片查看详情</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            角色卡和世界书是写作流程中的核心参考资产。
          </p>
        </div>
      </div>
    );
  }

  const metaLabels = autoMetaLabel(card.meta);

  return (
    <div className="min-w-0">
      <div className="workspace-panel p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold [font-family:var(--font-serif)]">{card.name}</h3>
            <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
              {card.cardType === "character" ? "角色卡" : "世界书"} ·
              更新于 {new Date(card.updatedAt).toLocaleString("zh-CN")}
            </p>
            {card.cardType === "character" && (card.meta.origin || card.meta.importance) ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.values(metaLabels)
                  .filter(Boolean)
                  .map((label) => (
                    <span
                      key={`${card.id}-${label}`}
                      className="rounded-full bg-[var(--panel-muted)] px-3 py-1 text-[11px] text-[var(--ink-soft)]"
                    >
                      {label}
                    </span>
                  ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onToggleConfirm}
              disabled={confirmPending}
              className="rounded-xl bg-[color-mix(in_srgb,var(--success)_14%,transparent)] px-3 py-1 text-xs text-[var(--success)]"
            >
              <BookMarked className="mr-1 inline h-3.5 w-3.5" />
              {card.status === "confirmed" ? "取消确认" : "确认卡片"}
            </button>
            <button
              onClick={onStartEdit}
              className="rounded-xl border border-[var(--line)] px-3 py-1 text-xs text-[var(--ink)]"
            >
              <PenSquare className="mr-1 inline h-3.5 w-3.5" />
              编辑
            </button>
            <button
              onClick={onDelete}
              disabled={deletePending}
              className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-3 py-1 text-xs text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_24%,transparent)]"
            >
              删除
            </button>
          </div>
        </div>

        <div className="mt-4">
          {editMode ? (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <label className="text-xs text-[var(--ink-soft)]">名称</label>
                <input
                  value={editorState.name}
                  onChange={(event) => onEditorStateChange((previous) => ({ ...previous, name: event.target.value }))}
                  className="form-input rounded-xl"
                />
              </div>

              {card.cardType === "character" ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-xs text-[var(--ink-soft)]">角色定位</span>
                      <input
                        value={editorState.role}
                        onChange={(event) => onEditorStateChange((previous) => ({ ...previous, role: event.target.value }))}
                        className="form-input rounded-xl"
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-xs text-[var(--ink-soft)]">核心目标</span>
                      <input
                        value={editorState.goal}
                        onChange={(event) => onEditorStateChange((previous) => ({ ...previous, goal: event.target.value }))}
                        className="form-input rounded-xl"
                      />
                    </label>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">特质</span>
                    <textarea
                      value={editorState.traits}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, traits: event.target.value }))}
                      rows={3}
                      placeholder="每行一个特质，或用逗号分隔"
                      className="form-input min-h-[88px] w-full resize-y rounded-xl"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">秘密 / 隐藏信息</span>
                    <textarea
                      value={editorState.secrets}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, secrets: event.target.value }))}
                      rows={3}
                      placeholder="可留空"
                      className="form-input min-h-[88px] w-full resize-y rounded-xl"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">背景</span>
                    <textarea
                      value={editorState.background}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, background: event.target.value }))}
                      rows={4}
                      className="form-input min-h-[112px] w-full resize-y rounded-xl"
                    />
                  </label>
                </>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 md:col-span-2">
                    <span className="text-xs text-[var(--ink-soft)]">规则 / 条目描述</span>
                    <textarea
                      value={editorState.description}
                      onChange={(event) =>
                        onEditorStateChange((previous) => ({ ...previous, description: event.target.value }))
                      }
                      rows={5}
                      className="form-input min-h-[128px] w-full resize-y rounded-xl"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">分类</span>
                    <input
                      value={editorState.category}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, category: event.target.value }))}
                      className="form-input rounded-xl"
                    />
                  </label>
                </div>
              )}

              <label className="grid gap-2">
                <span className="text-xs text-[var(--ink-soft)]">备注</span>
                <textarea
                  value={editorState.notes}
                  onChange={(event) => onEditorStateChange((previous) => ({ ...previous, notes: event.target.value }))}
                  rows={4}
                  className="form-input min-h-[112px] w-full resize-y rounded-xl"
                />
              </label>

              <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                <p className="text-sm font-medium text-[var(--ink)]">Lorebook 触发设置</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">别名 / 锚词</span>
                    <textarea
                      value={editorState.aliases}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, aliases: event.target.value }))}
                      rows={3}
                      className="form-input min-h-[88px] w-full resize-y rounded-xl"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">关键词</span>
                    <textarea
                      value={editorState.keywords}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, keywords: event.target.value }))}
                      rows={3}
                      className="form-input min-h-[88px] w-full resize-y rounded-xl"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">优先级</span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      value={editorState.priority}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, priority: event.target.value }))}
                      className="form-input rounded-xl"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">常驻级别</span>
                    <select
                      value={editorState.pinnedScope}
                      onChange={(event) =>
                        onEditorStateChange((previous) => ({
                          ...previous,
                          pinnedScope: event.target.value as CardEditorState["pinnedScope"],
                        }))
                      }
                      className="form-input rounded-xl"
                    >
                      <option value="none">不常驻</option>
                      <option value="chapter">章节常驻</option>
                      <option value="global">全局常驻</option>
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-xs text-[var(--ink-soft)]">联动卡片 ID</span>
                    <textarea
                      value={editorState.linkedCardIds}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, linkedCardIds: event.target.value }))}
                      rows={2}
                      className="form-input min-h-[72px] w-full resize-y rounded-xl"
                    />
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-deep)] px-3 py-3 text-sm text-[var(--ink-soft)]">
                    <input
                      type="checkbox"
                      checked={editorState.enabled}
                      onChange={(event) => onEditorStateChange((previous) => ({ ...previous, enabled: event.target.checked }))}
                    />
                    启用这张卡作为运行时 lore 条目
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={onSaveEdit}
                  disabled={updatePending}
                  className="rounded-xl bg-[var(--accent)] px-4 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  保存
                </button>
                <button
                  onClick={onCancelEdit}
                  className="rounded-xl border border-[var(--line)] px-3 py-1.5 text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              {card.cardType === "character" ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <DetailBlock label="角色定位" value={normalizeText(card.draft.role)} />
                    <DetailBlock label="核心目标" value={normalizeText(card.draft.goal)} />
                  </div>
                  <DetailBlock label="人物特质" value={normalizeList(card.draft.traits)} />
                  <DetailBlock label="秘密 / 隐藏信息" value={normalizeList(card.draft.secrets)} />
                  <DetailBlock label="背景" value={normalizeText(card.draft.background)} />
                  <DetailBlock label="备注" value={normalizeText(card.draft.notes)} />
                </>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <DetailBlock label="分类" value={normalizeText(card.draft.category)} />
                    <DetailBlock label="规则名称" value={normalizeText(card.draft.name) || card.name} />
                  </div>
                  <DetailBlock label="规则描述" value={normalizeText(card.draft.description)} />
                  <DetailBlock label="备注" value={normalizeText(card.draft.notes)} />
                </>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <DetailBlock label="别名 / 锚词" value={card.meta.aliases} />
                <DetailBlock label="关键词" value={card.meta.keywords} />
              </div>
              {card.cardType === "character" && (card.meta.origin || card.meta.importance) ? (
                <div className="grid gap-4 md:grid-cols-3">
                  <DetailBlock label="卡片来源" value={metaLabels.origin} />
                  <DetailBlock label="重要级别" value={metaLabels.importance} />
                  <DetailBlock label="发现阶段" value={metaLabels.stage} />
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-3">
                <DetailBlock label="优先级" value={String(card.meta.priority)} />
                <DetailBlock label="常驻级别" value={card.meta.pinnedScope} />
                <DetailBlock label="是否启用" value={card.meta.enabled ? "启用" : "停用"} />
              </div>
              <DetailBlock label="联动卡片 ID" value={card.meta.linkedCardIds} />
              {card.cardType === "character" && (card.meta.evidence?.length ?? 0) > 0 ? (
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">Evidence</p>
                  <div className="mt-3 grid gap-3">
                    {card.meta.evidence
                      ?.slice()
                      .reverse()
                      .slice(0, 6)
                      .map((item) => (
                        <div
                          key={`${card.id}-evidence-${item.chapterNo}-${item.source}-${item.reason}`}
                          className="rounded-xl border border-[var(--line)] bg-[var(--panel-muted)] px-3 py-3"
                        >
                          <p className="text-xs font-medium text-[var(--ink)]">
                            第 {item.chapterNo} 章 · {item.reason}
                          </p>
                          <p className="mt-1 text-xs text-[var(--ink-soft)]">{item.source}</p>
                          <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{item.snippet}</p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 workspace-panel p-5">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">Progressions</p>
        <h4 className="mt-1 text-lg font-semibold">状态演进历史</h4>
        <div className="mt-4 grid gap-3">
          {progressions.length ? (
            progressions
              .slice()
              .reverse()
              .slice(0, 12)
              .map((progression) => (
                <div key={progression.id} className="workspace-item active px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[var(--ink)]">
                      第 {progression.chapterNo} 章 · {progression.mode} · {progression.targetPath}
                    </p>
                    <StatusBadge status={progression.reviewState === "confirmed" ? "completed" : "blueprint"} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{progression.content}</p>
                </div>
              ))
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)] px-4 py-5 text-sm text-[var(--ink-soft)]">
              暂无演进记录。
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 workspace-panel p-5">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">Workshop</p>
        <h4 className="mt-1 text-lg font-semibold">补充记录</h4>
        <div className="mt-3 grid max-h-72 gap-3 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)] px-4 py-5 text-sm text-[var(--ink-soft)]">
              可以继续补充这张卡片的细节。
            </div>
          ) : null}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`rounded-2xl px-3 py-2 text-sm leading-7 ${
                message.role === "user"
                  ? "ml-8 bg-[var(--accent)]/10 text-[var(--ink)]"
                  : "mr-8 bg-[color-mix(in_srgb,var(--azure)_8%,transparent)] text-[var(--ink)]"
              }`}
            >
              {message.content}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <textarea
            value={workshopMessage}
            onChange={(event) => onWorkshopMessageChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                if (workshopMessage.trim()) {
                  onWorkshopSubmit();
                }
              }
            }}
            placeholder="输入补充内容，Ctrl+Enter 提交…"
            rows={2}
            className="form-input flex-1 min-h-[84px] resize-y rounded-xl"
          />
          <button
            onClick={onWorkshopSubmit}
            disabled={!workshopMessage.trim() || workshopPending}
            className="self-end rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {workshopPending ? "…" : "提交补充"}
          </button>
        </div>
        {workshopMessage.trim() ? (
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            还有未提交的补充内容。提交后再点&quot;确认&quot;，避免把半成品卡片提前锁住。
          </p>
        ) : null}
      </div>
    </div>
  );
}
