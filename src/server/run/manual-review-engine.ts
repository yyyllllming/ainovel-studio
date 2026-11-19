import "../server-only.ts";

import { notFound } from "../errors.ts";
import { z } from "zod";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { readFinalChapter, readVersionFile, recoverDraft } from "../project-files.ts";
import { resolveProjectFilePath } from "../paths.ts";
import { getBlueprint, getFoundation } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { getRunState } from "../repositories/run.repository.ts";
import { listChapterVersions } from "../repositories/chapter.repository.ts";
import { buildRuntimeStyleSections } from "../services/blueprint-generate.service.ts";
import { getProjectExecutionContext } from "../services/project-execution-context.ts";
import { getLatestCurrentReview } from "../services/review-content-identity.service.ts";
import { buildReviewCharterPromptContract } from "./review-policy.ts";
import { pickFallbackVersionForAutoReview } from "./manual-review.ts";
import { assembleContextPack } from "./context-engine.ts";
import { serializeContextPackSections } from "../services/context-serialization.ts";

const versionChoiceSchema = z.object({
  versionId: z.string().min(1),
  reason: z.string().min(1),
});

export function requireActiveManualReview(projectId: string, chapterNo: number) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const state = getRunState(projectId);
  if (!state || state.stage !== "manual_review" || state.currentChapter !== chapterNo) {
    throw new Error("当前章节不在人工确认状态");
  }

  return { project, state };
}

export async function autoPickVersionForManualReview(projectId: string, chapterNo: number) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  const blueprint = getBlueprint(projectId, chapterNo);
  const currentContent = (await readFinalChapter(projectId, chapterNo))
    ?? (await recoverDraft(projectId, chapterNo))?.content
    ?? null;
  const latestReview = await getLatestCurrentReview(projectId, chapterNo, currentContent);
  const versions = listChapterVersions(projectId, chapterNo);

  if (!project || !foundation || !blueprint) {
    throw new Error("缺少项目设定或章节蓝图，无法自动选版");
  }
  if (!versions.length) {
    throw new Error("当前没有候选版本可供 AI 自动选择");
  }

  const executionContext = await getProjectExecutionContext(projectId, project.style);
  const reviewStyle = buildRuntimeStyleSections({
    stage: "reviewer",
    context: executionContext,
  });
  const fallbackVersion = pickFallbackVersionForAutoReview(versions);
  const [contextPack, hydratedVersions] = await Promise.all([
    assembleContextPack(projectId, chapterNo).catch(() => null), // context is optional; review proceeds without it
    Promise.all(
      versions.map(async (version) => ({
        ...version,
        content: await readVersionFile(resolveProjectFilePath(projectId, version.path, ["versions"])),
      })),
    ),
  ]);
  const serializedContext = contextPack ? serializeContextPackSections(contextPack) : null;
  const reviewerCharterContract = buildReviewCharterPromptContract({
    mode: "selector",
    writingCharter: executionContext.styleProfile.writingCharter,
  });

  const choice = await chatJsonWithWorkflowPolicy(
    {
      workflow: "manual_review_pick",
      profile: executionContext.agents.reviewer.profile,
      model: executionContext.agents.reviewer.assignment.model,
      messages: [
        {
          role: "system",
          content: `${executionContext.prompts.reviewerDeep}

你现在不是做 pass / rewrite 判定，而是要在候选版本中自动选择一版作为正式版本。
优先标准：
1. 与项目 premise、已锁定设定、当前蓝图、伏笔和主线推进一致；
2. 人物动机、关系和世界规则不要漂；
3. 即使三个版本都不完美，也选择风险最小、最能呼应主线的一版。
${reviewerCharterContract.length ? reviewerCharterContract.join("\n") : ""}
必须输出 JSON：versionId, reason。`,
        },
        {
          role: "user",
          content: [
            `项目：${project.title}`,
            `项目 premise：${foundation.premise}`,
            `章节号：${chapterNo}`,
            `当前蓝图：\n${JSON.stringify(blueprint, null, 2)}`,
            ...reviewStyle.sections,
            `最近审稿意见：\n${latestReview ? JSON.stringify(latestReview, null, 2) : "无"}`,
            serializedContext ? `角色最新状态：\n${serializedContext.serializedCharacterStates || "无"}` : "",
            serializedContext ? `未回收线程：\n${serializedContext.serializedThreads || "无"}` : "",
            `历史摘要：\n${serializedContext?.serializedSummaries || "无"}`,
            `当前动态事实：\n${serializedContext?.serializedFacts || "无"}`,
            serializedContext ? `场景提醒：\n${serializedContext.serializedSteeringNotes || "无"}` : "",
            `候选版本：\n${hydratedVersions
              .map(
                (version) =>
                  `版本ID=${version.id}\n版本号=${version.versionNo}\ntemperature=${version.temperature}\n正文：\n${version.content}`,
              )
              .join("\n\n===== 分隔线 =====\n\n")}`,
          ].filter(Boolean).join("\n\n"),
        },
      ],
      assignmentMaxTokens: executionContext.agents.reviewer.assignment.maxTokens,
      temperature: 0.2,
    },
    versionChoiceSchema,
  ).catch((error) => { console.warn("[manual-review] version pick failed, using fallback:", String(error)); return {
    versionId: fallbackVersion?.id ?? "",
    reason: "自动选版回退：采用最低温度、最稳妥的候选版本继续主线。",
  }; });

  const pickedVersion = versions.find((version) => version.id === choice.versionId) ?? fallbackVersion;
  if (!pickedVersion) {
    throw new Error("AI 自动选版失败，且没有可回退的候选版本");
  }

  return {
    version: pickedVersion,
    reason: choice.reason,
  };
}
