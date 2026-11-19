/**
 * useFoundationWorkshopController — 组合 hook。
 *
 * 重构后的版本将逻辑拆分为三个独立 hook：
 *  - useFoundationDraft     → 草稿持久化与 resume 偏好
 *  - useStyleReferences     → 文风参考选择与样本
 *  - useWorkshopStream      → 流式生成与保存
 *
 * 本文件保持原有导出 API 完全不变（向后兼容）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type {
  AuthorCardDetail,
  AuthorCardSummary,
  ConversationMessage,
  DerivedFoundationMeta,
  FoundationDraft,
  FoundationPayload,
  FoundationStructuredSuggestions,
  SourceIdeaSummary,
  StreamProgressState,
  StyleReferenceCandidate,
  WorkshopSnapshot,
} from "@/lib/types";

// ─── re-export 所有原有公开 API，保持向后兼容 ──────────────
export {
  STYLE_SAMPLE_DELIMITER,
  FOUNDATION_WORKSHOP_LIKELY_STUCK_MS,
  FOUNDATION_WORKSHOP_RECOVERY_BANNER_TEXT,
  FOUNDATION_WORKSHOP_DISCARD_TOOLTIP,
  type FoundationWorkshopResumeMode,
  serializeStyleSamples,
  parseStyleSamples,
  getStyleReferenceKey,
  renderStyleReferenceLabel,
  getStyleSourceLabel,
  normalizeOptionalDigest,
  isFoundationWorkshopSessionLikelyStuck,
  getFoundationWorkshopResumeTarget,
  getFoundationWorkshopResumeToggleLabel,
  buildFoundationWorkshopRequestPayload,
  deriveWorkshopProgressFromActiveSession,
  buildDisplayedWorkshopMessages,
  resolveStreamingProgressPresentation,
  createStreamingProgressNode,
} from "./use-foundation-workshop-controller-utils";

import {
  buildDisplayedWorkshopMessages,
  createStreamingProgressNode,
  deriveWorkshopProgressFromActiveSession,
  getStyleReferenceKey,
  renderStyleReferenceLabel,
  resolveStreamingProgressPresentation,
} from "./use-foundation-workshop-controller-utils";
import { useFoundationDraft } from "./use-foundation-draft";
import { useStyleReferences } from "./use-style-references";
import { useWorkshopStream } from "./use-workshop-stream";
import { useFoundationQueries } from "./use-foundation-queries";

// ─── 原有接口类型（完全保留） ────────────────────────────

export interface UseFoundationWorkshopControllerResult {
  headerProps: {
    foundationLocked: boolean;
    readyToGenerate: boolean;
    sourceIdea: SourceIdeaSummary | null;
  };
  styleSelectorProps: {
    projectId: string;
    draft: FoundationDraft | null;
    sourceIdea: SourceIdeaSummary | null;
    authorCards: AuthorCardSummary[];
    expandedAuthorId: string | null;
    expandedAuthorDetail: AuthorCardDetail | null;
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
    getReferenceKey: typeof getStyleReferenceKey;
    renderReferenceLabel: typeof renderStyleReferenceLabel;
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
    styleProgressNode: ReactNode;
    visibleStyleCard: string;
  };
  editorProps: {
    draft: FoundationDraft | null;
    derivedFoundation: FoundationPayload | null;
    derivedFoundationMeta: DerivedFoundationMeta | null;
    aiCharacterSuggestions: WorkshopSnapshot["aiCharacterSuggestions"];
    rejectionStats: WorkshopSnapshot["rejectionStats"];
    recentRejections: WorkshopSnapshot["recentRejections"];
    structuredSuggestions: FoundationStructuredSuggestions | null;
    foundation: FoundationPayload | null;
    foundationLocked: boolean;
    coreDrift: boolean;
    blockingReason: string | null;
    readyToGenerate: boolean;
    displayedMessages: ConversationMessage[];
    message: string;
    isWorkshopStreaming: boolean;
    workshopProgress: StreamProgressState | null;
    workshopProgressNode: ReactNode;
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
    structuredSuggestionsMutationPending: boolean;
    canGenerateFoundation: boolean;
    foundationExists: boolean;
    onMessageChange: (value: string) => void;
    onToggleResumeMode: () => void;
    onSubmit: () => void;
    onGenerateFoundation: () => void;
    onLockFoundation: () => void;
    onGenerateStructuredSuggestions: () => void;
    onRefreshStructuredSuggestions: () => void;
    onApplyStructuredSuggestion: (suggestionId: string) => void;
    onDismissStructuredSuggestion: (suggestionId: string) => void;
    messageListRef: RefObject<HTMLDivElement | null>;
    messagesEndRef: RefObject<HTMLDivElement | null>;
    draftProgressNode: ReactNode;
  };
}

// ─── 主 hook ─────────────────────────────────────────────

export function useFoundationWorkshopController({
  projectId,
  foundation,
  foundationLocked,
  sourceIdea,
}: {
  projectId: string;
  foundation: FoundationPayload | null;
  foundationLocked: boolean;
  sourceIdea?: SourceIdeaSummary | null;
}): UseFoundationWorkshopControllerResult {
  const [expandedAuthorId, setExpandedAuthorId] = useState<string | null>(null);
  const [styleQuery, setStyleQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);

  // ── 数据查询 ──────────────────────────────────────────
  const {
    workshopQuery,
    authorCardsQuery,
    expandedAuthorQuery,
    foundationMutation,
    lockMutation,
    styleSearchMutation,
    structuredSuggestionsMutation,
    applyAuthorCardMutation,
    applyBookCardMutation,
    styleCandidates,
    styleSource,
  } = useFoundationQueries(projectId, expandedAuthorId);

  const draft = workshopQuery.data?.state?.draft ?? null;
  const activeSession = workshopQuery.data?.activeSession ?? null;

  // ── 文风参考 ──────────────────────────────────────────
  const style = useStyleReferences({
    draft,
    foundation: foundation as { styleDigest?: string } | null,
    styleCandidates,
    styleSource,
  });

  // ── 流式生成（需要先获取 isLocalStreaming） ──────────────
  const stream = useWorkshopStream({
    projectId,
    draft,
    draftHooks: {
      clearMessage: () => draftHook.clearMessage(),
      restoreMessage: (text: string) => draftHook.restoreMessage(text),
      setPendingUserMessage: (value: string) => draftHook.setPendingUserMessage(value),
      resetResumePreference: () => draftHook.resetResumePreference(),
      getResumeMode: () => draftHook.resumeMode,
    },
    styleHooks: {
      buildStylePayload: style.buildStylePayload,
      setStyleProgress: style.setStyleProgress,
      resetStyleInputs: style.resetStyleInputs,
    },
    activeSession,
  });

  // ── 草稿持久化 ────────────────────────────────────────
  const draftHook = useFoundationDraft({
    projectId,
    activeSession,
    isLocalStreaming: stream.isLocalStreaming,
  });

  // ── 派生状态 ──────────────────────────────────────────
  const isWorkshopStreaming = Boolean(stream.workshopProgress) || activeSession?.status === "running";
  const derivedWorkshopProgress =
    stream.workshopProgress ?? deriveWorkshopProgressFromActiveSession(activeSession);

  const displayedMessages = useMemo<ConversationMessage[]>(() => {
    return buildDisplayedWorkshopMessages({
      baseMessages: workshopQuery.data?.messages ?? [],
      localPendingUserMessage: draftHook.pendingUserMessage,
      localStreamingAssistantMessage: stream.streamingAssistantMessage,
      isLocalStreaming: stream.isLocalStreaming,
      activeSession,
    });
  }, [
    activeSession,
    stream.isLocalStreaming,
    draftHook.pendingUserMessage,
    stream.streamingAssistantMessage,
    workshopQuery.data?.messages,
  ]);

  // ── 滚动跟随：流式期间用 rAF 合并，避免每个 chunk 触发一次重排 ──
  const scrollFrameRef = useRef<number | null>(null);
  useEffect(() => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [displayedMessages.length, isWorkshopStreaming, stream.streamingAssistantMessage]);

  // ── Progress UI ────────────────────────────────────────
  const workshopProgressPresentation = derivedWorkshopProgress
    ? resolveStreamingProgressPresentation(derivedWorkshopProgress)
    : null;
  const workshopProgressNode = derivedWorkshopProgress ? createStreamingProgressNode({
    title: "设定流程正在实时整理",
    detail: derivedWorkshopProgress.message,
    progress: derivedWorkshopProgress.progress,
    indeterminate: workshopProgressPresentation?.indeterminate,
    label: workshopProgressPresentation?.label,
  }) : null;

  const draftProgressNode = derivedWorkshopProgress ? createStreamingProgressNode({
    title: "工作草案同步中",
    detail: derivedWorkshopProgress.message,
    progress: derivedWorkshopProgress.progress,
    indeterminate: workshopProgressPresentation?.indeterminate,
    label: workshopProgressPresentation?.label,
  }) : null;

  // ── 稳定回调（避免每次 render 都新建闭包，破坏子组件 React.memo） ──
  const onApplyAuthorCard = useCallback(
    (authorCardId: string) => applyAuthorCardMutation.mutate(authorCardId),
    [applyAuthorCardMutation],
  );
  const onApplyBookCard = useCallback(
    (bookCardId: string) => {
      if (!expandedAuthorId) return;
      applyBookCardMutation.mutate({ authorCardId: expandedAuthorId, bookCardId });
    },
    [applyBookCardMutation, expandedAuthorId],
  );
  const onToggleAuthorCard = useCallback(
    (authorCardId: string) =>
      setExpandedAuthorId((current) => (current === authorCardId ? null : authorCardId)),
    [],
  );
  const onSearch = useCallback(
    () => styleSearchMutation.mutate(styleQuery),
    [styleSearchMutation, styleQuery],
  );
  const onSave = useCallback(
    () => stream.handleSaveStyleSteering(style.isStyleStreaming),
    [stream, style.isStyleStreaming],
  );
  const onSubmit = useCallback(
    () => stream.handleSendWorkshopMessage(draftHook.message, foundationLocked),
    [stream, draftHook.message, foundationLocked],
  );
  const onGenerateFoundation = useCallback(
    () => foundationMutation.mutate(),
    [foundationMutation],
  );
  const onLockFoundation = useCallback(() => lockMutation.mutate(), [lockMutation]);
  const onGenerateStructuredSuggestions = useCallback(
    () => structuredSuggestionsMutation.mutate({ action: "generate" }),
    [structuredSuggestionsMutation],
  );
  const onRefreshStructuredSuggestions = useCallback(
    () => structuredSuggestionsMutation.mutate({ action: "refresh" }),
    [structuredSuggestionsMutation],
  );
  const onApplyStructuredSuggestion = useCallback(
    (suggestionId: string) =>
      structuredSuggestionsMutation.mutate({ action: "apply", suggestionId }),
    [structuredSuggestionsMutation],
  );
  const onDismissStructuredSuggestion = useCallback(
    (suggestionId: string) =>
      structuredSuggestionsMutation.mutate({ action: "dismiss", suggestionId }),
    [structuredSuggestionsMutation],
  );

  // ── 组装返回值（保持原有形状，但用 useMemo 稳定引用） ─────
  const readyToGenerate = Boolean(workshopQuery.data?.state?.readyToGenerate);

  const headerProps = useMemo<UseFoundationWorkshopControllerResult["headerProps"]>(
    () => ({
      foundationLocked,
      readyToGenerate,
      sourceIdea: sourceIdea ?? null,
    }),
    [foundationLocked, readyToGenerate, sourceIdea],
  );

  const styleSelectorProps = useMemo<UseFoundationWorkshopControllerResult["styleSelectorProps"]>(
    () => ({
      projectId,
      draft,
      sourceIdea: sourceIdea ?? null,
      authorCards: authorCardsQuery.data?.authors ?? [],
      expandedAuthorId,
      expandedAuthorDetail: expandedAuthorQuery.data ?? null,
      authorCardDetailLoading: expandedAuthorQuery.isLoading,
      applyAuthorCardPending: applyAuthorCardMutation.isPending,
      applyBookCardPending: applyBookCardMutation.isPending,
      activeStyleDigest: style.activeStyleDigest,
      onApplyAuthorCard,
      onApplyBookCard,
      onToggleAuthorCard,
      styleQuery,
      onStyleQueryChange: setStyleQuery,
      onSearch,
      styleSearchPending: styleSearchMutation.isPending,
      isStyleStreaming: style.isStyleStreaming,
      styleSourceLabel: style.styleSourceLabel,
      referencePool: style.referencePool,
      primaryStyleKey: style.primaryStyleKey,
      secondaryStyleKeys: style.secondaryStyleKeys,
      getReferenceKey: getStyleReferenceKey,
      renderReferenceLabel: renderStyleReferenceLabel,
      onSelectPrimary: style.onSelectPrimary,
      onToggleSecondary: style.onToggleSecondary,
      manualGuidance: style.manualGuidance,
      onManualGuidanceChange: style.onManualGuidanceChange,
      avoidances: style.avoidances,
      onAvoidancesChange: style.onAvoidancesChange,
      styleSamples: style.styleSamples,
      styleSampleDelimiter: style.styleSampleDelimiter,
      onStyleSamplesChange: style.onStyleSamplesChange,
      onSave,
      styleProgressNode: style.styleProgressNode,
      visibleStyleCard: style.visibleStyleCard,
    }),
    [
      projectId,
      draft,
      sourceIdea,
      authorCardsQuery.data?.authors,
      expandedAuthorId,
      expandedAuthorQuery.data,
      expandedAuthorQuery.isLoading,
      applyAuthorCardMutation.isPending,
      applyBookCardMutation.isPending,
      style,
      onApplyAuthorCard,
      onApplyBookCard,
      onToggleAuthorCard,
      styleQuery,
      onSearch,
      styleSearchMutation.isPending,
      onSave,
    ],
  );

  const editorProps = useMemo<UseFoundationWorkshopControllerResult["editorProps"]>(
    () => ({
      draft,
      derivedFoundation: workshopQuery.data?.derivedFoundation ?? null,
      derivedFoundationMeta: workshopQuery.data?.derivedFoundationMeta ?? null,
      aiCharacterSuggestions: workshopQuery.data?.aiCharacterSuggestions ?? [],
      rejectionStats: workshopQuery.data?.rejectionStats ?? { total: 0 },
      recentRejections: workshopQuery.data?.recentRejections ?? [],
      structuredSuggestions: workshopQuery.data?.structuredSuggestions ?? null,
      foundation,
      foundationLocked,
      coreDrift: workshopQuery.data?.state?.coreDrift ?? false,
      blockingReason: workshopQuery.data?.state?.blockingReason ?? null,
      readyToGenerate,
      displayedMessages,
      message: draftHook.message,
      isWorkshopStreaming,
      workshopProgress: derivedWorkshopProgress,
      workshopProgressNode,
      hasPendingMessage: draftHook.hasPendingMessage,
      readinessHint: workshopQuery.data?.readinessHint ?? "",
      nextFocus: stream.nextFocus,
      resumeBanner: draftHook.resumeBanner,
      foundationMutationPending: foundationMutation.isPending,
      foundationLockedMutationPending: lockMutation.isPending,
      structuredSuggestionsMutationPending: structuredSuggestionsMutation.isPending,
      canGenerateFoundation: workshopQuery.data?.canGenerateFoundation ?? false,
      foundationExists: Boolean(foundation),
      onMessageChange: draftHook.setMessage,
      onToggleResumeMode: draftHook.toggleResumeMode,
      onSubmit,
      onGenerateFoundation,
      onLockFoundation,
      onGenerateStructuredSuggestions,
      onRefreshStructuredSuggestions,
      onApplyStructuredSuggestion,
      onDismissStructuredSuggestion,
      messageListRef,
      messagesEndRef,
      draftProgressNode,
    }),
    [
      draft,
      workshopQuery.data,
      foundation,
      foundationLocked,
      readyToGenerate,
      displayedMessages,
      draftHook.message,
      draftHook.hasPendingMessage,
      draftHook.resumeBanner,
      draftHook.setMessage,
      draftHook.toggleResumeMode,
      isWorkshopStreaming,
      derivedWorkshopProgress,
      workshopProgressNode,
      stream.nextFocus,
      foundationMutation.isPending,
      lockMutation.isPending,
      structuredSuggestionsMutation.isPending,
      onSubmit,
      onGenerateFoundation,
      onLockFoundation,
      onGenerateStructuredSuggestions,
      onRefreshStructuredSuggestions,
      onApplyStructuredSuggestion,
      onDismissStructuredSuggestion,
      draftProgressNode,
    ],
  );

  return { headerProps, styleSelectorProps, editorProps };
}
