import { buildProseSteeringInstructions } from "./draft-quality.ts";
import { buildDefaultRuntimeReviewSignals } from "../story/story-progression.ts";
import type {
  MotifReuseSeverity,
  QuickAuditVerdict,
  ReviewVerdict,
  StyleChecklistHit,
  WritingCharter,
  WritingCharterBudgetViolation,
} from "../types.ts";
import { WRITING_CHARTER_BUDGET_LABELS } from "../types.ts";
import { wordCount } from "../utils.ts";

type ProseRisk = {
  severity: "ok" | "warn" | "fail";
  notes: string[];
  simileCount: number;
  contrastTemplateCount: number;
  abruptTurnCount: number;
  pronounLeadCount: number;
  dominantLead?: {
    lead: string;
    count: number;
  } | null;
};

const DIALOGUE_START = /^[“"「『‘—-]/u;
const SENTENCE_END = /(?<=[。！？!?…])\s*/u;
const LEADING_PUNCTUATION = /^[“”"「『‘’()（）《》〈〉【】\[\]\s—\-…·]+/u;
const PRONOUN_SENTENCE_STARTS = ["它", "他", "她", "它们", "他们", "她们"] as const;
const HAN_LEAD = /^[\p{Script=Han}]{1,4}/u;
const MOTIF_GENERIC_STOPWORDS = [
  "自己", "对方", "没有", "已经", "可以", "时候", "东西", "一下", "一点", "只是", "还是",
  "一个", "一种", "那种", "这个", "那道", "这里", "那里", "出来", "进去", "过去", "回来",
  "他的", "她的", "它的", "来的", "下来", "上来", "起来", "过来", "出去", "上去", "下去",
  "立刻", "马上", "随后", "当下", "片刻", "眼前", "之中", "之后", "之前", "之间", "然后", "不过", "但是", "只有", "因为",
  "这是", "那是", "就是", "不是", "都是", "也是", "便是", "正是", "所有", "任何", "每一",
  "一声", "一步", "一片", "一股", "一道", "一阵", "一丝", "一抹", "一缕", "几乎",
  "仿佛", "好像", "似乎", "而且", "同时", "所以", "可是", "虽然", "如果",
  "身体", "声音", "眼睛", "双眼", "目光", "气息", "身形",
];
const ACTOR_LEAD_FOLLOWERS = [
  "没", "又", "再", "先", "还", "便", "就", "正", "仍", "把", "向", "往",
  "听", "看", "抬", "贴", "伏", "退", "压", "抓", "扑", "冲", "咬", "停",
  "立", "俯", "回", "低", "探", "踏", "挪", "护", "忍", "盯", "撑", "拧",
] as const;
const RHETORICAL_QUESTION_RE = /(?:难道|岂不是|何尝|谁说|怎么会|凭什么|何必|何不|不是[^。！？!?\n]{0,12}吗)[^。！？!?\n]{0,20}[？?]/gu;
const INANIMATE_NOUNS = [
  "风", "雨", "雪", "夜", "月", "太阳", "灯", "灯影", "影子", "时间", "城市", "街道", "钟声",
  "门", "窗", "海", "河", "山", "雾", "云", "黑暗", "光", "回忆", "雨味", "水声",
] as const;
const HUMAN_VERBS = [
  "笑", "哭", "叹", "低语", "呼吸", "凝视", "拥抱", "咬", "咽", "颤抖", "沉默", "诉说",
  "嘲笑", "撒谎", "发怒", "呻吟", "踱步", "抓", "推", "喊", "吼", "喘", "颤", "贴", "照",
] as const;
const PERSONIFICATION_RE = new RegExp(
  `(?:${INANIMATE_NOUNS.map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})[^。！？!?，,\\n]{0,8}(?:${HUMAN_VERBS.map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})`,
  "gu",
);
const SENSORY_CHANNEL_KEYWORDS = {
  visual: ["亮", "暗", "光", "影", "颜色", "白", "黑", "灰", "看", "望", "刺眼", "发白"],
  auditory: ["声音", "水声", "风声", "喊", "叫", "吼", "响", "寂静", "喧哗", "低语", "喘气", "犬吠"],
  olfactory: ["气味", "香", "腥", "臭", "焦味", "雨味", "烟味"],
  gustatory: ["甜", "苦", "酸", "咸", "涩", "味", "发涩"],
  tactile: ["冷", "热", "暖", "寒", "刺", "硬", "软", "疼", "麻", "湿", "干", "发颤"],
  kinesthetic: ["跑", "走", "冲", "跌", "抬", "推", "拉", "挤", "站", "转身", "侧身", "跃"],
} as const;
const ALL_SENSORY_KEYWORDS = Object.values(SENSORY_CHANNEL_KEYWORDS).flat();

type SensoryChannelKey = keyof typeof SENSORY_CHANNEL_KEYWORDS;

type RuntimeRhetoricSensoryUsage = {
  totalWords: number;
  simileCount: number;
  simileDensityPerThousand: number;
  personificationCount: number;
  personificationDensityPerThousand: number;
  rhetoricalQuestionCount: number;
  sensoryHitTotal: number;
  sensoryDensityPerThousand: number;
  sensoryChannelCounts: Record<SensoryChannelKey, number>;
  primaryChannelHits: number;
  primaryChannelCount: number;
};

function splitParagraphs(input: string) {
  return input
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitSentences(input: string) {
  return input
    .split(SENTENCE_END)
    .map((item) => item.trim())
    .filter(Boolean);
}

function looksLikeDialogue(input: string) {
  return DIALOGUE_START.test(input.trim());
}

function includesAny(input: string, markers: string[]) {
  return markers.some((marker) => marker && input.includes(marker));
}

function countMarkerHits(input: string, markers: string[]) {
  return markers.reduce((sum, marker) => {
    if (!marker) {
      return sum;
    }
    return sum + Math.max(0, input.split(marker).length - 1);
  }, 0);
}

function countSimiles(input: string) {
  return (input.match(/像(?=[^。！？!?…\n]{1,24}[，。！？!?…])/gu)?.length ?? 0)
    + (input.match(/仿佛|如同|宛如|似乎/gu)?.length ?? 0);
}

function countKeywordHits(input: string, keywords: readonly string[]) {
  return keywords.reduce((total, keyword) => {
    if (!keyword) {
      return total;
    }
    return total + (input.match(new RegExp(escapeRegExp(keyword), "gu"))?.length ?? 0);
  }, 0);
}

function perThousand(hits: number, totalWords: number) {
  return totalWords > 0 ? (hits / totalWords) * 1000 : 0;
}

function normalizeSensoryChannel(raw: string): SensoryChannelKey[] {
  const token = raw.trim().toLowerCase();
  if (!token) {
    return [];
  }
  if (/visual|vision|视觉|视线|看|光影|画面/u.test(token)) {
    return ["visual"];
  }
  if (/auditory|audio|听觉|听感|声音|听/u.test(token)) {
    return ["auditory"];
  }
  if (/olfactory|smell|嗅觉|气味|闻/u.test(token)) {
    return ["olfactory"];
  }
  if (/gustatory|taste|味觉|味道|尝/u.test(token)) {
    return ["gustatory"];
  }
  if (/tactile|touch|触觉|触感|体感/u.test(token)) {
    return ["tactile"];
  }
  if (/kinesthetic|movement|动觉|动作|位移/u.test(token)) {
    return ["kinesthetic"];
  }
  return [];
}

function resolvePrimarySensoryChannels(channels: string[]) {
  return [...new Set(channels.flatMap((channel) => normalizeSensoryChannel(channel)))];
}

function computeSensoryChannelCounts(input: string): Record<SensoryChannelKey, number> {
  return {
    visual: countKeywordHits(input, SENSORY_CHANNEL_KEYWORDS.visual),
    auditory: countKeywordHits(input, SENSORY_CHANNEL_KEYWORDS.auditory),
    olfactory: countKeywordHits(input, SENSORY_CHANNEL_KEYWORDS.olfactory),
    gustatory: countKeywordHits(input, SENSORY_CHANNEL_KEYWORDS.gustatory),
    tactile: countKeywordHits(input, SENSORY_CHANNEL_KEYWORDS.tactile),
    kinesthetic: countKeywordHits(input, SENSORY_CHANNEL_KEYWORDS.kinesthetic),
  };
}

function measureRuntimeRhetoricSensoryUsage(
  chapterContent: string,
  writingCharter: WritingCharter,
): RuntimeRhetoricSensoryUsage {
  const totalWords = Math.max(1, wordCount(chapterContent));
  const simileCount = countSimiles(chapterContent);
  const personificationCount = chapterContent.match(PERSONIFICATION_RE)?.length ?? 0;
  const rhetoricalQuestionCount = chapterContent.match(RHETORICAL_QUESTION_RE)?.length ?? 0;
  const sensoryChannelCounts = computeSensoryChannelCounts(chapterContent);
  const sensoryHitTotal = sensoryChannelCounts.visual
    + sensoryChannelCounts.auditory
    + sensoryChannelCounts.olfactory
    + sensoryChannelCounts.gustatory
    + sensoryChannelCounts.tactile
    + sensoryChannelCounts.kinesthetic;
  const primaryChannels = resolvePrimarySensoryChannels(writingCharter.sensoryBudget.primaryChannels);
  const primaryChannelHits = primaryChannels.reduce((sum, channel) => sum + sensoryChannelCounts[channel], 0);

  return {
    totalWords,
    simileCount,
    simileDensityPerThousand: perThousand(simileCount, totalWords),
    personificationCount,
    personificationDensityPerThousand: perThousand(personificationCount, totalWords),
    rhetoricalQuestionCount,
    sensoryHitTotal,
    sensoryDensityPerThousand: perThousand(sensoryHitTotal, totalWords),
    sensoryChannelCounts,
    primaryChannelHits,
    primaryChannelCount: primaryChannels.length,
  };
}

function getSentenceLead(sentence: string) {
  const trimmed = sentence.trim().replace(LEADING_PUNCTUATION, "");
  if (!trimmed) {
    return "";
  }
  const pronounLead = PRONOUN_SENTENCE_STARTS.find((pronoun) => trimmed.startsWith(pronoun));
  if (pronounLead) {
    return pronounLead;
  }
  if (trimmed.startsWith("不是")) {
    return "不是";
  }
  if (trimmed.startsWith("像") || trimmed.startsWith("仿佛") || trimmed.startsWith("忽然")) {
    return trimmed.startsWith("仿佛") ? "仿佛" : trimmed.slice(0, 2);
  }
  const hanLead = trimmed.match(HAN_LEAD)?.[0] ?? "";
  if (!hanLead) {
    return "";
  }
  return hanLead.length <= 2 ? hanLead : hanLead.slice(0, 2);
}

function findMaxLeadWindow(input: string, windowSize: number) {
  const leads = splitParagraphs(input)
    .flatMap(splitSentences)
    .filter((sentence) => !looksLikeDialogue(sentence))
    .map((sentence) => getSentenceLead(sentence))
    .filter(Boolean);
  let best = {
    lead: "",
    count: 0,
  };

  for (let index = 0; index < leads.length; index += 1) {
    const bucket = new Map<string, number>();
    for (let offset = index; offset < Math.min(leads.length, index + windowSize); offset += 1) {
      const lead = leads[offset]!;
      const count = (bucket.get(lead) ?? 0) + 1;
      bucket.set(lead, count);
      if (count > best.count) {
        best = { lead, count };
      }
    }
  }

  return best;
}

function mergeChecklistHits(...groups: StyleChecklistHit[][]) {
  const merged: StyleChecklistHit[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const hit of group) {
      const key = `${hit.dimension}::${hit.description}::${hit.severity}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(hit);
    }
  }

  return merged;
}

function mergeBudgetViolations(...groups: Array<WritingCharterBudgetViolation[] | undefined>) {
  const merged: WritingCharterBudgetViolation[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    if (!group) {
      continue;
    }
    for (const violation of group) {
      const key = `${violation.key}::${violation.actual}::${violation.limit}::${violation.detail}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(violation);
    }
  }

  return merged;
}

function pushBudgetViolation(
  bucket: WritingCharterBudgetViolation[],
  input: Omit<WritingCharterBudgetViolation, "label">,
) {
  bucket.push({
    ...input,
    label: WRITING_CHARTER_BUDGET_LABELS[input.key],
  });
}

function collectEvidenceSentences(sentences: string[], predicate: (sentence: string) => boolean, limit = 3) {
  return sentences.filter(predicate).slice(0, limit);
}

function normalizeHanText(input: string) {
  return input.replace(/[^\p{Script=Han}]/gu, "");
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function looksLikeActorLeadToken(chapterContent: string, token: string) {
  if (!token) {
    return false;
  }

  const pattern = new RegExp(
    `(?:^|[。！？!?…\\n])\\s*[“”"「『‘’()（）《》〈〉【】\\[\\]\\s—\\-…·]*${escapeRegExp(token)}([\\p{Script=Han}]{1,2})`,
    "gu",
  );
  let total = 0;
  let actorLike = 0;
  let match = pattern.exec(chapterContent);

  while (match) {
    total += 1;
    const follower = match[1] ?? "";
    if (ACTOR_LEAD_FOLLOWERS.some((marker) => follower.startsWith(marker))) {
      actorLike += 1;
    }
    match = pattern.exec(chapterContent);
  }

  return total > 0 && actorLike >= Math.ceil(total / 2);
}

function extractMotifTokens(input: string, minLength: number, stopwords: Set<string>) {
  const normalized = normalizeHanText(input);
  const tokens = new Set<string>();
  const maxLength = Math.min(4, Math.max(minLength, 4));

  for (let length = minLength; length <= maxLength; length += 1) {
    for (let index = 0; index <= normalized.length - length; index += 1) {
      const token = normalized.slice(index, index + length);
      if (!token || stopwords.has(token) || Array.from(stopwords).some((stopword) => token.includes(stopword))) {
        continue;
      }
      if (new Set(token).size <= 1) {
        continue;
      }
      tokens.add(token);
    }
  }

  return [...tokens];
}

function parseCharterStopwords(raw: string[]): string[] {
  const extracted: string[] = [];
  for (const entry of raw) {
    const quoted = entry.matchAll(/["'\u201c\u201d\u300c\u300d\u300e\u300f]([^"'\u201c\u201d\u300c\u300d\u300e\u300f]+)["'\u201c\u201d\u300c\u300d\u300e\u300f]/gu);
    let matchedQuoted = false;
    for (const match of quoted) {
      matchedQuoted = true;
      const inner = (match[1] ?? "").trim();
      if (inner) {
        extracted.push(inner);
      }
    }
    if (!matchedQuoted) {
      if (entry.length <= 4 && /^[\p{Script=Han}]+$/u.test(entry)) {
        extracted.push(entry);
      } else {
        const compact = entry.replace(/不要统计|不统计|忽略|排除|别算/gu, "").trim();
        if (compact.length <= 4 && /^[\p{Script=Han}]+$/u.test(compact)) {
          extracted.push(compact);
        }
      }
    }
  }
  return extracted;
}

function shouldIgnoreMotifToken(
  chapterContent: string,
  token: string,
  ignoredTokens: Set<string>,
) {
  if (!token) {
    return true;
  }
  if (ignoredTokens.has(token)) {
    return true;
  }
  if (looksLikeActorLeadToken(chapterContent, token)) {
    return true;
  }
  return false;
}

function findFlaggedMotifs(
  paragraphs: string[],
  writingCharter: WritingCharter,
  chapterContent: string,
  ignoredTokens: string[] = [],
) {
  const stopwords = new Set([
    ...MOTIF_GENERIC_STOPWORDS,
    ...parseCharterStopwords(writingCharter.motifReuseBudget.stopwords),
  ]);
  const ignoredTokenSet = new Set(ignoredTokens);
  const motifMap = new Map<string, { count: number; paragraphIndexes: Set<number> }>();

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const normalized = normalizeHanText(paragraph);
    for (const token of extractMotifTokens(paragraph, writingCharter.motifReuseBudget.minMotifLength, stopwords)) {
      if (shouldIgnoreMotifToken(chapterContent, token, ignoredTokenSet)) {
        continue;
      }
      const count = normalized.split(token).length - 1;
      if (count <= 0) {
        continue;
      }
      const existing = motifMap.get(token) ?? { count: 0, paragraphIndexes: new Set<number>() };
      existing.count += count;
      existing.paragraphIndexes.add(paragraphIndex);
      motifMap.set(token, existing);
    }
  });

  return [...motifMap.entries()]
    .map(([token, value]) => ({
      token,
      count: value.count,
      paragraphSpan: value.paragraphIndexes.size,
    }))
    .filter((entry) =>
      entry.count > writingCharter.motifReuseBudget.maxPerMotif
      && entry.paragraphSpan >= writingCharter.motifReuseBudget.minParagraphSpan
    )
    .sort((left, right) => right.count - left.count || right.paragraphSpan - left.paragraphSpan || left.token.localeCompare(right.token, "zh-Hans-CN"))
    .slice(0, 5);
}

const STRUCTURAL_MOTIF_REPEAT_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "survival_goal", pattern: /活着|脱身|保命|逃出|撑住|硬扛/u },
  { id: "repeat_action", pattern: /继续|还是|又一次|照旧|贴墙|后退|夺路|下潜/u },
  { id: "repeat_location", pattern: /断壁|断崖|骨壁|井口|通道|石廊|风井|旧门/u },
  { id: "repeat_pressure", pattern: /追兵|追猎|巡山|妖鹫|罴影|窒息|反咬/u },
];

function classifyMotifReuseSeverity(input: {
  paragraphs: string[];
  flaggedMotifs: Array<{ token: string; count: number; paragraphSpan: number }>;
}): MotifReuseSeverity | null {
  if (!input.flaggedMotifs.length) {
    return null;
  }

  const repeatedCueIds = new Set<string>();
  for (const motif of input.flaggedMotifs) {
    const relatedParagraphs = input.paragraphs.filter((paragraph) => paragraph.includes(motif.token));
    if (relatedParagraphs.length < 2) {
      continue;
    }
    for (const cue of STRUCTURAL_MOTIF_REPEAT_PATTERNS) {
      const hits = relatedParagraphs.filter((paragraph) => cue.pattern.test(paragraph)).length;
      if (hits >= 2) {
        repeatedCueIds.add(cue.id);
      }
    }
  }

  return repeatedCueIds.size >= 2 ? "structural" : "lexical";
}

export function evaluateWritingCharterGate(input: {
  chapterContent: string;
  proseRisk: ProseRisk;
  writingCharter?: WritingCharter | null;
}) {
  const writingCharter = input.writingCharter;
  if (!writingCharter) {
    return {
      shouldBlock: false,
      notes: [] as string[],
      fixInstructions: [] as string[],
      styleChecklistHits: [] as StyleChecklistHit[],
      budgetViolations: [] as WritingCharterBudgetViolation[],
      reuseSeverity: null as MotifReuseSeverity | null,
    };
  }

  const paragraphs = splitParagraphs(input.chapterContent);
  const endingSentences = splitSentences(paragraphs.slice(-2).join("\n"));
  const endingSummarySentenceCount = endingSentences.filter((sentence) =>
    includesAny(sentence, writingCharter.endingPolicy.conclusionMarkers)
  ).length;
  const allSentences = splitSentences(input.chapterContent);
  const mechanismSummarySentenceCount = allSentences.filter((sentence) =>
    includesAny(sentence, writingCharter.mechanismRevealPolicy.mechanismKeywords)
    && (
      includesAny(sentence, writingCharter.mechanismRevealPolicy.explanationMarkers)
      || includesAny(sentence, writingCharter.mechanismRevealPolicy.summaryMarkers)
    )
  ).length;
  const mechanismTriadCount = paragraphs.reduce((sum, paragraph) => {
    const sentences = splitSentences(paragraph);
    let hits = 0;
    for (let index = 0; index <= sentences.length - 3; index += 1) {
      const first = sentences[index]!;
      const second = sentences[index + 1]!;
      const third = sentences[index + 2]!;
      const hasExplain = includesAny(first, writingCharter.mechanismRevealPolicy.explanationMarkers)
        && includesAny(first, writingCharter.mechanismRevealPolicy.mechanismKeywords);
      const hasVerify = includesAny(second, writingCharter.mechanismRevealPolicy.verificationMarkers);
      const hasSummary = includesAny(third, writingCharter.mechanismRevealPolicy.summaryMarkers);
      if (hasExplain && hasVerify && hasSummary) {
        hits += 1;
      }
    }
    return sum + hits;
  }, 0);
  const hardTransitionCount = countMarkerHits(
    input.chapterContent,
    writingCharter.transitionBudget.hardTransitionMarkers,
  );
  const maxSimilesPerParagraph = paragraphs.reduce(
    (max, paragraph) => Math.max(max, countSimiles(paragraph)),
    0,
  );
  const maxLeadWindow = findMaxLeadWindow(
    input.chapterContent,
    writingCharter.subjectLeadBudget.windowSize,
  );
  const ignoredMotifs = input.proseRisk.dominantLead?.lead
    ? [input.proseRisk.dominantLead.lead]
    : [];
  const flaggedMotifs = findFlaggedMotifs(paragraphs, writingCharter, input.chapterContent, ignoredMotifs);
  const reuseSeverity = classifyMotifReuseSeverity({ paragraphs, flaggedMotifs });
  const runtimeUsage = measureRuntimeRhetoricSensoryUsage(input.chapterContent, writingCharter);
  const personificationSentencePattern = new RegExp(PERSONIFICATION_RE.source, "u");
  const rhetoricalQuestionSentencePattern = new RegExp(RHETORICAL_QUESTION_RE.source, "u");

  const notes: string[] = [];
  const fixInstructions: string[] = [];
  const styleChecklistHits: StyleChecklistHit[] = [];
  const budgetViolations: WritingCharterBudgetViolation[] = [];

  if (endingSummarySentenceCount > writingCharter.endingPolicy.maxConclusionSentences) {
    notes.push(`章末结论句超预算（${endingSummarySentenceCount}/${writingCharter.endingPolicy.maxConclusionSentences}）`);
    fixInstructions.push(`章末结论句压到 ${writingCharter.endingPolicy.maxConclusionSentences} 句以内，删掉“${writingCharter.endingPolicy.conclusionMarkers.slice(0, 3).join(" / ")}”这类回钉句，只保留一个新后患或动作尾钩。`);
    styleChecklistHits.push({
      dimension: "章末收束",
      description: "章末结论句和总结标记超出作者习惯卡预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "ending_conclusion_sentence",
      scope: "ending",
      actual: endingSummarySentenceCount,
      limit: writingCharter.endingPolicy.maxConclusionSentences,
      detail: "章末结论句和总结标记超出预算。",
      evidence: collectEvidenceSentences(endingSentences, (sentence) =>
        includesAny(sentence, writingCharter.endingPolicy.conclusionMarkers)
      ),
      severity: "major",
    });
  }

  if (mechanismSummarySentenceCount > writingCharter.mechanismRevealPolicy.maxExplicitSummarySentences) {
    notes.push(`机制显性总结句超预算（${mechanismSummarySentenceCount}/${writingCharter.mechanismRevealPolicy.maxExplicitSummarySentences}）`);
    fixInstructions.push(`机制类信息显性总结句压到 ${writingCharter.mechanismRevealPolicy.maxExplicitSummarySentences} 句以内，先写异动、代价和动作结果，再补最少必要辨认。`);
    styleChecklistHits.push({
      dimension: "机制露出",
      description: "机制类信息写成了先解释后兑现的总结句。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "mechanism_explicit_summary",
      scope: "mechanism",
      actual: mechanismSummarySentenceCount,
      limit: writingCharter.mechanismRevealPolicy.maxExplicitSummarySentences,
      detail: "机制类信息出现过多显性总结句。",
      evidence: collectEvidenceSentences(allSentences, (sentence) =>
        includesAny(sentence, writingCharter.mechanismRevealPolicy.mechanismKeywords)
        && (
          includesAny(sentence, writingCharter.mechanismRevealPolicy.explanationMarkers)
          || includesAny(sentence, writingCharter.mechanismRevealPolicy.summaryMarkers)
        )
      ),
      severity: "major",
    });
  }

  if (mechanismTriadCount > writingCharter.mechanismRevealPolicy.maxTriadPatterns) {
    notes.push(`机制“解释 -> 验证 -> 总结”三段式超预算（${mechanismTriadCount}/${writingCharter.mechanismRevealPolicy.maxTriadPatterns}）`);
    fixInstructions.push(`拆掉“解释 -> 验证 -> 总结”三段式，别让角色先讲机制再验证再回收结论，把机制说明打散进遭遇和反噬。`);
    styleChecklistHits.push({
      dimension: "机制露出",
      description: "出现了解释 -> 验证 -> 总结式的机制复述。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "mechanism_triad_pattern",
      scope: "mechanism",
      actual: mechanismTriadCount,
      limit: writingCharter.mechanismRevealPolicy.maxTriadPatterns,
      detail: "出现了解释 -> 验证 -> 总结式的机制复述。",
      evidence: paragraphs.filter((paragraph) => {
        const sentences = splitSentences(paragraph);
        for (let index = 0; index <= sentences.length - 3; index += 1) {
          const first = sentences[index]!;
          const second = sentences[index + 1]!;
          const third = sentences[index + 2]!;
          const hasExplain = includesAny(first, writingCharter.mechanismRevealPolicy.explanationMarkers)
            && includesAny(first, writingCharter.mechanismRevealPolicy.mechanismKeywords);
          const hasVerify = includesAny(second, writingCharter.mechanismRevealPolicy.verificationMarkers);
          const hasSummary = includesAny(third, writingCharter.mechanismRevealPolicy.summaryMarkers);
          if (hasExplain && hasVerify && hasSummary) {
            return true;
          }
        }
        return false;
      }).slice(0, 2),
      severity: "major",
    });
  }

  if (input.proseRisk.contrastTemplateCount > writingCharter.transitionBudget.maxContrastTemplates) {
    notes.push(
      `转场模板超预算（不是…而是… ${input.proseRisk.contrastTemplateCount}/${writingCharter.transitionBudget.maxContrastTemplates}）`,
    );
    fixInstructions.push(`转场词预算收紧：把“不是……而是……”“忽然”和硬转词压回预算内，优先改成动作结果、环境异动和视线牵引完成转折。`);
    styleChecklistHits.push({
      dimension: "转场预算",
      description: "转场词、模板转折或忽然类提示词超出预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "transition_contrast_template",
      scope: "transition",
      actual: input.proseRisk.contrastTemplateCount,
      limit: writingCharter.transitionBudget.maxContrastTemplates,
      detail: "“不是……而是……”模板超出转场预算。",
      evidence: input.chapterContent.match(/不是[^。！？!?…\n]{0,30}而是/gu)?.slice(0, 3) ?? [],
      severity: "major",
    });
  }

  if (input.proseRisk.abruptTurnCount > writingCharter.transitionBudget.maxAbruptTurns) {
    notes.push(`忽然类突转超预算（${input.proseRisk.abruptTurnCount}/${writingCharter.transitionBudget.maxAbruptTurns}）`);
    if (!fixInstructions.some((entry) => entry.includes("转场词预算收紧"))) {
      fixInstructions.push(`转场词预算收紧：把“不是……而是……”“忽然”和硬转词压回预算内，优先改成动作结果、环境异动和视线牵引完成转折。`);
    }
    styleChecklistHits.push({
      dimension: "转场预算",
      description: "转场词、模板转折或忽然类提示词超出预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "transition_abrupt_turn",
      scope: "transition",
      actual: input.proseRisk.abruptTurnCount,
      limit: writingCharter.transitionBudget.maxAbruptTurns,
      detail: "忽然类突转提示词超出转场预算。",
      evidence: collectEvidenceSentences(allSentences, (sentence) => sentence.includes("忽然")),
      severity: "major",
    });
  }

  if (hardTransitionCount > writingCharter.transitionBudget.maxHardTransitionMarkers) {
    notes.push(`硬转词超预算（${hardTransitionCount}/${writingCharter.transitionBudget.maxHardTransitionMarkers}）`);
    if (!fixInstructions.some((entry) => entry.includes("转场词预算收紧"))) {
      fixInstructions.push(`转场词预算收紧：把“不是……而是……”“忽然”和硬转词压回预算内，优先改成动作结果、环境异动和视线牵引完成转折。`);
    }
    styleChecklistHits.push({
      dimension: "转场预算",
      description: "转场词、模板转折或忽然类提示词超出预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "transition_hard_marker",
      scope: "transition",
      actual: hardTransitionCount,
      limit: writingCharter.transitionBudget.maxHardTransitionMarkers,
      detail: "硬转词超出转场预算。",
      evidence: writingCharter.transitionBudget.hardTransitionMarkers.filter((marker) => input.chapterContent.includes(marker)).slice(0, 5),
      severity: "major",
    });
  }

  if (input.proseRisk.simileCount > writingCharter.simileBudget.maxPerChapter) {
    notes.push(`比喻超预算（全章 ${input.proseRisk.simileCount}/${writingCharter.simileBudget.maxPerChapter}）`);
    fixInstructions.push(`比喻预算收紧：全章显性比喻压到 ${writingCharter.simileBudget.maxPerChapter} 处以内，单段不超过 ${writingCharter.simileBudget.maxPerParagraph} 处，能直接写动作、触感和结果就别换比喻。`);
    styleChecklistHits.push({
      dimension: "比喻预算",
      description: "显性比喻密度超出作者习惯卡预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "simile_per_chapter",
      scope: "simile",
      actual: input.proseRisk.simileCount,
      limit: writingCharter.simileBudget.maxPerChapter,
      detail: "全章显性比喻超出预算。",
      evidence: collectEvidenceSentences(allSentences, (sentence) => /像|仿佛|如同|宛如|似乎/u.test(sentence)),
      severity: "major",
    });
  }

  if (maxSimilesPerParagraph > writingCharter.simileBudget.maxPerParagraph) {
    notes.push(`比喻超预算（单段 ${maxSimilesPerParagraph}/${writingCharter.simileBudget.maxPerParagraph}）`);
    if (!fixInstructions.some((entry) => entry.includes("比喻预算收紧"))) {
      fixInstructions.push(`比喻预算收紧：全章显性比喻压到 ${writingCharter.simileBudget.maxPerChapter} 处以内，单段不超过 ${writingCharter.simileBudget.maxPerParagraph} 处，能直接写动作、触感和结果就别换比喻。`);
    }
    styleChecklistHits.push({
      dimension: "比喻预算",
      description: "显性比喻密度超出作者习惯卡预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "simile_per_paragraph",
      scope: "simile",
      actual: maxSimilesPerParagraph,
      limit: writingCharter.simileBudget.maxPerParagraph,
      detail: "单段显性比喻超出预算。",
      evidence: paragraphs.filter((paragraph) => countSimiles(paragraph) > writingCharter.simileBudget.maxPerParagraph).slice(0, 2),
      severity: "major",
    });
  }

  const rhetoricFixInstruction = `修辞预算收紧：比喻密度压到 ${Number(writingCharter.rhetoricBudget.simileDensityPerThousand ?? 0).toFixed(2)}/千字以内，拟人密度压到 ${Number(writingCharter.rhetoricBudget.personificationDensityPerThousand ?? 0).toFixed(2)}/千字以内，反问不超过 ${Math.max(0, Math.round(Number(writingCharter.rhetoricBudget.rhetoricalQuestionPerChapter ?? 0)))} 次/章。`;
  const sensoryFixInstruction = `感官预算对齐：细节密度尽量贴近 ${Number(writingCharter.sensoryBudget.sensoryDetailTargetPerThousand ?? 0).toFixed(2)}/千字，优先命中主通道（${writingCharter.sensoryBudget.primaryChannels.join("、") || "无"}），不要堆砌泛化感官词。`;
  const simileDensityActual = Number(runtimeUsage.simileDensityPerThousand.toFixed(2));
  const simileDensityLimit = Number(Math.max(0, writingCharter.rhetoricBudget.simileDensityPerThousand).toFixed(2));
  const personificationDensityActual = Number(runtimeUsage.personificationDensityPerThousand.toFixed(2));
  const personificationDensityLimit = Number(Math.max(0, writingCharter.rhetoricBudget.personificationDensityPerThousand).toFixed(2));
  const rhetoricalQuestionLimit = Math.max(0, Math.round(Number(writingCharter.rhetoricBudget.rhetoricalQuestionPerChapter ?? 0)));
  const sensoryTarget = Number(Math.max(0, writingCharter.sensoryBudget.sensoryDetailTargetPerThousand).toFixed(2));
  const sensoryDensityActual = Number(runtimeUsage.sensoryDensityPerThousand.toFixed(2));
  const sensoryLowerLimit = Number((sensoryTarget * 0.35).toFixed(2));
  const sensoryUpperLimit = Number((sensoryTarget * 1.6).toFixed(2));
  const sensoryEvidence = collectEvidenceSentences(
    allSentences,
    (sentence) => countKeywordHits(sentence, ALL_SENSORY_KEYWORDS) >= 2,
  );

  if (runtimeUsage.totalWords >= 900 && simileDensityActual > simileDensityLimit) {
    notes.push(`修辞预算超标（比喻密度 ${simileDensityActual}/${simileDensityLimit} 每千字）`);
    if (!fixInstructions.some((entry) => entry.includes("修辞预算收紧"))) {
      fixInstructions.push(rhetoricFixInstruction);
    }
    if (!styleChecklistHits.some((entry) => entry.dimension === "修辞预算" && entry.description === "比喻/拟人/反问等修辞密度超出作者习惯卡预算。")) {
      styleChecklistHits.push({
        dimension: "修辞预算",
        description: "比喻/拟人/反问等修辞密度超出作者习惯卡预算。",
        severity: "major",
      });
    }
    pushBudgetViolation(budgetViolations, {
      key: "rhetoric_density",
      scope: "rhetoric",
      actual: simileDensityActual,
      limit: simileDensityLimit,
      detail: "比喻密度超出修辞预算。",
      evidence: collectEvidenceSentences(allSentences, (sentence) => /像|仿佛|如同|宛如|似乎/u.test(sentence)),
      severity: "major",
    });
  }

  if (runtimeUsage.totalWords >= 900 && personificationDensityActual > personificationDensityLimit) {
    notes.push(`修辞预算超标（拟人密度 ${personificationDensityActual}/${personificationDensityLimit} 每千字）`);
    if (!fixInstructions.some((entry) => entry.includes("修辞预算收紧"))) {
      fixInstructions.push(rhetoricFixInstruction);
    }
    if (!styleChecklistHits.some((entry) => entry.dimension === "修辞预算" && entry.description === "比喻/拟人/反问等修辞密度超出作者习惯卡预算。")) {
      styleChecklistHits.push({
        dimension: "修辞预算",
        description: "比喻/拟人/反问等修辞密度超出作者习惯卡预算。",
        severity: "major",
      });
    }
    pushBudgetViolation(budgetViolations, {
      key: "rhetoric_density",
      scope: "rhetoric",
      actual: personificationDensityActual,
      limit: personificationDensityLimit,
      detail: "拟人密度超出修辞预算。",
      evidence: collectEvidenceSentences(allSentences, (sentence) => personificationSentencePattern.test(sentence)),
      severity: "major",
    });
  }

  if (runtimeUsage.totalWords >= 900 && runtimeUsage.rhetoricalQuestionCount > rhetoricalQuestionLimit) {
    notes.push(`修辞预算超标（反问 ${runtimeUsage.rhetoricalQuestionCount}/${rhetoricalQuestionLimit}）`);
    if (!fixInstructions.some((entry) => entry.includes("修辞预算收紧"))) {
      fixInstructions.push(rhetoricFixInstruction);
    }
    if (!styleChecklistHits.some((entry) => entry.dimension === "修辞预算" && entry.description === "比喻/拟人/反问等修辞密度超出作者习惯卡预算。")) {
      styleChecklistHits.push({
        dimension: "修辞预算",
        description: "比喻/拟人/反问等修辞密度超出作者习惯卡预算。",
        severity: "major",
      });
    }
    pushBudgetViolation(budgetViolations, {
      key: "rhetoric_density",
      scope: "rhetoric",
      actual: runtimeUsage.rhetoricalQuestionCount,
      limit: rhetoricalQuestionLimit,
      detail: "反问句超出修辞预算。",
      evidence: collectEvidenceSentences(allSentences, (sentence) => rhetoricalQuestionSentencePattern.test(sentence)),
      severity: "major",
    });
  }

  if (sensoryTarget > 0 && runtimeUsage.totalWords >= 900 && sensoryDensityActual > sensoryUpperLimit) {
    notes.push(`感官预算偏高（细节密度 ${sensoryDensityActual}/${sensoryUpperLimit} 每千字）`);
    if (!fixInstructions.some((entry) => entry.includes("感官预算对齐"))) {
      fixInstructions.push(sensoryFixInstruction);
    }
    if (!styleChecklistHits.some((entry) => entry.dimension === "感官预算" && entry.description === "感官细节密度或主通道命中偏离作者习惯卡预算。")) {
      styleChecklistHits.push({
        dimension: "感官预算",
        description: "感官细节密度或主通道命中偏离作者习惯卡预算。",
        severity: "major",
      });
    }
    pushBudgetViolation(budgetViolations, {
      key: "sensory_density",
      scope: "sensory",
      actual: sensoryDensityActual,
      limit: sensoryUpperLimit,
      detail: "感官细节密度显著高于预算目标带宽。",
      evidence: sensoryEvidence,
      severity: "major",
    });
  }

  if (sensoryTarget > 0 && runtimeUsage.totalWords >= 900 && sensoryDensityActual < sensoryLowerLimit) {
    notes.push(`感官预算偏低（细节密度 ${sensoryDensityActual}/${sensoryLowerLimit} 每千字）`);
    if (!fixInstructions.some((entry) => entry.includes("感官预算对齐"))) {
      fixInstructions.push(sensoryFixInstruction);
    }
    if (!styleChecklistHits.some((entry) => entry.dimension === "感官预算" && entry.description === "感官细节密度或主通道命中偏离作者习惯卡预算。")) {
      styleChecklistHits.push({
        dimension: "感官预算",
        description: "感官细节密度或主通道命中偏离作者习惯卡预算。",
        severity: "major",
      });
    }
    pushBudgetViolation(budgetViolations, {
      key: "sensory_density",
      scope: "sensory",
      actual: sensoryDensityActual,
      limit: sensoryLowerLimit,
      detail: "感官细节密度显著低于预算目标带宽。",
      evidence: writingCharter.sensoryBudget.primaryChannels.slice(0, 4),
      severity: "major",
    });
  }

  if (runtimeUsage.primaryChannelCount > 0 && runtimeUsage.totalWords >= 900 && runtimeUsage.primaryChannelHits === 0) {
    notes.push(`感官预算偏离（主通道未命中：${writingCharter.sensoryBudget.primaryChannels.join("、")}）`);
    if (!fixInstructions.some((entry) => entry.includes("感官预算对齐"))) {
      fixInstructions.push(sensoryFixInstruction);
    }
    if (!styleChecklistHits.some((entry) => entry.dimension === "感官预算" && entry.description === "感官细节密度或主通道命中偏离作者习惯卡预算。")) {
      styleChecklistHits.push({
        dimension: "感官预算",
        description: "感官细节密度或主通道命中偏离作者习惯卡预算。",
        severity: "major",
      });
    }
    pushBudgetViolation(budgetViolations, {
      key: "sensory_density",
      scope: "sensory",
      actual: runtimeUsage.primaryChannelHits,
      limit: 1,
      detail: "主感官通道未被有效调用。",
      evidence: writingCharter.sensoryBudget.primaryChannels.slice(0, 4),
      severity: "major",
    });
  }

  if (input.proseRisk.pronounLeadCount > writingCharter.subjectLeadBudget.maxPronounLeads) {
    notes.push(`句首主体超预算（代词 ${input.proseRisk.pronounLeadCount}/${writingCharter.subjectLeadBudget.maxPronounLeads}）`);
    fixInstructions.push(`句首主体预算收紧：代词起句压到 ${writingCharter.subjectLeadBudget.maxPronounLeads} 次以内；同一主体句首压到 ${writingCharter.subjectLeadBudget.maxDominantLeadCount} 次以内；${writingCharter.subjectLeadBudget.windowSize} 句窗口里同句首不超过 ${writingCharter.subjectLeadBudget.maxSameLeadInWindow} 次。`);
    styleChecklistHits.push({
      dimension: "句首主体预算",
      description: "代词起句或同一主体连排起句超出预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "subject_pronoun_lead",
      scope: "subject_lead",
      actual: input.proseRisk.pronounLeadCount,
      limit: writingCharter.subjectLeadBudget.maxPronounLeads,
      detail: "代词起句超出预算。",
      evidence: PRONOUN_SENTENCE_STARTS.filter((lead) => input.chapterContent.includes(lead)).slice(0, 4),
      severity: "major",
    });
  }

  if ((input.proseRisk.dominantLead?.count ?? 0) > writingCharter.subjectLeadBudget.maxDominantLeadCount) {
    notes.push(`句首主体超预算（单主体 ${(input.proseRisk.dominantLead?.count ?? 0)}/${writingCharter.subjectLeadBudget.maxDominantLeadCount}）`);
    if (!fixInstructions.some((entry) => entry.includes("句首主体预算收紧"))) {
      fixInstructions.push(`句首主体预算收紧：代词起句压到 ${writingCharter.subjectLeadBudget.maxPronounLeads} 次以内；同一主体句首压到 ${writingCharter.subjectLeadBudget.maxDominantLeadCount} 次以内；${writingCharter.subjectLeadBudget.windowSize} 句窗口里同句首不超过 ${writingCharter.subjectLeadBudget.maxSameLeadInWindow} 次。`);
    }
    styleChecklistHits.push({
      dimension: "句首主体预算",
      description: "代词起句或同一主体连排起句超出预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "subject_dominant_lead",
      scope: "subject_lead",
      actual: input.proseRisk.dominantLead?.count ?? 0,
      limit: writingCharter.subjectLeadBudget.maxDominantLeadCount,
      detail: "单一主体句首复用超出预算。",
      evidence: input.proseRisk.dominantLead?.lead ? [input.proseRisk.dominantLead.lead] : [],
      severity: "major",
    });
  }

  if (maxLeadWindow.count > writingCharter.subjectLeadBudget.maxSameLeadInWindow) {
    notes.push(`句首主体超预算（窗口 ${maxLeadWindow.count}/${writingCharter.subjectLeadBudget.maxSameLeadInWindow}）`);
    if (!fixInstructions.some((entry) => entry.includes("句首主体预算收紧"))) {
      fixInstructions.push(`句首主体预算收紧：代词起句压到 ${writingCharter.subjectLeadBudget.maxPronounLeads} 次以内；同一主体句首压到 ${writingCharter.subjectLeadBudget.maxDominantLeadCount} 次以内；${writingCharter.subjectLeadBudget.windowSize} 句窗口里同句首不超过 ${writingCharter.subjectLeadBudget.maxSameLeadInWindow} 次。`);
    }
    styleChecklistHits.push({
      dimension: "句首主体预算",
      description: "代词起句或同一主体连排起句超出预算。",
      severity: "major",
    });
    pushBudgetViolation(budgetViolations, {
      key: "subject_window_repeat",
      scope: "subject_lead",
      actual: maxLeadWindow.count,
      limit: writingCharter.subjectLeadBudget.maxSameLeadInWindow,
      detail: "固定窗口内同一句首复用超出预算。",
      evidence: maxLeadWindow.lead ? [maxLeadWindow.lead] : [],
      severity: "major",
    });
  }

  if (flaggedMotifs.length > 0) {
    notes.push(`母题复用超预算（${flaggedMotifs.map((entry) => `${entry.token}×${entry.count}`).join("；")}）`);
    fixInstructions.push(`母题复用预算收紧：同一意象/词块尽量不要在一章里反复回钉；若必须复现，也要改成动作结果、场景变化或新的代价，而不是原词原意反复敲回。`);
    styleChecklistHits.push({
      dimension: "母题复用预算",
      description: reuseSeverity === "structural"
        ? "同一意象绑定同场域/同动作/同压迫源反复回钉，已经接近结构重复。"
        : "同一意象或词块在多段里反复回钉，先压回局部 prose 修正层。",
      severity: reuseSeverity === "structural" ? "major" : "minor",
    });
    pushBudgetViolation(budgetViolations, {
      key: "motif_reuse",
      scope: "motif_reuse",
      actual: flaggedMotifs[0]?.count ?? 0,
      limit: writingCharter.motifReuseBudget.maxPerMotif,
      detail: "同一意象或词块跨段反复回钉。",
      evidence: flaggedMotifs.map((entry) => entry.token),
      severity: reuseSeverity === "structural" ? "major" : "minor",
      reuseSeverity,
    });
  }

  return {
    shouldBlock: styleChecklistHits.some((entry) => entry.severity === "major"),
    notes,
    fixInstructions,
    styleChecklistHits,
    budgetViolations,
    reuseSeverity,
  };
}

export function shouldAutoRescueBeforeQuickAudit(input: {
  chapterNo: number;
  retryCount: number;
  proseRisk: ProseRisk;
  quickAudit: Pick<QuickAuditVerdict, "verdict" | "issues">;
}) {
  const maxRetryCount = input.chapterNo <= 3 ? 3 : 2;
  if (input.quickAudit.verdict !== "escalate") {
    return false;
  }
  if (input.retryCount >= maxRetryCount) {
    return false;
  }

  const hasMajorNonStyleIssue = input.quickAudit.issues.some((issue) =>
    issue.severity === "major" && issue.type !== "style_drift"
  );
  if (hasMajorNonStyleIssue) {
    return false;
  }

  const hasMajorStyleIssue = input.quickAudit.issues.some((issue) =>
    issue.severity === "major" && issue.type === "style_drift"
  );

  return hasMajorStyleIssue
    || input.proseRisk.severity === "fail"
    || (input.chapterNo <= 3 && input.proseRisk.severity === "warn" && input.proseRisk.notes.length >= 2);
}

function buildConcreteBudgetRepairSteps(violations: WritingCharterBudgetViolation[]) {
  const steps: string[] = [];

  for (const violation of violations) {
    const overflow = Math.max(0, violation.actual - violation.limit);
    if (overflow <= 0) {
      continue;
    }
    if (violation.key === "transition_contrast_template") {
      steps.push(`当前“不是……而是……”有 ${violation.actual}/${violation.limit} 处，至少删改 ${overflow} 处；改成动作结果或危险本身带动转折。`);
      continue;
    }
    if (violation.key === "transition_abrupt_turn" || violation.key === "transition_hard_marker") {
      steps.push(`当前硬转提示词有 ${violation.actual}/${violation.limit} 处，至少删改 ${overflow} 处；优先删“忽然/下一刻/骤然/偏偏”，不要只换成别的提示词。`);
      continue;
    }
    if (violation.key === "simile_per_chapter" || violation.key === "simile_per_paragraph") {
      steps.push(`当前显性比喻有 ${violation.actual}/${violation.limit} 处，至少删掉 ${overflow} 处；能直接写动作、触感和结果就直接写，不准把一种比喻换成另一种比喻。`);
      continue;
    }
    if (violation.key === "rhetoric_density") {
      steps.push(`当前修辞预算为 ${violation.actual}/${violation.limit}，至少回收 ${overflow.toFixed(2)} 的超额密度或次数；优先删空转比喻、拟人和反问，改成动作链与后果。`);
      continue;
    }
    if (violation.key === "sensory_density") {
      steps.push(`当前感官预算为 ${violation.actual}/${violation.limit}，至少修正 ${overflow.toFixed(2)}；保留主通道关键触点，删泛化感官词，避免同类感官堆叠。`);
      continue;
    }
    if (violation.key === "subject_pronoun_lead") {
      steps.push(`当前代词起句有 ${violation.actual}/${violation.limit} 处，至少改写 ${overflow} 个句首；优先改成主体名、动作承接、环境异动或自然省略。`);
      continue;
    }
    if (violation.key === "subject_dominant_lead" || violation.key === "subject_window_repeat") {
      const lead = violation.evidence.find(Boolean) ?? "同一主体";
      steps.push(`当前“${lead}”句首复用有 ${violation.actual}/${violation.limit} 处，至少改写 ${overflow} 个句首；把重复句首拆开到环境、身体反馈和动作结果上。`);
      continue;
    }
    if (violation.key === "motif_reuse") {
      const motifs = violation.evidence.slice(0, 4).join(" / ");
      steps.push(`当前母题回钉有 ${violation.actual}/${violation.limit} 次，至少删改 ${overflow} 处；先保留首次出现和真正带来局势变化的那次，其余“${motifs}”尽量改成后果或动作，不要原词原意反复敲回。`);
      continue;
    }
    if (violation.key === "ending_conclusion_sentence") {
      steps.push(`章末结论句当前 ${violation.actual}/${violation.limit} 句，至少删掉 ${overflow} 句；尾段只留一个新风险、新动作或新位置变化。`);
      continue;
    }
    if (violation.key === "mechanism_explicit_summary" || violation.key === "mechanism_triad_pattern") {
      steps.push(`机制说明当前 ${violation.actual}/${violation.limit} 处，至少删改 ${overflow} 处；先写异动、代价和动作结果，再补最短辨认，不要讲成小讲义。`);
    }
  }

  return steps;
}

export function buildAutoProseRescueReview(input: {
  chapterNo: number;
  chapterContent?: string;
  proseRisk: Parameters<typeof buildProseSteeringInstructions>[0];
  writingCharter?: WritingCharter | null;
}): ReviewVerdict {
  const steering = buildProseSteeringInstructions(input.proseRisk);
  const charterGate = input.chapterContent
    ? evaluateWritingCharterGate({
      chapterContent: input.chapterContent,
      proseRisk: input.proseRisk,
      writingCharter: input.writingCharter,
    })
    : {
      shouldBlock: false,
      notes: [] as string[],
      fixInstructions: [] as string[],
      styleChecklistHits: [] as StyleChecklistHit[],
      budgetViolations: [] as WritingCharterBudgetViolation[],
    };
  const rescueSteps: string[] = [];

  if (
    input.proseRisk.dominantLead
    && input.proseRisk.dominantLead.lead.length <= 2
    && input.proseRisk.dominantLead.count >= 5
  ) {
    rescueSteps.push(
      `先逐段处理句首：相邻两句不要重复以“${input.proseRisk.dominantLead.lead}”起头，优先换成环境异动、动作结果、疼痛反馈或视线落点，并把“${input.proseRisk.dominantLead.lead}”句首压到 6 次以内。`,
    );
  }

  if (input.proseRisk.pronounLeadCount >= 5) {
    rescueSteps.push(
      `把“它/他/她”这类代词起句压到 4 次以内；能自然省略主体时就省略，不能省略时改回角色名、动作承接或环境触发。`,
    );
  }

  if (input.proseRisk.simileCount >= 4) {
    rescueSteps.push(
      `再把显性比喻（像/仿佛/如同/宛如/似乎）压到 3 处以内；能直接成立画面就直接写动作、触感和结果，不要只把一种比喻换成另一种比喻。`,
    );
  }

  const fixInstructions = [
    "这轮只做 prose rescue：不改剧情事实、人物关系、世界规则和伏笔结论，只重写句法、段落与叙述重心。",
    ...steering,
    ...charterGate.fixInstructions,
    ...buildConcreteBudgetRepairSteps(charterGate.budgetViolations),
    ...rescueSteps,
    "优先把重复句首、解释腔和空转修辞压下去，再保留原有动作强度与压迫感。",
    "如果问题集中在章末，宁可删掉重复回钉的总结句，也不要把同一后患反复说三遍。",
  ].join("；");
  const runtimeSignals = buildDefaultRuntimeReviewSignals(null);

  return {
    reviewMode: "deep",
    verdict: "rewrite_current",
    confidence: 0.58,
    reason: `第 ${input.chapterNo} 章在 quick audit 前仍有明显 AI 腔，先执行自动 prose rescue。`,
    fixInstructions,
    issues: [
      {
        type: "style_drift",
        location: "正文文笔",
        severity: "major",
      },
    ],
    triggerReasons: ["low_confidence"],
    styleChecklistHits: [
      {
        dimension: "AI味修正",
        description: "当前章存在明显模板句、解释腔或重复句首，需要先执行 prose rescue。",
        severity: "major",
      },
      ...charterGate.styleChecklistHits,
    ],
    charterViolations: charterGate.budgetViolations,
    storyProgression: runtimeSignals.storyProgression,
    genreFulfillment: runtimeSignals.genreFulfillment,
    loopRisk: runtimeSignals.loopRisk,
    primaryDeltaDelivered: runtimeSignals.primaryDeltaDelivered,
    stuckDimensions: runtimeSignals.stuckDimensions,
    windowStartChapter: input.chapterNo,
    windowEndChapter: input.chapterNo,
    earliestAffectedChapter: input.chapterNo,
  };
}

export function enforceLocalProsePassGate(input: {
  chapterNo: number;
  chapterContent?: string;
  writingCharter?: WritingCharter | null;
  review: ReviewVerdict;
  proseRisk: Parameters<typeof buildProseSteeringInstructions>[0];
}) {
  const charterGate = input.chapterContent
    ? evaluateWritingCharterGate({
      chapterContent: input.chapterContent,
      proseRisk: input.proseRisk,
      writingCharter: input.writingCharter,
    })
    : {
      shouldBlock: false,
      notes: [] as string[],
      fixInstructions: [] as string[],
      styleChecklistHits: [] as StyleChecklistHit[],
      budgetViolations: [] as WritingCharterBudgetViolation[],
    };
  const shouldBlockPass = input.proseRisk.severity === "fail"
    || (input.chapterNo <= 3 && input.proseRisk.severity === "warn")
    || (input.proseRisk.severity === "warn" && input.proseRisk.notes.length >= 3)
    || charterGate.shouldBlock;

  if (input.review.verdict !== "pass" || !shouldBlockPass) {
    return input.review;
  }

  const steering = buildProseSteeringInstructions(input.proseRisk);
  const gatedRescue = buildAutoProseRescueReview({
    chapterNo: input.chapterNo,
    chapterContent: input.chapterContent,
    proseRisk: input.proseRisk,
    writingCharter: input.writingCharter,
  });
  const gateNotes = [...input.proseRisk.notes.slice(0, 2), ...charterGate.notes.slice(0, 4)];

  return {
    ...input.review,
    verdict: "rewrite_current",
    confidence: Math.max(input.review.confidence, 0.82),
    reason: `本地 prose gate 未通过：${gateNotes.join("；") || `第 ${input.chapterNo} 章仍有明显模型味`}`,
    fixInstructions: [input.review.fixInstructions, ...steering, ...charterGate.fixInstructions, gatedRescue.fixInstructions]
      .filter(Boolean)
      .join("；"),
    issues: [
      ...input.review.issues,
      ...gatedRescue.issues.filter((issue) =>
        !input.review.issues.some((existing) => existing.type === issue.type && existing.location === issue.location)
      ),
    ],
    triggerReasons: Array.from(new Set([...input.review.triggerReasons, "low_confidence"])),
    styleChecklistHits: mergeChecklistHits(
      input.review.styleChecklistHits,
      charterGate.styleChecklistHits,
      gatedRescue.styleChecklistHits,
    ),
    charterViolations: mergeBudgetViolations(
      input.review.charterViolations,
      charterGate.budgetViolations,
      gatedRescue.charterViolations,
    ),
  } satisfies ReviewVerdict;
}
