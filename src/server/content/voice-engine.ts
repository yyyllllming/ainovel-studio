import type { SceneCard, VoiceBrief, VoicePack, VoiceScore } from "./types.ts";

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function compactText(input: string) {
  return input.replace(/\s+/gu, " ").trim();
}

function anchorKeywords(anchor: string) {
  return anchor
    .split(/[、，,；;。.!?\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function anchorMatches(content: string, anchor: string) {
  if (anchorKeywords(anchor).some((keyword) => content.includes(keyword))) {
    return true;
  }
  if (anchor.includes("身体反馈") && /伤|血|骨|手|呼吸|指|背|痛/u.test(content)) {
    return true;
  }
  if (anchor.includes("风险压住解释") && /没急着解释|不急着解释|先听|先看|先按|再去/u.test(content)) {
    return true;
  }
  if (anchor.includes("章末只留一个后患") && /后患|闷响|热痕|回响/u.test(content)) {
    return true;
  }
  return false;
}

export function buildVoiceBrief(input: {
  voicePack: VoicePack;
  chapterNo: number;
  sceneCards: SceneCard[];
}): VoiceBrief {
  const preferredExemplars = input.voicePack.projectVoiceSnapshot?.exemplars?.length
    ? input.voicePack.projectVoiceSnapshot.exemplars
    : input.voicePack.styleExemplars;
  const exemplarSource = input.voicePack.projectVoiceSnapshot?.exemplars?.length
    ? "project_voice_snapshot"
    : input.voicePack.styleExemplars.length
      ? "style_snapshot"
      : "fallback";
  const scenePressure = input.sceneCards[0]?.obstacle ?? "本章压力要落进具体动作结果。";
  const summary = input.voicePack.projectVoiceSnapshot?.digest?.trim()
    || input.voicePack.styleDigest
    || "本章声线：身体反馈先行、风险压住解释、章末只留一个钩子。";

  return {
    summary,
    positiveAnchors: input.voicePack.positiveAnchors.slice(0, 6),
    antiPatterns: input.voicePack.antiPatterns.slice(0, 6),
    exemplarSource,
    preferredExemplars: preferredExemplars.slice(0, 3),
    polishPlan: uniqueNonEmpty([
      "优先让身体反馈、动作结果和环境压强带出情绪，不要先总结。",
      `当前章的声音要始终压着“${scenePressure}”往前走。`,
      "章末只保留一个新后患或新发现，不回钉总结。",
    ]),
  };
}

export function scoreVoice(input: {
  content: string;
  voicePack: VoicePack;
}): VoiceScore {
  const content = compactText(input.content);
  const matchedAnchors: string[] = [];
  const missingAnchors: string[] = [];

  for (const anchor of input.voicePack.positiveAnchors.slice(0, 5)) {
    if (anchorMatches(content, anchor)) {
      matchedAnchors.push(anchor);
    } else {
      missingAnchors.push(anchor);
    }
  }

  const base = input.voicePack.positiveAnchors.length
    ? matchedAnchors.length / Math.max(1, Math.min(input.voicePack.positiveAnchors.length, 5))
    : 0.5;
  const snapshotBonus = input.voicePack.projectVoiceSnapshot ? 0.08 : 0;
  const antiPatternPenalty = input.voicePack.antiPatterns.some((pattern) => pattern && content.includes(pattern)) ? 0.2 : 0;
  const summaryPenalty = /总结来说|总之|由此可见/u.test(content) ? 0.15 : 0;
  const score = Math.max(0, Math.min(1, base + 0.25 + snapshotBonus - antiPatternPenalty - summaryPenalty));

  return {
    score,
    consistency: score >= 0.75 ? "strong" : score >= 0.5 ? "mixed" : "weak",
    matchedAnchors,
    missingAnchors,
  };
}

export function polishVoice(input: {
  content: string;
  voiceBrief: VoiceBrief;
  issues?: string[];
}) {
  let content = input.content;
  const appliedFixes: string[] = [];
  const issues = new Set(input.issues ?? []);

  if (issues.has("summary_first") || /总结来说|总之|由此可见/u.test(content)) {
    content = content.replace(/^\s*(总结来说|总之|由此可见)[，,、]*/u, "");
    content = content.replace(/(总结来说|总之|由此可见)[，,、]*/gu, "");
    appliedFixes.push("summary_first");
  }

  if (issues.has("explanation_heavy")) {
    content = content.replace(/先解释|先说明|这意味着/gu, "先撞上");
    appliedFixes.push("explanation_heavy");
  }

  if (input.voiceBrief.antiPatterns.some((pattern) => pattern && content.includes(pattern))) {
    appliedFixes.push("anti_pattern_trim");
  }

  return {
    content: content.trim(),
    appliedFixes,
  };
}
