import "../server-only.ts";

import { z } from "zod";
import { type ChatMessage } from "../llm.ts";
import { WORKFLOW_TOKEN_CAPS } from "../llm-token-policy.ts";
import {
  chatJsonWithWorkflowPolicy,
  chatCompletionWithWorkflowPolicy,
  streamVisibleLongCompletionWithContinuation,
} from "../llm-workflows.ts";
import { normalizeEntityLookupKey } from "../character/lookup-normalization.ts";
import { getPrompt } from "../prompts.ts";
import { snapshotProfiles } from "../profiles.ts";
import {
  appendIdeaWorkshopMessage,
  getIdea,
  getIdeaWorkshopState,
  listIdeaWorkshopMessages,
  upsertIdeaWorkshopState,
} from "../repositories/idea.repository.ts";
import { buildFoundationFallbackReply, pickFoundationNextFocus } from "./foundation-workshop-copy.ts";
import { conflict, notFound } from "../errors.ts";
import { startStatusHeartbeat } from "../status-heartbeat.ts";
import type { FoundationWorkshopDraft } from "../types.ts";
import type { LlmProfile } from "../types/core.ts";

const ideaWorkshopDraftSchema = z.object({
  premise: z.string().default(""),
  mainline: z.string().default(""),
  storyHook: z.string().default(""),
  desiredTone: z.string().default(""),
  characterIdeas: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().min(1),
        goal: z.string().min(1),
        traits: z.array(z.string()).default([]),
        secrets: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  worldviewIdeas: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .default([]),
  relationshipIdeas: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        label: z.string().min(1),
      }),
    )
    .default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  styleReferences: z
    .array(
      z.object({
        kind: z.enum(["book", "author"]),
        label: z.string().min(1),
        author: z.string().optional(),
        source: z.enum(["network", "ai_fallback"]),
        relation: z.enum(["primary", "secondary"]),
      }),
    )
    .default([]),
  styleSamples: z.array(z.string()).default([]),
  styleManualGuidance: z.string().default(""),
  styleAvoidances: z.string().default(""),
  styleSteeringCard: z.string().default(""),
  styleDigest: z.string().default(""),
  styleExemplars: z
    .array(
      z.object({
        id: z.string().min(1),
        sourceId: z.string().min(1),
        sourceTitle: z.string().min(1),
        label: z.string().min(1),
        tags: z.array(z.enum(["narrative", "dialogue", "conflict", "emotion", "mechanism", "hook", "silence", "pressure"])).default([]),
        content: z.string().min(1),
        wordCount: z.number().int().nonnegative(),
        startOffset: z.number().int().nonnegative(),
        endOffset: z.number().int().nonnegative(),
        positionRatio: z.number(),
        dialogueRatio: z.number(),
      }),
    )
    .default([]),
  styleSnapshotId: z.string().nullable().optional().default(null),
  styleSnapshotVersion: z.number().nullable().optional().default(null),
});

export type IdeaWorkshopDraft = z.infer<typeof ideaWorkshopDraftSchema>;

const ideaWorkshopDraftSyncSchema = z.object({
  draft: ideaWorkshopDraftSchema,
  nextFocus: z.string().default("继续把人物动机、世界规则和冲突代价补具体。"),
});

function buildIdeaStarterMessage(title: string) {
  return [
    `先别急着搭结构，咱们从《${title}》里你最想写的那一点聊起。`,
    "有人物、有场面、有一句突然冒出来的对白，丢过来就行。",
    "我顺着问，帮你慢慢理清楚。",
  ].join("\n");
}

function buildIdeaStateSummary(title: string, draft: FoundationWorkshopDraft | null | undefined) {
  return [
    `想法标题：${title}`,
    draft?.premise ? `当前 premise：${draft.premise}` : "",
    draft?.mainline ? `当前主线：${draft.mainline}` : "",
    draft?.storyHook ? `当前钩子：${draft.storyHook}` : "",
    draft?.desiredTone ? `期待气质：${draft.desiredTone}` : "",
    draft?.characterIdeas.length ? `角色草案：\n${JSON.stringify(draft.characterIdeas, null, 2)}` : "",
    draft?.worldviewIdeas.length ? `世界观草案：\n${JSON.stringify(draft.worldviewIdeas, null, 2)}` : "",
    draft?.relationshipIdeas.length ? `关系草案：\n${JSON.stringify(draft.relationshipIdeas, null, 2)}` : "",
    draft?.unresolvedQuestions.length ? `待解问题：\n${draft.unresolvedQuestions.join("\n")}` : "",
    "你负责项目创建前的想法共创区。不要催用户填写项目参数，不要讨论模型配置或章节预算，只帮助用户沉淀人物、世界观、主线、冲突与开场钩子。",
  ].filter(Boolean).join("\n\n");
}

function buildIdeaFallbackDraft(title: string, draft: FoundationWorkshopDraft | null | undefined, nextFocus: string) {
  return ideaWorkshopDraftSchema.parse({
    premise: draft?.premise || "",
    mainline: draft?.mainline || "",
    storyHook: draft?.storyHook || "",
    desiredTone: draft?.desiredTone || "",
    characterIdeas: draft?.characterIdeas || [],
    worldviewIdeas: draft?.worldviewIdeas || [],
    relationshipIdeas: draft?.relationshipIdeas || [],
    unresolvedQuestions: Array.from(new Set([...(draft?.unresolvedQuestions || []), `继续细化：${nextFocus}`])),
    styleReferences: [],
    styleSamples: [],
    styleManualGuidance: "",
    styleAvoidances: "",
    styleSteeringCard: "",
    title,
  });
}

export function guardIdeaWorkshopDraftAgainstThinning(
  previousDraft: FoundationWorkshopDraft | null | undefined,
  nextDraft: IdeaWorkshopDraft,
): IdeaWorkshopDraft {
  if (!previousDraft) {
    return nextDraft;
  }

  // 薄化守卫：LLM 全量重写草稿时若条目数减少或 premise 变短，多半是输出截断而非用户意图，
  // 回退合并旧条目（按名称去重），避免静默清空多轮积累。
  const merged = { ...nextDraft };
  if (merged.characterIdeas.length < previousDraft.characterIdeas.length) {
    const keptNames = new Set(merged.characterIdeas.map((item) => normalizeEntityLookupKey(item.name)));
    merged.characterIdeas = [
      ...merged.characterIdeas,
      ...previousDraft.characterIdeas.filter((item) => !keptNames.has(normalizeEntityLookupKey(item.name))),
    ];
  }
  if (merged.worldviewIdeas.length < previousDraft.worldviewIdeas.length) {
    const keptNames = new Set(merged.worldviewIdeas.map((item) => normalizeEntityLookupKey(item.name)));
    merged.worldviewIdeas = [
      ...merged.worldviewIdeas,
      ...previousDraft.worldviewIdeas.filter((item) => !keptNames.has(normalizeEntityLookupKey(item.name))),
    ];
  }
  if (merged.premise.trim().length < previousDraft.premise.trim().length) {
    merged.premise = previousDraft.premise;
  }
  return merged;
}

function isUsableIdeaWorkshopProfile(profile: LlmProfile) {
  return profile.enabled && profile.apiKey.trim().length > 0 && profile.defaultModel.trim().length > 0;
}

export function selectIdeaWorkshopProfile(profiles: LlmProfile[], requestedProfileId?: string) {
  if (requestedProfileId?.trim()) {
    const selected = profiles.find((profile) => profile.id === requestedProfileId.trim());
    if (!selected) {
      throw new Error("未找到对应的 LLM Profile。");
    }
    if (!isUsableIdeaWorkshopProfile(selected)) {
      throw new Error("所选 LLM Profile 当前不可用，请检查是否已启用、填写 API Key 和默认模型。");
    }
    return selected;
  }

  const fallback = profiles.find((profile) => isUsableIdeaWorkshopProfile(profile));
  if (!fallback) {
    throw new Error("请先在模型配置里添加至少一个可用的模型 Profile。");
  }
  return fallback;
}

async function resolveIdeaAgent(requestedProfileId?: string) {
  const profiles = await snapshotProfiles();
  const profile = selectIdeaWorkshopProfile(profiles, requestedProfileId);
  return {
    profile,
    model: profile.defaultModel,
    temperature: 0.7,
    structuredMaxTokens: WORKFLOW_TOKEN_CAPS.ideaWorkshop.structuredReply,
    streamReplyMaxTokens: WORKFLOW_TOKEN_CAPS.ideaWorkshop.streamReply,
    replyMaxTokens: WORKFLOW_TOKEN_CAPS.ideaWorkshop.naturalReply,
  };
}

function buildIdeaNaturalReplySystemPrompt(prompt: string) {
  return [
    prompt,
    "你现在在项目前的想法区工作，不要谈项目结构、章节数、模型配置，只帮助作者沉淀创意内容。",
    "这一轮只输出给作者的自然语言回复，不要 JSON，不要 markdown 代码块，不要固定编号。先承接作者刚刚那句话，再自然推进下一步。",
  ].join("\n\n");
}

async function requestIdeaNaturalReply(input: {
  systemPrompt: string;
  profile: LlmProfile;
  model: string;
  stateSummary: string;
  recentMessages: ChatMessage[];
  trimmedMessage: string;
  temperature: number;
  maxTokens: number;
}) {
  return chatCompletionWithWorkflowPolicy(
    {
      workflow: "idea_workshop_natural_reply",
      profile: input.profile,
      model: input.model,
      messages: [
        {
          role: "system",
          content: input.systemPrompt,
        },
        {
          role: "user",
          content: input.stateSummary,
        },
        ...input.recentMessages.slice(-4),
        {
          role: "user",
          content: input.trimmedMessage,
        },
      ],
      assignmentMaxTokens: input.maxTokens,
      temperature: input.temperature,
    },
  ).then((response) => response.content.trim());
}

async function syncIdeaWorkshopDraft(input: {
  title: string;
  profile: LlmProfile;
  model: string;
  stateSummary: string;
  recentMessages: ChatMessage[];
  trimmedMessage: string;
  assistantReply: string;
  temperature: number;
  maxTokens: number;
  draft: FoundationWorkshopDraft | null | undefined;
}) {
  try {
    return await chatJsonWithWorkflowPolicy(
      {
        workflow: "foundation_draft_sync",
        profile: input.profile,
        model: input.model,
        messages: [
          {
            role: "system",
            content: [
              "你负责把本轮想法共创同步成结构化草稿。",
              "不要生成作者可见回复，只输出 JSON，字段只有 draft、nextFocus。",
              "draft 里只保留已经明确出现的想法，不要凭空扩写成完整项目方案。",
            ].join("\n"),
          },
          {
            role: "user",
            content: input.stateSummary,
          },
          ...input.recentMessages,
          {
            role: "user",
            content: input.trimmedMessage,
          },
          {
            role: "assistant",
            content: input.assistantReply,
          },
        ],
        assignmentMaxTokens: input.maxTokens,
        temperature: input.temperature,
      },
      ideaWorkshopDraftSyncSchema,
    );
  } catch {
    const nextFocus = pickFoundationNextFocus(input.draft);
    return {
      draft: buildIdeaFallbackDraft(input.title, input.draft, nextFocus),
      nextFocus,
    };
  }
}

export function getIdeaWorkshopSnapshot(ideaId: string) {
  const idea = getIdea(ideaId);
  if (!idea) {
    throw notFound("想法不存在", { ideaId });
  }

  const state = getIdeaWorkshopState(ideaId);
  const messages = listIdeaWorkshopMessages(ideaId);

  return {
    idea,
    state,
    messages: messages.length
      ? messages
      : [{
          id: "starter",
          ideaId,
          role: "assistant" as const,
          content: buildIdeaStarterMessage(idea.title),
          createdAt: idea.createdAt,
        }],
  };
}

export function assertIdeaWorkshopFresh(ideaId: string, baseUpdatedAt?: string) {
  const idea = getIdea(ideaId);
  if (!idea) {
    throw notFound("想法不存在", { ideaId });
  }

  const state = getIdeaWorkshopState(ideaId);
  if (baseUpdatedAt && state && baseUpdatedAt !== state.updatedAt) {
    throw conflict("想法区内容已在其他位置更新，请先刷新后再继续。", {
      currentUpdatedAt: state.updatedAt,
      state,
      messages: listIdeaWorkshopMessages(ideaId),
    });
  }

  return { idea, state };
}

export async function streamIdeaWorkshopMessage(
  ideaId: string,
  input: { message: string; baseUpdatedAt?: string; profileId?: string },
  emit: (event: Record<string, unknown>) => Promise<void> | void,
) {
  const { idea, state } = assertIdeaWorkshopFresh(ideaId, input.baseUpdatedAt);

  const trimmedMessage = input.message.trim();
  if (!trimmedMessage) {
    throw new Error("消息不能为空");
  }

  const [agent, prompt] = await Promise.all([
    resolveIdeaAgent(input.profileId),
    getPrompt("foundation-coach"),
  ]);
  const existingMessages = listIdeaWorkshopMessages(ideaId);
  const recentMessages = existingMessages.slice(-8).map<ChatMessage>((message) => ({
    role: message.role,
    content: message.content,
  }));
  const draft = state?.draft;
  const stateSummary = buildIdeaStateSummary(idea.title, draft);
  // 用户消息先落库：即使后续 LLM 调用失败或进程中断，这一轮输入也不会丢。
  appendIdeaWorkshopMessage(ideaId, "user", trimmedMessage);
  const naturalReplySystemPrompt = buildIdeaNaturalReplySystemPrompt(prompt);
  const emitStatus = async (stage: string, progress: number, message: string) => {
    await emit({
      type: "status",
      stage,
      progress,
      message,
    });
  };
  const emitAssistantReply = async (input: {
    delta: string;
    replace?: boolean;
    progress: number;
  }) => {
    await emit({
      type: "assistant_delta",
      delta: input.delta,
      replace: input.replace,
      progress: input.progress,
    });
  };

  await emitStatus("context", 8, "已收到你的想法，正在整理当前共创上下文。");
  await emitStatus("replying", 18, "想法助手开始延展这一轮回复。");

  let assistantReply = "";
  try {
    const streamMessages = [
      { role: "system" as const, content: naturalReplySystemPrompt },
      { role: "user" as const, content: stateSummary },
      ...recentMessages,
      { role: "user" as const, content: trimmedMessage },
    ];
    assistantReply = (await streamVisibleLongCompletionWithContinuation(
      {
        workflow: "idea_workshop_stream_reply",
        profile: agent.profile,
        model: agent.model,
        messages: streamMessages,
        assignmentMaxTokens: agent.streamReplyMaxTokens,
        temperature: agent.temperature,
      },
      async (event) => {
        const progress = event.replace
          ? Math.min(90, 72 + event.attemptIndex * 8)
          : Math.min(82, 18 + Math.ceil(event.mergedContent.length / 24));
        await emitAssistantReply({
          delta: event.delta,
          replace: event.replace,
          progress,
        });
      },
    )).content;
  } catch {
    assistantReply = "";
  }

  if (!assistantReply) {
    assistantReply = await requestIdeaNaturalReply({
      systemPrompt: naturalReplySystemPrompt,
      profile: agent.profile,
      model: agent.model,
      stateSummary,
      recentMessages,
      trimmedMessage,
      temperature: agent.temperature,
      maxTokens: agent.replyMaxTokens,
    }).catch((error) => { console.warn("[idea-workshop] LLM reply failed:", String(error)); return ""; });
    if (assistantReply) {
      await emitAssistantReply({
        replace: true,
        delta: assistantReply,
        progress: 72,
      });
    }
  }

  if (!assistantReply) {
    assistantReply = buildFoundationFallbackReply({ message: trimmedMessage, draft });
    await emitAssistantReply({
      replace: true,
      delta: assistantReply,
      progress: 72,
    });
  }

  const draftSyncStatus = {
    type: "status",
    stage: "draft_sync",
    progress: 96,
    message: "正在同步想法草稿和下一步焦点。",
  } satisfies Record<string, unknown>;
  await emit(draftSyncStatus);
  const stopDraftSyncHeartbeat = startStatusHeartbeat(emit, draftSyncStatus);

  let draftUpdate: z.infer<typeof ideaWorkshopDraftSyncSchema>;
  try {
    draftUpdate = await syncIdeaWorkshopDraft({
      title: idea.title,
      profile: agent.profile,
      model: agent.model,
      stateSummary,
      recentMessages,
      trimmedMessage,
      assistantReply,
      temperature: agent.temperature,
      maxTokens: agent.structuredMaxTokens,
      draft,
    });
  } finally {
    stopDraftSyncHeartbeat();
  }

  const assistant = appendIdeaWorkshopMessage(ideaId, "assistant", assistantReply);
  const nextState = upsertIdeaWorkshopState(
    ideaId,
    guardIdeaWorkshopDraftAgainstThinning(draft, draftUpdate.draft),
  );

  await emit({
    type: "final",
    progress: 100,
    nextFocus: draftUpdate.nextFocus,
    state: nextState,
  });

  return {
    assistant,
    state: nextState,
    nextFocus: draftUpdate.nextFocus,
  };
}
