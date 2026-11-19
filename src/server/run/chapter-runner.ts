import "../server-only.ts";
import { notFound } from "../errors.ts";
import { buildReviewRepairPlan } from "../content/review-repair.ts";
import { assembleContextPack } from "./context-engine.ts";
import { buildChapterDraftPlan } from "../story/chapter-draft-plan.ts";
import {
  shouldAutoPickVersionOnLowConfidence,
  shouldAutoRestartWindowReview,
} from "./manual-review.ts";
import {
  readFinalChapter,
  writeConflictNote,
  writeProjectMeta,
} from "../project-files.ts";
import { sanitizeProjectPremise } from "../foundation/foundation-summary-sanitizer.ts";
import { applyPatchOperations } from "../patch-utils.ts";
import { assessProseStyleRisk } from "../writing/prose-normalizer.ts";
import {
  buildAutoProseRescueReview,
  enforceLocalProsePassGate,
} from "../writing/prose-rescue.ts";
import { buildDeterministicQuickAudit } from "../writing/quick-audit.ts";
import {
  classifyReviewRepairPath,
  hasBlockingContextConflicts,
  resolveDeepReviewOutcome,
  shouldFallbackAfterAutoProseRescueFailure,
  shouldRewriteAfterQuickAudit,
  shouldInvokeDeepReview,
  shouldInvokeQuickAudit,
  shouldInvokeStyleRescue,
} from "./run-decisions.ts";
import { runWithHeartbeat } from "./run-heartbeat.ts";
import { autoPickVersionForManualReview } from "./manual-review-engine.ts";
import { getReviewWindowStartChapter } from "./review-policy.ts";
import {
  buildSuspendedRunStatePatch,
  readLockState,
  releaseLock,
  runningTasks,
  touchRunHeartbeat,
  waitIfPaused,
} from "./run-internals.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { confirmCardProgressionsInWindow } from "../repositories/card.repository.ts";
import { getBlueprint, getFoundation, isFoundationLocked } from "../repositories/foundation.repository.ts";
import { getProject, getStoryContract } from "../repositories/project.repository.ts";
import { getRunState, upsertRunState } from "../repositories/run.repository.ts";
import { listChapterInvalidations } from "../repositories/chapter.repository.ts";
import { listChapterReviewStates, lockChapterReviewWindow, upsertChapterReviewState } from "../repositories/review.repository.ts";
import { createRollbackVersionService } from "../commit/rollback-version.service.ts";
import { invalidateFutureTimelineAfterChapterChange } from "../story/timeline-invalidation.ts";
import {
  finalizeProjectCompletion as finalizeProjectCompletionService,
} from "../services/manual-review.service.ts";
import { requestEditorPatch } from "../services/chapter-optimize.service.ts";
import { generateVersions } from "../services/chapter-version-generate.service.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { getFoundationDriftReport } from "../services/foundation-truth-source.service.ts";
import {
} from "../story/story-contract.ts";
import { ensureStoryContract } from "../story/story-contract-engine.ts";
import { softInvalidateChapterRange } from "../story/timeline-invalidation.ts";
import type {
  ContextPack,
  LocalFlavorSignals,
  RunProgressPayload,
} from "../types.ts";
import { nowIso } from "../utils.ts";

import { BEST_EFFORT_REWRITE_TIMEOUT_MS, getRecentDeltaRecords } from "./chapter-shared.ts";
import { ensureFoundationCoverage, planStoryContinuation, writeDraftFromContext } from "./chapter-draft.ts";
import {
  persistProseSteeringNotes,
  persistReviewSteeringNotes,
  runStylePass,
} from "./chapter-style-pass.ts";
import { quickAuditChapter } from "./chapter-audit.ts";
import { deepReviewChapter, rewriteChapterFromReview } from "./chapter-review.ts";
import { finalizeAcceptedChapter } from "./chapter-finalize.ts";
import {
  executePlanningRepair,
  MAX_PLANNING_REPAIR_ATTEMPTS,
  shouldEscalatePlanningRepairToManualReview,
} from "./planning-repair.ts";
import { prepareChapterPrerequisites } from "./chapter-prerequisites.ts";
type ChapterRunResult =
  | { status: "pass" }
  | { status: "manual_review" }
  | { status: "restart"; fromChapter: number };

const AUTO_WINDOW_REPAIR_REASON_PREFIX = "[auto_window_repair]";

// 重写重试前清掉中断恢复信号，避免 writeDraftFromContext 把被否决的旧稿当成中断草稿续写。
export function buildDraftRecoveryResetPatch(stage: RunProgressPayload["stage"], chapterNo: number) {
  return {
    stage,
    desiredState: "running" as const,
    heartbeatAt: nowIso(),
    currentChapter: chapterNo,
    draftFile: null,
    currentPosition: 0,
    wordCount: 0,
    stageDetails: {
      writing: undefined,
    },
  };
}

function countRecentAutoWindowRepairs(projectId: string, fromChapter: number, currentChapter: number) {
  return listChapterInvalidations(projectId).filter((entry) =>
    entry.rangeStartChapter === fromChapter
    && entry.rangeEndChapter >= currentChapter
    && entry.reason.startsWith(AUTO_WINDOW_REPAIR_REASON_PREFIX)
  ).length;
}

async function runSingleChapter(
  projectId: string,
  chapterNo: number,
  executionContext: ProjectExecutionContext,
  sessionId: string,
): Promise<ChapterRunResult> {
  const startedAt = Date.now();
  let retryCount = 0;
  let autoPickAttempts = 0;
  let proseRescueAttempts = 0;
  let planningRepairAttempts = 0;
  let currentText = "";
  let currentLocalFlavorSignals: LocalFlavorSignals | null = null;
  let currentContextPack: ContextPack | null = null;
  let blueprintReason: string | undefined;
  let needsFreshDraft = true;
  const clearDraftRecoverySignals = () => {
    upsertRunState(
      projectId,
      buildDraftRecoveryResetPatch(getRunState(projectId)?.stage ?? "review", chapterNo),
    );
  };
  // Keep long review / rewrite / analysis stages from being marked interrupted mid-flight.
  const runStageTask = <T>(
    stage: RunProgressPayload["stage"],
    task: () => Promise<T>,
    input?: {
      intervalMs?: number;
    },
  ) =>
    runWithHeartbeat(
      task,
      () => touchRunHeartbeat(projectId, {
        stage,
        sessionId,
      }),
      {
        ...input,
        onError: (error) => {
          appendRunLog(
            projectId,
            "warning",
            `监控心跳刷新失败（${stage}）：${error instanceof Error ? error.message : "未知错误"}`,
          );
        },
      },
    );

  while (retryCount < 5) {
    await waitIfPaused(projectId, sessionId);
    const task = runningTasks.get(projectId);
    const lockState = readLockState(projectId);
    if (!task || lockState?.stopRequested) {
      throw new Error("运行已停止");
    }
    touchRunHeartbeat(projectId, {
      stage: getRunState(projectId)?.stage,
      sessionId: task.sessionId,
    });

    if (needsFreshDraft) {
      upsertRunState(projectId, {
        stage: "blueprint",
        status: "blueprint",
        desiredState: "running",
        heartbeatAt: nowIso(),
        currentChapter: chapterNo,
        retryCount,
        lastError: null,
        stageDetails: {
          blueprint: {
            generated: false,
            conflictCount: 0,
          },
        },
      });

      appendRunLog(projectId, "info", `第 ${chapterNo} 章开始生成内部蓝图与首稿上下文`);
      const contextPack = await runStageTask(
        "context",
        () => prepareChapterPrerequisites({
          projectId,
          chapterNo,
          blueprintReason,
          sessionId,
          executionContext,
        }),
      );
      await waitIfPaused(projectId, sessionId);
      currentContextPack = contextPack;
      await writeConflictNote(projectId, chapterNo, contextPack.conflicts);

      upsertRunState(projectId, {
        stage: "context",
        status: "context",
        desiredState: "running",
        heartbeatAt: nowIso(),
        currentChapter: chapterNo,
        retryCount,
        lastError: null,
        stageDetails: {
          context: {
            totalTokens: contextPack.totalTokens,
            conflicts: contextPack.conflicts,
          },
        },
      });

      if (hasBlockingContextConflicts(contextPack.conflicts)) {
        const blockingConflicts = contextPack.conflicts.filter((conflict) => conflict.severity === "hard");
        appendRunLog(projectId, "warning", `第 ${chapterNo} 章存在阻塞冲突，进入人工审阅`);
        upsertRunState(projectId, {
          stage: "manual_review",
          status: "manual_review",
          desiredState: "idle",
          heartbeatAt: null,
          currentChapter: chapterNo,
          retryCount,
          lastError: blockingConflicts.map((item) => item.message).join("；"),
        });
        return { status: "manual_review" as const };
      }

      const draft = await runStageTask("writing", () => writeDraftFromContext(projectId, chapterNo, contextPack, sessionId, executionContext));
      await waitIfPaused(projectId, sessionId);
      {
        const stylePassResult = await runStageTask(
          "style_pass",
          () => runStylePass(projectId, chapterNo, draft.content, currentContextPack, executionContext),
        );
        currentText = stylePassResult.content;
        currentLocalFlavorSignals = stylePassResult.localFlavorSignals ?? null;
      }
      await waitIfPaused(projectId, sessionId);
      persistProseSteeringNotes(projectId, chapterNo, currentText);
      proseRescueAttempts = 0;
      needsFreshDraft = false;
    }

    const project = getProject(projectId);
    if (!project) {
      throw notFound("项目不存在");
    }
    const blueprint = getBlueprint(projectId, chapterNo);
    if (!blueprint) {
      throw new Error("缺少章节蓝图，无法执行 quick audit 前自检");
    }
    const activeContract = project.storyContract ?? getStoryContract(projectId);
    const recentDeltaRecords = getRecentDeltaRecords(projectId, chapterNo);
    while (true) {
      const deterministicQuickAudit = buildDeterministicQuickAudit({
        chapterContent: currentText,
        blueprint,
        hasHardConflict: Boolean(currentContextPack?.conflicts.some((conflict) => conflict.severity === "hard")),
        writingCharter: executionContext.styleProfile.writingCharter,
        storyContract: activeContract,
        recentDeltaRecords,
      });
      const currentProseRisk = assessProseStyleRisk(currentText, executionContext.styleProfile.writingCharter);
      if (!shouldInvokeStyleRescue({
        attemptsUsed: proseRescueAttempts,
        maxAttempts: 3,
        chapterNo,
        retryCount,
        proseRisk: currentProseRisk,
        quickAudit: deterministicQuickAudit,
      })) {
        break;
      }

      const rescueReview = buildAutoProseRescueReview({
        chapterNo,
        chapterContent: currentText,
        proseRisk: currentProseRisk,
        writingCharter: executionContext.styleProfile.writingCharter,
      });
      proseRescueAttempts += 1;
      appendRunLog(
        projectId,
        "warning",
        `第 ${chapterNo} 章在 quick audit 前检测到纯 prose 风险，先执行自动 prose rescue（第 ${proseRescueAttempts} 次）`,
      );
      try {
        currentText = await runStageTask(
          "style_pass",
          () => rewriteChapterFromReview(
            projectId,
            chapterNo,
            currentText,
            rescueReview,
            currentContextPack,
            {
              timeoutMs: BEST_EFFORT_REWRITE_TIMEOUT_MS,
              maxAttempts: 1,
            },
            executionContext,
          ),
        );
        await waitIfPaused(projectId, sessionId);
        {
          const stylePassResult = await runStageTask(
            "style_pass",
            () => runStylePass(projectId, chapterNo, currentText, currentContextPack, executionContext),
          );
          currentText = stylePassResult.content;
          currentLocalFlavorSignals = stylePassResult.localFlavorSignals ?? null;
        }
        await waitIfPaused(projectId, sessionId);
        persistProseSteeringNotes(projectId, chapterNo, currentText);
      } catch (error) {
        if (!shouldFallbackAfterAutoProseRescueFailure(error)) {
          throw error;
        }
        appendRunLog(
          projectId,
          "warning",
          `第 ${chapterNo} 章自动 prose rescue 失败，保留当前稿继续 quick audit：${error instanceof Error ? error.message : "未知错误"}`,
        );
        break;
      }
    }
    const storyContract = project.storyContract ?? getStoryContract(projectId);
    const isCompletionCandidate = project.chapterPlanningMode === "dynamic"
      ? Boolean(storyContract?.forecast.finalRunReady)
        || chapterNo >= (storyContract?.forecast.target ?? project.chapterBudgetTarget)
        || chapterNo >= project.hardChapterCap
      : chapterNo >= project.targetChapters;

    const localQuickAudit = buildDeterministicQuickAudit({
      chapterContent: currentText,
      blueprint,
      hasHardConflict: false,
      writingCharter: executionContext.styleProfile.writingCharter,
      storyContract: activeContract,
      recentDeltaRecords,
    });
    const shouldRunQuickAudit = shouldInvokeQuickAudit({
      chapterNo,
      totalChapters: project.hardChapterCap,
      retryCount,
      policy: project.reviewPolicy,
      localGate: localQuickAudit,
      isCompletionCandidate,
    });

    if (!shouldRunQuickAudit) {
      await runStageTask(
        "analysis",
        () => finalizeAcceptedChapter(
          projectId,
          chapterNo,
          currentText,
          {
            reviewStatus: "provisional",
          },
          executionContext,
        ),
      );
      return { status: "pass" as const };
    }

    const quickAudit = await runStageTask(
      "review",
      () => quickAuditChapter(
        projectId,
        chapterNo,
        currentText,
        retryCount,
        currentContextPack,
        currentLocalFlavorSignals,
        executionContext,
      ),
    );
    const quickCheckedAt = nowIso();
    const currentWindowStart = getReviewWindowStartChapter(listChapterReviewStates(projectId), chapterNo);
    const openWindowId = `window-${projectId}-${currentWindowStart}-${chapterNo}`;

    upsertChapterReviewState({
      projectId,
      chapterNo,
      status: "provisional",
      quickCheckedAt,
      openWindowId,
      lastReviewMode: "quick",
      latestConfidence: quickAudit.confidence,
    });

    const deepDecision = shouldInvokeDeepReview({
      chapterNo,
      totalChapters: project.hardChapterCap,
      policy: project.reviewPolicy,
      quickAudit,
      hasHardConflict: false,
      hasMajorProgression: false,
      isCompletionCandidate,
    });

    if (!deepDecision.shouldInvoke) {
      if (shouldRewriteAfterQuickAudit({
        attemptsUsed: retryCount,
        maxAttempts: 2,
        proseRisk: assessProseStyleRisk(currentText, executionContext.styleProfile.writingCharter),
        quickAudit,
      })) {
        appendRunLog(
          projectId,
          "warning",
          `第 ${chapterNo} 章 quick audit 发现纯 prose 超预算，当前尚未进入深审窗口，先执行第 ${retryCount + 1} 次定向返修`,
        );
        persistReviewSteeringNotes(projectId, chapterNo, quickAudit);
        try {
          currentText = await runStageTask(
            "review",
            () => rewriteChapterFromReview(
              projectId,
              chapterNo,
              currentText,
              quickAudit,
              currentContextPack,
              {
                timeoutMs: BEST_EFFORT_REWRITE_TIMEOUT_MS,
                maxAttempts: 1,
              },
              executionContext,
            ),
          );
          await waitIfPaused(projectId, sessionId);
          {
            const stylePassResult = await runStageTask(
              "style_pass",
              () => runStylePass(projectId, chapterNo, currentText, currentContextPack, executionContext),
            );
            currentText = stylePassResult.content;
            currentLocalFlavorSignals = stylePassResult.localFlavorSignals ?? null;
          }
          await waitIfPaused(projectId, sessionId);
          persistProseSteeringNotes(projectId, chapterNo, currentText);
          retryCount += 1;
          appendRunLog(projectId, "info", `第 ${chapterNo} 章完成第 ${retryCount} 次 quick-audit prose 返修`);
          continue;
        } catch (error) {
          if (!shouldFallbackAfterAutoProseRescueFailure(error)) {
            throw error;
          }
          appendRunLog(
            projectId,
            "warning",
            `第 ${chapterNo} 章 quick-audit prose 返修失败，保留当前稿继续定稿：${error instanceof Error ? error.message : "未知错误"}`,
          );
        }
      }

      await runStageTask(
        "analysis",
        () => finalizeAcceptedChapter(
          projectId,
          chapterNo,
          currentText,
          {
            reviewStatus: "provisional",
          },
          executionContext,
        ),
      );
      return { status: "pass" as const };
    }

    const rawReview = await runStageTask(
        "review",
        () => deepReviewChapter(
          projectId,
          chapterNo,
          currentText,
          retryCount,
          deepDecision.triggerReasons,
          currentContextPack,
          currentLocalFlavorSignals,
          executionContext,
        ),
    );
    const review = enforceLocalProsePassGate({
      chapterNo,
      chapterContent: currentText,
      writingCharter: executionContext.styleProfile.writingCharter,
      review: rawReview,
      proseRisk: assessProseStyleRisk(currentText, executionContext.styleProfile.writingCharter),
    });
    if (rawReview.verdict === "pass" && review.verdict !== "pass") {
      appendRunLog(projectId, "warning", `第 ${chapterNo} 章本地 prose gate 未通过，改为继续返修：${review.reason}`);
    }
    const reviewOutcome = resolveDeepReviewOutcome({
      retryCount,
      review,
    });
    if (reviewOutcome.action !== "accept") {
      const addedReviewNotes = persistReviewSteeringNotes(projectId, chapterNo, review);
      if (addedReviewNotes.length) {
        currentContextPack = await assembleContextPack(projectId, chapterNo).catch((error) => {
          console.warn("[chapter-runner] context-pack re-assembly failed, reusing previous:", String(error));
          appendRunLog(
            projectId,
            "warning",
            `第 ${chapterNo} 章 context-pack 重组失败，沿用旧上下文：${error instanceof Error ? error.message : "未知错误"}`,
          );
          return currentContextPack;
        });
      }
    }

    if (reviewOutcome.action === "accept") {
      const lockedWindowId = `window-${projectId}-${review.windowStartChapter}-${review.windowEndChapter}`;
      await runStageTask(
        "analysis",
        () => finalizeAcceptedChapter(
          projectId,
          chapterNo,
          currentText,
          {
            reviewStatus: "deep_locked",
          },
          executionContext,
        ),
      );
      lockChapterReviewWindow(projectId, review.windowStartChapter, review.windowEndChapter, lockedWindowId);
      confirmCardProgressionsInWindow(projectId, review.windowStartChapter, review.windowEndChapter);
      return { status: "pass" as const };
    }

    if (reviewOutcome.action === "manual_review") {
      const earliestAffectedChapter = review.earliestAffectedChapter ?? chapterNo;
      const previousAutoRestarts = countRecentAutoWindowRepairs(projectId, earliestAffectedChapter, chapterNo);

      if (shouldAutoRestartWindowReview({
        chapterNo,
        earliestAffectedChapter,
        previousAutoRestarts,
      })) {
        appendRunLog(
          projectId,
          "warning",
          `第 ${chapterNo} 章深审发现早期窗口冲突，自动从第 ${earliestAffectedChapter} 章起重建时间线（第 ${previousAutoRestarts + 1} 次）`,
        );
        await softInvalidateChapterRange(projectId, {
          fromChapter: earliestAffectedChapter,
          reason:
            `${AUTO_WINDOW_REPAIR_REASON_PREFIX} 深审发现第 ${earliestAffectedChapter}-${chapterNo} 章时间线冲突，自动归档并重跑。`,
          reviewReason: review.reason,
        });
        return {
          status: "restart",
          fromChapter: earliestAffectedChapter,
        };
      }

      if (shouldAutoPickVersionOnLowConfidence({
        confidence: review.confidence,
        chapterNo,
        earliestAffectedChapter,
        previousAutoPickAttempts: autoPickAttempts,
      })) {
        await runStageTask(
          "review",
          () => generateVersions(projectId, chapterNo, review, currentText, currentContextPack, executionContext),
        );
        const picked = await autoPickVersionForManualReview(projectId, chapterNo);
        // Runner 会话内的自动选版回滚不走 assertNoOpenSession 守卫：会话本身就是发起方。
        await createRollbackVersionService({
          invalidateFutureTimelineAfterChapterChange,
        }).rollbackVersion(projectId, chapterNo, picked.version.id);
        currentText = await readFinalChapter(projectId, chapterNo) ?? currentText;
        autoPickAttempts += 1;
        retryCount += 1;
        appendRunLog(
          projectId,
          "info",
          `第 ${chapterNo} 章低置信度，已自动选定版本 ${picked.version.versionNo} 继续复核：${picked.reason}`,
        );
        continue;
      }

      if (earliestAffectedChapter >= chapterNo) {
        await runStageTask(
          "review",
          () => generateVersions(projectId, chapterNo, review, currentText, currentContextPack, executionContext),
        );
      }
      upsertChapterReviewState({
        projectId,
        chapterNo,
        status: "manual_review",
        quickCheckedAt,
        openWindowId,
        lastReviewMode: "deep",
        latestConfidence: review.confidence,
        earliestAffectedChapter,
      });
      upsertRunState(projectId, {
        stage: "manual_review",
        status: "manual_review",
        desiredState: "idle",
        heartbeatAt: null,
        currentChapter: chapterNo,
        retryCount,
        confidence: review.confidence,
        lastError: review.reason,
        stageDetails: {
          review: {
            mode: "deep",
            verdict: review.verdict,
            confidence: review.confidence,
            retryCount,
            triggerReasons: review.triggerReasons,
            windowStartChapter: review.windowStartChapter,
            windowEndChapter: review.windowEndChapter,
            earliestAffectedChapter,
          },
        },
      });
      appendRunLog(
        projectId,
        "warning",
        earliestAffectedChapter < chapterNo
          ? `第 ${chapterNo} 章深审发现窗口早期章节存在问题，自动修复预算已耗尽，等待人工确认从第 ${earliestAffectedChapter} 章重跑`
          : `第 ${chapterNo} 章生成多版本，等待人工选择`,
      );
      return { status: "manual_review" as const };
    }

    if (Date.now() - startedAt > 30 * 60 * 1000) {
      upsertRunState(projectId, {
        stage: "manual_review",
        status: "manual_review",
        desiredState: "idle",
        heartbeatAt: null,
        currentChapter: chapterNo,
        retryCount,
        confidence: review.confidence,
        lastError: "单章返工超过 30 分钟，已转入人工审阅",
      });
      return { status: "manual_review" as const };
    }

    if ((review.repairStrategy ?? classifyReviewRepairPath({ review })) === "planning_repair") {
      if (shouldEscalatePlanningRepairToManualReview({
        attemptsUsed: planningRepairAttempts,
        maxAttempts: MAX_PLANNING_REPAIR_ATTEMPTS,
      })) {
        upsertRunState(projectId, {
          stage: "manual_review",
          status: "manual_review",
          desiredState: "idle",
          heartbeatAt: null,
          currentChapter: chapterNo,
          retryCount,
          confidence: review.confidence,
          lastError: "章节主计划连续返修失败，已转人工审阅",
        });
        appendRunLog(
          projectId,
          "warning",
          `第 ${chapterNo} 章 planning_repair 已达 ${MAX_PLANNING_REPAIR_ATTEMPTS} 次上限，转人工审阅。`,
        );
        return { status: "manual_review" as const };
      }

      try {
        const planningRepair = await runStageTask(
          "planning_repair",
          () => executePlanningRepair({
            projectId,
            chapterNo,
            retryCount,
            repairAttempt: planningRepairAttempts + 1,
            review,
            executionContext,
          }),
        );
        await waitIfPaused(projectId, sessionId);
        planningRepairAttempts += 1;
        retryCount += 1;
        proseRescueAttempts = 0;
        currentContextPack = null;
        currentLocalFlavorSignals = null;
        needsFreshDraft = true;
        blueprintReason = undefined;
        clearDraftRecoverySignals();
        appendRunLog(
          projectId,
          "info",
          `第 ${chapterNo} 章已完成 planning_repair：ChapterPlan(generationId=${planningRepair.chapterPlanGenerationId}) 与 blueprint(sourcePlanGenerationId=${planningRepair.blueprintSourcePlanGenerationId}) 已同步，准备直接重写正文。`,
        );
        continue;
      } catch (error) {
        upsertRunState(projectId, {
          stage: "manual_review",
          status: "manual_review",
          desiredState: "idle",
          heartbeatAt: null,
          currentChapter: chapterNo,
          retryCount,
          confidence: review.confidence,
          lastError: error instanceof Error ? error.message : "planning_repair 失败",
        });
        appendRunLog(
          projectId,
          "warning",
          `第 ${chapterNo} 章 planning_repair 失败，转人工审阅：${error instanceof Error ? error.message : "未知错误"}`,
        );
        return { status: "manual_review" as const };
      }
    }

    appendRunLog(projectId, "info", `第 ${chapterNo} 章审核已提交给 Writer，开始执行第 ${retryCount + 1} 次返修`);
    const chapterDraftPlan = currentContextPack ? buildChapterDraftPlan(currentContextPack) : null;
    const repairPlan = chapterDraftPlan
      ? buildReviewRepairPlan({
        chapterContent: currentText,
        review,
        sceneCards: chapterDraftPlan.sceneCards,
        voiceBrief: chapterDraftPlan.voiceBrief,
      })
      : {
        repairPath: classifyReviewRepairPath({ review }),
        rewriteInstructions: [] as string[],
        fixInstructions: review.fixInstructions,
        voicePolishIssues: [] as string[],
      };
    const adjustedReview = repairPlan.fixInstructions === review.fixInstructions
      ? review
      : {
        ...review,
        fixInstructions: repairPlan.fixInstructions,
      };
    appendRunLog(
      projectId,
      "info",
      repairPlan.repairPath === "scene_rescue"
        ? `第 ${chapterNo} 章结构问题进入 scene-rescue，按 scene cards 重排返修。`
        : `第 ${chapterNo} 章 prose/voice 问题进入 voice polish，按 voice brief 收紧返修${repairPlan.voicePolishIssues.length ? `（${repairPlan.voicePolishIssues.join("、")}）` : ""}。`,
    );
    try {
      currentText = await runStageTask(
        "review",
        () => rewriteChapterFromReview(
          projectId,
          chapterNo,
          currentText,
          adjustedReview,
          currentContextPack,
          undefined,
          executionContext,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // 停止/暂停属于控制流异常，不能被当成返修失败吞掉再多跑一轮 Patch。
      if (message === "运行已停止" || message === "运行已暂停") {
        throw error;
      }
      appendRunLog(
        projectId,
        "warning",
        `第 ${chapterNo} 章 Writer 返修失败，回退到 Patch 修订：${error instanceof Error ? error.message : "未知错误"}`,
      );
      const { patch } = await runStageTask(
        "review",
        () => requestEditorPatch(
          projectId,
          chapterNo,
          currentText,
          adjustedReview,
          {
            contextPack: currentContextPack,
          },
          executionContext,
        ),
      );
      currentText = applyPatchOperations(currentText, patch.operations);
    }
    await waitIfPaused(projectId, sessionId);
    {
      const stylePassResult = await runStageTask(
        "style_pass",
        () => runStylePass(projectId, chapterNo, currentText, currentContextPack, executionContext),
      );
      currentText = stylePassResult.content;
      currentLocalFlavorSignals = stylePassResult.localFlavorSignals ?? null;
    }
    await waitIfPaused(projectId, sessionId);
    persistProseSteeringNotes(projectId, chapterNo, currentText);
    retryCount += 1;
    appendRunLog(projectId, "info", `第 ${chapterNo} 章完成第 ${retryCount} 次审核返修`);
    // retryCount >= 1 且 review 包含 loop/progression 类 issue 时，直接重建蓝图
    const hasLoopOrProgressionIssue = review.issues.some(
      (issue) => issue.type === "story_progression" || issue.type === "genre_fulfillment"
    );
    if (retryCount >= 1 && hasLoopOrProgressionIssue) {
      blueprintReason = `审稿指出剧情循环或推进不足：${review.reason}。请基于回避列表重新规划本章蓝图。\n修订指令：${adjustedReview.fixInstructions || "无"}`;
      currentContextPack = null;
      needsFreshDraft = true;
      clearDraftRecoverySignals();
    } else if (retryCount >= 2) {
      blueprintReason = `审稿多次指出：${review.reason}。请重新规划接下来的剧情段，并用新的内部规划重写本章。`;
      currentContextPack = null;
      needsFreshDraft = true;
      clearDraftRecoverySignals();
    }
  }

  upsertRunState(projectId, {
    stage: "manual_review",
    status: "manual_review",
    desiredState: "idle",
    heartbeatAt: null,
    currentChapter: chapterNo,
    retryCount: 5,
    lastError: "返工次数过多，已转人工审阅",
  });
  return { status: "manual_review" as const };
}

export async function executeRun(projectId: string, fromChapter?: number) {
  const sessionId = runningTasks.get(projectId)?.sessionId;
  try {
    if (!sessionId) {
      throw new Error("运行已停止");
    }
    const project = getProject(projectId);
    if (!project) {
      throw notFound("项目不存在");
    }

    await writeProjectMeta(projectId, {
      id: project.id,
      title: project.title,
      genre: project.genre,
      style: project.style,
      targetChapters: project.targetChapters,
      premise: sanitizeProjectPremise(project.premise),
      structure: {
        seriesMode: project.seriesMode,
        seriesTitle: project.seriesTitle,
        seriesIndex: project.seriesIndex,
        storyLength: project.storyLength,
        narrativePerson: project.narrativePerson,
        chapterPlanningMode: project.chapterPlanningMode,
        paceProfile: project.paceProfile,
        completionCriteria: project.completionCriteria,
        hasVolumes: project.hasVolumes,
        plannedVolumes: project.plannedVolumes,
        chapterBudgetMin: project.chapterBudgetMin,
        chapterBudgetTarget: project.chapterBudgetTarget,
        chapterBudgetMax: project.chapterBudgetMax,
        hardChapterCap: project.hardChapterCap,
      },
      storyContract: project.storyContract,
      steeringNotes: project.steeringNotes,
      updatedAt: nowIso(),
    });

    if (!getFoundation(projectId) || !isFoundationLocked(projectId)) {
      throw new Error("请先完成设定共创，并整理、锁定正式设定后再开始写作");
    }
    const drift = getFoundationDriftReport(projectId);
    if (drift.coreDrift) {
      throw new Error(drift.blockingReason ?? "请先整理正式设定，再开始自动写作");
    }

    let executionContext = await getProjectExecutionContext(projectId, project.style);
    await runWithHeartbeat(
      () => ensureFoundationCoverage(projectId, getFoundation(projectId)!, executionContext),
      () => touchRunHeartbeat(projectId, {
        stage: "analysis",
        sessionId,
      }),
      {
        onError: (error) => {
          appendRunLog(
            projectId,
            "warning",
            `监控心跳刷新失败（analysis）：${error instanceof Error ? error.message : "未知错误"}`,
          );
        },
      },
    );
    await waitIfPaused(projectId, sessionId);
    executionContext = await getProjectExecutionContext(projectId, project.style);
    await runWithHeartbeat(
      () => ensureStoryContract(projectId, executionContext),
      () => touchRunHeartbeat(projectId, {
        stage: "analysis",
        sessionId,
      }),
      {
        onError: (error) => {
          appendRunLog(
            projectId,
            "warning",
            `监控心跳刷新失败（analysis）：${error instanceof Error ? error.message : "未知错误"}`,
          );
        },
      },
    );
    await waitIfPaused(projectId, sessionId);

    let chapterNo = fromChapter ?? 1;
    let stoppedByUser = false;
    while (chapterNo <= project.hardChapterCap) {
      await waitIfPaused(projectId, sessionId);
      const task = runningTasks.get(projectId);
      const lockState = readLockState(projectId);
      if (!task || lockState?.stopRequested) {
        stoppedByUser = true;
        break;
      }
      touchRunHeartbeat(projectId, {
        stage: getRunState(projectId)?.stage,
        sessionId,
      });
      appendRunLog(projectId, "info", `开始处理第 ${chapterNo} 章`);
      const result = await runSingleChapter(projectId, chapterNo, executionContext, sessionId);
      if (result.status === "restart") {
        chapterNo = result.fromChapter;
        continue;
      }
      if (result.status !== "pass") {
        return;
      }
      const continuation = await runWithHeartbeat(
        () => planStoryContinuation(projectId, chapterNo, executionContext),
        () => touchRunHeartbeat(projectId, {
          stage: "analysis",
          sessionId,
        }),
        {
          onError: (error) => {
            appendRunLog(
              projectId,
              "warning",
              `监控心跳刷新失败（analysis）：${error instanceof Error ? error.message : "未知错误"}`,
            );
          },
        },
      );
      await waitIfPaused(projectId, sessionId);
      if (continuation.decision.decision === "complete_story") {
        await finalizeProjectCompletionService(projectId, "项目自动写作完成", chapterNo);
        return;
      }
      chapterNo += 1;
    }

    if (stoppedByUser) {
      const nextDesiredState = readLockState(projectId)?.desiredState === "stopped" ? "stopped" : "paused";
      upsertRunState(projectId, buildSuspendedRunStatePatch(projectId, nextDesiredState, Math.max(1, chapterNo)));
      appendRunLog(
        projectId,
        "info",
        nextDesiredState === "stopped"
          ? "自动写作已停止，可从当前章节重新启动。"
          : "自动写作已暂停，可从当前章节继续。",
      );
      return;
    }

    await finalizeProjectCompletionService(projectId, "项目自动写作完成", Math.min(chapterNo, project.hardChapterCap));
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    if (message === "运行已停止" || message === "运行已暂停") {
      upsertRunState(
        projectId,
        buildSuspendedRunStatePatch(
          projectId,
          message === "运行已暂停" ? "paused" : "stopped",
          fromChapter ?? 1,
        ),
      );
      appendRunLog(
        projectId,
        "info",
        message === "运行已暂停" ? "自动写作已暂停，可从当前章节继续。" : "自动写作已停止，可从当前章节重新启动。",
      );
      return;
    }
    appendRunLog(projectId, "error", message);
    upsertRunState(projectId, {
      stage: "failed",
      status: "failed",
      desiredState: "idle",
      heartbeatAt: null,
      currentChapter: getRunState(projectId)?.currentChapter ?? 1,
      retryCount: getRunState(projectId)?.retryCount ?? 0,
      lastError: message,
    });
  } finally {
    await releaseLock(projectId, sessionId);
  }
}
