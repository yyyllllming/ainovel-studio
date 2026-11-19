import "../server-only.ts";

import { z } from "zod";
import { resolveProjectAgents } from "../agent-resolver.ts";
import { notFound } from "../errors.ts";
import { type ChatMessage } from "../llm.ts";
import { WORKFLOW_TOKEN_CAPS, capByAssignment } from "../llm-token-policy.ts";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { appendCardMessage, getCard, listCardMessages, listCards, updateCardDraft } from "../repositories/card.repository.ts";
import { getFoundationWorkshopState } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import type { CardDraft, CardMessage, CharacterCardDraft, WorldCardDraft } from "../types.ts";

const characterDraftSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  goal: z.string().min(1),
  traits: z.array(z.string()).default([]),
  secrets: z.array(z.string()).optional(),
  background: z.string().optional(),
  notes: z.string().optional(),
});

const worldDraftSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().optional(),
  notes: z.string().optional(),
});

const cardWorkshopReplySchema = z.object({
  reply: z.string().min(1),
  draft: z.union([characterDraftSchema, worldDraftSchema]),
  nextFocus: z.string().default("继续完善设定细节"),
});

function buildCardSystemPrompt(input: {
  projectTitle: string;
  projectPremise: string;
  mainline: string;
  cardType: "character" | "world";
  cardName: string;
  currentDraft: CardDraft;
  confirmedCharacters: Array<{ name: string; role: string; goal: string }>;
  confirmedWorldRules: Array<{ name: string; description: string }>;
}): string {
  const lines: string[] = [
    `你是《${input.projectTitle}》的设定顾问，正在帮作者完善${input.cardType === "character" ? "角色" : "世界书"}卡片。`,
    ``,
    `【项目背景】`,
    `起点想法：${input.projectPremise || "未填写"}`,
  ];

  if (input.mainline) {
    lines.push(`主线梗概：${input.mainline}`);
  }

  if (input.confirmedCharacters.length > 0) {
    lines.push(
      ``,
      `【已确认角色】`,
      ...input.confirmedCharacters.map((c) => `- ${c.name}（${c.role}）：${c.goal}`),
    );
  }

  if (input.confirmedWorldRules.length > 0) {
    lines.push(
      ``,
      `【已确认世界书】`,
      ...input.confirmedWorldRules.map((r) => `- ${r.name}：${r.description}`),
    );
  }

  lines.push(
    ``,
    `【当前卡片】`,
    `类型：${input.cardType === "character" ? "角色卡" : "世界书卡"}`,
    `名称：${input.cardName}`,
    `当前草稿：\n${JSON.stringify(input.currentDraft, null, 2)}`,
    ``,
    `请根据作者的输入，帮助完善这张卡片的设定，保持与现有世界观一致。`,
    `reply 必须像正常共创对话：先承接作者刚刚那句话，再给出自然建议。`,
    `不要把 draft 原样贴给作者，不要复述 JSON 键名，不要像表单。`,
    `必须输出 JSON，包含 reply（文字回复）、draft（更新后的完整草稿）、nextFocus（下一步建议）。`,
  );

  return lines.join("\n");
}

export async function sendCardWorkshopMessage(
  cardId: string,
  projectId: string,
  message: string,
): Promise<{
  assistant: CardMessage;
  updatedDraft: CardDraft;
}> {
  const card = getCard(cardId);
  if (!card) throw notFound("卡片不存在");
  if (card.projectId !== projectId) throw new Error("卡片不属于该项目");

  const project = getProject(projectId);
  if (!project) throw notFound("项目不存在");

  const workshopState = getFoundationWorkshopState(projectId);
  const mainline = workshopState?.draft?.mainline ?? "";

  const allCards = listCards(projectId);
  const confirmedCards = allCards.filter((c) => c.status === "confirmed" && c.id !== cardId);
  const confirmedCharacters = confirmedCards
    .filter((c) => c.cardType === "character")
    .map((c) => {
      const d = c.draft as CharacterCardDraft;
      return { name: d.name || c.name, role: d.role || "", goal: d.goal || "" };
    });
  const confirmedWorldRules = confirmedCards
    .filter((c) => c.cardType === "world")
    .map((c) => {
      const d = c.draft as WorldCardDraft;
      return { name: d.name || c.name, description: d.description || "" };
    });

  const systemPrompt = buildCardSystemPrompt({
    projectTitle: project.title,
    projectPremise: project.premise,
    mainline,
    cardType: card.cardType,
    cardName: card.name,
    currentDraft: card.draft,
    confirmedCharacters,
    confirmedWorldRules,
  });

  const history = listCardMessages(cardId);
  const recentMessages = history.slice(-8).map<ChatMessage>((m) => ({
    role: m.role,
    content: m.content,
  }));

  const { coauthor } = await resolveProjectAgents(projectId);

  const result = await chatJsonWithWorkflowPolicy(
    {
      workflow: "card_workshop_reply",
      profile: coauthor.profile,
      model: coauthor.assignment.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...recentMessages,
        { role: "user", content: message },
      ],
      assignmentMaxTokens: capByAssignment(coauthor.assignment.maxTokens, WORKFLOW_TOKEN_CAPS.characterCardWorkshop.reply),
      temperature: coauthor.assignment.temperature,
    },
    cardWorkshopReplySchema,
  ).catch((error) => { console.warn("[card-workshop] LLM reply failed, using fallback:", String(error)); return {
    reply: "我先把你的想法记下来了，继续完善这张卡片的细节吧。",
    draft: card.draft,
    nextFocus: "继续完善设定细节",
  }; });

  appendCardMessage(cardId, projectId, "user", message);
  const assistant = appendCardMessage(cardId, projectId, "assistant", result.reply);
  const updatedDraft = updateCardDraft(cardId, undefined, result.draft as CardDraft, undefined).draft;

  return { assistant, updatedDraft };
}
