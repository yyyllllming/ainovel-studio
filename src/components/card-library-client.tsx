"use client";

import { useEffect, useMemo, useState } from "react";
import { BookMarked, Globe2, Plus, UserRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { validateCharacterName } from "@/lib/character-name-policy";
import type {
  CardEditorState,
  CardMessage,
  CardProgression,
  CardTab,
  ProjectCard,
} from "@/lib/types";
import { CardDetailPanel } from "./cards/card-detail-panel.tsx";
import {
  buildCardDraft,
  emptyCardEditorState,
  parseList,
  toCardEditorState,
} from "./cards/card-editor-utils.ts";
import { CardListSidebar } from "./cards/card-list-sidebar.tsx";
import { useConfirm } from "./confirm-dialog.tsx";

export function CardLibraryClient({
  projectId,
  defaultTab = "character",
}: {
  projectId: string;
  defaultTab?: CardTab;
}) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [activeTab, setActiveTab] = useState<CardTab>(defaultTab);
  // 父级切换 characterBook/worldBook 时，复用同一实例并同步 tab，避免 unmount/重新加载 chunk。
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newCardName, setNewCardName] = useState("");
  const [newCardType, setNewCardType] = useState<CardTab>("character");
  const [workshopDrafts, setWorkshopDrafts] = useState<Record<string, string>>({});
  const [editorState, setEditorState] = useState<CardEditorState>(emptyCardEditorState);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardsQuery = useQuery({
    // 与 use-project-queries 的 confirmed-only 卡片查询区分缓存，避免互相覆盖。
    queryKey: ["cards", projectId, { includeDraft: true }],
    queryFn: () =>
      apiGet<{ cards: ProjectCard[]; candidateCount: number }>(
        `/api/projects/${projectId}/cards?includeDraft=1`,
      ),
  });

  const cards = useMemo(() => cardsQuery.data?.cards ?? [], [cardsQuery.data?.cards]);
  const filteredCards = cards.filter((card) => card.cardType === activeTab);
  const effectiveSelectedCardId =
    selectedCardId && filteredCards.some((card) => card.id === selectedCardId)
      ? selectedCardId
      : (filteredCards[0]?.id ?? null);
  const activeCardId = effectiveSelectedCardId;
  const workshopMessage = (activeCardId && workshopDrafts[activeCardId]) || "";

  const selectedCardQuery = useQuery({
    queryKey: ["card", projectId, effectiveSelectedCardId],
    queryFn: () =>
      apiGet<{ card: ProjectCard; messages: CardMessage[] }>(
        `/api/projects/${projectId}/cards/${effectiveSelectedCardId}`,
      ),
    enabled: !!effectiveSelectedCardId,
  });

  const progressionsQuery = useQuery({
    queryKey: ["card-progressions", projectId, effectiveSelectedCardId],
    queryFn: () =>
      apiGet<{ progressions: CardProgression[] }>(
        `/api/projects/${projectId}/cards/${effectiveSelectedCardId}/progressions`,
      ),
    enabled: !!effectiveSelectedCardId,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<{ card: ProjectCard }>(`/api/projects/${projectId}/cards`, {
        cardType: newCardType,
        name: newCardName.trim(),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["cards", projectId] });
      setShowCreate(false);
      setNewCardName("");
      setSelectedCardId(result.card.id);
      setError(null);
    },
    onError: (error: Error) => setError(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ name, draft, meta }: { name?: string; draft?: Record<string, unknown>; meta?: ProjectCard["meta"] }) => {
      if (!activeCardId) {
        throw new Error("当前没有可编辑的卡片");
      }
      return apiPatch<{ card: ProjectCard }>(`/api/projects/${projectId}/cards/${activeCardId}`, {
        name,
        draft,
        meta,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card", projectId, activeCardId] });
      queryClient.invalidateQueries({ queryKey: ["cards", projectId] });
      queryClient.invalidateQueries({ queryKey: ["card-progressions", projectId, activeCardId] });
      setEditMode(false);
      setError(null);
    },
    onError: (error: Error) => setError(error.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (action: "confirm" | "unconfirm") => {
      if (!activeCardId) {
        throw new Error("当前没有可确认的卡片");
      }
      return apiPost(`/api/projects/${projectId}/cards/${activeCardId}/confirm`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["card", projectId, activeCardId] });
      queryClient.invalidateQueries({ queryKey: ["cards", projectId] });
    },
    onError: (error: Error) => setError(error.message),
  });

  const workshopMutation = useMutation({
    mutationFn: () => {
      if (!activeCardId) {
        throw new Error("当前没有可编辑的卡片");
      }
      return apiPost(`/api/projects/${projectId}/cards/${activeCardId}/workshop`, {
        message: workshopMessage,
      });
    },
    onSuccess: () => {
      if (activeCardId) {
        setWorkshopDrafts((current) => ({
          ...current,
          [activeCardId]: "",
        }));
      }
      queryClient.invalidateQueries({ queryKey: ["card", projectId, activeCardId] });
    },
    onError: (error: Error) => setError(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!activeCardId) {
        throw new Error("当前没有可删除的卡片");
      }
      return apiDelete(`/api/projects/${projectId}/cards/${activeCardId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards", projectId] });
      setSelectedCardId(null);
      setError(null);
    },
    onError: (error: Error) => setError(error.message),
  });

  const selectedCard = selectedCardQuery.data?.card ?? null;
  const messages = selectedCardQuery.data?.messages ?? [];
  const progressions = progressionsQuery.data?.progressions ?? [];
  const candidateCount = cardsQuery.data?.candidateCount ?? 0;
  const cardSummary = useMemo(
    () => ({
      character: cards.filter((card) => card.cardType === "character").length,
      world: cards.filter((card) => card.cardType === "world").length,
      confirmed: cards.filter((card) => card.status === "confirmed").length,
    }),
    [cards],
  );

  function updateWorkshopMessage(value: string) {
    if (!activeCardId) {
      return;
    }
    setWorkshopDrafts((current) => ({
      ...current,
      [activeCardId]: value,
    }));
  }

  function startEdit(card: ProjectCard) {
    setEditMode(true);
    setEditorState(toCardEditorState(card));
  }

  function saveEdit() {
    if (!selectedCard) {
      return;
    }

    if (!editorState.name.trim()) {
      setError("卡片名称不能为空");
      return;
    }

    if (
      selectedCard.cardType === "character"
      && (!editorState.role.trim() || !editorState.goal.trim() || parseList(editorState.traits).length === 0)
    ) {
      setError("角色卡至少要补齐名称、角色定位、目标和特质");
      return;
    }

    if (selectedCard.cardType === "character") {
      const validation = validateCharacterName(editorState.name);
      if (!validation.accepted) {
        setError("角色名必须是完整专有名，不能使用称谓、动作片段或半句");
        return;
      }
    }

    if (selectedCard.cardType === "world" && !editorState.description.trim()) {
      setError("世界书至少要补齐名称和描述");
      return;
    }

    updateMutation.mutate({
      name: editorState.name.trim() || undefined,
      draft: buildCardDraft(selectedCard.cardType, editorState),
      meta: {
        aliases: parseList(editorState.aliases),
        keywords: parseList(editorState.keywords),
        priority: Number(editorState.priority) || 50,
        pinnedScope: editorState.pinnedScope,
        linkedCardIds: parseList(editorState.linkedCardIds),
        enabled: editorState.enabled,
      },
    });
  }

  return (
    <section className="workspace-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-[var(--ink-soft)]">Story Assets</p>
          <h2 className="mt-2 text-2xl font-semibold [font-family:var(--font-serif)]">角色卡与世界书</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--ink-soft)]">
            管理项目中的角色设定与世界规则，支持补充、确认和精修。
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            setNewCardType(activeTab);
          }}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          新建卡片
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="workspace-item active flex items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Character</p>
            <p className="text-lg font-semibold">{cardSummary.character}</p>
          </div>
        </div>
        <div className="workspace-item active flex items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Globe2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Worldbook</p>
            <p className="text-lg font-semibold">{cardSummary.world}</p>
          </div>
        </div>
        <div className="workspace-item active flex items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]">
            <BookMarked className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Confirmed</p>
            <p className="text-lg font-semibold">{cardSummary.confirmed}</p>
          </div>
        </div>
      </div>

      {candidateCount > 0 ? (
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
          当前有 {candidateCount} 张连续章节候选草稿。它们不会自动进入后续写作锚点，需要你手动确认成正式卡。
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {(["character", "world"] as CardTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              setSelectedCardId(null);
              setEditMode(false);
            }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              activeTab === tab
                ? "bg-[var(--accent)] text-[var(--accent-ink)] shadow-[var(--shadow-soft)]"
                : "workspace-pill text-[var(--ink-soft)] hover:bg-[var(--hover)]"
            }`}
          >
            {tab === "character" ? "角色卡" : "世界书"}
            <span className="ml-1.5 text-xs opacity-70">
              {cards.filter((card) => card.cardType === tab).length}
            </span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-3 underline">
            关闭
          </button>
        </div>
      ) : null}

      {showCreate ? (
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
          <p className="mb-3 text-sm font-semibold">新建{newCardType === "character" ? "角色卡" : "世界书"}</p>
          <div className="flex gap-2">
            <select
              value={newCardType}
              onChange={(event) => setNewCardType(event.target.value as CardTab)}
              className="form-input rounded-xl"
            >
              <option value="character">角色卡</option>
              <option value="world">世界书</option>
            </select>
            <input
              value={newCardName}
              onChange={(event) => setNewCardName(event.target.value)}
              placeholder="卡片名称"
              className="form-input flex-1 rounded-xl"
            />
            <button
              onClick={() => {
                if (newCardType === "character") {
                  const validation = validateCharacterName(newCardName);
                  if (!validation.accepted) {
                    setError("角色名必须是完整专有名，不能使用称谓、动作片段或半句");
                    return;
                  }
                }
                createMutation.mutate();
              }}
              disabled={!newCardName.trim() || createMutation.isPending}
              className="rounded-xl bg-[var(--accent)] px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              创建
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="workspace-pill rounded-xl px-3 py-1.5 text-sm text-[var(--ink-soft)]"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <CardListSidebar
          activeTab={activeTab}
          cards={filteredCards}
          isLoading={cardsQuery.isLoading}
          selectedCardId={effectiveSelectedCardId}
          onSelectCard={(cardId) => {
            setSelectedCardId(cardId);
            setEditMode(false);
          }}
        />

        <CardDetailPanel
          card={selectedCard}
          editMode={editMode}
          editorState={editorState}
          onEditorStateChange={(updater) => setEditorState((previous) => updater(previous))}
          onStartEdit={() => {
            if (selectedCard) {
              startEdit(selectedCard);
            }
          }}
          onCancelEdit={() => setEditMode(false)}
          onSaveEdit={saveEdit}
          onToggleConfirm={() => {
            if (selectedCard) {
              confirmMutation.mutate(selectedCard.status === "confirmed" ? "unconfirm" : "confirm");
            }
          }}
          onDelete={async () => {
            if (!selectedCard) return;
            const confirmed = await confirm({
              title: `删除卡片「${selectedCard.name}」`,
              description: "此操作将永久删除该卡片及其所有内容。此操作不可撤销。",
              confirmLabel: "删除",
              variant: "danger",
            });
            if (confirmed) {
              deleteMutation.mutate();
            }
          }}
          confirmPending={confirmMutation.isPending}
          deletePending={deleteMutation.isPending}
          updatePending={updateMutation.isPending}
          progressions={progressions}
          messages={messages}
          workshopMessage={workshopMessage}
          onWorkshopMessageChange={updateWorkshopMessage}
          onWorkshopSubmit={() => workshopMutation.mutate()}
          workshopPending={workshopMutation.isPending}
        />
      </div>
    </section>
  );
}
