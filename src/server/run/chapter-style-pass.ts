import { notFound } from "../errors.ts";
import {
  buildReviewSteeringInstructions,
} from "../story/chapter-steering.ts";
import { buildChapterDraftPlan } from "../story/chapter-draft-plan.ts";
import { deriveVoicePolishIssues } from "../content/review-repair.ts";
import { polishVoice } from "../content/voice-engine.ts";
import { getNarrativePersonLabel } from "../domain/project-structure.ts";
import { requestChatCompletionForWorkflow } from "../llm-workflows.ts";
import { requestWithSentenceBoundaryContinuation } from "../long-form-continuation.ts";
import { buildProseSteeringInstructions } from "../writing/draft-quality.ts";
import {
  assessProseStyleRisk,
  normalizeGeneratedChapterContent,
} from "../writing/prose-normalizer.ts";
import { shouldInvokeLlmStyleRescue } from "./run-decisions.ts";
import { addSteeringNote, getProject, listActiveSteeringNotes } from "../repositories/project.repository.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { getFoundation } from "../repositories/foundation.repository.ts";
import { upsertRunState } from "../repositories/run.repository.ts";
import { applyDeterministicStylePass } from "../writing/style-pass.ts";
import { buildRuntimeStyleSections } from "../services/blueprint-generate.service.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "../services/project-execution-context.ts";
import { buildWritingCharterPromptContract } from "../style/style-steering.ts";
import { serializeContextPackSections } from "../services/context-serialization.ts";
import { renderProseSignalWarnings } from "../services/prose-signal-warnings.ts";
import type { ContextPack, ReviewVerdict } from "../types.ts";
import { nowIso, wordCount } from "../utils.ts";
import {
  BEST_EFFORT_REWRITE_TIMEOUT_MS,
  buildWriterBudgetSteeringLines,
  isBetterProseCandidate,
} from "./chapter-shared.ts";

export function persistProseSteeringNotes(projectId: string, chapterNo: number, chapterContent: string) {
  const writingCharter = getFoundation(projectId)?.styleProfile?.writingCharter ?? null;
  const proseRisk = assessProseStyleRisk(chapterContent, writingCharter);
  if (proseRisk.severity === "ok") {
    return [];
  }

  const existing = new Set(
    listActiveSteeringNotes(projectId, chapterNo).map((note) => note.instruction.trim()),
  );
  const instructions = buildProseSteeringInstructions(proseRisk, writingCharter);
  const scope = chapterNo <= 5 ? "current_volume" : "next_arc";
  const added: string[] = [];

  for (const instruction of instructions) {
    if (!instruction.trim() || existing.has(instruction.trim())) {
      continue;
    }
    addSteeringNote(projectId, {
      instruction,
      scope,
      currentChapter: chapterNo,
    });
    existing.add(instruction.trim());
    added.push(instruction);
  }

  if (added.length) {
    appendRunLog(projectId, "info", `已追加文风约束：${added.join("；")}`);
  }

  return added;
}

export function persistReviewSteeringNotes(
  projectId: string,
  chapterNo: number,
  review: Pick<ReviewVerdict, "issues" | "fixInstructions" | "reason" | "styleChecklistHits" | "charterViolations">,
) {
  const existing = new Set(
    listActiveSteeringNotes(projectId, chapterNo).map((note) => note.instruction.trim()),
  );
  const instructions = buildReviewSteeringInstructions({
    chapterNo,
    issues: review.issues,
    fixInstructions: review.fixInstructions,
    reason: review.reason,
    styleChecklistHits: review.styleChecklistHits,
    charterViolations: review.charterViolations,
  });
  const scope = chapterNo <= 3 ? "persistent" : chapterNo <= 5 ? "current_volume" : "next_arc";
  const added: string[] = [];

  for (const instruction of instructions) {
    if (!instruction.trim() || existing.has(instruction.trim())) {
      continue;
    }
    addSteeringNote(projectId, {
      instruction,
      scope,
      currentChapter: chapterNo,
    });
    existing.add(instruction.trim());
    added.push(instruction);
  }

  if (added.length) {
    appendRunLog(projectId, "info", `已追加审稿约束：${added.join("；")}`);
  }

  return added;
}

export async function runStylePass(
  projectId: string,
  chapterNo: number,
  chapterContent: string,
  contextPack: ContextPack | null,
  executionContext?: ProjectExecutionContext,
) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }
  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const chapterDraftPlan = contextPack ? buildChapterDraftPlan(contextPack) : null;
  const deterministic = applyDeterministicStylePass(chapterContent, context.styleProfile);
  const voicePolishResult = chapterDraftPlan
    ? polishVoice({
      content: deterministic.content,
      voiceBrief: chapterDraftPlan.voiceBrief,
      issues: deriveVoicePolishIssues(deterministic.content),
    })
    : { content: deterministic.content, appliedFixes: [] as string[] };
  const polishedDeterministic = applyDeterministicStylePass(voicePolishResult.content, context.styleProfile);
  const serializedContext = contextPack ? serializeContextPackSections(contextPack) : null;
  const narrativePerson = getNarrativePersonLabel(project.narrativePerson);
  const stylePrompt = buildRuntimeStyleSections({
    stage: "stylePass",
    context,
  });
  let bestContent = polishedDeterministic.content;
  let bestAssessment = assessProseStyleRisk(bestContent, context.styleProfile.writingCharter);
  let localFlavorSignals = polishedDeterministic.localFlavorSignals;
  let removedLexicon = Array.from(new Set([
    ...deterministic.removedLexicon,
    ...polishedDeterministic.removedLexicon,
    ...voicePolishResult.appliedFixes.map((fix) => `voice:${fix}`),
  ]));
  let paragraphPasses = deterministic.paragraphPasses + polishedDeterministic.paragraphPasses;

  upsertRunState(projectId, {
    stage: "style_pass",
    status: "style_pass",
    desiredState: "running",
    heartbeatAt: nowIso(),
    currentChapter: chapterNo,
    lastError: null,
    wordCount: wordCount(bestContent),
    stageDetails: {
      stylePass: {
        applied: true,
        paragraphPasses,
        removedLexicon,
        proseSeverity: bestAssessment.severity,
        proseScore: bestAssessment.score,
        proseNotes: bestAssessment.notes.slice(0, 3),
      },
    },
  });

  if (!shouldInvokeLlmStyleRescue({
    chapterNo,
    proseRisk: bestAssessment,
  })) {
    return {
      content: bestContent,
      removedLexicon,
      paragraphPasses,
      proseSeverity: bestAssessment.severity,
      proseScore: bestAssessment.score,
    };
  }

  const proseSignals = renderProseSignalWarnings(bestContent, context.styleProfile.writingCharter);
  const proseInstructions = buildProseSteeringInstructions(bestAssessment, context.styleProfile.writingCharter);
  const charterPromptContract = context.styleProfile.writingCharter
    ? buildWritingCharterPromptContract({
      writingCharter: context.styleProfile.writingCharter,
      stage: "writer",
    })
    : [];
  const charterBudgetSteering = buildWriterBudgetSteeringLines(context.styleProfile.writingCharter);
  const rescueTargets = [
    bestAssessment.pronounLeadCount >= 5
      ? `把代词起句从 ${bestAssessment.pronounLeadCount} 次压到 4 次以内。`
      : "",
    bestAssessment.simileCount >= 4
      ? `把显性比喻从 ${bestAssessment.simileCount} 处压到 3 处以内。`
      : "",
    bestAssessment.dominantLead && bestAssessment.dominantLead.lead.length <= 2 && bestAssessment.dominantLead.count >= 5
      ? `把“${bestAssessment.dominantLead.lead}”句首从 ${bestAssessment.dominantLead.count} 次压到 6 次以内。`
      : "",
  ].filter(Boolean);

  try {
    const messages = [
      {
        role: "system" as const,
        content: `${context.prompts.writer}

你现在执行单轮 style rescue。
任务是只修正文笔和段落组织，不改变既有剧情事实、人物关系、世界规则与伏笔结果。
重点消除一句一段、策划腔、解释腔、突兀转场、代词堆叠和平均句式，让正文更像正常小说成稿。
如果同一主体被连续写成“他/她/它……他/她/它……”，要改成更自然的主体锚点。
如果“像……”“仿佛……”“不是……而是……”等模板句连发，要打散句法，保留必要画面，删掉空转修辞。
这不是换几个同义词就算完成；要真正打散重复句首、模板句和空转意象。
${charterPromptContract.join("\n")}`,
      },
      {
        role: "user" as const,
        content: [
          `章节号：${chapterNo}`,
          "当前轮次：单轮 style rescue",
          `叙事人称：${narrativePerson}`,
          ...stylePrompt.sections,
          serializedContext ? `写作 DNA：\n${serializedContext.serializedWritingDna}` : "",
          serializedContext ? `角色最新状态：\n${serializedContext.serializedCharacterStates || "无"}` : "",
          serializedContext ? `未回收线程：\n${serializedContext.serializedThreads || "无"}` : "",
          serializedContext ? `上一章结尾实录：\n${serializedContext.serializedPreviousChapterTail || "无"}` : "",
          chapterDraftPlan ? `Voice Brief：\n${chapterDraftPlan.voiceBrief.summary}\n- ${chapterDraftPlan.voiceBrief.polishPlan.join("\n- ")}` : "",
          `文本风险摘要：${proseSignals.summary}`,
          proseSignals.warnings.length ? `本轮必须重点修：\n- ${proseSignals.warnings.join("\n- ")}` : "",
          proseInstructions.length ? `执行约束：\n- ${proseInstructions.join("\n- ")}` : "",
          charterBudgetSteering.length ? `作者习惯卡预算：\n- ${charterBudgetSteering.join("\n- ")}` : "",
          rescueTargets.length ? `本轮量化目标：\n- ${rescueTargets.join("\n- ")}` : "",
          "硬性要求：",
          "1. 不改剧情事实、人物关系、世界规则和伏笔结果。",
          "2. 连续代词起句要改成主体锚点、动作承接或自然省略，不要一排“它……它……它……”。",
          "3. 同一主体名词也不要连续多句起头，不要一排“咿呀……咿呀……咿呀……”；改用环境、动作结果、身体反馈或视线落点分散句首。",
          "4. “像/仿佛”“不是……而是……”之类模板句只保留必要个别处，其余直接删改，不要只是换个近义说法。",
          "5. 保留已有的动作链、危险感和信息量，不要改软。",
          `当前正文：\n${bestContent}`,
          "只输出修整后的完整正文，不要解释。",
        ].filter(Boolean).join("\n\n"),
      },
    ];
    const { content: rewritten } = await requestWithSentenceBoundaryContinuation({
      messages,
      request: (passMessages, pass) =>
        requestChatCompletionForWorkflow(
          {
            workflow: "chapter_style_pass",
            profile: context.agents.writer.profile,
            model: context.agents.writer.assignment.model,
            messages: passMessages,
            assignmentMaxTokens: context.agents.writer.assignment.maxTokens,
            temperature: Math.min(context.agents.writer.assignment.temperature, 0.25),
            timeoutMs: BEST_EFFORT_REWRITE_TIMEOUT_MS,
            maxAttempts: 1,
          },
          pass.kind === "continuation" ? pass.overrideMaxTokens : undefined,
        ),
      onStillTruncated: () => {
        console.warn(`[chapter-style-pass:${projectId}:${chapterNo}] style continuation still hit finish_reason=length.`);
        appendRunLog(projectId, "warning", `第 ${chapterNo} 章风格修整续写补救后仍命中长度上限，正文结尾可能被截断。`);
      },
    });
    const rescued = applyDeterministicStylePass(normalizeGeneratedChapterContent(rewritten), context.styleProfile);
    const candidateContent = rescued.content;
    const candidateAssessment = assessProseStyleRisk(candidateContent, context.styleProfile.writingCharter);

    if (isBetterProseCandidate(candidateAssessment, bestAssessment)) {
      bestContent = candidateContent;
      bestAssessment = candidateAssessment;
      localFlavorSignals = rescued.localFlavorSignals;
      removedLexicon = Array.from(new Set([...removedLexicon, ...rescued.removedLexicon]));
      paragraphPasses += rescued.paragraphPasses;
    }
  } catch {
    // Fall back to the deterministic pass output if rescue fails.
  }

  return {
    content: bestContent,
    removedLexicon,
    paragraphPasses,
    proseSeverity: bestAssessment.severity,
    proseScore: bestAssessment.score,
    localFlavorSignals,
  };
}
