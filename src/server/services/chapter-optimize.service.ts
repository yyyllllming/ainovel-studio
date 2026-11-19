import "../server-only.ts";

import { buildChapterDraftPlan } from "../story/chapter-draft-plan.ts";
import { assembleContextPack } from "../run/context-engine.ts";
import { notFound } from "../errors.ts";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { readFinalChapter, writePatchFile } from "../project-files.ts";
import { getProject } from "../repositories/project.repository.ts";
import { applyPatchOperations, offsetPatch } from "../patch-utils.ts";
import { buildDefaultRuntimeReviewSignals } from "../story/story-progression.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "./project-execution-context.ts";
import { serializeContextPackSections } from "./context-serialization.ts";
import type { ContextPack, EditorPatch, ReviewVerdict } from "../types.ts";
import { clamp } from "../utils.ts";
import { editorPatchSchema } from "../validation.ts";

export interface OptimizeChapterSelectionInput {
  projectId: string;
  chapterNo: number;
  selection: { start: number; end: number };
  action: "polish" | "expand" | "rewrite" | "enhance_emotion" | "add_dialogue" | "change_pov";
}

export interface ChapterOptimizeServiceDependencies {
  optimizeChapterSelection: (input: OptimizeChapterSelectionInput) => Promise<unknown>;
}

export async function requestEditorPatch(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  review: ReviewVerdict,
  options?: { selectionOffset?: number; selectionLength?: number; contextPack?: ContextPack | null },
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const serializedContext = options?.contextPack ? serializeContextPackSections(options.contextPack) : null;
  const chapterDraftPlan = options?.contextPack ? buildChapterDraftPlan(options.contextPack) : null;

  const patch = await chatJsonWithWorkflowPolicy(
    {
      workflow: "chapter_optimize_patch",
      profile: context.agents.reviewer.profile,
      model: context.agents.reviewer.assignment.model,
      messages: [
        {
          role: "system",
          content: `${context.prompts.editor}\n\n你只输出 JSON patch，不要解释。`,
        },
        {
          role: "user",
          content: [
            `章节号：${chapterNo}`,
            `返工原因：${review.reason}`,
            `返工说明：${review.fixInstructions}`,
            `问题列表：${JSON.stringify(review.issues, null, 2)}`,
            chapterDraftPlan ? `结构/声线执行计划：\n${chapterDraftPlan.promptText}` : "",
            serializedContext ? `角色最新状态：\n${serializedContext.serializedCharacterStates || "无"}` : "",
            serializedContext ? `未回收线程：\n${serializedContext.serializedThreads || "无"}` : "",
            serializedContext ? `动态事实：\n${serializedContext.serializedFacts || "无"}` : "",
            serializedContext ? `场景提醒：\n${serializedContext.serializedSteeringNotes || "无"}` : "",
            `正文：\n${chapterContent}`,
            "请输出 operations 和 summary。operation 的 range 使用字符位置。",
          ].filter(Boolean).join("\n\n"),
        },
      ],
      assignmentMaxTokens: context.agents.reviewer.assignment.maxTokens,
      temperature: 0.2,
    },
    editorPatchSchema,
  ).catch<EditorPatch>(() => {
    const end = Math.min(chapterContent.length, 480);
    return {
      operations: [
        {
          type: "replace",
          range: { start: 0, end },
          text: `${chapterContent.slice(0, end)}\n\n【修订指令】${review.fixInstructions}`,
        },
      ],
      summary: "回退 Patch：将返工说明附加到开头段落。",
    };
  });

  const normalizedPatch =
    options?.selectionLength !== undefined
      ? offsetPatch(patch, options.selectionOffset ?? 0, options.selectionLength)
      : patch;

  const path = await writePatchFile(projectId, chapterNo, normalizedPatch);
  return {
    patch: normalizedPatch,
    patchId: path,
  };
}

export function createChapterOptimizeService(input?: Partial<ChapterOptimizeServiceDependencies>) {
  const deps = { ...input };

  return {
    async optimizeChapterSelection(payload: OptimizeChapterSelectionInput) {
      const run = deps.optimizeChapterSelection ?? optimizeChapterSelection;
      return run(payload);
    },
  };
}

export async function optimizeChapterSelection(input: OptimizeChapterSelectionInput) {
  const content = await readFinalChapter(input.projectId, input.chapterNo);
  if (!content) {
    throw notFound("章节正文不存在");
  }
  const start = clamp(input.selection.start, 0, Math.max(0, content.length - 1));
  const end = clamp(input.selection.end, start + 1, content.length);
  if (start >= end) {
    throw new Error("选区范围不合法");
  }

  const project = getProject(input.projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const executionContext = await getProjectExecutionContext(input.projectId, project.style);
  const contextPack = await assembleContextPack(input.projectId, input.chapterNo).catch(() => null); // context is optional for optimization

  const selected = content.slice(start, end);
  const defaultRuntimeSignals = buildDefaultRuntimeReviewSignals(null);
  const review: ReviewVerdict = {
    reviewMode: "deep",
    verdict: "rewrite_current",
    confidence: 0.75,
    reason: `人工触发局部优化：${input.action}`,
    fixInstructions: `请针对选中文本执行 ${input.action}`,
    issues: [
      {
        type: input.action,
        location: `${start}-${end}`,
        severity: "minor",
      },
    ],
    triggerReasons: ["low_confidence"],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: defaultRuntimeSignals.storyProgression,
    genreFulfillment: defaultRuntimeSignals.genreFulfillment,
    loopRisk: defaultRuntimeSignals.loopRisk,
    primaryDeltaDelivered: defaultRuntimeSignals.primaryDeltaDelivered,
    stuckDimensions: defaultRuntimeSignals.stuckDimensions,
    windowStartChapter: input.chapterNo,
    windowEndChapter: input.chapterNo,
    earliestAffectedChapter: input.chapterNo,
  };
  const { patch, patchId } = await requestEditorPatch(
    input.projectId,
    input.chapterNo,
    `${selected}\n\n【动作】${input.action}`,
    review,
    {
      contextPack,
      selectionOffset: start,
      selectionLength: selected.length,
    },
    executionContext,
  );
  return {
    patchId,
    patch,
    preview: applyPatchOperations(content, patch.operations),
  };
}
