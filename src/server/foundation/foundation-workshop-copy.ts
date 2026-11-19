import type { FoundationWorkshopDraft } from "../types.ts";

export function buildFoundationStarterMessage(input: {
  title: string;
  genre: string;
  style: string;
  premise: string;
}) {
  const seed = input.premise.trim()
    ? `我先接住你的起点想法：${input.premise}`
    : `我们先别急着定稿，先把《${input.title}》最有感觉的那部分聊出来。`;

  return [
    seed,
    "这里不是问卷，你不用按固定题目回答。",
    "你可以像正常聊天一样，直接告诉我你现在最清晰的一段设想：一个角色、一个冲突、一个世界规则、一个开场画面都可以。",
    "我会顺着你的想法继续追问、整理，再慢慢收成正式设定。",
  ].join("\n");
}

export function pickFoundationNextFocus(draft: FoundationWorkshopDraft | null | undefined) {
  if (!draft?.mainline?.trim()) {
    return "主线推进线";
  }
  if (!draft.characterIdeas.length) {
    return "主角和关键配角";
  }
  if (!draft.worldviewIdeas.length) {
    return "世界规则与代价";
  }
  if (!draft.relationshipIdeas.length) {
    return "关键人物关系";
  }
  return draft.unresolvedQuestions[0] || "第一卷最先爆发的核心冲突";
}

function summarizeUserMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= 72) {
    return compact;
  }
  return `${compact.slice(0, 72)}...`;
}

export function buildFoundationFallbackReply(input: {
  message: string;
  draft: FoundationWorkshopDraft | null | undefined;
}) {
  const focus = pickFoundationNextFocus(input.draft);
  const snippet = summarizeUserMessage(input.message);

  return [
    `我先顺着你刚才这句往下接：${snippet}`,
    "这个方向已经能成立了，我们继续往前推，不用按问卷套路来答。",
    `接下来最值得细化的是${focus}。你可以直接补一段更具体的设想，我来帮你把它整理进正式设定。`,
  ].join("");
}
