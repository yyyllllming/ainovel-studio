import { getNarrativePersonLabel } from "../domain/project-structure.ts";
import { chatJsonWithWorkflowPolicyTrace } from "../llm-workflows.ts";
import {
  plannerTracePath,
  computeChapterContentHash,
  computeContentHash,
  readFinalChapter,
  readPlannerTraceFile,
  writeReviewFile,
} from "../project-files.ts";
import { appendRunLog, upsertRunState } from "../repositories/run.repository.ts";
import { getBlueprint, getFoundation } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { saveReviewContextUsage, saveReviewReport } from "../repositories/review.repository.ts";
import { buildReviewCharterPromptContract } from "./review-policy.ts";
import { buildRuntimeStyleSections } from "../services/blueprint-generate.service.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { measureReviewMessages, serializeContextPackSections } from "../services/context-serialization.ts";
import { buildDeterministicQuickAudit } from "../writing/quick-audit.ts";
import { auditCrossChapterManuscript, charactersPresentInWindow, inferTimeMarkerFromText } from "../writing/cross-chapter-audit.ts";
import { classifyReviewFailureCategory, classifyReviewRepairPath } from "./run-decisions.ts";
import { buildLocalFlavorSignals } from "../writing/prose-normalizer.ts";
import type { ContextPack, LocalFlavorSignals, QuickAuditVerdict, ReviewLineage } from "../types.ts";
import { nowIso } from "../utils.ts";
import {
  buildRuntimeReviewAssessments,
  getRecentDeltaRecords,
  mergeCharterViolations,
  persistCrossChapterIssues,
  quickAuditSchema,
  resolveActiveStoryContract,
  REVIEW_JSON_CONTRACT,
} from "./chapter-shared.ts";

export async function quickAuditChapter(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  retryCount: number,
  contextPack?: ContextPack | null,
  localFlavorSignals?: LocalFlavorSignals | null,
  executionContext?: ProjectExecutionContext,
  reviewSubject?: Pick<ReviewLineage, "submissionId" | "versionId" | "contentHash">,
) {
  const foundation = getFoundation(projectId);
  const blueprint = getBlueprint(projectId, chapterNo);
  const project = getProject(projectId);
  if (!project || !foundation || !blueprint) {
    throw new Error("缺少审稿所需的设定或蓝图");
  }
  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const activeContract = await resolveActiveStoryContract(projectId, project, foundation, context);
  const runtimeAssessments = buildRuntimeReviewAssessments(projectId, chapterNo, blueprint, activeContract);
  const serializedContext = contextPack ? serializeContextPackSections(contextPack) : null;
  const narrativePerson = getNarrativePersonLabel(project.narrativePerson);
  const reviewStyle = buildRuntimeStyleSections({
    stage: "reviewer",
    context,
  });
  const reviewerCharterContract = buildReviewCharterPromptContract({
    mode: "quick",
    writingCharter: context.styleProfile.writingCharter,
  });
  const deterministic = buildDeterministicQuickAudit({
    chapterContent,
    blueprint,
    hasHardConflict: Boolean(contextPack?.conflicts.some((conflict) => conflict.severity === "hard")),
    writingCharter: context.styleProfile.writingCharter,
    storyContract: activeContract,
    recentDeltaRecords: getRecentDeltaRecords(projectId, chapterNo),
  });
  const previousChapters = await Promise.all(
    Array.from({ length: Math.min(5, Math.max(0, chapterNo - 1)) }, (_, index) => chapterNo - 1 - index)
      .reverse()
      .map(async (previousChapterNo) => ({
        chapterNo: previousChapterNo,
        text: (await readFinalChapter(projectId, previousChapterNo)) ?? "",
      })),
  );
  const previousBlueprint = chapterNo > 1 ? getBlueprint(projectId, chapterNo - 1) : null;
  const previousText = previousChapters.at(-1)?.text ?? "";
  const crossChapterAudit = auditCrossChapterManuscript({
    chapterNo,
    currentText: chapterContent,
    previousChapters: previousChapters.filter((chapter) => chapter.text.trim()),
    previousEndState: previousBlueprint
      ? {
          location: previousBlueprint.locations.at(-1) ?? null,
          timeMarker: inferTimeMarkerFromText(previousText.slice(-500)),
          charactersPresent: charactersPresentInWindow(previousText.slice(-500), previousBlueprint.characters),
        }
      : null,
    currentStartState: {
      location: blueprint.locations[0] ?? null,
      timeMarker: inferTimeMarkerFromText(chapterContent.slice(0, 500)),
      charactersPresent: charactersPresentInWindow(chapterContent.slice(0, 220), blueprint.characters),
    },
  });

  const reviewMessages = [
    {
      role: "system" as const,
      content: `${context.prompts.reviewerQuick}\n\n你是极简检查 AI。必须输出 JSON。${reviewerCharterContract.length ? `\n${reviewerCharterContract.join("\n")}` : ""}`,
    },
    {
      role: "user" as const,
      content: [
        `章节号：${chapterNo}`,
        `项目叙事人称：${narrativePerson}`,
        `本章蓝图：${JSON.stringify(blueprint, null, 2)}`,
        ...reviewStyle.sections,
        serializedContext ? `写作 DNA：\n${serializedContext.serializedWritingDna}` : "",
        `角色设定：${JSON.stringify(foundation.characters, null, 2)}`,
        serializedContext ? `角色最新状态：\n${serializedContext.serializedCharacterStates || "无"}` : "",
        serializedContext ? `未回收线程：\n${serializedContext.serializedThreads || "无"}` : "",
        serializedContext ? `Lorebook：\n${serializedContext.serializedLorebook || "无"}` : "",
        serializedContext ? `动态事实：\n${serializedContext.serializedFacts || "无"}` : "",
        serializedContext ? `历史摘要：\n${serializedContext.serializedSummaries || "无"}` : "",
        serializedContext ? `场景提醒：\n${serializedContext.serializedSteeringNotes || "无"}` : "",
        `当前返工次数：${retryCount}`,
        `正文：\n${chapterContent}`,
        reviewerCharterContract.length ? `作者习惯卡术语约束：\n${reviewerCharterContract.join("\n")}` : "",
        `当前故事推进状态：${JSON.stringify(runtimeAssessments, null, 2)}`,
        `跨章确定性审计：${JSON.stringify(crossChapterAudit, null, 2)}`,
        "只检查硬连续性风险、蓝图明显跑偏、文本结构破损、人称是否漂移、style drift / AI味，以及 storyProgression / genreFulfillment / loopRisk 是否需要升级到深审。请输出 verdict, confidence, reason, fixInstructions, issues, triggerReasons, styleChecklistHits, charterViolations, storyProgression, genreFulfillment, loopRisk, primaryDeltaDelivered, stuckDimensions。",
        REVIEW_JSON_CONTRACT,
      ].filter(Boolean).join("\n\n"),
    },
  ];
  const budgetTokens = contextPack
    ? Object.values(contextPack.breakdown).reduce((sum, value) => sum + value, 0)
    : 128_000;
  saveReviewContextUsage(projectId, chapterNo, "quick", measureReviewMessages(reviewMessages, budgetTokens));
  const actualContentHash = computeChapterContentHash(chapterContent);
  if (reviewSubject && reviewSubject.contentHash !== actualContentHash) {
    throw new Error("审查正文哈希与作者稿不一致");
  }
  let promptHash = computeContentHash(JSON.stringify(reviewMessages));
  const llmAudit = await chatJsonWithWorkflowPolicyTrace(
    {
      workflow: "quick_audit",
      profile: context.agents.reviewer.profile,
      model: context.agents.reviewer.assignment.model,
      messages: reviewMessages,
      assignmentMaxTokens: context.agents.reviewer.assignment.maxTokens,
      temperature: 0.2,
    },
    quickAuditSchema,
  ).then((result) => {
    promptHash = result.attempts.at(-1)?.messagesHash ?? promptHash;
    return result.value;
  }).catch<QuickAuditVerdict>((error) => {
    promptHash = (error as Error & { lastMessagesHash?: string }).lastMessagesHash ?? promptHash;
    if (reviewSubject) {
      throw new Error("作者稿 Reviewer 响应异常，未生成可通过的审查报告");
    }
    return {
      reviewMode: "quick",
      verdict: deterministic.verdict === "pass" ? "pass" : "escalate",
      confidence: deterministic.confidence,
      reason: "极简检查模型响应异常，已回退到规则检查。",
      fixInstructions: deterministic.fixInstructions,
      issues: deterministic.issues.length
        ? deterministic.issues
        : [
            {
              type: "quick_audit_fallback",
              location: "全文",
              severity: "minor",
            },
          ],
      triggerReasons: deterministic.triggerReasons,
      styleChecklistHits: deterministic.styleChecklistHits,
      charterViolations: deterministic.charterViolations,
      storyProgression: deterministic.storyProgression,
      genreFulfillment: deterministic.genreFulfillment,
      loopRisk: deterministic.loopRisk,
      primaryDeltaDelivered: deterministic.primaryDeltaDelivered,
      stuckDimensions: deterministic.stuckDimensions,
    };
  });
  const lineage: ReviewLineage = {
    submissionId: reviewSubject?.submissionId ?? null,
    versionId: reviewSubject?.versionId ?? null,
    contentHash: reviewSubject?.contentHash ?? actualContentHash,
    reviewerProfileId: context.agents.reviewer.profile.id,
    promptHash,
    reviewSchemaVersion: reviewSubject?.submissionId ? "author-submission-v1" : "quick-audit-v1",
    windowContentHash: null,
  };

  const mergedStyleChecklistHits = [
    ...deterministic.styleChecklistHits,
    ...(llmAudit.styleChecklistHits ?? []),
  ].filter((hit, index, hits) =>
    hits.findIndex((candidate) =>
      candidate.dimension === hit.dimension
      && candidate.description === hit.description
      && candidate.severity === hit.severity
    ) === index
  );
  const mergedCharterViolations = mergeCharterViolations(
    deterministic.charterViolations,
    llmAudit.charterViolations ?? [],
  );

  const audit: QuickAuditVerdict = {
    reviewMode: "quick",
    verdict: deterministic.verdict === "escalate" || crossChapterAudit.verdict === "escalate" || llmAudit.verdict === "escalate" ? "escalate" : "pass",
    confidence: Math.min(deterministic.confidence, crossChapterAudit.verdict === "escalate" ? 0.35 : 1, llmAudit.confidence),
    reason: crossChapterAudit.verdict === "escalate"
      ? "跨章确定性审计发现不可由模型通过覆盖的硬问题。"
      : deterministic.verdict === "escalate" ? deterministic.reason : llmAudit.reason,
    fixInstructions:
      crossChapterAudit.verdict === "escalate"
        ? "先修复跨章重复、连续性或稿面完整性问题，再重新审查。"
        : deterministic.verdict === "escalate"
        ? deterministic.fixInstructions
        : llmAudit.fixInstructions,
    issues: [
      ...deterministic.issues,
      ...persistCrossChapterIssues(crossChapterAudit.issues),
      ...llmAudit.issues,
    ],
    triggerReasons: Array.from(new Set([
      ...deterministic.triggerReasons,
      ...(crossChapterAudit.verdict === "escalate" ? ["hard_conflict" as const] : []),
      ...llmAudit.triggerReasons,
    ])),
    styleChecklistHits: mergedStyleChecklistHits,
    charterViolations: mergedCharterViolations,
    storyProgression: llmAudit.storyProgression ?? deterministic.storyProgression,
    genreFulfillment: llmAudit.genreFulfillment ?? deterministic.genreFulfillment,
    loopRisk: llmAudit.loopRisk ?? deterministic.loopRisk,
    primaryDeltaDelivered: llmAudit.primaryDeltaDelivered ?? deterministic.primaryDeltaDelivered,
    stuckDimensions: Array.from(new Set([...(deterministic.stuckDimensions ?? []), ...(llmAudit.stuckDimensions ?? [])])),
    localFlavorSignals: localFlavorSignals ?? buildLocalFlavorSignals(chapterContent, context.styleProfile.writingCharter),
  };
  audit.failureCategory = classifyReviewFailureCategory({ review: audit });
  audit.repairStrategy = classifyReviewRepairPath({
    review: audit,
    proseSeverity: audit.localFlavorSignals?.severity ?? "warn",
    proseScore: audit.localFlavorSignals?.score ?? null,
  });

  const trace = await readPlannerTraceFile(projectId, chapterNo);
  const plannerQuality = trace?.plannerQuality ?? null;
  const path = await writeReviewFile({
    projectId,
    chapterNo,
    review: audit,
    plannerQuality,
    plannerTracePath: trace ? plannerTracePath(projectId, chapterNo) : null,
    lineage,
  });
  saveReviewReport(projectId, chapterNo, audit, path, plannerQuality, lineage);
  upsertRunState(projectId, {
    stage: "review",
    status: "review",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: chapterNo,
    retryCount,
    confidence: audit.confidence,
    lastError: null,
    stageDetails: {
      review: {
        mode: "quick",
        verdict: audit.verdict,
        confidence: audit.confidence,
        retryCount,
        triggerReasons: audit.triggerReasons,
      },
    },
  });
  appendRunLog(
    projectId,
    audit.verdict === "pass" ? "info" : "warning",
    `第 ${chapterNo} 章极简检查：${audit.verdict} (confidence=${audit.confidence.toFixed(2)})`,
  );
  return audit;
}
