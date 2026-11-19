import "../server-only.ts";

import { getNarrativePersonLabel } from "../domain/project-structure.ts";
import { notFound } from "../errors.ts";
import { buildProseSteeringInstructions } from "../writing/draft-quality.ts";
import { requestChatCompletionForWorkflow } from "../llm-workflows.ts";
import { requestWithSentenceBoundaryContinuation } from "../long-form-continuation.ts";
import { readFinalChapter, recoverDraft, writeVersionFile } from "../project-files.ts";
import { assessProseStyleRisk, normalizeGeneratedChapterContent } from "../writing/prose-normalizer.ts";
import {
  getNextVersionNo,
  saveChapterVersion,
} from "../repositories/chapter.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { createChapterSessionGuard } from "../commit/chapter-session-guard.ts";
import { assembleContextPack } from "../run/context-engine.ts";
import { buildDefaultRuntimeReviewSignals } from "../story/story-progression.ts";
import { type ReviewVerdict } from "../types.ts";
import { buildRuntimeStyleSections } from "./blueprint-generate.service.ts";
import { serializeContextPackSections } from "./context-serialization.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "./project-execution-context.ts";
import { renderProseSignalWarnings } from "./prose-signal-warnings.ts";
import { getLatestCurrentReview } from "./review-content-identity.service.ts";

const LONG_FORM_REWRITE_TIMEOUT_MS = 8 * 60_000;
const VERSION_GENERATION_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!, index);
    }
  };
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

export async function generateVersions(
  projectId: string,
  chapterNo: number,
  review: ReviewVerdict,
  baseText: string,
  contextPack?: Awaited<ReturnType<typeof assembleContextPack>> | null,
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const serializedContext = contextPack ? serializeContextPackSections(contextPack) : null;
  const narrativePerson = getNarrativePersonLabel(project.narrativePerson);
  const proseSignals = renderProseSignalWarnings(baseText, context.styleProfile.writingCharter);
  const proseInstructions = buildProseSteeringInstructions(
    assessProseStyleRisk(baseText, context.styleProfile.writingCharter),
    context.styleProfile.writingCharter,
  );
  const writerStyle = buildRuntimeStyleSections({
    stage: "writer",
    context,
  });
  const temperatures = [0.7, 0.9, 1.1];
  const nextVersionNo = getNextVersionNo(projectId, chapterNo);
  const contents = await mapWithConcurrency(temperatures, VERSION_GENERATION_CONCURRENCY, async (temperature) => {
      const messages = [
        {
          role: "system" as const,
          content: `${context.prompts.writer}\n\n你要给出章节的完整候选版本，不要解释。`,
        },
        {
          role: "user" as const,
          content: [
            `章节号：${chapterNo}`,
            `叙事人称：${narrativePerson}`,
            ...writerStyle.sections,
            serializedContext ? `写作 DNA：\n${serializedContext.serializedWritingDna}` : "",
            `当前 prose 风险：${proseSignals.summary}`,
            proseSignals.warnings.length ? `本轮顺手修掉的文笔问题：\n- ${proseSignals.warnings.join("\n- ")}` : "",
            proseInstructions.length ? `本轮必须执行的文笔约束：\n- ${proseInstructions.join("\n- ")}` : "",
            serializedContext ? `上一章结尾实录：\n${serializedContext.serializedPreviousChapterTail || "无"}` : "",
            serializedContext ? `角色最新状态：\n${serializedContext.serializedCharacterStates || "无"}` : "",
            serializedContext ? `未回收线程：\n${serializedContext.serializedThreads || "无"}` : "",
            serializedContext ? `动态事实：\n${serializedContext.serializedFacts || "无"}` : "",
            serializedContext ? `历史摘要：\n${serializedContext.serializedSummaries || "无"}` : "",
            `当前章节正文：\n${baseText}`,
            `审稿意见：${review.reason}`,
            `返工说明：${review.fixInstructions}`,
            `目标：生成一个完整的新版本，不要分点。温度=${temperature}`,
          ].filter(Boolean).join("\n\n"),
        },
      ];

      return requestWithSentenceBoundaryContinuation({
        messages,
        request: (passMessages, pass) =>
          requestChatCompletionForWorkflow(
            {
              workflow: "chapter_version_generate",
              profile: context.agents.writer.profile,
              model: context.agents.writer.assignment.model,
              messages: passMessages,
              assignmentMaxTokens: context.agents.writer.assignment.maxTokens,
              temperature,
              timeoutMs: LONG_FORM_REWRITE_TIMEOUT_MS,
              maxAttempts: pass.kind === "continuation" ? 1 : undefined,
            },
            pass.kind === "continuation" ? pass.overrideMaxTokens : undefined,
          ),
        onStillTruncated: () => {
          console.warn(`[chapter-version:${projectId}:${chapterNo}] version continuation still hit finish_reason=length.`);
        },
      })
        .then(({ content }) => normalizeGeneratedChapterContent(content))
        .catch((error) => { console.warn(`[chapter-version] generation failed, using base text fallback:`, String(error)); return `${baseText}\n\n【候选版本回退】${review.fixInstructions}`; });
    },
  );

  return mapWithConcurrency(contents, VERSION_GENERATION_CONCURRENCY, async (content, index) => {
      const temperature = temperatures[index];
      const versionNo = nextVersionNo + index;
      const path = await writeVersionFile(projectId, chapterNo, versionNo, content);
      const id = saveChapterVersion({
        projectId,
        chapterNo,
        versionNo,
        temperature,
        path,
        excerpt: content.slice(0, 180),
        selected: false,
        source: "multi_version",
      });

      return { id, versionNo, temperature, path, excerpt: content.slice(0, 180) };
    },
  );
}

export interface ChapterVersionGenerateServiceDependencies {
  generateVersionsForChapter: (projectId: string, chapterNo: number) => Promise<unknown>;
}

export function createChapterVersionGenerateService(input?: Partial<ChapterVersionGenerateServiceDependencies>) {
  const deps = { ...input };

  return {
    async generateVersionsForChapter(projectId: string, chapterNo: number) {
      const run = deps.generateVersionsForChapter ?? generateVersionsForChapter;
      return run(projectId, chapterNo);
    },
  };
}

export async function generateVersionsForChapter(projectId: string, chapterNo: number) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  createChapterSessionGuard().assertNoOpenSession(projectId, "生成多版本", {
    allowDuringManualReview: true,
  });
  const recovered = await recoverDraft(projectId, chapterNo);
  const content = (await readFinalChapter(projectId, chapterNo)) ?? recovered?.content;
  if (!content) {
    throw new Error("当前章节还没有可生成多版本的正文");
  }
  const review = await getLatestCurrentReview(projectId, chapterNo, content);
  const defaultRuntimeSignals = buildDefaultRuntimeReviewSignals(null);
  const fallbackReview: ReviewVerdict =
    review && review.reviewMode === "deep"
      ? {
          reviewMode: "deep",
          verdict:
            review.verdict === "rewrite_current" || review.verdict === "manual_review_window"
              ? review.verdict
              : "rewrite_current",
          confidence: review.confidence,
          reason: review.reason,
          fixInstructions: review.fixInstructions,
          issues: review.issues,
          triggerReasons: review.triggerReasons,
          styleChecklistHits: review.styleChecklistHits,
          charterViolations: review.charterViolations,
          storyProgression: review.storyProgression,
          genreFulfillment: review.genreFulfillment,
          loopRisk: review.loopRisk,
          primaryDeltaDelivered: review.primaryDeltaDelivered,
          stuckDimensions: review.stuckDimensions,
          windowStartChapter: review.windowStartChapter ?? chapterNo,
          windowEndChapter: review.windowEndChapter ?? chapterNo,
          earliestAffectedChapter: review.earliestAffectedChapter ?? chapterNo,
        }
      : {
          reviewMode: "deep",
          verdict: "rewrite_current",
          confidence: 0.55,
          reason: "人工触发多版本生成",
          fixInstructions: "请尝试用不同写法重写本章。",
          issues: [],
          triggerReasons: ["low_confidence"],
          styleChecklistHits: [],
          charterViolations: [],
          storyProgression: defaultRuntimeSignals.storyProgression,
          genreFulfillment: defaultRuntimeSignals.genreFulfillment,
          loopRisk: defaultRuntimeSignals.loopRisk,
          primaryDeltaDelivered: defaultRuntimeSignals.primaryDeltaDelivered,
          stuckDimensions: defaultRuntimeSignals.stuckDimensions,
          windowStartChapter: chapterNo,
          windowEndChapter: chapterNo,
          earliestAffectedChapter: chapterNo,
        };
  const executionContext = await getProjectExecutionContext(projectId, project.style);
  const contextPack = await assembleContextPack(projectId, chapterNo).catch(() => null); // context is optional for version generation
  return generateVersions(projectId, chapterNo, fallbackReview, content, contextPack, executionContext);
}
