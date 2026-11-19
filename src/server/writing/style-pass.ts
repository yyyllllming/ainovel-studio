import type { StyleProfile } from "../types.ts";
import {
  applyDeterministicAiFlavorGuard,
  applyWritingCharterRegexGuard,
  buildLocalFlavorSignals,
  normalizeGeneratedChapterContent,
} from "./prose-normalizer.ts";

const AI_NOVEL_CLICHE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/喃喃自语/gu, "自言自语"],
  [/沉声道/gu, "低声说"],
  [/冷声道/gu, "冷冷地说"],
  [/轻声呢喃/gu, "小声说"],
  [/薄唇微启/gu, "张了张嘴"],
  [/目光微凝/gu, "盯着"],
  [/嘴角勾起一抹弧度/gu, "嘴角一歪"],
  [/心中涌起一股暖流/gu, "心里暖了一下"],
  [/不禁泛起涟漪/gu, "有些触动"],
];

const LEXICON_REPLACEMENTS: Record<string, string> = {
  "推进主线": "",
  "信息投放": "风声",
  "升级危机": "局势更紧",
  "情绪价值": "情绪回响",
  "爽点": "痛快处",
  "名场面": "关键一幕",
  "反转点": "转折",
  "阻力": "难处",
};

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceForbiddenLexicon(input: string, forbiddenLexicon: string[]) {
  let output = input;
  const removedLexicon: string[] = [];

  // 先应用 AI 小说套话替换
  for (const [pattern, replacement] of AI_NOVEL_CLICHE_REPLACEMENTS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    if (regex.test(output)) {
      output = output.replace(pattern, replacement);
    }
  }

  for (const phrase of forbiddenLexicon) {
    if (!phrase.trim()) {
      continue;
    }
    const replacement = LEXICON_REPLACEMENTS[phrase] ?? "";
    const pattern = new RegExp(escapeRegExp(phrase), "gu");
    if (!pattern.test(output)) {
      continue;
    }
    output = output.replace(pattern, replacement);
    removedLexicon.push(phrase);
  }

  return {
    content: output
      .replace(/[ \t]{2,}/g, " ")
      .replace(/。{2,}/g, "。")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    removedLexicon,
  };
}

function countParagraphs(input: string) {
  if (!input.trim()) {
    return 0;
  }
  return input.split(/\n{2,}/).filter((item) => item.trim()).length;
}

export function applyDeterministicStylePass(input: string, profile: StyleProfile) {
  const initialParagraphs = countParagraphs(input);
  const cleaned = replaceForbiddenLexicon(input, profile.forbiddenLexicon);
  const guarded = applyWritingCharterRegexGuard(cleaned.content, profile.writingCharter);
  const aiGuarded = applyDeterministicAiFlavorGuard(guarded, profile.writingCharter);
  const normalized = normalizeGeneratedChapterContent(aiGuarded);
  const localFlavorSignals = buildLocalFlavorSignals(normalized, profile.writingCharter);
  const finalParagraphs = countParagraphs(normalized);

  return {
    content: normalized,
    removedLexicon: cleaned.removedLexicon,
    paragraphPasses: Math.max(0, initialParagraphs - finalParagraphs),
    localFlavorSignals,
  };
}
