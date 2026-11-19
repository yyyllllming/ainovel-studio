import "../server-only.ts";

import { notFound } from "../errors.ts";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getNarrativePersonLabel } from "../domain/project-structure.ts";
import { canGenerateFormalFoundation, getFoundationGenerationHint } from "./foundation-workshop-rules.ts";
import { resolveProjectAgents } from "../agent-resolver.ts";
import {
  buildDerivedFoundationMeta,
  buildTranscriptWorldviewFallback as deriveTranscriptWorldviewFallback,
  deriveDraftCoreSummaries,
  deriveFoundationCandidate,
} from "./foundation-candidate.ts";
import { resolveWorkshopCharacterGovernance } from "./foundation-entity-resolution.ts";
import { extractCharacterMentionCandidates } from "./foundation-mention-extraction.ts";
import { sanitizeFoundationWorkshopDraft, sanitizeProjectPremise } from "./foundation-summary-sanitizer.ts";
import {
  buildFoundationCoreFactsHash,
  buildFoundationStateSummaryDigest,
  createFoundationCoreEnvelope,
  foundationDeltaV1Schema,
  foundationWorkshopDraftSchema,
  rebaseFoundationEnvelope,
  syncFoundationDraftWithFallback,
} from "./foundation-core-state.ts";
import {
  buildFoundationFallbackReply,
  buildFoundationStarterMessage,
  // pickFoundationNextFocus, // reserved for future draft-sync guidance
} from "./foundation-workshop-copy.ts";
import type { ChatMessage } from "../llm.ts";
import {
  chatCompletionWithWorkflowPolicy,
  chatJsonWithWorkflowPolicy,
  streamVisibleLongCompletionWithContinuation,
} from "../llm-workflows.ts";
import { getPrompt, getStyleCard } from "../prompts.ts";
import {
  appendFoundationWorkshopMessage,
  clearFoundationWorkshopSessionIfCurrent,
  finalizeFoundationWorkshopTurn,
  getFoundation,
  getFoundationWorkshopEnvelopeState,
  getFoundationWorkshopState,
  getFoundationWorkshopSession,
  listFoundationWorkshopMessages,
  listRunningFoundationWorkshopSessionsUpdatedBefore,
  saveFoundationStructuredSuggestions,
  saveFoundationStyleCard,
  saveFoundationWorkshopSession,
  updateFoundationWorkshopSessionIfCurrent,
  upsertFoundationWorkshopState,
} from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { listCards } from "../repositories/card.repository.ts";
import type {
  FoundationCoreEnvelope,
  FoundationPayload,
  FoundationStructuredSuggestions,
  StyleExcerpt,
  FoundationWorkshopDraft,
  FoundationWorkshopSession,
  StyleProfile,
  StyleReferenceCandidate,
  StyleReferenceSelection,
} from "../types.ts";
import { getActiveStylePackage } from "../repositories/style.repository.ts";
import { getFoundationDriftReport } from "../services/foundation-truth-source.service.ts";
import {
  applyFingerprintToCharter,
  buildFallbackStyleSteeringCard,
  buildFallbackStyleProfile,
  compileStyleProfile,
  dedupeStyleReferenceCandidates,
  formatStyleProfileForPrompt,
  interpretStyleReference,
  mapStyleFacets,
  reduceStyleProfile,
  type StyleFacet,
} from "../style/style-steering.ts";
import { computeStyleFingerprint, type StyleFingerprint } from "../style-fingerprint.ts";
import { startStatusHeartbeat } from "../status-heartbeat.ts";
import { runWithHeartbeat } from "../run/run-heartbeat.ts";
import { nowIso } from "../utils.ts";

const styleSearchFallbackSchema = z.object({
  candidates: z.array(
    z.object({
      kind: z.enum(["book", "author"]),
      label: z.string().min(1),
      author: z.string().optional(),
      hint: z.string().min(1),
    }),
  ).max(6).default([]),
});

const FOUNDATION_WORKSHOP_STALE_FAILURE_MESSAGE = "上一次设定共创会话已中断，请重新发送。";
const FOUNDATION_WORKSHOP_SESSION_HEARTBEAT_MS_FALLBACK = 10_000;
const FOUNDATION_WORKSHOP_SESSION_STALE_MS_FALLBACK = 300_000;
const FOUNDATION_WORKSHOP_SESSION_SWEEP_MS_FALLBACK = 600_000;

declare global {
  var __ainovelFoundationWorkshopSessionSweeper: ReturnType<typeof setInterval> | undefined;
  var __ainovelFoundationStyleSteeringLocks: Set<string> | undefined;
  var __ainovelFoundationWorkshopDerivedCache:
    | Map<string, { key: string; value: FoundationWorkshopDerivedState }>
    | undefined;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

export function resolveFoundationWorkshopSessionConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    heartbeatMs: readPositiveInteger(
      env.AINOVEL_FOUNDATION_SESSION_HEARTBEAT_MS,
      FOUNDATION_WORKSHOP_SESSION_HEARTBEAT_MS_FALLBACK,
    ),
    staleMs: readPositiveInteger(
      env.AINOVEL_FOUNDATION_SESSION_STALE_MS,
      FOUNDATION_WORKSHOP_SESSION_STALE_MS_FALLBACK,
    ),
    enableSweeper: env.AINOVEL_ENABLE_FOUNDATION_SESSION_SWEEPER !== "0",
    sweepMs: readPositiveInteger(
      env.AINOVEL_FOUNDATION_SESSION_SWEEP_MS,
      FOUNDATION_WORKSHOP_SESSION_SWEEP_MS_FALLBACK,
    ),
  };
}

export function isFoundationWorkshopSessionStale(
  updatedAt: string,
  input?: {
    nowMs?: number;
    staleMs?: number;
  },
) {
  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  const nowMs = input?.nowMs ?? Date.now();
  const staleMs = input?.staleMs ?? resolveFoundationWorkshopSessionConfig().staleMs;
  return nowMs - updatedAtMs > staleMs;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function refreshFoundationWorkshopSessionCursor(
  projectId: string,
  sessionState: FoundationWorkshopSession,
) {
  const current = getFoundationWorkshopSession(projectId);
  if (!current || current.sessionId !== sessionState.sessionId) {
    return null;
  }
  return current;
}

function updateFoundationWorkshopSessionWithCursorRefresh(
  sessionState: FoundationWorkshopSession,
  patch: Partial<Pick<
    FoundationWorkshopSession,
    "status" | "stage" | "progress" | "statusMessage" | "assistantMessage" | "error"
  >>,
  nextUpdatedAt = new Date().toISOString(),
): {
  session: FoundationWorkshopSession;
  persisted: boolean;
  /** session 是否已经被其它请求覆盖（删除/替换 sessionId），用于让调用方提前停止持久化。 */
  sessionLost: boolean;
} {
  let currentSession = sessionState;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const persistedUpdatedAt = updateFoundationWorkshopSessionIfCurrent(
      currentSession.projectId,
      currentSession.sessionId,
      currentSession.updatedAt,
      patch,
      nextUpdatedAt,
    );
    if (persistedUpdatedAt) {
      return {
        session: {
          ...currentSession,
          ...patch,
          updatedAt: persistedUpdatedAt,
        },
        persisted: true,
        sessionLost: false,
      };
    }

    const refreshed = refreshFoundationWorkshopSessionCursor(currentSession.projectId, currentSession);
    if (!refreshed) {
      return {
        session: currentSession,
        persisted: false,
        sessionLost: true,
      };
    }
    currentSession = refreshed;
  }

  return {
    session: currentSession,
    persisted: false,
    sessionLost: false,
  };
}

function failFoundationWorkshopSessionIfCurrent(
  session: FoundationWorkshopSession,
  message: string,
  nextUpdatedAt = new Date().toISOString(),
) {
  return updateFoundationWorkshopSessionWithCursorRefresh(
    session,
    {
      status: "failed",
      stage: "failed",
      statusMessage: message,
      error: message,
    },
    nextUpdatedAt,
  );
}

export function sweepStaleFoundationWorkshopSessions(input?: {
  now?: () => string;
  staleMs?: number;
}) {
  const now = input?.now ?? nowIso;
  const staleMs = input?.staleMs ?? resolveFoundationWorkshopSessionConfig().staleMs;
  const currentTime = now();
  const cutoff = new Date(Date.parse(currentTime) - staleMs).toISOString();
  const sessions = listRunningFoundationWorkshopSessionsUpdatedBefore(cutoff);
  let failedCount = 0;

  for (const session of sessions) {
    const result = failFoundationWorkshopSessionIfCurrent(
      session,
      FOUNDATION_WORKSHOP_STALE_FAILURE_MESSAGE,
      currentTime,
    );
    if (!result.persisted) {
      continue;
    }
    failedCount += 1;
    console.warn(`[foundation-workshop:${session.projectId}:${session.sessionId}] stale running session marked failed`);
  }

  return {
    failedCount,
  };
}

function ensureFoundationWorkshopSessionSweeperStarted() {
  const config = resolveFoundationWorkshopSessionConfig();
  if (!config.enableSweeper || global.__ainovelFoundationWorkshopSessionSweeper) {
    return;
  }

  const timer = setInterval(() => {
    try {
      sweepStaleFoundationWorkshopSessions();
    } catch (error) {
      console.warn(
        "[foundation-workshop] session sweeper failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }, config.sweepMs);

  timer.unref?.();
  global.__ainovelFoundationWorkshopSessionSweeper = timer;
}

function resolveFoundationWorkshopResumeAssistantMessage(
  activeSession: FoundationWorkshopSession | null | undefined,
  resumeSessionId: string | null | undefined,
) {
  if (typeof resumeSessionId !== "string" || !activeSession || activeSession.sessionId !== resumeSessionId) {
    return null;
  }

  const partial = activeSession.assistantMessage.trim();
  return partial ? partial : null;
}

function buildFoundationWorkshopRecentMessages(
  messages: ReturnType<typeof listFoundationWorkshopMessages>,
  resumeAssistantMessage: string | null,
) {
  const recentMessages = messages.slice(-8).map<ChatMessage>((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (!resumeAssistantMessage) {
    return recentMessages;
  }

  return [
    ...recentMessages,
    {
      role: "assistant" as const,
      content: resumeAssistantMessage,
    },
  ];
}

function getNormalizedFoundationWorkshopSession(projectId: string) {
  ensureFoundationWorkshopSessionSweeperStarted();
  const session = getFoundationWorkshopSession(projectId);
  if (!session || session.status !== "running") {
    return session;
  }

  if (!isFoundationWorkshopSessionStale(session.updatedAt)) {
    return session;
  }

  const now = new Date().toISOString();
  const staleSession = failFoundationWorkshopSessionIfCurrent(
    session,
    FOUNDATION_WORKSHOP_STALE_FAILURE_MESSAGE,
    now,
  );
  return staleSession.persisted ? staleSession.session : getFoundationWorkshopSession(projectId);
}

function getFoundationStyleSteeringLocks() {
  if (!global.__ainovelFoundationStyleSteeringLocks) {
    global.__ainovelFoundationStyleSteeringLocks = new Set();
  }
  return global.__ainovelFoundationStyleSteeringLocks;
}

function assertNoRunningFoundationStyleSteering(projectId: string) {
  if (getFoundationStyleSteeringLocks().has(projectId)) {
    throw new Error("设定工坊正在编译文风约束，请等待它完成后再操作。");
  }
}

function acquireFoundationStyleSteeringLock(projectId: string) {
  getFoundationStyleSteeringLocks().add(projectId);
  return () => {
    getFoundationStyleSteeringLocks().delete(projectId);
  };
}

function assertNoRunningFoundationWorkshopSession(projectId: string) {
  assertNoRunningFoundationStyleSteering(projectId);
  const session = getNormalizedFoundationWorkshopSession(projectId);
  if (session?.status === "running") {
    throw new Error("设定工坊还有一条未完成的回复，请等待它收尾后再发送新消息。");
  }
}

function createFoundationWorkshopSessionState(projectId: string, userMessage: string): FoundationWorkshopSession {
  const now = new Date().toISOString();
  return {
    projectId,
    sessionId: nanoid(),
    status: "running",
    stage: "context",
    progress: 0,
    statusMessage: "",
    userMessage,
    assistantMessage: "",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildStyleProfileInputs(
  draft: FoundationWorkshopDraft | null | undefined,
  input: {
    references: StyleReferenceSelection[];
    manualGuidance?: string;
    avoidances?: string;
  },
) {
  return buildFallbackStyleProfile({
    references: input.references,
    manualGuidance: input.manualGuidance,
    avoidances: input.avoidances,
    draft: {
      mainline: draft?.mainline ?? "",
      desiredTone: draft?.desiredTone ?? "",
      storyHook: draft?.storyHook ?? "",
    },
    worldContext: [
      ...(draft?.worldviewIdeas ?? []).map((item) => `${item.name}:${item.description}`),
      ...(draft?.relationshipIdeas ?? []).map((item) => `${item.source}-${item.label}-${item.target}`),
    ].join("；"),
    workshopContext: draft?.unresolvedQuestions?.join("；") ?? "",
  });
}

function normalizeStyleSamples(samples?: string[]) {
  return (samples ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 3);
}

function estimateDialogueRatio(content: string) {
  const normalized = content.trim();
  if (!normalized) {
    return 0;
  }
  const dialogueChars = (normalized.match(/“[^”]*”|"[^"]*"|「[^」]*」|『[^』]*』/gu) ?? [])
    .reduce((sum, chunk) => sum + chunk.length, 0);
  return Math.min(1, dialogueChars / Math.max(1, normalized.length));
}

function buildPseudoStyleExcerpts(samples: string[]): StyleExcerpt[] {
  const total = Math.max(1, samples.length);
  return samples.map((content, index) => {
    const dialogueRatio = estimateDialogueRatio(content);
    return {
      id: `pseudo-sample-${index + 1}`,
      sourceId: "manual-sample",
      sourceTitle: "用户样文",
      label: `样文 ${index + 1}`,
      tags: dialogueRatio >= 0.2 ? ["narrative", "dialogue"] : ["narrative"],
      content,
      wordCount: content.length,
      startOffset: 0,
      endOffset: content.length,
      positionRatio: total === 1 ? 0 : index / (total - 1),
      dialogueRatio,
    };
  });
}

function batchStyleExcerpts(excerpts: StyleExcerpt[], batchSize = 5) {
  const batches: StyleExcerpt[][] = [];
  for (let cursor = 0; cursor < excerpts.length; cursor += batchSize) {
    batches.push(excerpts.slice(cursor, cursor + batchSize));
  }
  return batches;
}

function buildFingerprintFromExcerpts(excerpts: StyleExcerpt[]): StyleFingerprint | null {
  const normalizedText = excerpts
    .map((entry) => entry.content.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!normalizedText) {
    return null;
  }
  return computeStyleFingerprint(normalizedText, []);
}

function summarizeStyleFacetSignature(facets: StyleFacet[]) {
  const distinctive = facets
    .flatMap((facet) => facet.distinctivePatterns)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return distinctive[0] ?? "场景驱动叙事";
}

function hasFingerprintCalibratedCharter(profile: StyleProfile) {
  const charter = profile.writingCharter;
  if (!charter) {
    return false;
  }
  return charter.infoRevealRule.includes("对白占比约")
    || charter.transitionRule.includes("一句一段占比约")
    || charter.pauseRule.includes("密度偏高");
}

function resolveStyleAnalysisExcerpts(projectId: string, samples: string[]) {
  const activeStyle = getActiveStylePackage(projectId);
  const importedExcerpts = activeStyle.sampledExcerpts.length
    ? activeStyle.sampledExcerpts
    : activeStyle.styleExemplars;
  const pseudoExcerpts = buildPseudoStyleExcerpts(samples);

  return [...importedExcerpts, ...pseudoExcerpts]
    .filter((entry) => Boolean(entry.content?.trim()))
    .slice(0, 20);
}

async function tryCompileStyleProfileWithMapReduce(input: {
  excerpts: StyleExcerpt[];
  genre: string;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}) {
  const fingerprint = buildFingerprintFromExcerpts(input.excerpts);
  if (!fingerprint) {
    return null;
  }
  const batches = batchStyleExcerpts(input.excerpts, 5);
  if (!batches.length) {
    return null;
  }

  const facets = await Promise.all(
    batches.map((excerptBatch, batchIndex) =>
      mapStyleFacets({
        excerptBatch,
        batchIndex,
        totalBatches: batches.length,
        genre: input.genre,
        llmCall: input.llmCall,
      })),
  );
  const reducedProfile = await reduceStyleProfile({
    facets,
    fingerprint,
    genre: input.genre,
    manualGuidance: input.manualGuidance,
    avoidances: input.avoidances,
    llmCall: input.llmCall,
  });
  const compiledProfile = hasFingerprintCalibratedCharter(reducedProfile)
    ? reducedProfile
    : applyFingerprintToCharter(reducedProfile, fingerprint);
  const signature = summarizeStyleFacetSignature(facets);

  return {
    compiledProfile,
    styleCard: renderCompiledStyleCard(compiledProfile, signature),
    signature,
  };
}

async function tryCompileStyleProfileWithLegacyFallback(input: {
  references: StyleReferenceSelection[];
  samples: string[];
  genre: string;
  premise: string;
  fallbackProfile: StyleProfile;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}) {
  const interpretation = await interpretStyleReference({
    references: input.references,
    samples: input.samples,
    genre: input.genre,
    premise: input.premise,
    llmCall: input.llmCall,
  }).catch(() => null);
  if (!interpretation) {
    return null;
  }
  const compiledProfile = await compileStyleProfile({
    interpretation,
    baseProfile: input.fallbackProfile,
    manualGuidance: input.manualGuidance,
    avoidances: input.avoidances,
    llmCall: input.llmCall,
  }).catch(() => input.fallbackProfile);

  return {
    compiledProfile,
    styleCard: renderCompiledStyleCard(compiledProfile, interpretation.signature),
    signature: interpretation.signature,
  };
}

function renderCompiledStyleCard(profile: StyleProfile, signature?: string) {
  return [
    "风格约束卡",
    signature ? `风格签名：${signature}` : "",
    "",
    formatStyleProfileForPrompt(profile),
  ].filter(Boolean).join("\n");
}

function buildFoundationStateSummary(
  project: NonNullable<ReturnType<typeof getProject>>,
  draft: FoundationWorkshopDraft | null | undefined,
  fallbackStyleCard: string,
) {
  const sanitizedDraft = sanitizeFoundationWorkshopDraft(draft);
  const safeProjectPremise = sanitizeProjectPremise(project.premise);
  const styleSummarySource = (
    sanitizedDraft?.styleDigest
    || sanitizedDraft?.styleSteeringCard
    || sanitizedDraft?.styleManualGuidance
    || fallbackStyleCard
  ).trim().slice(0, 300);
  const digest = buildFoundationStateSummaryDigest(foundationWorkshopDraftSchema.parse({
    ...sanitizedDraft,
    premise: sanitizedDraft?.premise || safeProjectPremise || "",
    desiredTone: sanitizedDraft?.desiredTone || project.style,
    styleDigest: styleSummarySource,
    styleSteeringCard: styleSummarySource,
  }));

  return [
    `项目标题：${project.title}`,
    `题材：${project.genre}`,
    `风格模板：${project.style} / ${getNarrativePersonLabel(project.narrativePerson)}`,
    digest,
    "你在维护 canonical core state。最新用户意图优先；已被否定的旧设定必须明确移除、覆盖或标记为已废弃。",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 3500);
}

export function buildTranscriptWorldviewFallback(messages: Array<Pick<ChatMessage, "role" | "content">>, limit = 6) {
  return deriveTranscriptWorldviewFallback(
    messages.filter((message): message is { role: "user" | "assistant"; content: string } =>
      message.role === "user" || message.role === "assistant"
    ),
    limit,
  );
}

async function generateFoundationWorkshopReply(input: {
  project: NonNullable<ReturnType<typeof getProject>>;
  coauthor: Awaited<ReturnType<typeof resolveProjectAgents>>["coauthor"];
  draft: FoundationWorkshopDraft | null | undefined;
  systemPrompt: string;
  stateSummary: string;
  recentMessages: ChatMessage[];
  message: string;
  recentWindow?: number;
}) {
  const recentMessages = input.recentWindow === undefined
    ? input.recentMessages
    : input.recentMessages.slice(-input.recentWindow);
  const reply = await chatCompletionWithWorkflowPolicy({
    workflow: "foundation_workshop_fallback_reply",
    profile: input.coauthor.profile,
    model: input.coauthor.assignment.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.stateSummary },
      ...recentMessages,
      { role: "user", content: input.message },
    ],
    assignmentMaxTokens: input.coauthor.assignment.maxTokens,
    temperature: input.coauthor.assignment.temperature,
  }).then((response) => response.content).catch((error) => { console.warn("[foundation] LLM reply failed:", String(error)); return ""; });

  return reply.trim() || buildFoundationFallbackReply({ message: input.message, draft: input.draft });
}

async function syncFoundationWorkshopDraft(input: {
  project: NonNullable<ReturnType<typeof getProject>>;
  coauthor: Awaited<ReturnType<typeof resolveProjectAgents>>["coauthor"];
  envelope: FoundationCoreEnvelope;
  draft: FoundationWorkshopDraft | null | undefined;
  stateSummary: string;
  recentMessages: ChatMessage[];
  allMessages: ChatMessage[];
  message: string;
  assistantReply: string;
}) {
  const transcriptMessages = [
    ...input.allMessages
      .filter((message): message is { role: "user" | "assistant"; content: string } =>
        message.role === "user" || message.role === "assistant"
      ),
    { role: "user" as const, content: input.message },
    { role: "assistant" as const, content: input.assistantReply },
  ];

  const synced = await syncFoundationDraftWithFallback({
    envelope: input.envelope,
    runDeltaSync: () =>
      chatJsonWithWorkflowPolicy(
        {
          workflow: "foundation_draft_sync",
          profile: input.coauthor.profile,
          model: input.coauthor.assignment.model,
          messages: [
            {
              role: "system",
              content: [
                "你是小说设定共创助手的 canonical core state 同步器。",
                "你在生成 FoundationDeltaV1，不是在重写整份 draft。",
                "只输出严格 JSON，不要 markdown 代码块，不要额外说明。",
                "最新用户意图优先。已被否定、降级或废弃的旧设定，必须通过 remove、覆盖或 conflictsWithPrevious 明确表达。",
                "不要发明不存在的实体；如果无法确认，就用 retain 或把问题留在 nextFocus。",
                "输出必须且只能包含以下字段（FoundationDeltaV1，不允许额外键）：",
                JSON.stringify({
                  schemaVersion: "foundation-delta.v1",
                  latestIntent: "一句话概括这一轮的用户意图",
                  summaryPatch: { premise: "可选，仅在需要更新时给出", mainline: "可选", storyHook: "可选", desiredTone: "可选" },
                  characterOps: [{ op: "upsert|remove|retain", name: "角色真实姓名", aliases: [], payload: { name: "同上", role: "protagonist|supporting|antagonist 等", goal: "目标", traits: ["特质"], secrets: ["可选"] } }],
                  worldviewOps: [{ op: "upsert|remove|retain", name: "世界观条目名", aliases: [], payload: { name: "同上", description: "条目描述" } }],
                  relationshipOps: [{ op: "upsert|remove|retain", key: "源->目标", payload: { source: "源角色", target: "目标角色", label: "关系" } }],
                  questionOps: [{ op: "upsert|remove|retain", value: "待解决问题" }],
                  conflictsWithPrevious: [],
                  lockedFields: [],
                  readyToGenerate: false,
                  nextFocus: "下一步共创焦点",
                }),
                "op 为 upsert 时 payload 必填；remove/retain 不需要 payload。summaryPatch 里没变化的键直接省略。信息足够生成正式设定时把 readyToGenerate 置为 true。",
              ].join("\n"),
            },
            { role: "user", content: input.stateSummary },
            ...input.allMessages,
            { role: "user", content: input.message },
            { role: "assistant", content: input.assistantReply },
          ],
          assignmentMaxTokens: input.coauthor.assignment.maxTokens,
          temperature: Math.min(input.coauthor.assignment.temperature, 0.8),
        },
        foundationDeltaV1Schema,
      ),
  });
  const nextDraft = foundationWorkshopDraftSchema.parse({
    ...synced.envelope.draft,
    ...deriveDraftCoreSummaries({
      project: input.project,
      draft: synced.envelope.draft,
      messages: transcriptMessages,
    }),
  });
  const nextCoreFactsHash = buildFoundationCoreFactsHash(nextDraft);
  return {
    ...synced,
    envelope: {
      ...synced.envelope,
      draft: nextDraft,
      syncMeta: {
        ...synced.envelope.syncMeta,
        coreFactsHash: nextCoreFactsHash,
        syncStatus: {
          ...synced.envelope.syncMeta.syncStatus,
          coreFactsHashAfter: nextCoreFactsHash,
        },
      },
    },
  };
}

async function searchOpenLibraryCandidates(query: string) {
  const encoded = encodeURIComponent(query.trim());
  const [bookResponse, authorResponse] = await Promise.all([
    fetch(`https://openlibrary.org/search.json?q=${encoded}&limit=8`, {
      signal: AbortSignal.timeout(8000),
    }),
    fetch(`https://openlibrary.org/search/authors.json?q=${encoded}&limit=5`, {
      signal: AbortSignal.timeout(8000),
    }),
  ]);

  const [booksJson, authorsJson] = await Promise.all([
    bookResponse.ok ? bookResponse.json() : Promise.resolve({ docs: [] }),
    authorResponse.ok ? authorResponse.json() : Promise.resolve({ docs: [] }),
  ]) as Array<{ docs?: Array<Record<string, unknown>> }>;

  const books = (booksJson.docs ?? []).flatMap((entry, index) => {
    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) {
      return [];
    }
    const authors = Array.isArray(entry.author_name)
      ? entry.author_name.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    return [{
      id: `network-book-${index}-${title}`,
      kind: "book" as const,
      label: title,
      author: authors[0],
      source: "network" as const,
      hint: [
        authors[0] ? `作者：${authors[0]}` : "",
        typeof entry.first_publish_year === "number" ? `首版：${entry.first_publish_year}` : "",
      ].filter(Boolean).join(" · ") || "联网书目候选",
      origin: "openlibrary",
    }];
  });

  const authors = (authorsJson.docs ?? []).flatMap((entry, index) => {
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) {
      return [];
    }
    return [{
      id: `network-author-${index}-${name}`,
      kind: "author" as const,
      label: name,
      source: "network" as const,
      hint: typeof entry.top_work === "string" && entry.top_work.trim()
        ? `代表作：${entry.top_work.trim()}`
        : "联网作者候选",
      origin: "openlibrary",
    }];
  });

  return dedupeStyleReferenceCandidates([...books, ...authors]);
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function stripHtml(input: string) {
  return decodeHtmlEntities(input)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampSnippet(input: string, max = 120) {
  const text = input.trim();
  if (!text) {
    return "";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function extractDuckDuckGoSnippets(html: string) {
  const titles = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => stripHtml(match[1] ?? ""))
    .filter(Boolean);
  const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/g)]
    .map((match) => stripHtml(match[1] ?? ""));

  return titles.slice(0, 5).map((title, index) => ({
    title,
    snippet: snippets[index] ?? "",
  }));
}

async function searchDuckDuckGoSnippet(query: string) {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  return extractDuckDuckGoSnippets(html)[0] ?? null;
}

function parseFallbackCandidateLines(text: string): z.infer<typeof styleSearchFallbackSchema>["candidates"] {
  const candidates: z.infer<typeof styleSearchFallbackSchema>["candidates"] = [];

  for (const rawLine of text.split(/\r?\n+/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split("|").map((item) => item.trim());
    if (parts.length < 3) {
      continue;
    }
    const head = parts[0].toLowerCase();
    if (head === "书" || head === "book") {
      const label = parts[1];
      if (!label) {
        continue;
      }
      candidates.push({
        kind: "book",
        label,
        author: parts[2] || undefined,
        hint: parts.slice(3).join(" | ") || "AI 推断的风格参考候选",
      });
      continue;
    }
    if (head === "作者" || head === "author") {
      const label = parts[1];
      if (!label) {
        continue;
      }
      candidates.push({
        kind: "author",
        label,
        hint: parts.slice(3).join(" | ") || parts[2] || "AI 推断的风格参考候选",
      });
    }
  }

  return candidates;
}

async function buildAiFallbackCandidates(projectId: string, query: string, networkCandidates: StyleReferenceCandidate[]) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const { planner } = await resolveProjectAgents(projectId);
  const safeProjectPremise = sanitizeProjectPremise(project.premise);
  const systemPrompt = [
    "你是小说文风参考检索助手。",
    "当直接联网结果不足时，你要先根据搜索词、题材和 premise 推断最可能合适的作品或作者，再输出便于继续联网核查的候选。",
    "优先选择中文互联网上常见、容易检索到简介、梗概或风格讨论的作品或作者。",
    "必须输出 4-6 个候选，书和作者可以混合。",
  ].join("");

  const userPrompt = [
    `项目标题：${project.title}`,
    `题材：${project.genre}`,
    `基础 premise：${safeProjectPremise || "未填写"}`,
    `搜索词：${query}`,
    networkCandidates.length
      ? `已有联网候选（不要重复）：\n${networkCandidates.map((item) => `${item.kind}:${item.label}${item.author ? ` / ${item.author}` : ""}`).join("\n")}`
      : "",
    "输出 4-6 个候选，字段：kind, label, author(可选), hint。hint 只写为什么适合当前风格方向。",
  ].filter(Boolean).join("\n\n");

  const structured = await chatJsonWithWorkflowPolicy(
    {
      workflow: "foundation_style_search_structured",
      profile: planner.profile,
      model: planner.assignment.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      assignmentMaxTokens: planner.assignment.maxTokens,
      temperature: Math.min(planner.assignment.temperature + 0.15, 0.95),
    },
    styleSearchFallbackSchema,
  ).catch((error) => { console.warn("[foundation] style search fallback failed:", String(error)); return { candidates: [] as z.infer<typeof styleSearchFallbackSchema>["candidates"] }; });

  let seeds = structured.candidates;
  if (!seeds.length) {
    const lineText = await chatCompletionWithWorkflowPolicy({
      workflow: "foundation_style_search_line_fallback",
      profile: planner.profile,
      model: planner.assignment.model,
      messages: [
        {
          role: "system",
          content:
            "你是小说文风参考检索助手。请输出 4-6 行候选，不要 JSON。每行格式严格为：书|作品名|作者|适配理由 或 作者|作者名||适配理由。",
        },
        { role: "user", content: userPrompt },
      ],
      assignmentMaxTokens: planner.assignment.maxTokens,
      temperature: Math.min(planner.assignment.temperature + 0.15, 0.95),
    }).then((response) => response.content).catch((error) => { console.warn("[foundation] LLM reply failed:", String(error)); return ""; });
    seeds = parseFallbackCandidateLines(lineText);
  }

  const aiCandidates = dedupeStyleReferenceCandidates(
    seeds.slice(0, 6).map((candidate, index) => ({
      id: `ai-fallback-${index}-${candidate.label}`,
      source: "ai_fallback" as const,
      kind: candidate.kind,
      label: candidate.label,
      author: candidate.author,
      hint: candidate.hint,
      origin: "planner",
    })),
  );

  if (!aiCandidates.length) {
    return [];
  }

  return Promise.all(
    aiCandidates.map(async (candidate, index) => {
      const evidenceQuery = candidate.kind === "book"
        ? `${candidate.label} ${candidate.author ?? ""} 小说 梗概 文风 简介`
        : `${candidate.label} 作家 写作风格 代表作 简介`;
      const webEvidence = await searchDuckDuckGoSnippet(evidenceQuery).catch(() => null); // network search is optional enhancement
      const hint = [
        candidate.hint,
        webEvidence?.snippet ? clampSnippet(webEvidence.snippet, 90) : "",
      ].filter(Boolean).join(" · ");

      return {
        ...candidate,
        id: `ai-fallback-${index}-${candidate.label}`,
        hint: clampSnippet(hint || candidate.hint, 140),
        origin: webEvidence?.title ? `planner + ${webEvidence.title}` : "planner",
      } satisfies StyleReferenceCandidate;
    }),
  );
}

function normalizeStyleSearchText(input: string) {
  return input.trim().toLowerCase();
}

function candidateMatchesStyleQuery(candidate: Pick<StyleReferenceCandidate, "label" | "author">, query: string) {
  const normalizedQuery = normalizeStyleSearchText(query);
  if (!normalizedQuery) {
    return false;
  }

  const haystacks = [candidate.label, candidate.author ?? ""].map(normalizeStyleSearchText);
  return haystacks.some((item) => item.includes(normalizedQuery));
}

function mergeStyleSearchCandidates(query: string, networkCandidates: StyleReferenceCandidate[], aiCandidates: StyleReferenceCandidate[]) {
  const exactNetwork = networkCandidates.filter((candidate) => candidateMatchesStyleQuery(candidate, query));
  const exactAi = aiCandidates.filter((candidate) => candidateMatchesStyleQuery(candidate, query));
  const contextualAi = aiCandidates.filter((candidate) => !candidateMatchesStyleQuery(candidate, query));
  const contextualNetwork = networkCandidates.filter((candidate) => !candidateMatchesStyleQuery(candidate, query));

  return dedupeStyleReferenceCandidates([
    ...exactNetwork,
    ...exactAi,
    ...contextualAi,
    ...contextualNetwork,
  ]).slice(0, 8);
}

function deriveWorkshopCharacterGovernance(input: {
  draftCharacters: FoundationWorkshopDraft["characterIdeas"];
  persistedCharacters: FoundationPayload["characters"];
  workshopMessages: Array<Pick<ChatMessage, "role" | "content">>;
}) {
  return resolveWorkshopCharacterGovernance({
    authoritativeNames: [...input.draftCharacters, ...input.persistedCharacters].map((character) => character.name),
    mentionCandidates: extractCharacterMentionCandidates(
      input.workshopMessages.filter(
        (message): message is { role: "user" | "assistant"; content: string } =>
          message.role === "user" || message.role === "assistant",
      ),
    ),
  });
}

function buildStructuredSuggestionId(prefix: "character" | "world", name: string) {
  return `${prefix}:${name.trim().toLowerCase()}`;
}

function getStructuredSuggestionsSnapshot(input: {
  draft: FoundationWorkshopDraft | null | undefined;
  stored: FoundationStructuredSuggestions | null | undefined;
}) {
  const stored = input.stored;
  if (!stored) {
    return null;
  }

  const currentHash = input.draft ? buildFoundationCoreFactsHash(input.draft) : stored.coreFactsHash;
  const visibleCharacters = stored.characters.filter((item) => !stored.dismissedIds.includes(item.id));
  const visibleWorldRules = stored.worldRules.filter((item) => !stored.dismissedIds.includes(item.id));

  return {
    ...stored,
    status: visibleCharacters.length || visibleWorldRules.length
      ? stored.coreFactsHash === currentHash
        ? "fresh"
        : "stale"
      : "empty",
    characters: visibleCharacters,
    worldRules: visibleWorldRules,
  } satisfies FoundationStructuredSuggestions;
}

function requireFreshStructuredSuggestions(
  suggestions: FoundationStructuredSuggestions | null | undefined,
  draft: FoundationWorkshopDraft | null | undefined,
) {
  if (!suggestions || suggestions.status === "empty") {
    throw new Error("当前没有可操作的结构化建议。");
  }
  if (!draft) {
    throw notFound("设定工坊草案不存在。");
  }
  if (suggestions.coreFactsHash !== buildFoundationCoreFactsHash(draft)) {
    throw new Error("结构化建议已过期，请先刷新。");
  }

  return {
    suggestions,
    draft,
  };
}

export function generateFoundationStructuredSuggestions(projectId: string) {
  const snapshot = getFoundationWorkshopSnapshot(projectId);
  const draft = snapshot.state?.draft ?? null;
  if (!draft) {
    throw notFound("设定工坊草案不存在。");
  }

  const currentHash = buildFoundationCoreFactsHash(draft);
  const existing = snapshot.structuredSuggestions?.coreFactsHash === currentHash
    ? snapshot.structuredSuggestions
    : null;
  const dismissedIds = existing?.dismissedIds ?? [];
  const persistedFoundation = getFoundation(projectId);
  const knownCharacterNames = new Set([
    ...draft.characterIdeas.map((character) => character.name.trim()),
    ...(persistedFoundation?.characters ?? []).map((character) => character.name.trim()),
  ]);
  const knownWorldRuleNames = new Set([
    ...draft.worldviewIdeas.map((rule) => rule.name.trim()),
    ...(persistedFoundation?.worldview ?? []).map((rule) => rule.name.trim()),
  ]);

  const characters = (snapshot.aiCharacterSuggestions ?? [])
    .filter((character) => !knownCharacterNames.has(character.canonicalName.trim()))
    .map((character) => ({
      id: buildStructuredSuggestionId("character", character.canonicalName),
      canonicalName: character.canonicalName,
      role: character.role,
      goal: character.goal,
      traits: character.traits,
      rationale: character.evidenceSnippet ?? `${character.sourceKind ?? "message"} suggestion`,
    }))
    .filter((character) => !dismissedIds.includes(character.id));

  const worldRules = (snapshot.derivedFoundation?.worldview ?? [])
    .filter((rule) => !knownWorldRuleNames.has(rule.name.trim()))
    .map((rule) => ({
      id: buildStructuredSuggestionId("world", rule.name),
      name: rule.name,
      description: rule.description,
      rationale: "derived_foundation",
    }))
    .filter((rule) => !dismissedIds.includes(rule.id));

  const suggestions: FoundationStructuredSuggestions = {
    coreFactsHash: currentHash,
    generatedAt: nowIso(),
    status: characters.length || worldRules.length ? "fresh" : "empty",
    characters,
    worldRules,
    dismissedIds,
  };

  saveFoundationStructuredSuggestions(projectId, suggestions);
  return getFoundationWorkshopSnapshot(projectId);
}

export function dismissFoundationStructuredSuggestion(projectId: string, suggestionId: string) {
  const snapshot = getFoundationWorkshopSnapshot(projectId);
  const fresh = requireFreshStructuredSuggestions(
    snapshot.structuredSuggestions ?? null,
    snapshot.state?.draft ?? null,
  );
  const { suggestions } = fresh;

  const nextSuggestions: FoundationStructuredSuggestions = {
    ...suggestions,
    characters: suggestions.characters.filter((item) => item.id !== suggestionId),
    worldRules: suggestions.worldRules.filter((item) => item.id !== suggestionId),
    dismissedIds: Array.from(new Set([...suggestions.dismissedIds, suggestionId])),
    status:
      suggestions.characters.some((item) => item.id !== suggestionId)
      || suggestions.worldRules.some((item) => item.id !== suggestionId)
        ? "fresh"
        : "empty",
  };

  saveFoundationStructuredSuggestions(projectId, nextSuggestions);
  return getFoundationWorkshopSnapshot(projectId);
}

export function applyFoundationStructuredSuggestion(projectId: string, suggestionId: string) {
  const snapshot = getFoundationWorkshopSnapshot(projectId);
  const fresh = requireFreshStructuredSuggestions(
    snapshot.structuredSuggestions ?? null,
    snapshot.state?.draft ?? null,
  );
  const { suggestions, draft } = fresh;

  const characterSuggestion = suggestions.characters.find((item) => item.id === suggestionId) ?? null;
  const worldRuleSuggestion = suggestions.worldRules.find((item) => item.id === suggestionId) ?? null;
  if (!characterSuggestion && !worldRuleSuggestion) {
    throw notFound("结构化建议不存在。");
  }

  const nextDraft: FoundationWorkshopDraft = {
    ...draft,
    characterIdeas: characterSuggestion
      ? [
        ...draft.characterIdeas,
        {
          name: characterSuggestion.canonicalName,
          role: characterSuggestion.role,
          goal: characterSuggestion.goal,
          traits: characterSuggestion.traits,
        },
      ]
      : draft.characterIdeas,
    worldviewIdeas: worldRuleSuggestion
      ? [
        ...draft.worldviewIdeas,
        {
          name: worldRuleSuggestion.name,
          description: worldRuleSuggestion.description,
        },
      ]
      : draft.worldviewIdeas,
  };

  upsertFoundationWorkshopState(projectId, nextDraft, snapshot.state?.readyToGenerate ?? false);
  return getFoundationWorkshopSnapshot(projectId);
}

interface FoundationWorkshopDerivedState {
  state: (FoundationWorkshopStateRecordLike & ReturnType<typeof getFoundationDriftReport>) | null;
  derivedFoundation: FoundationPayload | null;
  derivedFoundationMeta:
    | (NonNullable<ReturnType<typeof buildDerivedFoundationMeta>> & { coreDrift: boolean; blockingReason: string | null })
    | null;
  characterGovernance: ReturnType<typeof deriveWorkshopCharacterGovernance>;
}

interface FoundationWorkshopStateRecordLike {
  projectId: string;
  readyToGenerate: boolean;
  updatedAt: string;
  draft: FoundationWorkshopDraft;
}

interface FoundationWorkshopDerivedInputs {
  project: NonNullable<ReturnType<typeof getProject>>;
  rawState: ReturnType<typeof getFoundationWorkshopEnvelopeState>;
  messages: ReturnType<typeof listFoundationWorkshopMessages>;
  existingFoundation: FoundationPayload | null;
  activeStyle: ReturnType<typeof getActiveStylePackage>;
  confirmedCards: ReturnType<typeof listCards>;
}

const FOUNDATION_WORKSHOP_DERIVED_CACHE_LIMIT = 32;

function buildFoundationWorkshopDerivedStateKey(input: FoundationWorkshopDerivedInputs) {
  const lastMessage = input.messages[input.messages.length - 1];
  return JSON.stringify({
    projectUpdatedAt: input.project.updatedAt,
    stateUpdatedAt: input.rawState?.updatedAt ?? null,
    readyToGenerate: input.rawState?.readyToGenerate ?? null,
    messageCount: input.messages.length,
    lastMessageId: lastMessage?.id ?? null,
    lastMessageCreatedAt: lastMessage?.createdAt ?? null,
    foundationFacts: input.existingFoundation
      ? {
        premise: input.existingFoundation.premise,
        mainline: input.existingFoundation.mainline ?? "",
        storyHook: input.existingFoundation.storyHook ?? "",
        characters: input.existingFoundation.characters.map((entry) => [entry.name, entry.goal]),
        worldview: input.existingFoundation.worldview.map((entry) => [entry.name, entry.description]),
        relationshipCount: input.existingFoundation.relationships.length,
      }
      : null,
    styleSnapshotId: input.activeStyle.styleSnapshotId,
    styleSnapshotVersion: input.activeStyle.styleSnapshotVersion,
    cards: input.confirmedCards.map((card) => [card.id, card.status, card.updatedAt]),
  });
}

function computeFoundationWorkshopDerivedState(input: FoundationWorkshopDerivedInputs): FoundationWorkshopDerivedState {
  const { project, rawState, messages, existingFoundation } = input;
  const projectId = project.id;
  const sanitizedDraft = rawState ? sanitizeFoundationWorkshopDraft(rawState.draft) : undefined;
  const shouldRecomposeCoreFacts =
    messages.length > 0
    || !sanitizedDraft?.premise
    || !sanitizedDraft?.mainline
    || !sanitizedDraft?.storyHook;
  const enrichedDraft = sanitizedDraft
    ? foundationWorkshopDraftSchema.parse({
      ...(
        shouldRecomposeCoreFacts
          ? {
            ...sanitizedDraft,
            ...deriveDraftCoreSummaries({
              project,
              draft: sanitizedDraft,
              messages,
            }),
          }
          : sanitizedDraft
      ),
    })
    : undefined;
  const driftReport = rawState ? getFoundationDriftReport(projectId) : null;
  const state = rawState && driftReport
    ? {
      projectId: rawState.projectId,
      readyToGenerate: rawState.readyToGenerate,
      updatedAt: rawState.updatedAt,
      draft: enrichedDraft ?? rawState.draft,
      ...driftReport,
    }
    : null;
  const derivedFoundation = state
    ? deriveFoundationCandidate({
      project,
      workshopDraft: state.draft,
      workshopMessages: messages,
      activeStyle: input.activeStyle,
      confirmedCards: input.confirmedCards,
      existing: existingFoundation,
    })
    : null;
  // 漂移报告在本次快照里已经算过一次，直接复用，不再经由 buildDerivedFoundationDriftMeta 重复计算。
  const derivedMetaBase = buildDerivedFoundationMeta({
    draft: state?.draft,
    derivedFoundation,
    persistedFoundation: existingFoundation,
  });
  const derivedFoundationMeta = derivedMetaBase && driftReport
    ? {
      ...derivedMetaBase,
      coreDrift: driftReport.coreDrift,
      blockingReason: driftReport.blockingReason,
    }
    : null;
  const characterGovernance = deriveWorkshopCharacterGovernance({
    draftCharacters: state?.draft.characterIdeas ?? [],
    persistedCharacters: existingFoundation?.characters ?? [],
    workshopMessages: messages,
  });

  return {
    state,
    derivedFoundation,
    derivedFoundationMeta,
    characterGovernance,
  };
}

/**
 * 单次 snapshot 的候选推导 + 漂移报告 + 角色治理都是 O(消息数×正则) 的纯 CPU 计算，
 * 且该 GET 被前端轮询高频调用。这里按 (项目/草稿/消息/正式设定/风格/卡片) 指纹做进程内 memo，
 * 输入不变时直接复用上一次结果，避免重复阻塞事件循环。
 */
function resolveFoundationWorkshopDerivedState(input: FoundationWorkshopDerivedInputs): FoundationWorkshopDerivedState {
  const cache = global.__ainovelFoundationWorkshopDerivedCache
    ?? (global.__ainovelFoundationWorkshopDerivedCache = new Map());
  const key = buildFoundationWorkshopDerivedStateKey(input);
  const cached = cache.get(input.project.id);
  if (cached?.key === key) {
    return cached.value;
  }

  const value = computeFoundationWorkshopDerivedState(input);
  cache.delete(input.project.id);
  cache.set(input.project.id, { key, value });
  if (cache.size > FOUNDATION_WORKSHOP_DERIVED_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  return value;
}

export function getFoundationWorkshopSnapshot(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const rawState = getFoundationWorkshopEnvelopeState(projectId);
  const messages = listFoundationWorkshopMessages(projectId);
  const activeSession = getNormalizedFoundationWorkshopSession(projectId);
  const existingFoundation = getFoundation(projectId);
  const activeStyle = getActiveStylePackage(projectId);
  const confirmedCards = listCards(projectId);
  const { state, derivedFoundation, derivedFoundationMeta, characterGovernance } = resolveFoundationWorkshopDerivedState({
    project,
    rawState,
    messages,
    existingFoundation,
    activeStyle,
    confirmedCards,
  });
  const canGenerateFoundation = canGenerateFormalFoundation({
    messages,
    draft: state?.draft,
    hasExistingFoundation: Boolean(existingFoundation),
    isIdeaSeeded: Boolean(project.sourceIdeaId),
  });
  const structuredSuggestions = getStructuredSuggestionsSnapshot({
    draft: state?.draft,
    stored: rawState?.structuredSuggestions ?? null,
  });

  return {
    project,
    state,
    activeSession,
    stylePanelUnlocked: true,
    canGenerateFoundation,
    readinessHint: getFoundationGenerationHint({
      messages,
      draft: state?.draft,
      hasExistingFoundation: Boolean(existingFoundation),
      isIdeaSeeded: Boolean(project.sourceIdeaId),
    }),
    derivedFoundation,
    derivedFoundationMeta,
    aiCharacterSuggestions: characterGovernance.aiCharacterSuggestions,
    rejectionStats: characterGovernance.rejectionStats,
    recentRejections: characterGovernance.recentRejections,
    structuredSuggestions,
    messages: messages.length
      ? messages
      : [
          {
            id: "starter",
            projectId,
            role: "assistant" as const,
            content: buildFoundationStarterMessage(project),
            createdAt: project.createdAt,
          },
        ],
  };
}

/**
 * 带乐观并发控制的回合收口：finalize 用回合起点的 revisionId 做 CAS，
 * 冲突（Runner 自动补强 / style steering / 并发回合在 LLM 处理期间推进了草稿）时
 * 重读最新 envelope、把本回合 rebase 上去再试，避免互相整体覆盖丢更新。
 */
function finalizeWorkshopTurnWithRebase(input: {
  projectId: string;
  sessionId: string;
  assistantContent: string;
  envelope: FoundationCoreEnvelope;
  readyToGenerate: boolean;
  baseRevisionId: string | null;
}) {
  let envelope = input.envelope;
  let expectedRevisionId: string | null = input.baseRevisionId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = finalizeFoundationWorkshopTurn({
      projectId: input.projectId,
      sessionId: input.sessionId,
      assistantContent: input.assistantContent,
      envelope,
      readyToGenerate: input.readyToGenerate,
      expectedRevisionId,
    });
    if (result) {
      return result;
    }
    const latest = getFoundationWorkshopEnvelopeState(input.projectId);
    if (latest) {
      envelope = rebaseFoundationEnvelope(latest.envelope, envelope);
      expectedRevisionId = latest.envelope.syncMeta.revisionId;
    } else {
      expectedRevisionId = null;
    }
  }
  // 连续冲突说明写入方异常活跃（理论上不可达）：放弃乐观锁强制收口，保证本回合不丢。
  return finalizeFoundationWorkshopTurn({
    projectId: input.projectId,
    sessionId: input.sessionId,
    assistantContent: input.assistantContent,
    envelope,
    readyToGenerate: input.readyToGenerate,
  })!;
}

export async function sendFoundationWorkshopMessage(projectId: string, input: { message: string; resumeSessionId?: string | null }) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  ensureFoundationWorkshopSessionSweeperStarted();
  assertNoRunningFoundationWorkshopSession(projectId);

  const trimmedMessage = input.message.trim();
  if (!trimmedMessage) {
    throw new Error("消息不能为空");
  }

  const resumableSession = getNormalizedFoundationWorkshopSession(projectId);
  const resumeAssistantMessage = resolveFoundationWorkshopResumeAssistantMessage(
    resumableSession,
    input.resumeSessionId,
  );

  // 非流式发送同样登记 running session：让并发的发送 / 文风编译走同一互斥，且收口走 finalize 事务。
  const sessionState = createFoundationWorkshopSessionState(projectId, trimmedMessage);
  saveFoundationWorkshopSession(sessionState);

  try {
    const [{ coauthor }, state, existingMessages, styleCard] = await Promise.all([
      resolveProjectAgents(projectId),
      Promise.resolve(getFoundationWorkshopEnvelopeState(projectId)),
      Promise.resolve(listFoundationWorkshopMessages(projectId)),
      getStyleCard(project.style).catch(() => getStyleCard("default")), // fallback to default style if custom style unavailable
    ]);

    const recentMessages = buildFoundationWorkshopRecentMessages(existingMessages, resumeAssistantMessage);
    const allMessages = existingMessages.map<ChatMessage>((message) => ({
      role: message.role,
      content: message.content,
    }));

    const draft = state?.draft;
    const prompt = await getPrompt("foundation-coach");
    const stateSummary = buildFoundationStateSummary(project, draft, styleCard);
    appendFoundationWorkshopMessage(projectId, "user", trimmedMessage);
    const naturalReplySystemPrompt = [
      prompt,
      "这一轮只输出给作者的自然语言回复，不要 JSON，不要 markdown 代码块，不要固定编号。先承接作者刚刚那句话，再自然推进下一步。",
    ].join("\n\n");
    const assistantReply = await generateFoundationWorkshopReply({
      project,
      coauthor,
      draft,
      systemPrompt: naturalReplySystemPrompt,
      stateSummary,
      recentMessages,
      message: trimmedMessage,
      recentWindow: 4,
    });
    const draftUpdate = await syncFoundationWorkshopDraft({
      project,
      coauthor,
      envelope: state?.envelope ?? createFoundationCoreEnvelope(draft ?? foundationWorkshopDraftSchema.parse({})),
      draft,
      stateSummary,
      recentMessages,
      allMessages,
      message: trimmedMessage,
      assistantReply,
    });

    const { message: assistantMessage, nextState } = finalizeWorkshopTurnWithRebase({
      projectId,
      sessionId: sessionState.sessionId,
      assistantContent: assistantReply,
      envelope: draftUpdate.envelope,
      readyToGenerate: draftUpdate.readyToGenerate,
      baseRevisionId: state?.envelope.syncMeta.revisionId ?? null,
    });

    return {
      assistant: assistantMessage,
      state: nextState,
      nextFocus: draftUpdate.nextFocus,
    };
  } catch (error) {
    clearFoundationWorkshopSessionIfCurrent(projectId, sessionState.sessionId);
    throw error;
  }
}

export async function streamFoundationWorkshopMessage(
  projectId: string,
  input: { message: string; resumeSessionId?: string | null },
  emit: (event: Record<string, unknown>) => Promise<void> | void,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  ensureFoundationWorkshopSessionSweeperStarted();
  const trimmedMessage = input.message.trim();
  if (!trimmedMessage) {
    throw new Error("消息不能为空");
  }

  assertNoRunningFoundationWorkshopSession(projectId);
  const resumableSession = getNormalizedFoundationWorkshopSession(projectId);
  const resumeAssistantMessage = resolveFoundationWorkshopResumeAssistantMessage(
    resumableSession,
    input.resumeSessionId,
  );

  let sessionState = createFoundationWorkshopSessionState(projectId, trimmedMessage);
  let sessionWritable = true;
  saveFoundationWorkshopSession(sessionState);

  const syncSession = (patch: Partial<Pick<
    FoundationWorkshopSession,
    "status" | "stage" | "progress" | "statusMessage" | "assistantMessage" | "error"
  >>) => {
    if (!sessionWritable) {
      return false;
    }

    const result = updateFoundationWorkshopSessionWithCursorRefresh(
      sessionState,
      patch,
      new Date().toISOString(),
    );
    sessionState = result.session;
    if (result.persisted) {
      return true;
    }

    if (result.sessionLost) {
      sessionWritable = false;
    }
    return false;
  };

  const touchSessionKeepalive = async () => {
    if (!sessionWritable) {
      return false;
    }

    const delays = [0, 10, 20, 40];
    for (const delay of delays) {
      if (delay > 0) {
        await sleep(delay);
      }

      const result = updateFoundationWorkshopSessionWithCursorRefresh(
        sessionState,
        {},
        new Date().toISOString(),
      );
      sessionState = result.session;
      if (result.persisted) {
        return true;
      }

      if (result.sessionLost) {
        sessionWritable = false;
        return false;
      }
    }

    return false;
  };

  const emitStatus = async (stage: string, progress: number, message: string) => {
    syncSession({
      status: "running",
      stage,
      progress,
      statusMessage: message,
      error: null,
    });
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
    message?: string;
  }) => {
    const nextAssistantReply = input.replace
      ? input.delta
      : `${sessionState.assistantMessage}${input.delta}`;
    syncSession({
      status: "running",
      stage: "replying",
      progress: input.progress,
      statusMessage: input.message ?? "设定助手开始共创回复。",
      assistantMessage: nextAssistantReply,
      error: null,
    });
    await emit({
      type: "assistant_delta",
      replace: input.replace,
      delta: input.delta,
      progress: input.progress,
    });
  };

  syncSession({
    status: "running",
    stage: "context",
    progress: 8,
    statusMessage: "已收到你的想法，正在整理当前设定上下文。",
  });

  let assistantReply = "";

  try {
    await runWithHeartbeat(
      async () => {
        const [{ coauthor }, state, existingMessages, styleCard] = await Promise.all([
          resolveProjectAgents(projectId),
          Promise.resolve(getFoundationWorkshopEnvelopeState(projectId)),
          Promise.resolve(listFoundationWorkshopMessages(projectId)),
          getStyleCard(project.style).catch(() => getStyleCard("default")), // fallback to default style if custom style unavailable
        ]);

        const recentMessages = buildFoundationWorkshopRecentMessages(existingMessages, resumeAssistantMessage);
        const allMessages = existingMessages.map<ChatMessage>((message) => ({
          role: message.role,
          content: message.content,
        }));
        const draft = state?.draft;
        appendFoundationWorkshopMessage(projectId, "user", trimmedMessage);
        const prompt = await getPrompt("foundation-coach");
        const stateSummary = buildFoundationStateSummary(project, draft, styleCard);
        const naturalReplySystemPrompt = [
          prompt,
          "这一轮只输出给作者的自然语言回复，不要 JSON，不要 markdown 代码块，不要固定编号。先承接作者刚刚那句话，再自然推进下一步。",
        ].join("\n\n");

        await emitStatus("context", 8, "已收到你的想法，正在整理当前设定上下文。");
        await emitStatus("replying", 18, "设定助手开始共创回复。");

        try {
          const streamMessages = [
            { role: "system" as const, content: naturalReplySystemPrompt },
            { role: "user" as const, content: stateSummary },
            ...recentMessages,
            { role: "user" as const, content: trimmedMessage },
          ];
          const streamed = await streamVisibleLongCompletionWithContinuation(
            {
              workflow: "foundation_workshop_stream_reply",
              profile: coauthor.profile,
              model: coauthor.assignment.model,
              messages: streamMessages,
              assignmentMaxTokens: coauthor.assignment.maxTokens,
              temperature: coauthor.assignment.temperature,
            },
            async (event) => {
              if (!event.replace) {
                assistantReply = event.mergedContent;
              } else {
                assistantReply = event.delta;
              }
              await emitAssistantReply({
                delta: event.delta,
                replace: event.replace,
                progress: event.replace
                  ? Math.min(90, 72 + event.attemptIndex * 8)
                  : Math.min(82, 18 + Math.ceil(event.mergedContent.length / 18)),
              });
            },
          );
          assistantReply = streamed.content.trim();
          syncSession({
            assistantMessage: assistantReply,
          });
        } catch {
          assistantReply = "";
          // 清空 session 中残留的 partial assistant 文本，避免后续 fallback 时与旧值不一致
          syncSession({ assistantMessage: "" });
        }

        if (!assistantReply) {
          assistantReply = await generateFoundationWorkshopReply({
            project,
            coauthor,
            draft,
            systemPrompt: naturalReplySystemPrompt,
            stateSummary,
            recentMessages,
            message: trimmedMessage,
            recentWindow: 4,
          });
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
          message: "正在同步共创草案和下一步焦点。",
        } satisfies Record<string, unknown>;
        syncSession({
          status: "running",
          stage: "draft_sync",
          progress: 96,
          statusMessage: "正在同步共创草案和下一步焦点。",
          assistantMessage: assistantReply,
          error: null,
        });
        await emit(draftSyncStatus);
        const stopDraftSyncHeartbeat = startStatusHeartbeat(async (event) => {
          syncSession({
            status: "running",
            stage: "draft_sync",
            progress: 96,
            statusMessage: "正在同步共创草案和下一步焦点。",
            assistantMessage: assistantReply,
            error: null,
          });
          await emit(event);
        }, draftSyncStatus);

        let draftUpdate: Awaited<ReturnType<typeof syncFoundationWorkshopDraft>>;
        try {
          draftUpdate = await syncFoundationWorkshopDraft({
            project,
            coauthor,
            envelope: state?.envelope ?? createFoundationCoreEnvelope(draft ?? foundationWorkshopDraftSchema.parse({})),
            draft,
            stateSummary,
            recentMessages,
            allMessages,
            message: trimmedMessage,
            assistantReply,
          });
        } finally {
          stopDraftSyncHeartbeat();
        }

        if (sessionWritable) {
          const { nextState } = finalizeWorkshopTurnWithRebase({
            projectId,
            sessionId: sessionState.sessionId,
            assistantContent: assistantReply,
            envelope: draftUpdate.envelope,
            readyToGenerate: draftUpdate.readyToGenerate,
            baseRevisionId: state?.envelope.syncMeta.revisionId ?? null,
          });

          await emit({
            type: "final",
            progress: 100,
            nextFocus: draftUpdate.nextFocus,
            state: nextState,
          });
          return;
        }

        await emit({
          type: "final",
          progress: 100,
          nextFocus: draftUpdate.nextFocus,
        });
      },
      async () => {
        await touchSessionKeepalive();
      },
      {
        intervalMs: resolveFoundationWorkshopSessionConfig().heartbeatMs,
        onError: (error) => {
          console.warn(
            `[foundation-workshop:${projectId}:${sessionState.sessionId}] session keepalive failed:`,
            error instanceof Error ? error.message : error,
          );
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "设定共创失败";
    if (sessionWritable) {
      syncSession({
        status: "failed",
        stage: sessionState.stage === "context" ? "failed" : sessionState.stage,
        progress: sessionState.progress,
        assistantMessage: assistantReply || sessionState.assistantMessage,
        error: message,
      });
    }
    throw error;
  }
}

export async function searchFoundationStyleReferences(projectId: string, query: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const networkCandidates = await searchOpenLibraryCandidates(query).catch((error) => { console.warn("[foundation] OpenLibrary search failed:", String(error)); return [] as StyleReferenceCandidate[]; });
  const aiCandidates = await buildAiFallbackCandidates(projectId, query, networkCandidates);
  const mergedCandidates = mergeStyleSearchCandidates(query, networkCandidates, aiCandidates);

  return {
    candidates: mergedCandidates,
    source: networkCandidates.length && aiCandidates.length
      ? "mixed" as const
      : networkCandidates.length
        ? "network" as const
        : "ai_fallback" as const,
  };
}

function applyStyleSteeringFieldsToDraft(
  baseDraft: FoundationWorkshopDraft,
  input: {
    references: StyleReferenceSelection[];
    samples: string[];
    manualGuidance?: string;
    avoidances?: string;
    styleSteeringCard: string;
    styleProfile: StyleProfile;
  },
): FoundationWorkshopDraft {
  return {
    ...baseDraft,
    styleReferences: input.references,
    styleSamples: input.samples,
    styleManualGuidance: input.manualGuidance?.trim() ?? "",
    styleAvoidances: input.avoidances?.trim() ?? "",
    styleSteeringCard: input.styleSteeringCard,
    styleProfile: input.styleProfile,
  };
}

export async function updateFoundationStyleSteering(projectId: string, input: {
  references: StyleReferenceSelection[];
  samples?: string[];
  manualGuidance?: string;
  avoidances?: string;
}) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  // 与 workshop 聊天回合互斥：聊天回合进行中不允许编译文风，反之亦然，避免双方整体覆写草稿互相回滚。
  assertNoRunningFoundationWorkshopSession(projectId);
  const state = getFoundationWorkshopState(projectId);
  if (!state) {
    throw notFound("设定工作台不存在");
  }

  const releaseLock = acquireFoundationStyleSteeringLock(projectId);
  try {
    const { planner } = await resolveProjectAgents(projectId);
    const fallbackCard = buildFallbackStyleSteeringCard({
      references: input.references,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
    });
    const fallbackProfile = buildStyleProfileInputs(state.draft, input);
    const normalizedSamples = normalizeStyleSamples(input.samples);
    const analysisExcerpts = resolveStyleAnalysisExcerpts(projectId, normalizedSamples);
    const premise = state.draft.premise || sanitizeProjectPremise(project.premise) || "未填写";
    const llmCall = (messages: ChatMessage[]) =>
      chatCompletionWithWorkflowPolicy({
        workflow: "foundation_style_steering",
        profile: planner.profile,
        model: planner.assignment.model,
        messages,
        assignmentMaxTokens: planner.assignment.maxTokens,
        temperature: Math.min(planner.assignment.temperature + 0.1, 0.8),
      }).then((response) => response.content);

    let compiledProfile = fallbackProfile;
    let styleCard = fallbackCard;

    const mapReduced = analysisExcerpts.length
      ? await tryCompileStyleProfileWithMapReduce({
        excerpts: analysisExcerpts,
        genre: project.genre,
        manualGuidance: input.manualGuidance,
        avoidances: input.avoidances,
        llmCall,
      }).catch(() => null)
      : null;
    if (mapReduced) {
      compiledProfile = mapReduced.compiledProfile;
      styleCard = mapReduced.styleCard;
    } else {
      const legacyCompiled = await tryCompileStyleProfileWithLegacyFallback({
        references: input.references,
        samples: normalizedSamples,
        genre: project.genre,
        premise,
        fallbackProfile,
        manualGuidance: input.manualGuidance,
        avoidances: input.avoidances,
        llmCall,
      });
      if (legacyCompiled) {
        compiledProfile = legacyCompiled.compiledProfile;
        styleCard = legacyCompiled.styleCard;
      }
    }

    // 编译耗时较长，落库前重读最新草稿，只回写 style* 字段，避免覆盖编译期间其它写入方的改动。
    const latestState = getFoundationWorkshopState(projectId) ?? state;
    const nextDraft = applyStyleSteeringFieldsToDraft(latestState.draft, {
      references: input.references,
      samples: normalizedSamples,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      styleSteeringCard: styleCard,
      styleProfile: compiledProfile,
    });
    upsertFoundationWorkshopState(projectId, nextDraft, latestState.readyToGenerate);
    if (getFoundation(projectId)) {
      saveFoundationStyleCard(projectId, nextDraft.styleSteeringCard ?? fallbackCard, nextDraft.styleProfile);
    }

    return {
      state: getFoundationWorkshopState(projectId),
      styleSteeringCard: nextDraft.styleSteeringCard,
    };
  } finally {
    releaseLock();
  }
}

export async function streamFoundationStyleSteering(
  projectId: string,
  input: {
    references: StyleReferenceSelection[];
    samples?: string[];
    manualGuidance?: string;
    avoidances?: string;
  },
  emit: (event: Record<string, unknown>) => Promise<void> | void,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  // 与 workshop 聊天回合互斥：聊天回合进行中不允许编译文风，反之亦然，避免双方整体覆写草稿互相回滚。
  assertNoRunningFoundationWorkshopSession(projectId);
  const state = getFoundationWorkshopState(projectId);
  if (!state) {
    throw notFound("设定工作台不存在");
  }

  const releaseLock = acquireFoundationStyleSteeringLock(projectId);
  try {
    const { planner } = await resolveProjectAgents(projectId);
    const fallbackCard = buildFallbackStyleSteeringCard({
      references: input.references,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
    });
    const fallbackProfile = buildStyleProfileInputs(state.draft, input);
    const normalizedSamples = normalizeStyleSamples(input.samples);
    const analysisExcerpts = resolveStyleAnalysisExcerpts(projectId, normalizedSamples);
    const premise = state.draft.premise || sanitizeProjectPremise(project.premise) || "未填写";
    const llmCall = (messages: ChatMessage[]) =>
      chatCompletionWithWorkflowPolicy({
        workflow: "foundation_style_steering",
        profile: planner.profile,
        model: planner.assignment.model,
        messages,
        assignmentMaxTokens: planner.assignment.maxTokens,
        temperature: Math.min(planner.assignment.temperature + 0.1, 0.8),
      }).then((response) => response.content);

    await emit({
      type: "status",
      stage: "context",
      progress: 10,
      message: "正在汇总参考作品、作者和你的偏好。",
    });

    let streamedCard = fallbackCard;
    let compiledProfile = fallbackProfile;
    let resolvedSignature = "";
    let usedMapReduce = false;
    if (analysisExcerpts.length) {
      await emit({
        type: "status",
        stage: "analysis",
        progress: 24,
        message: "正在抽取样本切面并融合文体指纹。",
      });

      const mapReduced = await tryCompileStyleProfileWithMapReduce({
        excerpts: analysisExcerpts,
        genre: project.genre,
        manualGuidance: input.manualGuidance,
        avoidances: input.avoidances,
        llmCall,
      }).catch(() => null);

      if (mapReduced) {
        await emit({
          type: "status",
          stage: "drafting",
          progress: 56,
          message: "正在把融合风格编译成可长期注入的执行规则。",
        });
        compiledProfile = mapReduced.compiledProfile;
        streamedCard = mapReduced.styleCard;
        resolvedSignature = mapReduced.signature;
        usedMapReduce = true;
      }
    }

    if (!usedMapReduce) {
      try {
        await emit({
          type: "status",
          stage: "analysis",
          progress: 24,
          message: "正在拆解参考作品/作者的叙事节奏和文气特征。",
        });
        const legacyCompiled = await tryCompileStyleProfileWithLegacyFallback({
          references: input.references,
          samples: normalizedSamples,
          genre: project.genre,
          premise,
          fallbackProfile,
          manualGuidance: input.manualGuidance,
          avoidances: input.avoidances,
          llmCall,
        });
        if (legacyCompiled) {
          await emit({
            type: "status",
            stage: "drafting",
            progress: 56,
            message: "正在把风格解读编译成可长期注入的执行规则。",
          });
          compiledProfile = legacyCompiled.compiledProfile;
          streamedCard = legacyCompiled.styleCard;
          resolvedSignature = legacyCompiled.signature;
        } else {
          streamedCard = fallbackCard;
          compiledProfile = fallbackProfile;
        }
      } catch {
        streamedCard = fallbackCard;
        compiledProfile = fallbackProfile;
      }
    }

    await emit({
      type: "style_delta",
      replace: true,
      delta: streamedCard,
      progress: resolvedSignature ? 88 : 84,
    });

    // 编译耗时较长，落库前重读最新草稿，只回写 style* 字段，避免覆盖编译期间其它写入方的改动。
    const latestState = getFoundationWorkshopState(projectId) ?? state;
    const nextDraft = applyStyleSteeringFieldsToDraft(latestState.draft, {
      references: input.references,
      samples: normalizedSamples,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      styleSteeringCard: streamedCard,
      styleProfile: compiledProfile,
    });
    upsertFoundationWorkshopState(projectId, nextDraft, latestState.readyToGenerate);
    if (getFoundation(projectId)) {
      saveFoundationStyleCard(projectId, nextDraft.styleSteeringCard ?? fallbackCard, nextDraft.styleProfile);
    }

    await emit({
      type: "final",
      progress: 100,
      styleSteeringCard: streamedCard,
      state: getFoundationWorkshopState(projectId),
    });
  } finally {
    releaseLock();
  }
}
