"use client";

import { memo } from "react";
import type {
  FoundationCharacterRejection,
  FoundationCharacterSuggestion,
  FoundationDraft,
  DerivedFoundationMeta,
  FoundationPayload,
  FoundationStructuredSuggestions,
  ConversationMessage,
  StreamProgressState,
} from "@/lib/types";
import { FoundationPreview } from "./foundation-preview";
import { WorkshopConversation } from "./workshop-conversation";

interface WorkshopEditorProps {
  draft: FoundationDraft | null;
  derivedFoundation: FoundationPayload | null;
  derivedFoundationMeta: DerivedFoundationMeta | null;
  aiCharacterSuggestions?: FoundationCharacterSuggestion[];
  rejectionStats?: { total: number };
  recentRejections?: FoundationCharacterRejection[];
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
  messageListRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  draftProgressNode: React.ReactNode;
}

function WorkshopEditorImpl({
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
  blockingReason,
  readyToGenerate,
  displayedMessages,
  message,
  isWorkshopStreaming,
  workshopProgress,
  workshopProgressNode,
  hasPendingMessage,
  readinessHint,
  nextFocus,
  resumeBanner,
  foundationMutationPending,
  foundationLockedMutationPending,
  structuredSuggestionsMutationPending,
  canGenerateFoundation,
  foundationExists,
  onMessageChange,
  onToggleResumeMode,
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
}: WorkshopEditorProps) {
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_340px]">
      <div className="grid gap-4">
        <WorkshopConversation
          displayedMessages={displayedMessages}
          message={message}
          foundationLocked={foundationLocked}
          coreDrift={coreDrift}
          blockingReason={blockingReason}
          isWorkshopStreaming={isWorkshopStreaming}
          workshopProgress={workshopProgress}
          workshopProgressNode={workshopProgressNode}
          hasPendingMessage={hasPendingMessage}
          readinessHint={readinessHint}
          nextFocus={nextFocus}
          resumeBanner={resumeBanner}
          foundationMutationPending={foundationMutationPending}
          foundationLockedMutationPending={foundationLockedMutationPending}
          canGenerateFoundation={canGenerateFoundation}
          foundationExists={foundationExists}
          onMessageChange={onMessageChange}
          onToggleResumeMode={onToggleResumeMode}
          onSubmit={onSubmit}
          onGenerateFoundation={onGenerateFoundation}
          onLockFoundation={onLockFoundation}
          messageListRef={messageListRef}
          messagesEndRef={messagesEndRef}
        />
      </div>

      <FoundationPreview
        draft={draft}
        derivedFoundation={derivedFoundation}
        derivedFoundationMeta={derivedFoundationMeta}
        aiCharacterSuggestions={aiCharacterSuggestions}
        rejectionStats={rejectionStats}
        recentRejections={recentRejections}
        structuredSuggestions={structuredSuggestions}
        foundation={foundation}
        foundationLocked={foundationLocked}
        coreDrift={coreDrift}
        readyToGenerate={readyToGenerate}
        structuredSuggestionsMutationPending={structuredSuggestionsMutationPending}
        onGenerateStructuredSuggestions={onGenerateStructuredSuggestions}
        onRefreshStructuredSuggestions={onRefreshStructuredSuggestions}
        onApplyStructuredSuggestion={onApplyStructuredSuggestion}
        onDismissStructuredSuggestion={onDismissStructuredSuggestion}
        draftProgressNode={draftProgressNode}
      />
    </div>
  );
}

export const WorkshopEditor = memo(WorkshopEditorImpl);
