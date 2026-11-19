import type { LocalFlavorSignals, WritingCharter } from "../types.ts";

const DIALOGUE_START = /^[“"「『‘—-]/u;
const LATIN_WORD_EDGE = /[\p{Letter}\p{Number}]$/u;
const LATIN_WORD_START = /^[\p{Letter}\p{Number}]/u;
const CHAPTER_HEADING = /^\s*第[0-9一二三四五六七八九十百零〇两]+章[：:、. ]?.*\n+/u;
const SENTENCE_END = /(?<=[。！？!?…])\s*/u;
const LEADING_PUNCTUATION = /^[“”"「『‘’()（）《》〈〉【】\[\]\s—\-…·]+/u;
const SIMILE_MARKER = /仿佛|如同|宛如|似乎|像(?=[^。！？!?…\n]{1,24}[，。！？!?…])/gu;
const PRONOUN_SENTENCE_STARTS = ["它", "他", "她", "它们", "他们", "她们"] as const;
const HAN_LEAD = /^[\p{Script=Han}]{1,4}/u;
const MOMENT_MARKERS = ["这一瞬", "这一息", "这一刻", "这一刹", "这一刹那", "这一霎"] as const;

const STACKED_ADVERBS = ["微微", "缓缓", "轻轻", "淡淡", "静静", "默默", "悄然", "蓦然"] as const;

const FACE_CLICHE_PATTERNS = [
  /眸[中光]?[闪微一]/gu,
  /目光微凝/gu,
  /薄唇微[启抿]/gu,
  /嘴角[勾微上][起扬]/gu,
  /剑眉微蹙/gu,
  /瞳孔[微骤][缩张]/gu,
  /凤眸/gu,
] as const;

const DEFAULT_HARD_TURN_MARKERS = [
  "忽然",
  "骤然",
  "蓦地",
  "下一刻",
  "转眼",
  "与此同时",
  "然而",
  "可是",
  "偏偏",
  "旋即",
] as const;
const EXPLANATION_LEAD_PATTERNS = [
  /^这意味着/u,
  /^这说明/u,
  /^这让[^，。！？!?…\n]{0,10}(意识到|明白)/u,
  /^(他|她|它)(这才)?意识到/u,
  /^(他|她|它)明白/u,
  /^[\p{Script=Han}]{2,4}(这才)?意识到/u,
  /^[\p{Script=Han}]{2,4}明白/u,
] as const;
const JUDGMENT_LEAD_PATTERNS = [
  /^更像是/u,
  /^像是/u,
  /^仿佛是/u,
  /^带着一种/u,
  /^有一种/u,
  /^几乎像是/u,
] as const;
const PHRASE_REUSE_MARKERS = [
  "这一瞬",
  "这一息",
  "这一刻",
  "这意味着",
  "这说明",
  "偏偏",
  "忽然",
  "骤然",
  "下一刻",
  "旋即",
  "一点点",
  "慢慢",
  "没有立刻",
  "更像是",
  "带着一种",
] as const;

function sentenceCount(input: string) {
  return input.match(/[。！？!?…]+/gu)?.length ?? 0;
}

function looksLikeDialogue(input: string) {
  return DIALOGUE_START.test(input.trim());
}

function splitSentences(input: string) {
  return input
    .split(SENTENCE_END)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitParagraphSentences(input: string) {
  return input.match(/[^。！？!?…\n]+[。！？!?…]?/gu)?.map((item) => item.trim()).filter(Boolean) ?? [];
}

function leadingPunctuationParts(sentence: string) {
  const match = sentence.match(LEADING_PUNCTUATION)?.[0] ?? "";
  return {
    prefix: match,
    body: sentence.slice(match.length),
  };
}

function stripSentenceStartToken(sentence: string, token: string) {
  const { prefix, body } = leadingPunctuationParts(sentence.trim());
  if (!body.startsWith(token)) {
    return sentence.trim();
  }
  const stripped = body.slice(token.length).replace(/^[，,、：:；;\s]+/u, "").trimStart();
  return `${prefix}${stripped}`.trim();
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeGuardedSentence(sentence: string) {
  return sentence
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/^[，,、：:；;]+/u, "")
    .trim();
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

function getHardTurnMarkers(charter?: WritingCharter | null) {
  return [...new Set([...(charter?.transitionBudget.hardTransitionMarkers ?? []), ...DEFAULT_HARD_TURN_MARKERS])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function detectMomentMarkerLead(sentence: string) {
  const body = leadingPunctuationParts(sentence).body.trimStart();
  return MOMENT_MARKERS.find((marker) => body.startsWith(marker)) ?? null;
}

function stripMomentLeadPrefix(input: string) {
  const marker = MOMENT_MARKERS.find((candidate) => input.startsWith(candidate)) ?? null;
  if (!marker) {
    return input;
  }
  return input.slice(marker.length).replace(/^[，,、：:；;\s]+/u, "").trimStart();
}

function detectRegexLead(sentence: string, patterns: readonly RegExp[]) {
  const body = stripMomentLeadPrefix(leadingPunctuationParts(sentence).body.trimStart());
  for (const pattern of patterns) {
    const match = body.match(pattern)?.[0] ?? "";
    if (match) {
      return match;
    }
  }
  return null;
}

function countClauseMarkerHits(input: string, markers: readonly string[]) {
  return markers.reduce((total, marker) => {
    const pattern = new RegExp(`(^|[，,；;。！？!?…\\n])\\s*${escapeRegExp(marker)}(?=[，,；;。！？!?…\\s\\p{Script=Han}])`, "gu");
    return total + (input.match(pattern)?.length ?? 0);
  }, 0);
}

function collectPhraseReuseHits(input: string) {
  return PHRASE_REUSE_MARKERS.map((phrase) => ({
    phrase,
    count: input.match(new RegExp(escapeRegExp(phrase), "gu"))?.length ?? 0,
  }))
    .filter((entry) => entry.count >= 3)
    .sort((left, right) => right.count - left.count || left.phrase.localeCompare(right.phrase, "zh-Hans-CN"))
    .slice(0, 6);
}

function trimOverusedClauseMarkers(input: string, markers: readonly string[], usage: Map<string, number>, maxUses = 1) {
  let output = input;
  for (const marker of markers) {
    const pattern = new RegExp(`(^|[，,；;。！？!?…])\\s*${escapeRegExp(marker)}(?=[，,；;。！？!?…\\s\\p{Script=Han}])`, "gu");
    output = output.replace(pattern, (_match, prefix: string) => {
      const next = (usage.get(marker) ?? 0) + 1;
      usage.set(marker, next);
      if (next <= maxUses) {
        return _match;
      }
      return prefix;
    });
  }
  return output;
}

function trimOverusedGenericPhrases(input: string, usage: Map<string, number>, maxUses = 2) {
  let output = input;
  for (const phrase of PHRASE_REUSE_MARKERS) {
    const pattern = new RegExp(escapeRegExp(phrase), "gu");
    output = output.replace(pattern, (match) => {
      const next = (usage.get(phrase) ?? 0) + 1;
      usage.set(phrase, next);
      if (next <= maxUses) {
        return match;
      }
      return "";
    });
  }
  return output;
}

export function inspectProseStyleSignals(input: string, charter?: WritingCharter | null) {
  const text = input.replace(/\r\n?/g, "\n").trim();
  const hardTurnMarkers = getHardTurnMarkers(charter);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const narrativeSentences = paragraphs
    .flatMap(splitSentences)
    .filter((sentence) => !looksLikeDialogue(sentence));
  const momentMarkerCount = narrativeSentences.filter((sentence) => detectMomentMarkerLead(sentence)).length;
  const explanationLeadCount = narrativeSentences.filter((sentence) => detectRegexLead(sentence, EXPLANATION_LEAD_PATTERNS)).length;
  const judgmentLeadCount = narrativeSentences.filter((sentence) => detectRegexLead(sentence, JUDGMENT_LEAD_PATTERNS)).length;
  const repeatedSentenceStarts = Array.from(
    narrativeSentences.reduce((acc, sentence) => {
      const lead = getSentenceLead(sentence);
      if (lead) {
        acc.set(lead, (acc.get(lead) ?? 0) + 1);
      }
      return acc;
    }, new Map<string, number>()),
  )
    .map(([lead, count]) => ({ lead, count }))
    .filter((entry) => entry.count >= 2)
    .sort((left, right) => right.count - left.count || left.lead.localeCompare(right.lead, "zh-Hans-CN"))
    .slice(0, 6);
  const pronounLeadCount = narrativeSentences.filter((sentence) =>
    PRONOUN_SENTENCE_STARTS.some((pronoun) => getSentenceLead(sentence).startsWith(pronoun))
  ).length;
  const sentenceCountValue = narrativeSentences.length;
  const pronounLeadRatio = sentenceCountValue ? pronounLeadCount / sentenceCountValue : 0;
  const simileCount = text.match(SIMILE_MARKER)?.length ?? 0;
  const contrastTemplateCount = text.match(/不是[^。！？!?…\n]{0,30}而是/gu)?.length ?? 0;
  const abruptTurnCount = countClauseMarkerHits(text, hardTurnMarkers);
  const phraseReuseHits = collectPhraseReuseHits(text);

  const stackedAdverbHits = STACKED_ADVERBS.reduce(
    (count, word) => count + (text.match(new RegExp(word, "gu"))?.length ?? 0), 0
  );
  const faceClicheHits = FACE_CLICHE_PATTERNS.reduce(
    (count, pattern) => count + (text.match(new RegExp(pattern.source, pattern.flags))?.length ?? 0), 0
  );

  const warnings: string[] = [];

  if (sentenceCountValue >= 5 && pronounLeadCount >= 3 && pronounLeadRatio >= 0.34) {
    warnings.push("叙述句连续以代词起句，主体锚点偏弱。");
  }
  if (momentMarkerCount >= 2) {
    warnings.push("“这一瞬/这一息”类机械卡点词偏多。");
  }
  if (explanationLeadCount >= 2) {
    warnings.push("解释补句偏直，判断先于动作收束。");
  }
  if (judgmentLeadCount >= 2) {
    warnings.push("“更像是/带着一种”类判断句起手偏多。");
  }
  if (simileCount >= 4 || (sentenceCountValue >= 8 && simileCount >= Math.ceil(sentenceCountValue * 0.22))) {
    warnings.push("“像/仿佛”比喻使用偏密，意象容易空转。");
  }
  if (contrastTemplateCount >= 2) {
    warnings.push("“不是……而是……”模板重复，句法显得模型化。");
  }
  if (abruptTurnCount >= 3) {
    warnings.push("“忽然/骤然/偏偏”类硬转词偏多，转场显得机械。");
  }
  const repeatedLead = repeatedSentenceStarts.find((entry) => entry.count >= 3 && entry.lead.length <= 2);
  if (repeatedLead) {
    warnings.push(`多句反复以“${repeatedLead.lead}”起头，句法变化不足。`);
  }
  if (phraseReuseHits.length > 0) {
    warnings.push(`词块回钉偏多（${phraseReuseHits[0]!.phrase}×${phraseReuseHits[0]!.count}）`);
  }
  if (stackedAdverbHits >= 4) {
    warnings.push(`叠词副词偏密（微微/缓缓/轻轻等共 ${stackedAdverbHits} 处）`);
  }
  if (faceClicheHits >= 2) {
    warnings.push(`眸系/五官套话偏多（${faceClicheHits} 处）`);
  }

  return {
    paragraphCount: paragraphs.length,
    sentenceCount: sentenceCountValue,
    momentMarkerCount,
    explanationLeadCount,
    judgmentLeadCount,
    phraseReuseHits,
    pronounLeadCount,
    pronounLeadRatio,
    simileCount,
    contrastTemplateCount,
    abruptTurnCount,
    stackedAdverbHits,
    faceClicheHits,
    repeatedSentenceStarts,
    warnings,
  };
}

function resolveProseRiskThresholds(charter?: WritingCharter | null) {
  const pronounLimit = charter?.subjectLeadBudget.maxPronounLeads ?? 4;
  const dominantLeadLimit = charter?.subjectLeadBudget.maxDominantLeadCount ?? 6;
  const simileLimit = charter?.simileBudget.maxPerChapter ?? 4;
  const contrastLimit = charter?.transitionBudget.maxContrastTemplates ?? 1;
  const abruptLimit = charter?.transitionBudget.maxAbruptTurns ?? 2;

  return {
    pronounWarnCount: pronounLimit + 1,
    pronounFailCount: Math.max(pronounLimit + 3, pronounLimit * 2),
    pronounWarnRatio: 0.08,
    pronounFailRatio: 0.1,
    simileWarnCount: simileLimit + 1,
    simileFailCount: Math.max(simileLimit + 2, simileLimit * 2),
    simileWarnRatio: 0.12,
    simileFailRatio: 0.12,
    contrastWarnCount: contrastLimit + 1,
    contrastFailCount: Math.max(contrastLimit + 1, contrastLimit * 2),
    abruptWarnCount: abruptLimit + 1,
    abruptFailCount: Math.max(abruptLimit + 2, abruptLimit * 2),
    dominantLeadWarnCount: Math.max(dominantLeadLimit, 1) + 1,
    dominantLeadFailCount: Math.max(dominantLeadLimit + 2, dominantLeadLimit * 2),
    momentMarkerWarnCount: 2,
    momentMarkerFailCount: 4,
    explanationLeadWarnCount: 2,
    explanationLeadFailCount: 3,
    judgmentLeadWarnCount: 2,
    judgmentLeadFailCount: 3,
    phraseReuseWarnCount: 3,
    phraseReuseFailCount: 4,
  };
}

export function assessProseStyleRisk(input: string, charter?: WritingCharter | null) {
  const signals = inspectProseStyleSignals(input, charter);
  const thresholds = resolveProseRiskThresholds(charter);
  const notes: string[] = [];
  const simileRatio = signals.sentenceCount ? signals.simileCount / signals.sentenceCount : 0;
  const dominantLead = signals.repeatedSentenceStarts.find((entry) => entry.lead.length <= 2)
    ?? signals.repeatedSentenceStarts[0]
    ?? null;
  const strongestPhraseReuse = signals.phraseReuseHits[0] ?? null;
  let score = 0;

  if (signals.momentMarkerCount >= thresholds.momentMarkerFailCount) {
    score += 2;
    notes.push(`“这一瞬/这一息”卡点词过密（${signals.momentMarkerCount} 处）`);
  } else if (signals.momentMarkerCount >= thresholds.momentMarkerWarnCount) {
    score += 1;
    notes.push(`“这一瞬/这一息”卡点词偏多（${signals.momentMarkerCount} 处）`);
  }

  if (signals.explanationLeadCount >= thresholds.explanationLeadFailCount) {
    score += 2;
    notes.push(`解释补句偏直（${signals.explanationLeadCount} 处）`);
  } else if (signals.explanationLeadCount >= thresholds.explanationLeadWarnCount) {
    score += 1;
    notes.push(`解释补句开始偏多（${signals.explanationLeadCount} 处）`);
  }

  if (signals.judgmentLeadCount >= thresholds.judgmentLeadFailCount) {
    score += 2;
    notes.push(`文学化判断句过密（${signals.judgmentLeadCount} 处）`);
  } else if (signals.judgmentLeadCount >= thresholds.judgmentLeadWarnCount) {
    score += 1;
    notes.push(`文学化判断句偏多（${signals.judgmentLeadCount} 处）`);
  }

  if (signals.pronounLeadCount >= thresholds.pronounFailCount && signals.pronounLeadRatio >= thresholds.pronounFailRatio) {
    score += 2;
    notes.push(`代词起句偏密（${signals.pronounLeadCount}/${signals.sentenceCount}）`);
  } else if (signals.pronounLeadCount >= thresholds.pronounWarnCount && signals.pronounLeadRatio >= thresholds.pronounWarnRatio) {
    score += 1;
    notes.push(`代词起句开始偏多（${signals.pronounLeadCount}/${signals.sentenceCount}）`);
  }

  if (signals.simileCount >= thresholds.simileFailCount || (signals.sentenceCount >= 18 && simileRatio >= thresholds.simileFailRatio)) {
    score += 2;
    notes.push(`“像/仿佛”比喻过密（${signals.simileCount} 处）`);
  } else if (signals.simileCount >= thresholds.simileWarnCount || (signals.sentenceCount >= 8 && simileRatio >= thresholds.simileWarnRatio)) {
    score += 1;
    notes.push(`“像/仿佛”比喻偏多（${signals.simileCount} 处）`);
  }

  if (signals.contrastTemplateCount >= thresholds.contrastFailCount) {
    score += 2;
    notes.push(`“不是……而是……”模板过密（${signals.contrastTemplateCount} 处）`);
  } else if (signals.contrastTemplateCount >= thresholds.contrastWarnCount) {
    score += 1;
    notes.push(`“不是……而是……”开始重复（${signals.contrastTemplateCount} 处）`);
  }

  if (signals.abruptTurnCount >= thresholds.abruptFailCount) {
    score += 2;
    notes.push(`“忽然/骤然/偏偏”类硬转词过密（${signals.abruptTurnCount} 处）`);
  } else if (signals.abruptTurnCount >= thresholds.abruptWarnCount) {
    score += 1;
    notes.push(`“忽然/骤然/偏偏”类硬转词偏多（${signals.abruptTurnCount} 处）`);
  }

  if (dominantLead && dominantLead.count >= thresholds.dominantLeadFailCount && dominantLead.lead.length <= 2) {
    score += 2;
    notes.push(`句首反复落在“${dominantLead.lead}”（${dominantLead.count} 次）`);
  } else if (dominantLead && dominantLead.count >= thresholds.dominantLeadWarnCount && dominantLead.lead.length <= 2) {
    score += 1;
    notes.push(`句首重复偏多（${dominantLead.lead}×${dominantLead.count}）`);
  }

  if (strongestPhraseReuse && strongestPhraseReuse.count >= thresholds.phraseReuseFailCount) {
    score += 2;
    notes.push(`词块回钉过密（${strongestPhraseReuse.phrase}×${strongestPhraseReuse.count}）`);
  } else if (strongestPhraseReuse && strongestPhraseReuse.count >= thresholds.phraseReuseWarnCount) {
    score += 1;
    notes.push(`词块回钉偏多（${strongestPhraseReuse.phrase}×${strongestPhraseReuse.count}）`);
  }

  if (signals.stackedAdverbHits >= 7) {
    score += 2;
    notes.push(`叠词副词过密（微微/缓缓/轻轻等共 ${signals.stackedAdverbHits} 处）`);
  } else if (signals.stackedAdverbHits >= 4) {
    score += 1;
    notes.push(`叠词副词偏多（微微/缓缓/轻轻等共 ${signals.stackedAdverbHits} 处）`);
  }

  if (signals.faceClicheHits >= 4) {
    score += 2;
    notes.push(`眸系/五官套话过密（${signals.faceClicheHits} 处）`);
  } else if (signals.faceClicheHits >= 2) {
    score += 1;
    notes.push(`眸系/五官套话偏多（${signals.faceClicheHits} 处）`);
  }

  const severity: "ok" | "warn" | "fail" = score >= 4 ? "fail" : score >= 2 ? "warn" : "ok";

  return {
    ...signals,
    dominantLead,
    notes,
    score,
    severity,
    shouldForceDeepReview: severity !== "ok",
    shouldRetryStylePass: severity === "fail" || (severity === "warn" && notes.length >= 2),
  };
}

export function buildLocalFlavorSignals(input: string, charter?: WritingCharter | null): LocalFlavorSignals {
  const assessment = assessProseStyleRisk(input, charter);
  return {
    severity: assessment.severity,
    score: assessment.score,
    notes: assessment.notes,
    warnings: assessment.warnings,
    momentMarkerCount: assessment.momentMarkerCount,
    explanationLeadCount: assessment.explanationLeadCount,
    judgmentLeadCount: assessment.judgmentLeadCount,
    phraseReuseHits: assessment.phraseReuseHits.map((entry) => ({
      phrase: entry.phrase,
      count: entry.count,
    })),
    pronounLeadCount: assessment.pronounLeadCount,
    pronounLeadRatio: assessment.pronounLeadRatio,
    simileCount: assessment.simileCount,
    contrastTemplateCount: assessment.contrastTemplateCount,
    abruptTurnCount: assessment.abruptTurnCount,
    repeatedSentenceStarts: assessment.repeatedSentenceStarts.map((entry) => ({
      lead: entry.lead,
      count: entry.count,
    })),
    dominantLead: assessment.dominantLead
      ? {
        lead: assessment.dominantLead.lead,
        count: assessment.dominantLead.count,
      }
      : null,
    sentenceCount: assessment.sentenceCount,
  };
}

export function applyDeterministicAiFlavorGuard(input: string, charter?: WritingCharter | null) {
  const hardMarkers = getHardTurnMarkers(charter);
  const paragraphs = input
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  let momentMarkerUsed = 0;
  let explanationLeadUsed = 0;
  let judgmentLeadUsed = 0;
  const hardMarkerUsage = new Map<string, number>();
  const phraseUsage = new Map<string, number>();
  const stackedAdverbUsage = new Map<string, number>();
  let faceClicheUsed = 0;

  const guardedParagraphs = paragraphs.map((paragraph) => {
    const sentences = splitParagraphSentences(paragraph);
    const guardedSentences: string[] = [];

    for (const originalSentence of sentences) {
      let sentence = originalSentence.trim();
      if (!sentence) {
        continue;
      }

      if (!looksLikeDialogue(sentence)) {
        const momentLead = detectMomentMarkerLead(sentence);
        if (momentLead) {
          momentMarkerUsed += 1;
          if (momentMarkerUsed > 1) {
            sentence = stripSentenceStartToken(sentence, momentLead);
          }
        }

        const explanationLead = detectRegexLead(sentence, EXPLANATION_LEAD_PATTERNS);
        if (explanationLead) {
          explanationLeadUsed += 1;
          if (explanationLeadUsed > 1) {
            sentence = stripSentenceStartToken(sentence, explanationLead);
          }
        }

        const judgmentLead = detectRegexLead(sentence, JUDGMENT_LEAD_PATTERNS);
        if (judgmentLead) {
          judgmentLeadUsed += 1;
          if (judgmentLeadUsed > 1) {
            sentence = stripSentenceStartToken(sentence, judgmentLead);
          }
        }

        sentence = trimOverusedClauseMarkers(sentence, hardMarkers, hardMarkerUsage, 1);
        sentence = trimOverusedGenericPhrases(sentence, phraseUsage, 2);

        // 叠词副词：全章每个只保留前 3 次
        for (const adverb of STACKED_ADVERBS) {
          const adverbPattern = new RegExp(escapeRegExp(adverb), "gu");
          sentence = sentence.replace(adverbPattern, (match) => {
            const next = (stackedAdverbUsage.get(adverb) ?? 0) + 1;
            stackedAdverbUsage.set(adverb, next);
            return next <= 3 ? match : "";
          });
        }

        // 五官套话：全章只保留前 1 次
        for (const pattern of FACE_CLICHE_PATTERNS) {
          const regex = new RegExp(pattern.source, pattern.flags);
          sentence = sentence.replace(regex, (match) => {
            faceClicheUsed += 1;
            return faceClicheUsed <= 1 ? match : "";
          });
        }
      }

      const normalized = normalizeGuardedSentence(sentence);
      if (normalized) {
        guardedSentences.push(normalized);
      }
    }

    return guardedSentences.join("");
  }).filter(Boolean);

  return guardedParagraphs.join("\n\n").trim();
}

export function applyWritingCharterRegexGuard(input: string, charter?: WritingCharter | null) {
  if (!charter) {
    return input;
  }

  const hardMarkers = [...charter.transitionBudget.hardTransitionMarkers]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  let contrastUsed = 0;
  let abruptUsed = 0;
  let hardMarkerUsed = 0;
  let chapterSimileUsed = 0;
  let pronounLeadUsed = 0;
  const leadCounts = new Map<string, number>();
  const leadWindow: string[] = [];

  const paragraphs = input
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const guardedParagraphs = paragraphs.map((paragraph) => {
    let paragraphSimileUsed = 0;
    const sentences = splitParagraphSentences(paragraph);
    const guardedSentences: string[] = [];

    for (const originalSentence of sentences) {
      let sentence = originalSentence.trim();
      if (!sentence) {
        continue;
      }

      if (!looksLikeDialogue(sentence)) {
        sentence = sentence.replace(/不是[^。！？!?…\n]{0,30}?而是/gu, (match) => {
          if (contrastUsed < charter.transitionBudget.maxContrastTemplates) {
            contrastUsed += 1;
            return match;
          }
          return "";
        });

        const currentAbruptLead = leadingPunctuationParts(sentence).body.startsWith("忽然");
        if (currentAbruptLead) {
          if (abruptUsed < charter.transitionBudget.maxAbruptTurns) {
            abruptUsed += 1;
          } else {
            sentence = stripSentenceStartToken(sentence, "忽然");
          }
        }

        for (const marker of hardMarkers) {
          if (!leadingPunctuationParts(sentence).body.startsWith(marker)) {
            continue;
          }
          if (hardMarkerUsed < charter.transitionBudget.maxHardTransitionMarkers) {
            hardMarkerUsed += 1;
          } else {
            sentence = stripSentenceStartToken(sentence, marker);
          }
          break;
        }

        sentence = sentence.replace(SIMILE_MARKER, (match) => {
          const keepChapter = chapterSimileUsed < charter.simileBudget.maxPerChapter;
          const keepParagraph = paragraphSimileUsed < charter.simileBudget.maxPerParagraph;
          if (keepChapter && keepParagraph) {
            chapterSimileUsed += 1;
            paragraphSimileUsed += 1;
            return match;
          }
          return "";
        });

        let lead = getSentenceLead(sentence);
        while (lead) {
          const leadCount = leadCounts.get(lead) ?? 0;
          const repeatedInWindow = leadWindow.filter((entry) => entry === lead).length;
          const overPronounBudget = PRONOUN_SENTENCE_STARTS.includes(lead as (typeof PRONOUN_SENTENCE_STARTS)[number])
            && pronounLeadUsed >= charter.subjectLeadBudget.maxPronounLeads;
          const overDominantBudget = leadCount >= charter.subjectLeadBudget.maxDominantLeadCount;
          const overWindowBudget = repeatedInWindow >= charter.subjectLeadBudget.maxSameLeadInWindow;
          if (!overPronounBudget && !overDominantBudget && !overWindowBudget) {
            break;
          }
          sentence = stripSentenceStartToken(sentence, lead);
          const normalized = normalizeGuardedSentence(sentence);
          if (!normalized) {
            sentence = "";
            break;
          }
          sentence = normalized;
          lead = getSentenceLead(sentence);
        }

        if (sentence) {
          const finalLead = getSentenceLead(sentence);
          if (finalLead) {
            if (PRONOUN_SENTENCE_STARTS.includes(finalLead as (typeof PRONOUN_SENTENCE_STARTS)[number])) {
              pronounLeadUsed += 1;
            }
            leadCounts.set(finalLead, (leadCounts.get(finalLead) ?? 0) + 1);
            leadWindow.push(finalLead);
            if (leadWindow.length > charter.subjectLeadBudget.windowSize) {
              leadWindow.shift();
            }
          }
        }
      }

      const normalized = normalizeGuardedSentence(sentence);
      if (normalized) {
        guardedSentences.push(normalized);
      }
    }

    return guardedSentences.join("");
  }).filter(Boolean);

  return guardedParagraphs.join("\n\n").trim();
}

function joinParagraphs(left: string, right: string) {
  const needsSpace = LATIN_WORD_EDGE.test(left) && LATIN_WORD_START.test(right);
  return `${left}${needsSpace ? " " : ""}${right}`;
}

function shouldMergeParagraphs(current: string, next: string) {
  if (!current || !next) {
    return false;
  }

  if (looksLikeDialogue(current) || looksLikeDialogue(next)) {
    return false;
  }

  const currentSentenceCount = sentenceCount(current);
  const nextSentenceCount = sentenceCount(next);
  const currentShort = currentSentenceCount <= 1 && current.length <= 70;
  const nextShort = nextSentenceCount <= 1 && next.length <= 70;
  const combinedLength = current.length + next.length;

  return currentShort && nextShort && combinedLength <= 130;
}

export function normalizeGeneratedChapterContent(input: string) {
  let text = input
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();

  if (!text) {
    return "";
  }

  text = text.replace(CHAPTER_HEADING, "");

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return paragraphs[0] ?? "";
  }

  const normalized: string[] = [];

  for (const paragraph of paragraphs) {
    if (!normalized.length) {
      normalized.push(paragraph);
      continue;
    }

    const previous = normalized[normalized.length - 1] ?? "";
    if (shouldMergeParagraphs(previous, paragraph)) {
      normalized[normalized.length - 1] = joinParagraphs(previous, paragraph);
      continue;
    }

    normalized.push(paragraph);
  }

  return normalized.join("\n\n").trim();
}
