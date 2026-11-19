import { notFound } from "../errors.ts";
import { basename } from "node:path";
import {
  buildProjectPromptSummary,
  getNarrativePersonLabel,
} from "../domain/project-structure.ts";
import { buildOpeningChapterSteering } from "../story/chapter-steering.ts";
import { buildChapterDraftPlan } from "../story/chapter-draft-plan.ts";
import type { ChatMessage } from "../llm.ts";
import {
  chatJsonWithWorkflowPolicy,
  requestStreamChatCompletionForWorkflow,
} from "../llm-workflows.ts";
import { buildSentenceBoundaryContinuationMessages, mergeSentenceBoundaryContinuation } from "../long-form-continuation.ts";
import {
  appendDraftChunk,
  createDraftFile,
  readFinalChapter,
  recoverDraft,
  replaceDraftWithFinalContent,
  writeFoundationFiles,
  writeCheckpoint,
} from "../project-files.ts";
import { withinProject } from "../paths.ts";
import {
  shouldUseBootstrapDraftSelection,
} from "../writing/draft-quality.ts";
import {
  assessFoundationCoverage,
  buildFallbackFoundationExpansion,
  mergeFoundationPayload,
} from "../foundation/foundation-enrichment.ts";
import { sanitizeProjectPremise } from "../foundation/foundation-summary-sanitizer.ts";
import { getFoundationWorkshopSnapshot } from "../foundation/foundation-workshop.ts";
import { normalizeGeneratedChapterContent } from "../writing/prose-normalizer.ts";
import { runWithHeartbeat } from "./run-heartbeat.ts";
import { ensureRunSessionActive } from "./session-activation.ts";
import { touchRunHeartbeat, waitIfPaused } from "./run-internals.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getFoundation, saveFoundation, upsertFoundationWorkshopState } from "../repositories/foundation.repository.ts";
import { getProject, listActiveSteeringNotes, saveStoryContract } from "../repositories/project.repository.ts";
import { getRunState, upsertRunState } from "../repositories/run.repository.ts";
import { listChapterReviewStates } from "../repositories/review.repository.ts";
import { syncConfirmedCardsFromProjectFoundation } from "../services/card.service.ts";
import {
  buildProjectWritingDnaPrompt,
  ensureConcreteFoundationCharacterNames,
  foundationSchema,
} from "../services/foundation-generate.service.ts";
import { buildRuntimeStyleSections } from "../services/blueprint-generate.service.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { getLatestCurrentReview } from "../services/review-content-identity.service.ts";
import { buildWritingCharterPromptContract } from "../style/style-steering.ts";
import {
  applyContinuationDecision,
  buildStoryContractSummary,
  hydrateStoryContract,
} from "../story/story-contract.ts";
import { ensureStoryContract } from "../story/story-contract-engine.ts";
import { serializeContextPackSections } from "../services/context-serialization.ts";
import type {
  ContextPack,
  FoundationPayload,
  StoryContract,
  StoryContinuationDecision,
  WritingCharter,
} from "../types.ts";
import { nowIso, wordCount } from "../utils.ts";
import {
  buildAuthorHabitDirectives,
  buildWriterBudgetSteeringLines,
  continuationDecisionSchema,
} from "./chapter-shared.ts";

const FOUNDATION_EXPANSION_TIMEOUT_MS = 20_000;

export function buildContextMessages(
  projectId: string,
  contextPack: ContextPack,
  chapterNo: number,
  styleSections: string[],
) {
  const project = getProject(projectId);
  const narrativePerson = getNarrativePersonLabel(project?.narrativePerson ?? "third");
  const openingSteering = buildOpeningChapterSteering({
    chapterNo,
    protagonistName: contextPack.blueprint.characters[0] ?? contextPack.requiredCards[0]?.name ?? "主角",
    currentVolumeGoal: contextPack.currentVolumeGoal,
    projectPremise: contextPack.projectPremise,
  });
  const {
    serializedFacts,
    serializedCharacters,
    serializedWorld,
    serializedSummaries,
    serializedWritingDna,
    serializedCharacterStates,
    serializedThreads,
    serializedLorebook,
    serializedPreviousChapterTail,
    serializedSteeringNotes,
    serializedWriterNotes,
  } = serializeContextPackSections(contextPack);

  return {
    system: [
      `项目：${projectId}`,
      "你正在生成小说章节初稿。",
      "必须遵守风格边界、角色卡、世界规则和当前蓝图。",
      `叙事人称必须固定为：${narrativePerson}。`,
      "你还必须参考角色最新状态、未回收线程和场景提醒，像长篇连载工具那样保持前后文一致。",
      "如果上一章结尾还挂着明确的动作、危机、地点或伤势，本章开头必须先承接，再推进新内容；除非蓝图明确要求跳时跳场。",
      "如果有 soft conflict，需要在文内解释合理性；如果有 hard conflict，不允许私自改写设定。",
    ].join("\n"),
    user: [
      `章节：第 ${chapterNo} 章`,
      `叙事人称：${narrativePerson}`,
      `剧情前提：${contextPack.projectPremise}`,
      `蓝图：${JSON.stringify(contextPack.blueprint, null, 2)}`,
      ...styleSections,
      `写作 DNA：\n${serializedWritingDna}`,
      `活动 steering notes：\n${contextPack.activeSteeringNotes.join("\n") || "无"}`,
      `角色卡：\n${serializedCharacters}`,
      `世界规则：\n${serializedWorld}`,
      `Lorebook 触发条目：\n${serializedLorebook || "无"}`,
      `角色最新状态：\n${serializedCharacterStates || "无"}`,
      `未回收线程 / 伏笔账本：\n${serializedThreads || "无"}`,
      `动态事实：\n${serializedFacts || "无"}`,
      `上一章结尾实录：\n${serializedPreviousChapterTail || "无"}`,
      `历史摘要：\n${serializedSummaries || "无"}`,
      `Scene Steering：\n${serializedSteeringNotes || "无"}`,
      `开篇强约束：\n${openingSteering.join("\n") || "无"}`,
      `Writer 注意事项：\n${serializedWriterNotes || "无"}`,
      "请输出完整章节正文，不要解释，不要加代码块。",
    ].join("\n\n"),
  };
}

export async function ensureFoundationCoverage(
  projectId: string,
  foundation: FoundationPayload,
  executionContext: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const coverage = assessFoundationCoverage(foundation);
  if (!coverage.shouldExpand) {
    return foundation;
  }

  const workshopDraft = getFoundationWorkshopSnapshot(projectId).state?.draft;
  const stableProjectPremise = sanitizeProjectPremise(project.premise);
  appendRunLog(projectId, "info", `检测到正式设定偏薄，开始自动补强：${coverage.notes.join("；")}`);

  // 用请求级 timeoutMs 真正中断超时调用，避免 Promise.race 弃单后请求仍在后台烧 token。
  const expanded = await chatJsonWithWorkflowPolicy(
    {
      workflow: "foundation_expansion",
      profile: executionContext.agents.coauthor.profile,
      model: executionContext.agents.coauthor.assignment.model,
      messages: [
        {
          role: "system",
          content: `${executionContext.prompts.planner}\n\n你负责补强正式设定，让首章到前五章的 story bible 足够具体。必须输出 JSON。`,
        },
        {
          role: "user",
          content: [
            `项目：${project.title}`,
            `题材：${project.genre}`,
            buildProjectPromptSummary(project),
            `起点想法：${foundation.premise || stableProjectPremise}`,
            `当前正式设定：\n${JSON.stringify(foundation, null, 2)}`,
            `内置写作 DNA：\n${buildProjectWritingDnaPrompt({
              project,
              foundation,
              styleProfile: executionContext.styleProfile,
            })}`,
            workshopDraft ? `共创草案：\n${JSON.stringify(workshopDraft, null, 2)}` : "",
            `检测到的问题：\n- ${coverage.notes.join("\n- ")}`,
            "请在不推翻现有 premise、主角和风格的前提下补强正式设定，让系统第一次写正文时就有足够硬的注入底座。",
            "硬性要求：",
            "1. characters 至少 3 人，relationships 至少 2 条，worldview 至少 4 条。",
            "2. 主角 goal 必须具体到当前阶段的欲望、代价或疑问，不能写“推动主线完成”。",
            "3. worldview 必须至少覆盖：开篇活动区域、能力触发条件、能力代价/反噬、当前追猎或竞争压力。",
            "4. 不要写“世界基调 / 当前主场景 / 当前地点 / 默认风格”这种占位词。",
            "5. 保留已有有效设定，只补足缺位，不要把远期终局一次讲透。",
            "6. 输出字段仍然只能是 premise, styleCard, characters, worldview, relationships。",
          ].filter(Boolean).join("\n\n"),
        },
      ],
      assignmentMaxTokens: executionContext.agents.coauthor.assignment.maxTokens,
      temperature: Math.min(executionContext.agents.coauthor.assignment.temperature, 0.55),
      timeoutMs: FOUNDATION_EXPANSION_TIMEOUT_MS,
      maxAttempts: 1,
    },
    foundationSchema,
  ).catch((error) => { console.warn("[chapter-draft] foundation expansion failed, using fallback:", String(error)); return null; });

  const expansionPayload = expanded ?? buildFallbackFoundationExpansion({
    title: project.title,
    genre: project.genre,
    premise: foundation.premise || stableProjectPremise,
    foundation,
  });

  if (!expanded) {
    appendRunLog(projectId, "warning", "正式设定补强请求超时或失败，已回退为本地 story bible 补强。");
  }

  const normalized = await ensureConcreteFoundationCharacterNames(
    project,
    expansionPayload,
    workshopDraft,
    [],
    executionContext,
  );
  const merged = mergeFoundationPayload(foundation, {
    ...normalized,
    styleProfile: workshopDraft?.styleProfile ?? foundation.styleProfile ?? executionContext.styleProfile,
  });
  const nextCoverage = assessFoundationCoverage(merged);

  if (
    nextCoverage.score >= coverage.score
    && merged.characters.length <= foundation.characters.length
    && merged.worldview.length <= foundation.worldview.length
    && merged.relationships.length <= foundation.relationships.length
  ) {
    appendRunLog(projectId, "warning", "正式设定自动补强未带来明显提升，继续沿用当前版本。");
    return foundation;
  }

  const saved = saveFoundation(projectId, merged);
  if (workshopDraft) {
    upsertFoundationWorkshopState(
      projectId,
      {
        ...workshopDraft,
        premise: saved.premise,
        mainline: saved.mainline ?? workshopDraft.mainline ?? "",
        storyHook: saved.storyHook ?? workshopDraft.storyHook ?? "",
        characterIdeas: saved.characters,
        worldviewIdeas: saved.worldview,
        relationshipIdeas: saved.relationships,
        styleSteeringCard: saved.styleCard || workshopDraft.styleSteeringCard,
        styleProfile: saved.styleProfile ?? workshopDraft.styleProfile,
        styleSnapshotId: saved.styleSnapshotId ?? workshopDraft.styleSnapshotId ?? null,
        styleSnapshotVersion: saved.styleSnapshotVersion ?? workshopDraft.styleSnapshotVersion ?? null,
        styleDigest: saved.styleDigest ?? workshopDraft.styleDigest ?? "",
        styleExemplars: saved.styleExemplars ?? workshopDraft.styleExemplars ?? [],
      },
      true,
    );
  }
  await writeFoundationFiles(projectId, saved);
  syncConfirmedCardsFromProjectFoundation(projectId);
  appendRunLog(
    projectId,
    "info",
    `已自动补强正式设定：角色 ${saved.characters.length}，世界规则 ${saved.worldview.length}，关系 ${saved.relationships.length}`,
  );
  return saved;
}

export function buildHeuristicContinuationDecision(project: NonNullable<ReturnType<typeof getProject>>, contract: StoryContract, chapterNo: number) {
  if (chapterNo >= project.hardChapterCap) {
    return {
      chapterNo,
      decision: "complete_story",
      summary: "已达到安全章节上限，强制收束并完结。",
      nextPlan: [],
    } satisfies StoryContinuationDecision;
  }

  if (project.chapterPlanningMode === "fixed") {
    return {
      chapterNo,
      decision: chapterNo >= project.targetChapters ? "complete_story" : "continue_chaptering",
      summary: chapterNo >= project.targetChapters ? "固定章节数已完成。" : "继续下一章。",
      nextPlan: chapterNo >= project.targetChapters ? [] : ["继续按固定章节推进主线"],
    } satisfies StoryContinuationDecision;
  }

  const currentVolume = contract.volumes.find((volume) => volume.volumeNo === contract.currentVolume) ?? contract.volumes[0];
  const volumeSpan = currentVolume ? chapterNo - currentVolume.chapterStart + 1 : 1;
  if (contract.forecast.finalRunReady && chapterNo >= contract.forecast.target) {
    return {
      chapterNo,
      decision: "complete_story",
      summary: "终局收束条件已满足，可以完结。",
      nextPlan: [],
    } satisfies StoryContinuationDecision;
  }
  if (chapterNo >= contract.forecast.max || (contract.currentVolume >= contract.volumes.length && chapterNo >= contract.forecast.target)) {
    return {
      chapterNo,
      decision: "enter_final_run",
      summary: "主线已经接近收束，进入最终推进。",
      nextPlan: ["回收关键伏笔", "让核心关系落点明确"],
    } satisfies StoryContinuationDecision;
  }
  if (currentVolume && volumeSpan >= currentVolume.chapterBudgetTarget && contract.currentVolume < contract.volumes.length) {
    return {
      chapterNo,
      decision: "end_volume",
      summary: `${currentVolume.label}的阶段目标已基本完成，转入下一卷。`,
      nextPlan: ["开启下一卷的新矛盾", "保留上一卷的余波"],
    } satisfies StoryContinuationDecision;
  }
  return {
    chapterNo,
    decision: "continue_chaptering",
    summary: "继续推进当前剧情段。",
    nextPlan: ["延续当前卷目标", "保持角色动机与伏笔推进"],
  } satisfies StoryContinuationDecision;
}

export async function planStoryContinuation(projectId: string, chapterNo: number, executionContext?: ProjectExecutionContext) {
  const project = getProject(projectId);
  const foundation = getFoundation(projectId);
  if (!project || !foundation) {
    throw new Error("缺少续写决策所需的项目或设定");
  }
  const contract = await ensureStoryContract(projectId, executionContext);
  const currentText = await readFinalChapter(projectId, chapterNo);
  const latestReview = await getLatestCurrentReview(projectId, chapterNo, currentText);
  const activeNotes = listActiveSteeringNotes(projectId, chapterNo);

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const decision = await chatJsonWithWorkflowPolicy(
    {
      workflow: "continuation_decision",
      profile: context.agents.planner.profile,
      model: context.agents.planner.assignment.model,
      messages: [
        {
          role: "system",
          content: `${context.prompts.planner}

你现在负责每章结束后的 continuation decision。必须输出 JSON：decision, summary, nextPlan。
decision 只能是 continue_chaptering / end_volume / enter_final_run / complete_story。`,
        },
        {
          role: "user",
          content: [
            `项目：${project.title}`,
            `当前章节：第 ${chapterNo} 章`,
            `story contract：\n${buildStoryContractSummary(contract)}`,
            `当前卷目标：${contract.volumes.find((item) => item.volumeNo === contract.currentVolume)?.goal ?? contract.endingPromise}`,
            `本章正文结尾：\n${currentText?.slice(-1800) || "无"}`,
            latestReview ? `最近审稿结论：${latestReview.reason}` : "",
            activeNotes.length ? `追加 steering：\n${activeNotes.map((item) => `[${item.scope}] ${item.instruction}`).join("\n")}` : "",
            `安全上限：${project.hardChapterCap} 章`,
            "请判断是继续当前卷、结束当前卷、进入最终收束，还是已经可以完结。",
          ].filter(Boolean).join("\n\n"),
        },
      ],
      assignmentMaxTokens: context.agents.planner.assignment.maxTokens,
      temperature: context.agents.planner.assignment.temperature,
    },
    continuationDecisionSchema,
  ).catch((error) => {
    console.warn("[chapter-draft] continuation decision failed, using heuristic:", String(error));
    appendRunLog(
      projectId,
      "warning",
      `第 ${chapterNo} 章续写决策模型调用失败，已回退为启发式判断：${error instanceof Error ? error.message : "未知错误"}`,
    );
    return buildHeuristicContinuationDecision(project, contract, chapterNo);
  });

  const nextContract = hydrateStoryContract(applyContinuationDecision(contract, {
    chapterNo,
    decision: decision.decision,
    summary: decision.summary,
    nextPlan: decision.nextPlan,
  }), {
    genre: project.genre,
    premise: foundation.premise,
    completionCriteria: project.completionCriteria,
    latestChapter: chapterNo,
    foundation,
  });
  saveStoryContract(projectId, nextContract);
  upsertRunState(projectId, {
    stage: "analysis",
    status: "analysis",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: chapterNo,
    totalChapters: nextContract.forecast.target,
    stageDetails: {
      ...(getRunState(projectId)?.stageDetails ?? {}),
      continuation: {
        decision: decision.decision,
        summary: decision.summary,
        nextPlan: decision.nextPlan,
        currentVolume: nextContract.currentVolume,
        completionProgress: nextContract.forecast.completionProgress,
      },
    },
  });
  appendRunLog(projectId, "info", `续写决策：${decision.decision} - ${decision.summary}`);
  return {
    decision,
    contract: nextContract,
  };
}

export async function writeDraftFromContext(
  projectId: string,
  chapterNo: number,
  contextPack: ContextPack,
  sessionId: string,
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const existingState = getRunState(projectId);
  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const writerStyle = buildRuntimeStyleSections({
    stage: "writer",
    context,
  });
  const promptBundle = buildContextMessages(projectId, contextPack, chapterNo, writerStyle.sections);
  const draftMeta = {
    chapterNo,
    timestamp: nowIso(),
    pid: process.pid,
  };
  const shouldRecoverDraft =
    existingState?.currentChapter === chapterNo
    && (
      (existingState.currentPosition ?? 0) > 0
      || Boolean(existingState.draftFile)
      || Boolean(existingState.stageDetails?.writing?.draftFile)
    );
  const recoveredDraft = shouldRecoverDraft
    ? await recoverDraft(projectId, chapterNo)
    : null;
  if (recoveredDraft?.completed) {
    // 含 DRAFT_END 的草稿写作阶段已经结束，直接复用成稿，不能再当成中断草稿续写。
    ensureRunSessionActive(projectId, sessionId, {
      allowPaused: true,
    });
    const completedContent = normalizeGeneratedChapterContent(recoveredDraft.content);
    const completedWords = wordCount(completedContent);
    upsertRunState(projectId, {
      stage: "writing",
      status: "writing",
      desiredState: "running",
      heartbeatAt: nowIso(),
      currentChapter: chapterNo,
      lastError: null,
      draftFile: recoveredDraft.path,
      currentPosition: completedContent.length,
      wordCount: completedWords,
      stageDetails: {
        writing: {
          draftFile: basename(recoveredDraft.path),
          currentPosition: completedContent.length,
          wordCount: completedWords,
        },
      },
    });
    appendRunLog(projectId, "info", `第 ${chapterNo} 章发现已完成草稿（${completedWords} 词），直接复用成稿，不再续写。`);
    return {
      draftPath: recoveredDraft.path,
      content: completedContent,
    };
  }
  const recoveredContent = recoveredDraft?.content.trimEnd() ?? "";
  const draftPath =
    recoveredDraft?.source === "draft"
      ? recoveredDraft.path
      : await createDraftFile(projectId, chapterNo, draftMeta);
  if (recoveredDraft?.source === "checkpoint" && recoveredContent) {
    await appendDraftChunk(draftPath, recoveredContent);
  }
  const recoveredWordCount = recoveredContent ? wordCount(recoveredContent) : 0;
  const recoveredPosition = recoveredContent.length;

  upsertRunState(projectId, {
    stage: "writing",
    status: "writing",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: chapterNo,
    lastError: null,
    draftFile: draftPath,
    currentPosition: recoveredPosition,
    wordCount: recoveredWordCount,
    stageDetails: {
      writing: {
        draftFile: basename(draftPath),
        currentPosition: recoveredPosition,
        wordCount: recoveredWordCount,
      },
    },
  });

  const useBootstrapSelection = shouldUseBootstrapDraftSelection({
    chapterNo,
    reviewStates: listChapterReviewStates(projectId),
  });
  const chapterDraftPlan = buildChapterDraftPlan(contextPack);
  const authorHabitDirectives = buildAuthorHabitDirectives(context);
  const directWriteInstructions = useBootstrapSelection
    ? [
      authorHabitDirectives[0] ?? "",
      authorHabitDirectives[1] ?? "",
      authorHabitDirectives[2] ?? "",
      authorHabitDirectives[3] ?? "",
      chapterDraftPlan.storyBrief,
      chapterDraftPlan.structureBrief,
      ...chapterDraftPlan.sceneCards
        .slice(0, 3)
        .map((sceneCard) => `${sceneCard.label}：${sceneCard.objective}｜阻力=${sceneCard.obstacle}｜不可逆变化=${sceneCard.irreversibleChange}`),
      `Voice Brief：${chapterDraftPlan.voiceBrief.summary}`,
      ...chapterDraftPlan.voiceBrief.polishPlan.slice(0, 2),
      ...chapterDraftPlan.obligationDirectives.slice(0, 4),
      ...chapterDraftPlan.openingDirectives.slice(0, 4),
      ...chapterDraftPlan.proseDirectives.slice(0, 6),
      ...chapterDraftPlan.planningDirectives.slice(0, 2),
      ...chapterDraftPlan.antiAiDirectives.slice(0, 4),
      ...chapterDraftPlan.reviewChecklist.slice(0, 2),
    ]
    : [
      authorHabitDirectives[0] ?? "",
      authorHabitDirectives[1] ?? "",
      authorHabitDirectives[2] ?? "",
      chapterDraftPlan.storyBrief,
      chapterDraftPlan.structureBrief,
      ...chapterDraftPlan.sceneCards
        .slice(0, 2)
        .map((sceneCard) => `${sceneCard.label}：${sceneCard.objective}｜阻力=${sceneCard.obstacle}｜不可逆变化=${sceneCard.irreversibleChange}`),
      `Voice Brief：${chapterDraftPlan.voiceBrief.summary}`,
      ...chapterDraftPlan.voiceBrief.polishPlan.slice(0, 2),
      ...chapterDraftPlan.obligationDirectives.slice(0, 3),
      ...chapterDraftPlan.proseDirectives.slice(0, 4),
      ...chapterDraftPlan.antiAiDirectives.slice(0, 3),
      ...chapterDraftPlan.reviewChecklist.slice(0, 1),
    ];
  const keepWritingAlive = () => touchRunHeartbeat(projectId, {
    stage: "writing",
    sessionId,
  });

  appendRunLog(
    projectId,
    "info",
    recoveredDraft
      ? `第 ${chapterNo} 章从${recoveredDraft.source === "checkpoint" ? " checkpoint" : " draft"} 恢复续写，已载入 ${recoveredWordCount} 词。`
      : useBootstrapSelection
        ? `第 ${chapterNo} 章启用单稿强规划直写：${chapterDraftPlan.sceneCards.length} 个 scene cards，voice brief 已接入，obligation cards ${chapterDraftPlan.obligationDirectives.length} 条。`
        : `第 ${chapterNo} 章启用分拍直写：${chapterDraftPlan.sceneCards.length} 个 scene cards，按 structure + voice plan 收束首稿。`,
  );

  let aggregated = recoveredContent;
  let lastCheckpointWords = recoveredWordCount;

  await runWithHeartbeat(
    async () => {
      const baseMessages = buildDraftMessages({
        writerPrompt: context.prompts.writer,
        systemPrompt: promptBundle.system,
        userPrompt: promptBundle.user,
        strictMode: useBootstrapSelection,
        extraInstructions: directWriteInstructions,
        draftPlanText: chapterDraftPlan.promptText,
        targetWordInstruction: `本章目标字数：${contextPack.blueprint.estimatedWords} 字；允许区间 ${context.chapterWordTarget.min}-${context.chapterWordTarget.max} 字，优先靠近 ${context.chapterWordTarget.target} 字。`,
        writingCharter: context.styleProfile.writingCharter,
        resumeFromDraftTail: recoveredContent ? recoveredContent.slice(-2400) : null,
        resumeWordCount: recoveredWordCount > 0 ? recoveredWordCount : null,
      });
      const updateWritingState = async (delta: string) => {
        await waitIfPaused(projectId, sessionId);
        ensureRunSessionActive(projectId, sessionId, {
          allowPaused: true,
        });
        aggregated += delta;
        await appendDraftChunk(draftPath, delta);
        const words = wordCount(aggregated);
        const position = aggregated.length;

        upsertRunState(projectId, {
          stage: "writing",
          status: "writing",
          desiredState: "running",
          heartbeatAt: nowIso(),
          currentChapter: chapterNo,
          lastError: null,
          draftFile: draftPath,
          currentPosition: position,
          wordCount: words,
          stageDetails: {
            writing: {
              draftFile: basename(draftPath),
              currentPosition: position,
              wordCount: words,
            },
          },
        });

        if (words - lastCheckpointWords >= 1000) {
          lastCheckpointWords = words;
          await writeCheckpoint(
            withinProject(
              projectId,
              "drafts",
              ".checkpoints",
              `chapter_${String(chapterNo).padStart(3, "0")}_checkpoint_${words}.md`,
            ),
            words,
            aggregated,
          );
        }
      };

      const writerTemperature =
        useBootstrapSelection
          ? Math.min(context.agents.writer.assignment.temperature, 0.38)
          : context.agents.writer.assignment.temperature;
      let mergedContent = recoveredContent;
      let continuationCount = 0;
      let attemptMessages = baseMessages;

      while (true) {
        let attemptContent = "";
        const attemptResult = await requestStreamChatCompletionForWorkflow(
          {
            workflow: "chapter_draft_stream",
            profile: context.agents.writer.profile,
            model: context.agents.writer.assignment.model,
            messages: attemptMessages,
            assignmentMaxTokens: context.agents.writer.assignment.maxTokens,
            temperature: writerTemperature,
            targetWords: contextPack.blueprint.estimatedWords,
          },
          async (delta) => {
            attemptContent += delta;
            await updateWritingState(delta);
          },
        );

        mergedContent = mergedContent
          ? mergeSentenceBoundaryContinuation(mergedContent, attemptContent)
          : attemptResult.content;

        if (attemptResult.finishReason !== "length" || continuationCount >= 2) {
          aggregated = mergedContent;
          break;
        }

        continuationCount += 1;
        attemptMessages = buildSentenceBoundaryContinuationMessages(baseMessages, mergedContent).messages;
      }
    },
    keepWritingAlive,
    {
      onError: (error) => {
        appendRunLog(
          projectId,
          "warning",
          `监控心跳刷新失败（writing）：${error instanceof Error ? error.message : "未知错误"}`,
        );
      },
    },
  );

  ensureRunSessionActive(projectId, sessionId, {
    allowPaused: true,
  });
  const normalizedContent = normalizeGeneratedChapterContent(aggregated);
  const finalWords = wordCount(normalizedContent);
  await replaceDraftWithFinalContent(draftPath, normalizedContent, finalWords);
  appendRunLog(projectId, "info", `第 ${chapterNo} 章草稿生成完成（${finalWords} 词）`);
  return {
    draftPath,
    content: normalizedContent,
  };
}

export function buildDraftMessages(input: {
  writerPrompt: string;
  systemPrompt: string;
  userPrompt: string;
  strictMode?: boolean;
  extraInstructions?: string[];
  draftPlanText?: string;
  targetWordInstruction?: string;
  writingCharter?: WritingCharter | null;
  resumeFromDraftTail?: string | null;
  resumeWordCount?: number | null;
}): ChatMessage[] {
  const steeringInstruction = [
    input.resumeFromDraftTail
      ? "你正在续写一份中断草稿。只能从当前草稿的最后一处往后写，不要重写开头，不要复述已有段落，不要另起摘要。"
      : "",
    input.strictMode
      ? [
        "你现在写的是项目的开篇/重建阶段，必须把主要质量放在第一次成稿上。",
        "这次只允许输出一版完整正文，不要试探性开头，不要假设后面还会补一版候选。",
        "如果蓝图里含有后续章节信息，也只执行当前章，不要替下一章预写摘要、预告或桥接说明。",
        "优先避免连续代词起句、过密比喻和模板句反复。",
        "同一角色名也不要连续多句机械起头，要用动作、环境、身体反馈和视线落点分散句首。",
        ...buildWriterBudgetSteeringLines(input.writingCharter),
      ].join("\n")
      : "",
    ...(input.writingCharter
      ? buildWritingCharterPromptContract({
        writingCharter: input.writingCharter,
        stage: "writer",
      })
      : []),
    ...(input.extraInstructions ?? []),
  ].filter(Boolean).join("\n");

  const strictInstruction = input.strictMode
    ? [
      "额外要求：正文从开头就要像可直接发表的中文小说成稿，不要把模型味留到后处理阶段。",
      "每个 beat 都要推进即时目标或代价，不要写成平均摊开的摘要。",
    ].join("\n")
    : "";

  return [
    {
      role: "system" as const,
      content: `${input.writerPrompt}\n\n${input.systemPrompt}${steeringInstruction ? `\n${steeringInstruction}` : ""}`,
    },
    {
      role: "user" as const,
      content: [
        input.userPrompt,
        input.resumeWordCount
          ? `当前已有约 ${input.resumeWordCount} 字的中断草稿，请在此基础上直接续完本章。`
          : "",
        input.resumeFromDraftTail ? `已写草稿结尾（不要重复）：\n${input.resumeFromDraftTail}` : "",
        input.draftPlanText ? `本章写作执行计划：\n${input.draftPlanText}` : "",
        input.targetWordInstruction ?? "",
        strictInstruction,
      ].filter(Boolean).join("\n\n"),
    },
  ];
}
