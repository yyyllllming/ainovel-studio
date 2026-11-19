import type { FoundationWorkshopDraft, FoundationWorkshopMessage } from "../types.ts";

export function hasUserWorkshopInput(messages: FoundationWorkshopMessage[]) {
  return messages.some((message) => message.role === "user" && message.content.trim().length > 0);
}

export function hasWorkshopDraftContent(draft: FoundationWorkshopDraft | null | undefined) {
  if (!draft) {
    return false;
  }
  return Boolean(
    draft.premise.trim()
    || draft.mainline.trim()
    || draft.storyHook.trim()
    || draft.desiredTone.trim()
    || draft.unresolvedQuestions.some((item) => item.trim().length > 0)
    || draft.characterIdeas.length
    || draft.worldviewIdeas.length
    || draft.relationshipIdeas.length,
  );
}

export function canGenerateFormalFoundation(input: {
  messages: FoundationWorkshopMessage[];
  draft?: FoundationWorkshopDraft | null;
  hasExistingFoundation: boolean;
  isIdeaSeeded?: boolean;
}) {
  if (input.hasExistingFoundation) {
    return true;
  }
  if (hasUserWorkshopInput(input.messages)) {
    return true;
  }
  return Boolean(input.isIdeaSeeded && hasWorkshopDraftContent(input.draft));
}

export function getFoundationGenerationHint(input: {
  messages: FoundationWorkshopMessage[];
  draft?: FoundationWorkshopDraft | null;
  hasExistingFoundation: boolean;
  isIdeaSeeded?: boolean;
}) {
  if (input.hasExistingFoundation) {
    return "你已经有一份正式设定了，可以继续整理新版，满意后再锁定。";
  }
  if (hasUserWorkshopInput(input.messages)) {
    return "已经完成至少一轮共创，现在可以整理正式设定了。";
  }
  if (input.isIdeaSeeded && hasWorkshopDraftContent(input.draft)) {
    return "想法快照已经带进项目了，可以直接整理正式设定；如果还想补细节，也可以继续聊几轮。";
  }
  return "先和设定助手聊至少一轮，把人物动机、世界规则或核心冲突补出来，再整理正式设定。";
}
