import type { ChapterBlueprint, ChapterReviewState, WritingCharter } from "../types.ts";
import { assessProseStyleRisk } from "./prose-normalizer.ts";
import { wordCount } from "../utils.ts";

const PRONOUN_LEADS = new Set(["它", "他", "她", "它们", "他们", "她们"]);

export type DraftCandidateEvaluation = ReturnType<typeof scoreDraftCandidate>;

export function shouldUseBootstrapDraftSelection(input: {
  chapterNo: number;
  reviewStates: Array<Pick<ChapterReviewState, "chapterNo" | "status">>;
  bootstrapChapterCount?: number;
}) {
  const bootstrapChapterCount = input.bootstrapChapterCount ?? 3;
  const hasDeepLock = input.reviewStates.some((state) =>
    state.status === "deep_locked" && state.chapterNo < input.chapterNo
  );

  return input.chapterNo <= bootstrapChapterCount || !hasDeepLock;
}

export function scoreDraftCandidate(input: {
  content: string;
  blueprint: Pick<ChapterBlueprint, "characters" | "estimatedWords">;
}) {
  const proseRisk = assessProseStyleRisk(input.content);
  const totalWords = wordCount(input.content);
  const missingCharacters = input.blueprint.characters.filter((name) => name && !input.content.includes(name));
  const missingCharacterPenalty = missingCharacters.length * 1200;
  const shortfallPenalty = totalWords < Math.max(1200, Math.floor(input.blueprint.estimatedWords * 0.6))
    ? 900
    : 0;
  const overshootPenalty = totalWords > Math.max(4200, Math.ceil(input.blueprint.estimatedWords * 2.1))
    ? 400
    : 0;
  const score = proseRisk.score * 1000
    + proseRisk.pronounLeadCount * 10
    + proseRisk.simileCount * 14
    + proseRisk.contrastTemplateCount * 30
    + proseRisk.abruptTurnCount * 18
    + ((proseRisk.dominantLead && proseRisk.dominantLead.lead.length <= 2) ? proseRisk.dominantLead.count * 22 : 0)
    + missingCharacterPenalty
    + shortfallPenalty
    + overshootPenalty;

  return {
    score,
    proseRisk,
    totalWords,
    missingCharacters,
    shortfallPenalty,
    overshootPenalty,
  };
}

export function pickBestDraftCandidate<T extends { content: string }>(
  candidates: T[],
  blueprint: Pick<ChapterBlueprint, "characters" | "estimatedWords">,
) {
  return candidates
    .map((candidate, index) => ({
      index,
      candidate,
      evaluation: scoreDraftCandidate({
        content: candidate.content,
        blueprint,
      }),
    }))
    .sort((left, right) => left.evaluation.score - right.evaluation.score || left.index - right.index)[0]
    ?? null;
}

export function filterUsableDraftCandidates<T extends { content: string }>(candidates: Array<T | null | undefined>) {
  return candidates.filter((candidate): candidate is T => Boolean(candidate?.content.trim()));
}

export function isBootstrapDraftCandidateAcceptable(evaluation: DraftCandidateEvaluation) {
  return evaluation.proseRisk.severity !== "fail"
    && !(evaluation.proseRisk.dominantLead
      && evaluation.proseRisk.dominantLead.lead.length <= 2
      && evaluation.proseRisk.dominantLead.count >= 12)
    && evaluation.missingCharacters.length === 0
    && evaluation.shortfallPenalty === 0
    && evaluation.score <= 6500;
}

export function buildProseSteeringInstructions(
  input: ReturnType<typeof assessProseStyleRisk>,
  writingCharter?: WritingCharter | null,
) {
  const instructions: string[] = [];
  const pronounLimit = writingCharter?.subjectLeadBudget.maxPronounLeads ?? 4;
  const dominantLeadLimit = writingCharter?.subjectLeadBudget.maxDominantLeadCount ?? 6;
  const windowSize = writingCharter?.subjectLeadBudget.windowSize ?? 6;
  const simileChapterLimit = writingCharter?.simileBudget.maxPerChapter ?? 4;
  const simileParagraphLimit = writingCharter?.simileBudget.maxPerParagraph ?? 1;
  const contrastWarnCount = (writingCharter?.transitionBudget.maxContrastTemplates ?? 1) + 1;
  const abruptWarnCount = (writingCharter?.transitionBudget.maxAbruptTurns ?? 2) + 1;

  if (input.pronounLeadCount >= pronounLimit + 1 && input.pronounLeadRatio >= 0.08) {
    instructions.push(
      `正文叙述要尽快落回明确主体，优先使用角色名、动作承接或自然省略，避免连续多句以“它/他/她”起头；当前代词起句已到 ${input.pronounLeadCount} 次，目标压到 ${pronounLimit} 次以内。`,
    );
  }
  if (
    input.dominantLead
    && input.dominantLead.lead.length <= 2
    && input.dominantLead.count >= dominantLeadLimit
    && !PRONOUN_LEADS.has(input.dominantLead.lead)
  ) {
    instructions.push(
      `连续 ${windowSize} 句叙述里，同一主体名词起句不要超过 ${writingCharter?.subjectLeadBudget.maxSameLeadInWindow ?? 2} 次；当前“${input.dominantLead.lead}”已经重复 ${input.dominantLead.count} 次。相邻两句不要重复以“${input.dominantLead.lead}”起头，优先改成环境承接、动作结果、身体反馈或视线落点分散句首，并把“${input.dominantLead.lead}”句首压到 ${dominantLeadLimit} 次以内。`,
    );
  }
  if (input.simileCount >= simileChapterLimit + 1 || (input.sentenceCount >= 10 && input.simileCount / input.sentenceCount >= 0.15)) {
    instructions.push(
      `显性比喻（像/仿佛/如同/宛如/似乎）尽量压到 ${simileChapterLimit} 处以内；当前已有 ${input.simileCount} 处，同一段只保留 ${simileParagraphLimit} 处关键比喻，优先用动作、感官和结果直接显形。`,
    );
  }
  if (input.contrastTemplateCount >= contrastWarnCount) {
    instructions.push(
      "避免反复使用“不是……而是……”这类模板句推进语气，改用直接动作、判断和结果来完成转折。",
    );
  }
  if (input.abruptTurnCount >= abruptWarnCount) {
    instructions.push(
      "少用“忽然”这类提示词硬切转场，改成让动作、声音或危险本身把变化带出来。",
    );
  }

  return instructions;
}

export function buildBootstrapRetryInstructions(evaluations: DraftCandidateEvaluation[]) {
  const instructions = new Set<string>();

  for (const evaluation of evaluations) {
    for (const instruction of buildProseSteeringInstructions(evaluation.proseRisk)) {
      instructions.add(instruction);
    }
    if (evaluation.proseRisk.simileCount >= 3) {
      instructions.add("显性比喻要再收紧一轮，优先删除空转比喻，改成动作、感官和结果直接显形。");
    }
    if (evaluation.missingCharacters.length > 0) {
      instructions.add(
        `正文里必须让这些关键角色直接上场或被点名：${evaluation.missingCharacters.join("、")}。不要只写抽象猎手或模糊敌意。`,
      );
    }
    if (evaluation.shortfallPenalty > 0) {
      instructions.add("首章成稿不要只写一个短场面就停，至少把即时目标、危险升级和一个后患写完整。");
    }
  }

  return Array.from(instructions);
}
