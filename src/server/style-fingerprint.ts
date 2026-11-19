import { wordCount } from "./utils.ts";
import type { ReferenceSection } from "./style/style-reference-import.ts";

const DIALOGUE_RE = /“[^”]*”|"[^"]*"|「[^」]*」|『[^』]*』/gu;
const SENTENCE_SPLIT_RE = /[。！？!?]+/u;
const SENTENCE_END_RE = /[^。！？!?]+[。！？!?]?/gu;
const PUNCTUATION_OR_SPACE_RE = /[\p{P}\p{S}\s]/gu;
const WHITESPACE_RE = /\s/gu;
const CHARACTER_RE = /[\p{L}\p{N}]/gu;
const BIGRAM_STOPWORDS = new Set([
  "的话",
  "的是",
  "他们",
  "我们",
  "你们",
  "自己",
  "不是",
  "一个",
  "一些",
  "这种",
  "那里",
  "这里",
  "然后",
  "没有",
  "什么",
  "已经",
  "因为",
  "所以",
]);
const ACTION_OPENERS = ["跑", "走", "拿", "推", "追", "撞", "翻", "冲", "踏", "跃"];
const SCENE_OPENERS = ["天", "风", "雨", "雾", "雪", "月", "阳", "街", "夜", "晨"];
const SIMILE_RE = /(?:像|如同|仿佛|宛如|好似|犹如)[^。！？!?，,\n]{0,18}(?:一样|一般|似的|般)?/gu;
const CONTRAST_IRONY_RE = /(?:不是[^。！？!?，,\n]{0,16}而是|明明[^。！？!?，,\n]{0,16}却|偏偏|反而|可笑的是|讽刺的是|然而|却|竟然|居然)/gu;
const RHETORICAL_QUESTION_RE = /(?:难道|岂不是|何尝|谁说|怎么会|凭什么|何必|何不|不是[^。！？!?\n]{0,12}吗)[^。！？!?\n]{0,20}[？?]/gu;
const SENSORY_SYNAESTHESIA_PATTERNS = [
  /(声音|水声|风声|嗓音|语气)[^。！？!?，,\n]{0,10}(亮|刺眼|发白|发冷|发热|柔软|粗糙)/gu,
  /(颜色|光|灯影|月光|夜色)[^。！？!?，,\n]{0,10}(吵|刺耳|苦|甜|咸|酸|沉默|喧哗)/gu,
  /(气味|香味|味道|雨味)[^。！？!?，,\n]{0,10}(刺眼|发亮|尖锐|喧哗)/gu,
  /(冷|热|暖|寒)[^。！？!?，,\n]{0,8}(发涩|发苦|发甜|刺眼|有声音)/gu,
];
const ACTION_VERBS = [
  "跑", "走", "冲", "追", "撞", "翻", "推", "拉", "拿", "抓", "跃", "扑", "扯", "挥", "踢", "刺", "砸", "躲", "闪", "奔", "挤", "站", "坐", "抬", "压",
];
const ENVIRONMENT_WORDS = [
  "天", "风", "雨", "雾", "雪", "月", "阳", "晨", "夜", "街", "巷", "桥", "门", "窗", "墙", "潮", "云", "光", "影", "山", "河", "湖", "海", "院", "集市", "地面", "空气",
];
const INTROSPECTION_WORDS = [
  "想", "想到", "想起", "觉得", "心里", "心口", "意识", "明白", "后悔", "害怕", "担心", "希望", "犹豫", "记得", "回忆", "不安", "沉重", "庆幸", "疑惑", "喉咙",
];
const SUBTEXT_CUES = ["沉默", "没说", "没有说", "停顿", "低头", "目光", "声音", "喉结", "手指", "笑了笑", "只是", "却", "仍", "呼吸", "……"];
const EXPLICIT_EMOTION_WORDS = [
  "愤怒", "悲伤", "开心", "高兴", "痛苦", "恐惧", "害怕", "绝望", "激动", "恼火", "难过", "喜悦", "愤恨", "狂喜", "委屈", "羞愧", "焦虑",
];
const IMPLICIT_EMOTION_WORDS = ["沉默", "停顿", "目光", "背影", "呼吸", "喉咙", "手指", "只是", "却", "仍", "轻轻", "低低", "发颤", "没说"];
const TENSION_WORDS = [
  "忽然", "猛地", "骤然", "紧", "压", "窒", "追", "撞", "裂", "血", "火", "危险", "惊", "恐", "痛", "颤", "死", "崩", "吼", "喊", "尖", "冷", "黑", "喘",
];
const SCENE_CHANGE_MARKERS = [
  "次日", "翌日", "清晨", "黄昏", "夜里", "夜色", "天亮", "天黑", "后来", "此时", "与此同时", "转眼", "片刻后", "门外", "街口", "桥下", "院门", "回到", "来到",
];
const TEMPORAL_DEVICE_MARKERS = [
  "曾经", "当时", "那年", "后来", "如今", "此刻", "次日", "翌日", "此前", "之后", "从前", "回忆", "想起", "与此同时", "转眼", "片刻", "终于", "直到", "三年前", "多年后",
];
const FIRST_PERSON_MARKERS = ["我", "我们", "咱们", "自己"];
const THIRD_PERSON_MARKERS = ["他", "她", "他们", "她们", "那人", "这人", "其"];
const INANIMATE_NOUNS = [
  "风", "雨", "雪", "夜", "月", "太阳", "灯", "灯影", "影子", "时间", "城市", "街道", "钟声", "门", "窗", "海", "河", "山", "雾", "云", "黑暗", "光", "回忆", "雨味", "水声",
];
const HUMAN_VERBS = [
  "笑", "哭", "叹", "低语", "呼吸", "凝视", "拥抱", "咬", "咽", "颤抖", "沉默", "诉说", "嘲笑", "撒谎", "发怒", "呻吟", "踱步", "抓", "推", "喊", "吼", "喘", "颤", "贴", "照",
];
const SENSORY_CHANNEL_KEYWORDS = {
  visual: ["亮", "暗", "光", "影", "颜色", "白", "黑", "灰", "看", "望", "刺眼", "发白"],
  auditory: ["声音", "水声", "风声", "喊", "叫", "吼", "响", "寂静", "喧哗", "低语", "喘气", "犬吠"],
  olfactory: ["气味", "香", "腥", "臭", "焦味", "雨味", "烟味"],
  gustatory: ["甜", "苦", "酸", "咸", "涩", "味", "发涩"],
  tactile: ["冷", "热", "暖", "寒", "刺", "硬", "软", "疼", "麻", "湿", "干", "发颤"],
  kinesthetic: ["跑", "走", "冲", "跌", "抬", "推", "拉", "挤", "站", "转身", "侧身", "跃"],
} as const;

type TensionCurveShape = "rising" | "oscillating" | "plateau" | "climactic";
type ParagraphBreathingPattern = "tight" | "mixed" | "expansive";
type PerspectiveLabel = "first" | "third" | "mixed" | "neutral";
type SensoryChannelDistribution = {
  visual: number;
  auditory: number;
  olfactory: number;
  gustatory: number;
  tactile: number;
  kinesthetic: number;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const PERSONIFICATION_RE = new RegExp(
  `(?:${INANIMATE_NOUNS.map(escapeRegExp).join("|")})[^。！？!?，,\n]{0,8}(?:${HUMAN_VERBS.map(escapeRegExp).join("|")})`,
  "gu",
);

export interface StyleFingerprint {
  sentenceLength: {
    mean: number;
    median: number;
    stddev: number;
    shortRatio: number;
    mediumRatio: number;
    longRatio: number;
  };
  paragraphLength: {
    mean: number;
    median: number;
    singleSentenceRatio: number;
  };
  dialogue: {
    overallRatio: number;
    averageLength: number;
    averageSurroundingAction: number;
  };
  punctuation: {
    comma: number;
    period: number;
    exclamation: number;
    question: number;
    ellipsis: number;
    dash: number;
    semicolon: number;
  };
  chapter: {
    count: number;
    averageWords: number;
    minWords: number;
    maxWords: number;
  };
  openingPattern: {
    sceneRatio: number;
    dialogueRatio: number;
    actionRatio: number;
    introspectionRatio: number;
  };
  vocabulary: {
    uniqueRatio: number;
    topBigrams: string[];
  };
  rhetoric: {
    simileCount: number;
    simileDensity: number;
    personificationCount: number;
    synesthesiaCount: number;
    contrastCount: number;
    contrastIronyCount: number;
    rhetoricalQuestionCount: number;
    dominantDevice: "simile" | "personification" | "synesthesia" | "contrast" | "contrastIrony" | "rhetoricalQuestion" | "none";
  };
  narrativeRhythm: {
    sceneChangeFrequency: number;
    tensionCurveShape: TensionCurveShape;
    shortBurstRatio: number;
    longFlowRatio: number;
    rhythmVariance: number;
    paragraphBreathingPattern: ParagraphBreathingPattern;
  };
  emotionRendering: {
    actionBasedRatio: number;
    environmentBasedRatio: number;
    introspectionRatio: number;
    dialogueSubtextRatio: number;
    sensoryDetailDensity: number;
    restraintScore: number;
  };
  deepTexture: {
    perspectiveShiftCount: number;
    temporalDeviceCount: number;
    whitespaceRatio: number;
    informationDensity: number;
    imageClusterCount: number;
    sensoryDetailDensity: number;
    sensoryChannelDistribution: SensoryChannelDistribution;
  };
}

function normalizeContentLength(text: string) {
  return text.replace(PUNCTUATION_OR_SPACE_RE, "").length;
}

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractDialogueSpans(text: string): string[] {
  return text.match(DIALOGUE_RE) ?? [];
}

function countChar(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function mean(numbers: number[]) {
  if (!numbers.length) {
    return 0;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function median(numbers: number[]): number {
  if (!numbers.length) {
    return 0;
  }
  const sorted = [...numbers].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function stddev(numbers: number[]): number {
  if (numbers.length <= 1) {
    return 0;
  }
  const average = mean(numbers);
  const variance = numbers.reduce((sum, value) => sum + ((value - average) ** 2), 0) / numbers.length;
  return Math.sqrt(variance);
}

function perThousand(totalHits: number, totalChars: number) {
  return totalChars > 0 ? (totalHits / totalChars) * 1000 : 0;
}

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function countKeywordHits(text: string, keywords: readonly string[]) {
  let total = 0;
  for (const keyword of keywords) {
    const escaped = escapeRegExp(keyword);
    total += countMatches(text, new RegExp(escaped, "gu"));
  }
  return total;
}

function computeDominantDevice(counts: {
  simile: number;
  personification: number;
  synesthesia: number;
  contrastIrony: number;
  rhetoricalQuestion: number;
}): StyleFingerprint["rhetoric"]["dominantDevice"] {
  const entries: Array<[StyleFingerprint["rhetoric"]["dominantDevice"], number]> = [
    ["simile", counts.simile],
    ["personification", counts.personification],
    ["synesthesia", counts.synesthesia],
    ["contrast", counts.contrastIrony],
    ["rhetoricalQuestion", counts.rhetoricalQuestion],
  ];
  let bestKey: StyleFingerprint["rhetoric"]["dominantDevice"] = "none";
  let bestValue = 0;
  for (const [key, value] of entries) {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestValue > 0 ? bestKey : "none";
}

function inferTensionCurveShape(paragraphs: string[]): TensionCurveShape {
  if (paragraphs.length < 2) {
    return "plateau";
  }
  const scores = paragraphs.map((paragraph) => {
    const paragraphChars = Math.max(1, normalizeContentLength(paragraph));
    return countKeywordHits(paragraph, TENSION_WORDS) / paragraphChars;
  });
  const peak = Math.max(...scores);
  if (peak <= 0) {
    return "plateau";
  }

  const first = scores[0] ?? 0;
  const last = scores[scores.length - 1] ?? 0;
  const average = mean(scores);
  const peakIndex = scores.findIndex((score) => score === peak);

  if (peakIndex === scores.length - 1 && last > first && last >= average * 1.2) {
    return "climactic";
  }

  let directionChanges = 0;
  let previousDirection = 0;
  for (let index = 1; index < scores.length; index += 1) {
    const diff = scores[index]! - scores[index - 1]!;
    const direction = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) {
      directionChanges += 1;
    }
    if (direction !== 0) {
      previousDirection = direction;
    }
  }

  if (directionChanges >= 2) {
    return "oscillating";
  }
  if (last > first * 1.15) {
    return "rising";
  }
  return "plateau";
}

function inferParagraphBreathingPattern(
  paragraphMeanLength: number,
  shortBurstRatio: number,
  longFlowRatio: number,
): ParagraphBreathingPattern {
  if (paragraphMeanLength <= 0) {
    return "mixed";
  }
  if (paragraphMeanLength < 40 || shortBurstRatio > 0.55) {
    return "tight";
  }
  if (paragraphMeanLength > 120 || longFlowRatio > 0.35) {
    return "expansive";
  }
  return "mixed";
}

function inferPerspective(paragraph: string): PerspectiveLabel {
  const first = countKeywordHits(paragraph, FIRST_PERSON_MARKERS);
  const third = countKeywordHits(paragraph, THIRD_PERSON_MARKERS);
  if (first > 0 && third > 0) {
    return "mixed";
  }
  if (first > 0) {
    return "first";
  }
  if (third > 0) {
    return "third";
  }
  return "neutral";
}

function countPerspectiveShifts(paragraphs: string[]) {
  let previous: PerspectiveLabel = "neutral";
  let shifts = 0;
  for (const paragraph of paragraphs) {
    const current = inferPerspective(paragraph);
    if (current === "neutral") {
      continue;
    }
    if (previous !== "neutral" && current !== previous) {
      shifts += 1;
    }
    previous = current;
  }
  return shifts;
}

function computeSensoryChannelCounts(text: string): Record<keyof SensoryChannelDistribution, number> {
  return {
    visual: countKeywordHits(text, SENSORY_CHANNEL_KEYWORDS.visual),
    auditory: countKeywordHits(text, SENSORY_CHANNEL_KEYWORDS.auditory),
    olfactory: countKeywordHits(text, SENSORY_CHANNEL_KEYWORDS.olfactory),
    gustatory: countKeywordHits(text, SENSORY_CHANNEL_KEYWORDS.gustatory),
    tactile: countKeywordHits(text, SENSORY_CHANNEL_KEYWORDS.tactile),
    kinesthetic: countKeywordHits(text, SENSORY_CHANNEL_KEYWORDS.kinesthetic),
  };
}

function normalizeSensoryDistribution(
  channelCounts: Record<keyof SensoryChannelDistribution, number>,
): SensoryChannelDistribution {
  const total = channelCounts.visual
    + channelCounts.auditory
    + channelCounts.olfactory
    + channelCounts.gustatory
    + channelCounts.tactile
    + channelCounts.kinesthetic;

  return {
    visual: safeRatio(channelCounts.visual, total),
    auditory: safeRatio(channelCounts.auditory, total),
    olfactory: safeRatio(channelCounts.olfactory, total),
    gustatory: safeRatio(channelCounts.gustatory, total),
    tactile: safeRatio(channelCounts.tactile, total),
    kinesthetic: safeRatio(channelCounts.kinesthetic, total),
  };
}

function classifyOpening(text: string) {
  const snippet = text.slice(0, 100).trim();
  if (!snippet) {
    return "introspection";
  }
  if (/^[“"「『]/u.test(snippet)) {
    return "dialogue";
  }
  const firstChar = snippet[0] ?? "";
  if (ACTION_OPENERS.includes(firstChar)) {
    return "action";
  }
  if (SCENE_OPENERS.includes(firstChar)) {
    return "scene";
  }
  return "introspection";
}

function buildBigrams(text: string) {
  const normalized = text.replace(PUNCTUATION_OR_SPACE_RE, "");
  const bigrams: string[] = [];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (pair.length < 2) {
      continue;
    }
    if (BIGRAM_STOPWORDS.has(pair)) {
      continue;
    }
    if (pair[0] === pair[1]) {
      continue;
    }
    bigrams.push(pair);
  }

  return bigrams;
}

export function computeStyleFingerprint(
  normalizedText: string,
  sections: ReferenceSection[],
): StyleFingerprint {
  const sentenceLengths = splitSentences(normalizedText).map(normalizeContentLength).filter((value) => value > 0);
  const paragraphs = splitParagraphs(normalizedText);
  const paragraphLengths = paragraphs.map(normalizeContentLength).filter((value) => value > 0);
  const dialogueSpans = extractDialogueSpans(normalizedText);
  const dialogueLengths = dialogueSpans.map(normalizeContentLength).filter((value) => value > 0);
  const totalChars = Math.max(1, normalizeContentLength(normalizedText));
  const dialogueChars = dialogueLengths.reduce((sum, value) => sum + value, 0);
  const dialogueBoundaries = Array.from(normalizedText.matchAll(DIALOGUE_RE));
  const surroundingActionLengths: number[] = [];
  let previousEnd = 0;

  for (const match of dialogueBoundaries) {
    const start = match.index ?? 0;
    const nonDialogueSpan = normalizedText.slice(previousEnd, start);
    const nonDialogueLength = normalizeContentLength(nonDialogueSpan);
    if (nonDialogueLength > 0) {
      surroundingActionLengths.push(nonDialogueLength);
    }
    previousEnd = start + match[0].length;
  }

  const trailingSpanLength = normalizeContentLength(normalizedText.slice(previousEnd));
  if (trailingSpanLength > 0) {
    surroundingActionLengths.push(trailingSpanLength);
  }

  const chapterWordCounts = sections.map((section) => wordCount(section.content)).filter((value) => value > 0);
  const openingCounts = {
    scene: 0,
    dialogue: 0,
    action: 0,
    introspection: 0,
  };

  for (const section of sections) {
    openingCounts[classifyOpening(section.content)] += 1;
  }

  const bigrams = buildBigrams(normalizedText);
  const bigramCounts = new Map<string, number>();
  for (const pair of bigrams) {
    bigramCounts.set(pair, (bigramCounts.get(pair) ?? 0) + 1);
  }

  const sentenceMean = mean(sentenceLengths);
  const chapterCount = chapterWordCounts.length;
  const simileCount = countMatches(normalizedText, SIMILE_RE);
  const personificationCount = countMatches(normalizedText, PERSONIFICATION_RE);
  const synesthesiaCount = SENSORY_SYNAESTHESIA_PATTERNS.reduce((sum, pattern) => sum + countMatches(normalizedText, pattern), 0);
  const contrastIronyCount = countMatches(normalizedText, CONTRAST_IRONY_RE);
  const rhetoricalQuestionCount = countMatches(normalizedText, RHETORICAL_QUESTION_RE);

  const shortBurstRatio = sentenceLengths.length
    ? sentenceLengths.filter((length) => length <= 8).length / sentenceLengths.length
    : 0;
  const longFlowRatio = sentenceLengths.length
    ? sentenceLengths.filter((length) => length >= 25).length / sentenceLengths.length
    : 0;
  const rhythmVariance = sentenceMean > 0 ? stddev(sentenceLengths) / (sentenceMean + 1) : 0;
  const sceneChangeHits = countKeywordHits(normalizedText, SCENE_CHANGE_MARKERS);

  const actionHits = countKeywordHits(normalizedText, ACTION_VERBS);
  const environmentHits = countKeywordHits(normalizedText, ENVIRONMENT_WORDS);
  const introspectionHits = countKeywordHits(normalizedText, INTROSPECTION_WORDS);
  const renderingHitTotal = actionHits + environmentHits + introspectionHits;

  const subtextPattern = new RegExp(`${SUBTEXT_CUES.map(escapeRegExp).join("|")}|\\.\\.\\.|……`, "gu");
  let dialogueSubtextCount = 0;
  for (const match of dialogueBoundaries) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const context = normalizedText.slice(Math.max(0, start - 24), Math.min(normalizedText.length, end + 24));
    if (subtextPattern.test(context)) {
      dialogueSubtextCount += 1;
    }
    subtextPattern.lastIndex = 0;
  }

  const sensoryChannelCounts = computeSensoryChannelCounts(normalizedText);
  const sensoryHitTotal = sensoryChannelCounts.visual
    + sensoryChannelCounts.auditory
    + sensoryChannelCounts.olfactory
    + sensoryChannelCounts.gustatory
    + sensoryChannelCounts.tactile
    + sensoryChannelCounts.kinesthetic;
  const explicitEmotionHits = countKeywordHits(normalizedText, EXPLICIT_EMOTION_WORDS);
  const implicitEmotionHits = countKeywordHits(normalizedText, IMPLICIT_EMOTION_WORDS);

  const imageClusterCount = paragraphs
    .filter((paragraph) => {
      const counts = computeSensoryChannelCounts(paragraph);
      const activeChannels = Object.values(counts).filter((value) => value > 0).length;
      return activeChannels >= 2;
    })
    .length;

  return {
    sentenceLength: {
      mean: sentenceMean,
      median: median(sentenceLengths),
      stddev: stddev(sentenceLengths),
      shortRatio: sentenceLengths.length ? sentenceLengths.filter((value) => value < 15).length / sentenceLengths.length : 0,
      mediumRatio: sentenceLengths.length ? sentenceLengths.filter((value) => value >= 15 && value <= 40).length / sentenceLengths.length : 0,
      longRatio: sentenceLengths.length ? sentenceLengths.filter((value) => value > 40).length / sentenceLengths.length : 0,
    },
    paragraphLength: {
      mean: mean(paragraphLengths),
      median: median(paragraphLengths),
      singleSentenceRatio: paragraphs.length
        ? paragraphs.filter((paragraph) => (paragraph.match(SENTENCE_END_RE) ?? []).filter((entry) => normalizeContentLength(entry) > 0).length <= 1).length / paragraphs.length
        : 0,
    },
    dialogue: {
      overallRatio: dialogueChars / totalChars,
      averageLength: mean(dialogueLengths),
      averageSurroundingAction: mean(surroundingActionLengths),
    },
    punctuation: {
      comma: perThousand(countChar(normalizedText, /[，,]/gu), totalChars),
      period: perThousand(countChar(normalizedText, /[。.]/gu), totalChars),
      exclamation: perThousand(countChar(normalizedText, /[！!]/gu), totalChars),
      question: perThousand(countChar(normalizedText, /[？?]/gu), totalChars),
      ellipsis: perThousand(countChar(normalizedText, /……|\.{3,}/gu), totalChars),
      dash: perThousand(countChar(normalizedText, /——|--/gu), totalChars),
      semicolon: perThousand(countChar(normalizedText, /[；;]/gu), totalChars),
    },
    chapter: {
      count: chapterCount,
      averageWords: chapterCount ? Math.round(mean(chapterWordCounts)) : 0,
      minWords: chapterCount ? Math.min(...chapterWordCounts) : 0,
      maxWords: chapterCount ? Math.max(...chapterWordCounts) : 0,
    },
    openingPattern: {
      sceneRatio: chapterCount ? openingCounts.scene / chapterCount : 0,
      dialogueRatio: chapterCount ? openingCounts.dialogue / chapterCount : 0,
      actionRatio: chapterCount ? openingCounts.action / chapterCount : 0,
      introspectionRatio: chapterCount ? openingCounts.introspection / chapterCount : 0,
    },
    vocabulary: {
      uniqueRatio: bigrams.length ? bigramCounts.size / bigrams.length : 0,
      topBigrams: [...bigramCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 20)
        .map(([pair]) => pair),
    },
    rhetoric: {
      simileCount,
      simileDensity: perThousand(simileCount, totalChars),
      personificationCount,
      synesthesiaCount,
      contrastCount: contrastIronyCount,
      contrastIronyCount,
      rhetoricalQuestionCount,
      dominantDevice: computeDominantDevice({
        simile: simileCount,
        personification: personificationCount,
        synesthesia: synesthesiaCount,
        contrastIrony: contrastIronyCount,
        rhetoricalQuestion: rhetoricalQuestionCount,
      }),
    },
    narrativeRhythm: {
      sceneChangeFrequency: perThousand(sceneChangeHits, totalChars),
      tensionCurveShape: inferTensionCurveShape(paragraphs),
      shortBurstRatio,
      longFlowRatio,
      rhythmVariance,
      paragraphBreathingPattern: inferParagraphBreathingPattern(mean(paragraphLengths), shortBurstRatio, longFlowRatio),
    },
    emotionRendering: {
      actionBasedRatio: safeRatio(actionHits, renderingHitTotal),
      environmentBasedRatio: safeRatio(environmentHits, renderingHitTotal),
      introspectionRatio: safeRatio(introspectionHits, renderingHitTotal),
      dialogueSubtextRatio: safeRatio(dialogueSubtextCount, dialogueSpans.length),
      sensoryDetailDensity: perThousand(sensoryHitTotal, totalChars),
      restraintScore: clamp01((implicitEmotionHits + dialogueSubtextCount + 1) / (implicitEmotionHits + dialogueSubtextCount + explicitEmotionHits + 1)),
    },
    deepTexture: {
      perspectiveShiftCount: countPerspectiveShifts(paragraphs),
      temporalDeviceCount: countKeywordHits(normalizedText, TEMPORAL_DEVICE_MARKERS),
      whitespaceRatio: safeRatio(countMatches(normalizedText, WHITESPACE_RE), Math.max(1, normalizedText.length)),
      informationDensity: safeRatio(countMatches(normalizedText, CHARACTER_RE), Math.max(1, normalizedText.length)),
      imageClusterCount,
      sensoryDetailDensity: perThousand(sensoryHitTotal, totalChars),
      sensoryChannelDistribution: normalizeSensoryDistribution(sensoryChannelCounts),
    },
  };
}
