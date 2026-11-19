import { getNarrativePersonLabel } from "../domain/project-structure.ts";
import { buildChapterDraftPlan } from "../story/chapter-draft-plan.ts";
import {
  chatJsonWithWorkflowPolicyTrace,
  requestChatCompletionForWorkflow,
} from "../llm-workflows.ts";
import { requestWithSentenceBoundaryContinuation } from "../long-form-continuation.ts";
import {
  plannerTracePath,
  computeChapterContentHash,
  computeContentHash,
  computeReviewWindowContentHash,
  readFinalChapter,
  readPlannerTraceFile,
  writeReviewFile,
} from "../project-files.ts";
import { buildProseSteeringInstructions } from "../writing/draft-quality.ts";
import {
  assessProseStyleRisk,
  buildLocalFlavorSignals,
  normalizeGeneratedChapterContent,
} from "../writing/prose-normalizer.ts";
import { evaluateWritingCharterGate } from "../writing/prose-rescue.ts";
import { auditCrossChapterManuscript, charactersPresentInWindow, inferTimeMarkerFromText } from "../writing/cross-chapter-audit.ts";
import { buildReviewCharterPromptContract, getReviewWindowStartChapter } from "./review-policy.ts";
import { classifyReviewFailureCategory, classifyReviewRepairPath } from "./run-decisions.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getBlueprint, getFoundation } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { listChapterReviewStates, saveReviewContextUsage, saveReviewReport } from "../repositories/review.repository.ts";
import { upsertRunState } from "../repositories/run.repository.ts";
import { buildRuntimeStyleSections } from "../services/blueprint-generate.service.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { measureReviewMessages, serializeContextPackSections } from "../services/context-serialization.ts";
import { renderProseSignalWarnings } from "../services/prose-signal-warnings.ts";
import type { ContextPack, DeepReviewVerdict, LocalFlavorSignals, QuickAuditVerdict, ReviewLineage } from "../types.ts";
import { nowIso } from "../utils.ts";
import {
  buildRuntimeReviewAssessments,
  deepReviewSchema,
  LONG_FORM_REWRITE_TIMEOUT_MS,
  mergeCharterViolations,
  persistCrossChapterIssues,
  resolveActiveStoryContract,
  REVIEW_JSON_CONTRACT,
} from "./chapter-shared.ts";

export function validateEarliestAffectedChapter(
  review: DeepReviewVerdict,
  windowStartChapter: number,
  windowEndChapter: number,
): DeepReviewVerdict {
  const earliest = review.earliestAffectedChapter;
  if (earliest === null || (earliest >= windowStartChapter && earliest <= windowEndChapter)) {
    return review;
  }

  const issue = {
    type: "invalid_review_window",
    location: `earliestAffectedChapter=${earliest}; reviewed=${windowStartChapter}-${windowEndChapter}`,
    severity: "major" as const,
  };
  return {
    ...review,
    verdict: "manual_review_window",
    earliestAffectedChapter: null,
    reason: `${review.reason} Reviewer 给出的最早受影响章节超出本次已审查窗口，禁止自动回滚。`,
    fixInstructions: `${review.fixInstructions} 请人工确认正确的返工窗口后再继续。`,
    issues: [...review.issues, issue],
  };
}

export async function loadDeepReviewWindow(projectId: string, chapterNo: number, currentText: string) {
  const states = listChapterReviewStates(projectId);
  const windowStartChapter = getReviewWindowStartChapter(states, chapterNo);
  const previousChapters = await Promise.all(
    Array.from({ length: Math.max(0, chapterNo - windowStartChapter) }, (_, index) => windowStartChapter + index).map(
      async (current) => ({
        chapterNo: current,
        content: (await readFinalChapter(projectId, current)) ?? "",
      }),
    ),
  );

  return {
    windowStartChapter,
    windowEndChapter: chapterNo,
    chapters: [
      ...previousChapters.filter((entry) => entry.content.trim()),
      {
        chapterNo,
        content: currentText,
      },
    ],
  };
}

export async function deepReviewChapter(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  retryCount: number,
  triggerReasons: QuickAuditVerdict["triggerReasons"],
  contextPack?: ContextPack | null,
  localFlavorSignals?: LocalFlavorSignals | null,
  executionContext?: ProjectExecutionContext,
  reviewSubject?: Pick<ReviewLineage, "submissionId" | "versionId" | "contentHash">,
) {
  const foundation = getFoundation(projectId);
  const blueprint = getBlueprint(projectId, chapterNo);
  const project = getProject(projectId);
  if (!project || !foundation || !blueprint) {
    throw new Error("缺少深审所需的设定或蓝图");
  }

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const activeContract = await resolveActiveStoryContract(projectId, project, foundation, context);
  const runtimeAssessments = buildRuntimeReviewAssessments(projectId, chapterNo, blueprint, activeContract);
  const serializedContext = contextPack ? serializeContextPackSections(contextPack) : null;
  const window = await loadDeepReviewWindow(projectId, chapterNo, chapterContent);
  const previousWindowChapter = window.chapters.at(-2) ?? null;
  const previousBlueprint = previousWindowChapter ? getBlueprint(projectId, previousWindowChapter.chapterNo) : null;
  const crossChapterAudit = auditCrossChapterManuscript({
    chapterNo,
    currentText: chapterContent,
    previousChapters: window.chapters
      .filter((chapter) => chapter.chapterNo < chapterNo)
      .map((chapter) => ({ chapterNo: chapter.chapterNo, text: chapter.content })),
    previousEndState: previousBlueprint && previousWindowChapter
      ? {
          location: previousBlueprint.locations.at(-1) ?? null,
          timeMarker: inferTimeMarkerFromText(previousWindowChapter.content.slice(-500)),
          charactersPresent: charactersPresentInWindow(
            previousWindowChapter.content.slice(-500),
            previousBlueprint.characters,
          ),
        }
      : null,
    currentStartState: {
      location: blueprint.locations[0] ?? null,
      timeMarker: inferTimeMarkerFromText(chapterContent.slice(0, 500)),
      charactersPresent: charactersPresentInWindow(chapterContent.slice(0, 220), blueprint.characters),
    },
  });
  const narrativePerson = getNarrativePersonLabel(project.narrativePerson);
  const reviewStyle = buildRuntimeStyleSections({
    stage: "reviewer",
    context,
  });
  const reviewerCharterContract = buildReviewCharterPromptContract({
    mode: "deep",
    writingCharter: context.styleProfile.writingCharter,
  });
  const localCharterGate = evaluateWritingCharterGate({
    chapterContent,
    proseRisk: assessProseStyleRisk(chapterContent, context.styleProfile.writingCharter),
    writingCharter: context.styleProfile.writingCharter,
  });

  const reviewMessages = [
    {
      role: "system" as const,
      content: `${context.prompts.reviewerDeep}\n\n你是长篇连续性深审 AI。必须输出 JSON。${reviewerCharterContract.length ? `\n${reviewerCharterContract.join("\n")}` : ""}`,
    },
    {
      role: "user" as const,
      content: [
        `章节号：${chapterNo}`,
        `项目叙事人称：${narrativePerson}`,
        `深审窗口：第 ${window.windowStartChapter} 章 - 第 ${window.windowEndChapter} 章`,
        `触发原因：${triggerReasons.join("、") || "cadence"}`,
        `本章蓝图：${JSON.stringify(blueprint, null, 2)}`,
        ...reviewStyle.sections,
        serializedContext ? `写作 DNA：\n${serializedContext.serializedWritingDna}` : "",
        `角色设定：${JSON.stringify(foundation.characters, null, 2)}`,
        serializedContext ? `Lorebook：\n${serializedContext.serializedLorebook || "无"}` : "",
        serializedContext ? `角色最新状态：\n${serializedContext.serializedCharacterStates || "无"}` : "",
        serializedContext ? `未回收线程：\n${serializedContext.serializedThreads || "无"}` : "",
        serializedContext ? `Hook诊断：\n${serializedContext.serializedHookDiagnostics || "无"}` : "",
        serializedContext ? `动态事实：\n${serializedContext.serializedFacts || "无"}` : "",
        serializedContext ? `历史摘要：\n${serializedContext.serializedSummaries || "无"}` : "",
        serializedContext ? `场景提醒：\n${serializedContext.serializedSteeringNotes || "无"}` : "",
        `当前故事推进状态：${JSON.stringify(runtimeAssessments, null, 2)}`,
        `跨章确定性审计：${JSON.stringify(crossChapterAudit, null, 2)}`,
        `窗口正文：\n${window.chapters
          .map((entry) => `【第 ${entry.chapterNo} 章】\n${entry.content}`)
          .join("\n\n===== 分隔线 =====\n\n")}`,
        reviewerCharterContract.length ? `作者习惯卡术语约束：\n${reviewerCharterContract.join("\n")}` : "",
        "请重点检查 state drift、动机连续性、世界规则一致性、伏笔债务、铺垫回收、POV/tone 稳定性、人称是否稳定、style drift / AI味，以及 storyProgression / genreFulfillment / loopRisk / story completion readiness。",
        "输出 verdict, confidence, reason, fixInstructions, issues, triggerReasons, styleChecklistHits, charterViolations, storyProgression, genreFulfillment, loopRisk, primaryDeltaDelivered, stuckDimensions, windowStartChapter, windowEndChapter, earliestAffectedChapter。",
        REVIEW_JSON_CONTRACT,
      ].filter(Boolean).join("\n\n"),
    },
  ];
  const budgetTokens = contextPack
    ? Object.values(contextPack.breakdown).reduce((sum, value) => sum + value, 0)
    : 128_000;
  saveReviewContextUsage(projectId, chapterNo, "deep", measureReviewMessages(reviewMessages, budgetTokens));
  const actualContentHash = computeChapterContentHash(chapterContent);
  if (reviewSubject && reviewSubject.contentHash !== actualContentHash) {
    throw new Error("审查正文哈希与作者稿不一致");
  }
  let promptHash = computeContentHash(JSON.stringify(reviewMessages));
  const review = await chatJsonWithWorkflowPolicyTrace(
    {
      workflow: "deep_review",
      profile: context.agents.reviewer.profile,
      model: context.agents.reviewer.assignment.model,
      messages: reviewMessages,
      assignmentMaxTokens: context.agents.reviewer.assignment.maxTokens,
      temperature: 0.2,
    },
    deepReviewSchema,
  ).then((result) => {
    promptHash = result.attempts.at(-1)?.messagesHash ?? promptHash;
    return result.value;
  }).catch<DeepReviewVerdict>((error) => {
    promptHash = (error as Error & { lastMessagesHash?: string }).lastMessagesHash ?? promptHash;
    return {
      reviewMode: "deep",
      verdict: "rewrite_current",
      confidence: 0.58,
      reason: "深审模型响应异常，保守退回当前章重修。",
      fixInstructions: "请重新核对当前章与窗口内前文的一致性，再补强动机与设定呼应。",
      issues: [
        {
          type: "deep_review_fallback",
          location: "深审窗口",
          severity: "major",
        },
      ],
      triggerReasons,
      styleChecklistHits: [],
      charterViolations: localCharterGate.budgetViolations,
      storyProgression: runtimeAssessments.storyProgression,
      genreFulfillment: runtimeAssessments.genreFulfillment,
      loopRisk: runtimeAssessments.loopRisk,
      primaryDeltaDelivered: runtimeAssessments.primaryDeltaDelivered,
      stuckDimensions: runtimeAssessments.stuckDimensions,
      windowStartChapter: window.windowStartChapter,
      windowEndChapter: window.windowEndChapter,
      earliestAffectedChapter: chapterNo,
    };
  });
  const lineage: ReviewLineage = {
    submissionId: reviewSubject?.submissionId ?? null,
    versionId: reviewSubject?.versionId ?? null,
    contentHash: reviewSubject?.contentHash ?? actualContentHash,
    reviewerProfileId: context.agents.reviewer.profile.id,
    promptHash,
    reviewSchemaVersion: reviewSubject?.submissionId ? "author-submission-v1" : "deep-review-v1",
    windowContentHash: computeReviewWindowContentHash(window.chapters),
  };
  let normalized: DeepReviewVerdict = {
    ...review,
    reviewMode: "deep",
    triggerReasons: review.triggerReasons.length ? review.triggerReasons : triggerReasons,
    styleChecklistHits: [
      ...(review.styleChecklistHits ?? []),
      ...localCharterGate.styleChecklistHits,
    ].filter((hit, index, hits) =>
      hits.findIndex((candidate) =>
        candidate.dimension === hit.dimension
        && candidate.description === hit.description
        && candidate.severity === hit.severity
      ) === index
    ),
    charterViolations: mergeCharterViolations(
      review.charterViolations ?? [],
      localCharterGate.budgetViolations,
    ),
    storyProgression: review.storyProgression ?? runtimeAssessments.storyProgression,
    genreFulfillment: review.genreFulfillment ?? runtimeAssessments.genreFulfillment,
    loopRisk: review.loopRisk ?? runtimeAssessments.loopRisk,
    primaryDeltaDelivered: review.primaryDeltaDelivered ?? runtimeAssessments.primaryDeltaDelivered,
    stuckDimensions: Array.from(new Set([...(review.stuckDimensions ?? []), ...runtimeAssessments.stuckDimensions])),
    localFlavorSignals: localFlavorSignals ?? buildLocalFlavorSignals(chapterContent, context.styleProfile.writingCharter),
    windowStartChapter: window.windowStartChapter,
    windowEndChapter: window.windowEndChapter,
    earliestAffectedChapter: review.earliestAffectedChapter,
  };
  if (crossChapterAudit.verdict === "escalate") {
    const preserveManualWindow = normalized.verdict === "manual_review_window";
    normalized = {
      ...normalized,
      verdict: preserveManualWindow ? "manual_review_window" : "rewrite_current",
      confidence: Math.min(normalized.confidence, 0.35),
      reason: "跨章确定性审计发现不可由模型通过覆盖的硬问题。",
      fixInstructions: "先修复跨章重复、连续性或稿面完整性问题，再重新审查。",
      issues: [
        ...normalized.issues,
        ...persistCrossChapterIssues(crossChapterAudit.issues),
      ],
      earliestAffectedChapter: preserveManualWindow ? normalized.earliestAffectedChapter : chapterNo,
    };
  }
  normalized = validateEarliestAffectedChapter(
    normalized,
    window.windowStartChapter,
    window.windowEndChapter,
  );
  normalized.failureCategory = classifyReviewFailureCategory({ review: normalized });
  normalized.repairStrategy = classifyReviewRepairPath({
    review: normalized,
    proseSeverity: normalized.localFlavorSignals?.severity ?? "warn",
    proseScore: normalized.localFlavorSignals?.score ?? null,
  });

  const trace = await readPlannerTraceFile(projectId, chapterNo);
  const plannerQuality = trace?.plannerQuality ?? null;
  const path = await writeReviewFile({
    projectId,
    chapterNo,
    review: normalized,
    plannerQuality,
    plannerTracePath: trace ? plannerTracePath(projectId, chapterNo) : null,
    lineage,
  });
  saveReviewReport(projectId, chapterNo, normalized, path, plannerQuality, lineage);
  upsertRunState(projectId, {
    stage: "review",
    status: "review",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: chapterNo,
    retryCount,
    confidence: normalized.confidence,
    lastError: null,
    stageDetails: {
      review: {
        mode: "deep",
        verdict: normalized.verdict,
        confidence: normalized.confidence,
        retryCount,
        triggerReasons: normalized.triggerReasons,
        windowStartChapter: normalized.windowStartChapter,
        windowEndChapter: normalized.windowEndChapter,
        earliestAffectedChapter: normalized.earliestAffectedChapter,
      },
    },
  });
  appendRunLog(
    projectId,
    normalized.verdict === "pass" ? "info" : "warning",
    `第 ${chapterNo} 章深审结果：${normalized.verdict} (confidence=${normalized.confidence.toFixed(2)})`,
  );
  return normalized;
}

export async function rewriteChapterFromReview(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  review: Pick<QuickAuditVerdict, "issues" | "fixInstructions" | "reason" | "styleChecklistHits" | "charterViolations">,
  contextPack: ContextPack | null,
  options?: {
    timeoutMs?: number;
    maxAttempts?: number;
  },
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  const blueprint = getBlueprint(projectId, chapterNo);
  if (!project || !foundation || !blueprint) {
    throw new Error("缺少返修所需的项目设定或章节规划");
  }

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const serializedContext = contextPack ? serializeContextPackSections(contextPack) : null;
  const chapterDraftPlan = contextPack ? buildChapterDraftPlan(contextPack) : null;
  const writerStyle = buildRuntimeStyleSections({
    stage: "writer",
    context,
  });

  const narrativePerson = getNarrativePersonLabel(project.narrativePerson);
  const proseSignals = renderProseSignalWarnings(chapterContent, context.styleProfile.writingCharter);
  const proseInstructions = buildProseSteeringInstructions(
    assessProseStyleRisk(chapterContent, context.styleProfile.writingCharter),
    context.styleProfile.writingCharter,
  );

  const messages = [
    {
      role: "system" as const,
      content: `${context.prompts.writer}

你现在接收 Reviewer 的返修单。
你的任务不是解释问题，而是直接交付一版修订后的完整章节正文。
必须保留已经成立的有效内容，修掉 reviewer 指出的核心问题，输出完整正文，不要附带说明、标题、分点或修订备注。`,
    },
    {
      role: "user" as const,
      content: [
        `章节号：${chapterNo}`,
        `叙事人称：${narrativePerson}`,
        `当前章节规划：${JSON.stringify(blueprint, null, 2)}`,
        chapterDraftPlan ? `结构/声线执行计划：\n${chapterDraftPlan.promptText}` : "",
        ...writerStyle.sections,
        serializedContext ? `写作 DNA：\n${serializedContext.serializedWritingDna}` : "",
        `项目 premise：${foundation.premise}`,
        `Reviewer 结论：${review.reason}`,
        `Reviewer 修订要求：${review.fixInstructions}`,
        review.charterViolations.length ? `作者习惯卡超预算明细：\n${JSON.stringify(review.charterViolations, null, 2)}` : "",
        `问题清单：${JSON.stringify(review.issues, null, 2)}`,
        `当前 prose 风险：${proseSignals.summary}`,
        proseSignals.warnings.length ? `本轮顺手修掉的文笔问题：\n- ${proseSignals.warnings.join("\n- ")}` : "",
        proseInstructions.length ? `本轮必须执行的文笔约束：\n- ${proseInstructions.join("\n- ")}` : "",
        "返修硬性要求：",
        "0. 所有超预算项都要直接删改到阈值内，不要只换同义词保留同样密度。",
        "1. 修 Reviewer 指出的情节/规则问题时，顺手把重复句首、代词堆叠、模板句和空转比喻一起压下去。",
        "2. 连续代词起句要改成主体锚点、动作承接或自然省略，不要一排“它……它……它……”。",
        "3. 同一主体名词不要连续多句起头，不要一排“咿呀……咿呀……咿呀……”；改用环境、动作结果、身体反馈或视线落点分散句首。",
        "4. “像/仿佛”“不是……而是……”之类模板句只保留必要个别处，其余打散，优先用动作、感官和结果直接显形。",
        "5. 保留已有的动作链、危险感和信息量，不要把返修写软、写空、写成解释稿。",
        serializedContext ? `上一章结尾实录：\n${serializedContext.serializedPreviousChapterTail || "无"}` : "",
        serializedContext ? `角色最新状态：\n${serializedContext.serializedCharacterStates || "无"}` : "",
        serializedContext ? `未回收线程：\n${serializedContext.serializedThreads || "无"}` : "",
        serializedContext ? `Hook诊断：\n${serializedContext.serializedHookDiagnostics || "无"}` : "",
        serializedContext ? `Lorebook：\n${serializedContext.serializedLorebook || "无"}` : "",
        serializedContext ? `动态事实：\n${serializedContext.serializedFacts || "无"}` : "",
        serializedContext ? `历史摘要：\n${serializedContext.serializedSummaries || "无"}` : "",
        serializedContext ? `场景提醒：\n${serializedContext.serializedSteeringNotes || "无"}` : "",
        `当前正文：\n${chapterContent}`,
      ].filter(Boolean).join("\n\n"),
    },
  ];

  const { content: rewritten } = await requestWithSentenceBoundaryContinuation({
    messages,
    request: (passMessages, pass) =>
      requestChatCompletionForWorkflow(
        {
          workflow: "rewrite_from_review",
          profile: context.agents.writer.profile,
          model: context.agents.writer.assignment.model,
          messages: passMessages,
          assignmentMaxTokens: context.agents.writer.assignment.maxTokens,
          temperature: Math.min(context.agents.writer.assignment.temperature, 0.6),
          timeoutMs: options?.timeoutMs ?? LONG_FORM_REWRITE_TIMEOUT_MS,
          maxAttempts: pass.kind === "continuation" ? 1 : options?.maxAttempts,
        },
        pass.kind === "continuation" ? pass.overrideMaxTokens : undefined,
      ),
    onStillTruncated: () => {
      console.warn(`[chapter-review:${projectId}:${chapterNo}] rewrite continuation still hit finish_reason=length.`);
      appendRunLog(projectId, "warning", `第 ${chapterNo} 章返修续写补救后仍命中长度上限，正文结尾可能被截断。`);
    },
  });

  return normalizeGeneratedChapterContent(rewritten);
}
