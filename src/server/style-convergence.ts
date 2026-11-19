import type { StyleExcerpt, StyleProfile } from "./types.ts";
import type { StyleFingerprint } from "./style-fingerprint.ts";
import { computeStyleFingerprint } from "./style-fingerprint.ts";
import { formatStyleProfileForStage, normalizeStyleProfile } from "./style/style-steering.ts";
import type { ChatMessage } from "./llm.ts";
import { safeParseJson } from "./utils/safe-json.ts";

export interface DimensionDivergence {
  dimension: string;
  referenceValue: number;
  generatedValue: number;
  deviation: number;
}

export interface ConvergenceResult {
  refinedProfile: StyleProfile;
  iterations: number;
  convergenceScore: number;
  divergences: DimensionDivergence[];
}

export async function iterativeStyleConvergence(input: {
  initialProfile: StyleProfile;
  referenceFingerprint: StyleFingerprint;
  referenceExcerpts: StyleExcerpt[];
  maxIterations?: number;
  writerSystemPrompt: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<ConvergenceResult> {
  const maxIterations = input.maxIterations ?? 2;
  let currentProfile = input.initialProfile;
  let bestScore = 0;
  let lastDivergences: DimensionDivergence[] = [];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const testText = await generateTestPassage({
      profile: currentProfile,
      referenceExcerpts: input.referenceExcerpts.slice(0, 3),
      writerSystemPrompt: input.writerSystemPrompt,
      llmCall: input.llmCall,
    });
    const generatedFingerprint = computeStyleFingerprint(testText, []);
    const divergences = computeDivergences(input.referenceFingerprint, generatedFingerprint);
    const convergenceScore = scoreConvergence(divergences);
    lastDivergences = divergences;
    bestScore = Math.max(bestScore, convergenceScore);

    if (convergenceScore >= 0.75) {
      return {
        refinedProfile: currentProfile,
        iterations: iteration + 1,
        convergenceScore,
        divergences,
      };
    }

    const worstDimensions = divergences
      .filter((entry) => entry.deviation > 0.2)
      .sort((left, right) => right.deviation - left.deviation)
      .slice(0, 3);
    if (!worstDimensions.length) {
      return {
        refinedProfile: currentProfile,
        iterations: iteration + 1,
        convergenceScore,
        divergences,
      };
    }

    currentProfile = await refineProfileForDivergences({
      profile: currentProfile,
      divergences: worstDimensions,
      llmCall: input.llmCall,
    });
  }

  return {
    refinedProfile: currentProfile,
    iterations: maxIterations,
    convergenceScore: bestScore,
    divergences: lastDivergences,
  };
}

async function generateTestPassage(input: {
  profile: StyleProfile;
  referenceExcerpts: StyleExcerpt[];
  writerSystemPrompt: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<string> {
  const styleText = formatStyleProfileForStage(input.profile, "writer");
  const exemplarContext = input.referenceExcerpts
    .map((entry) => `> ${entry.content.slice(0, 200)}`)
    .join("\n\n");

  const systemPrompt = [
    input.writerSystemPrompt,
    "",
    "--- 风格锚点 ---",
    styleText,
  ].join("\n");
  const userPrompt = [
    "请以下面的风格范本为参考，写一段 400-600 字的小说片段。",
    "题材不限，但必须包含：一段叙述、一段对话、一个情绪转折。",
    "",
    "风格范本：",
    exemplarContext,
    "",
    "请直接输出正文，不要加标题或解释。",
  ].join("\n");

  try {
    return await input.llmCall([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
  } catch {
    return "";
  }
}

export function computeDivergences(
  reference: StyleFingerprint,
  generated: StyleFingerprint,
): DimensionDivergence[] {
  const divergences: DimensionDivergence[] = [];
  const clampDeviation = (value: number) => Math.min(1, Math.max(0, value));
  const ratioDeviation = (referenceValue: number, generatedValue: number, baselineOffset = 0) =>
    clampDeviation(
      Math.abs((referenceValue + baselineOffset) - (generatedValue + baselineOffset))
      / Math.max(1, Math.abs(referenceValue + baselineOffset)),
    );
  const scaledDeviation = (referenceValue: number, generatedValue: number, scale = 1) =>
    clampDeviation(Math.abs(referenceValue - generatedValue) * scale);
  const deriveDeepTextureSensoryDensity = (fingerprint: StyleFingerprint) => fingerprint.emotionRendering.sensoryDetailDensity;

  divergences.push({
    dimension: "sentenceLength.mean",
    referenceValue: reference.sentenceLength.mean,
    generatedValue: generated.sentenceLength.mean,
    deviation: ratioDeviation(reference.sentenceLength.mean, generated.sentenceLength.mean),
  });
  divergences.push({
    dimension: "paragraphLength.mean",
    referenceValue: reference.paragraphLength.mean,
    generatedValue: generated.paragraphLength.mean,
    deviation: ratioDeviation(reference.paragraphLength.mean, generated.paragraphLength.mean),
  });
  divergences.push({
    dimension: "dialogue.overallRatio",
    referenceValue: reference.dialogue.overallRatio,
    generatedValue: generated.dialogue.overallRatio,
    deviation: scaledDeviation(reference.dialogue.overallRatio, generated.dialogue.overallRatio, 3),
  });
  divergences.push({
    dimension: "punctuation.exclamation",
    referenceValue: reference.punctuation.exclamation,
    generatedValue: generated.punctuation.exclamation,
    deviation: ratioDeviation(reference.punctuation.exclamation, generated.punctuation.exclamation, 0.1),
  });
  divergences.push({
    dimension: "sentenceLength.shortRatio",
    referenceValue: reference.sentenceLength.shortRatio,
    generatedValue: generated.sentenceLength.shortRatio,
    deviation: scaledDeviation(reference.sentenceLength.shortRatio, generated.sentenceLength.shortRatio, 2),
  });

  divergences.push({
    dimension: "rhetoric.simileDensity",
    referenceValue: reference.rhetoric.simileDensity,
    generatedValue: generated.rhetoric.simileDensity,
    deviation: ratioDeviation(reference.rhetoric.simileDensity, generated.rhetoric.simileDensity),
  });
  divergences.push({
    dimension: "narrativeRhythm.rhythmVariance",
    referenceValue: reference.narrativeRhythm.rhythmVariance,
    generatedValue: generated.narrativeRhythm.rhythmVariance,
    deviation: ratioDeviation(reference.narrativeRhythm.rhythmVariance, generated.narrativeRhythm.rhythmVariance),
  });
  divergences.push({
    dimension: "emotionRendering.restraintScore",
    referenceValue: reference.emotionRendering.restraintScore,
    generatedValue: generated.emotionRendering.restraintScore,
    deviation: scaledDeviation(reference.emotionRendering.restraintScore, generated.emotionRendering.restraintScore, 2),
  });
  divergences.push({
    dimension: "deepTexture.sensoryDetailDensity",
    referenceValue: deriveDeepTextureSensoryDensity(reference),
    generatedValue: deriveDeepTextureSensoryDensity(generated),
    deviation: ratioDeviation(deriveDeepTextureSensoryDensity(reference), deriveDeepTextureSensoryDensity(generated)),
  });
  divergences.push({
    dimension: "paragraphLength.singleSentenceRatio",
    referenceValue: reference.paragraphLength.singleSentenceRatio,
    generatedValue: generated.paragraphLength.singleSentenceRatio,
    deviation: scaledDeviation(reference.paragraphLength.singleSentenceRatio, generated.paragraphLength.singleSentenceRatio, 2),
  });
  divergences.push({
    dimension: "dialogue.averageSurroundingAction",
    referenceValue: reference.dialogue.averageSurroundingAction,
    generatedValue: generated.dialogue.averageSurroundingAction,
    deviation: ratioDeviation(reference.dialogue.averageSurroundingAction, generated.dialogue.averageSurroundingAction),
  });
  divergences.push({
    dimension: "punctuation.ellipsis",
    referenceValue: reference.punctuation.ellipsis,
    generatedValue: generated.punctuation.ellipsis,
    deviation: ratioDeviation(reference.punctuation.ellipsis, generated.punctuation.ellipsis, 0.1),
  });
  divergences.push({
    dimension: "vocabulary.uniqueRatio",
    referenceValue: reference.vocabulary.uniqueRatio,
    generatedValue: generated.vocabulary.uniqueRatio,
    deviation: scaledDeviation(reference.vocabulary.uniqueRatio, generated.vocabulary.uniqueRatio, 2),
  });

  return divergences;
}

function scoreConvergence(divergences: DimensionDivergence[]) {
  if (!divergences.length) {
    return 1;
  }
  return 1 - (divergences.reduce((sum, entry) => sum + entry.deviation, 0) / divergences.length);
}

async function refineProfileForDivergences(input: {
  profile: StyleProfile;
  divergences: DimensionDivergence[];
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  const divergenceDescription = input.divergences
    .map((entry) =>
      `${entry.dimension}: 参考值=${entry.referenceValue.toFixed(2)}, 生成值=${entry.generatedValue.toFixed(2)}, 偏差=${(entry.deviation * 100).toFixed(0)}%`)
    .join("\n");
  const currentRules = formatStyleProfileForStage(input.profile, "writer");
  const systemPrompt = `你是风格规则校准器。当前的风格规则在 LLM 生成时产生了偏差。
请根据偏差信息调整相关规则字段，使生成结果更接近参考值。
只调整与偏差相关的字段，不要改动其他部分。
输出完整的 StyleProfile JSON。`;
  const userPrompt = [
    "当前风格规则：",
    currentRules,
    "",
    "生成测试后发现的偏差：",
    divergenceDescription,
    "",
    "请调整规则以减小这些偏差。例如：",
    "- 如果句长偏短，加强“避免碎句”的规则",
    "- 如果对白占比偏高，加强叙述段的要求",
    "- 如果感叹号过多，加强“克制标点”的规则",
  ].join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const parsed = safeParseJson<Record<string, unknown>>(
      raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim(),
    );
    return parsed ? normalizeStyleProfile(parsed) : input.profile;
  } catch {
    return input.profile;
  }
}
