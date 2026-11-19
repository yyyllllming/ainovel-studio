import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import type {
  StyleConfidence,
  StyleExcerpt,
  StyleExcerptTag,
  StyleReferenceImport,
} from "../types.ts";
import { clamp, wordCount } from "../utils.ts";
import { computeStyleFingerprint, type StyleFingerprint } from "../style-fingerprint.ts";

const ENCODING_ORDER = ["utf-8-sig", "utf-8", "gb18030", "gbk", "big5", "shift_jis"] as const;
const CHAPTER_HEADING_RE =
  /^(?:#{1,6}\s*)?(?:第[零一二三四五六七八九十百千万两0-9]+[章节卷回篇幕][^\n]{0,32}|chapter\s+[0-9ivxlcdm]+[^\n]{0,32}|序章[^\n]{0,24}|终章[^\n]{0,24}|番外[^\n]{0,24}|prologue[^\n]{0,24}|epilogue[^\n]{0,24})$/gimu;
const NOISE_LINE_PATTERNS = [
  /啃书小说网/iu,
  /版权归作者或出版社/u,
  /章节目录/u,
  /^-+\s*章节目录\s*-+$/u,
  /最新网址/iu,
  /请收藏/u,
  /加入书签/u,
  /本章未完/u,
  /点击下一页/u,
  /手机用户请/u,
  /求(?:推荐|收藏|月票|订阅)/u,
  /备用网址/u,
  /广告/u,
  /下载(?:app|APP)/u,
  /阅读模式/u,
  /返回目录/u,
  /作者有话说/u,
  /章节报错/u,
  /纯文字在线阅读/u,
  /最快更新/u,
  /天才一秒记住/u,
  /www\./iu,
  /\.com/iu,
];

interface DecodedImport {
  encoding: (typeof ENCODING_ORDER)[number];
  text: string;
}

export interface ReferenceSection {
  title: string;
  content: string;
  startOffset: number;
  endOffset: number;
}

interface PassageCandidate {
  label: string;
  content: string;
  startOffset: number;
  endOffset: number;
  positionRatio: number;
  dialogueRatio: number;
  wordCount: number;
  tags: StyleExcerptTag[];
}

interface StyleReferenceSamplingContext {
  sourceKind?: "plain_import" | "book_import";
  totalWordCount?: number;
  totalChapterCount?: number;
  sampledChapterCount?: number;
}

export interface PreparedStyleReferenceImport {
  title: string;
  author?: string;
  originalFileName: string;
  mediaType: string;
  sourceHash: string;
  normalizedText: string;
  wordCount: number;
  encoding: string;
  confidence: StyleConfidence;
  chapterCount: number;
  excerpts: StyleExcerpt[];
  fingerprint?: StyleFingerprint;
}

function normalizeMarkdown(line: string) {
  return line
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^>\s?/u, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1");
}

function scoreDecodedText(text: string) {
  const replacementCount = (text.match(/�/gu) ?? []).length;
  const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu) ?? []).length;
  const cjkCount = (text.match(/[\p{Script=Han}]/gu) ?? []).length;
  const punctuationCount = (text.match(/[，。！？；：“”‘’、,.!?;:"'()\[\]\-]/gu) ?? []).length;
  const whitespaceCount = (text.match(/\s/gu) ?? []).length;
  const mojibakeCount = (text.match(/[鈥鍥銆婏紝锛岃€]/gu) ?? []).length;
  const total = Math.max(1, text.length);

  return ((cjkCount * 2) + punctuationCount + whitespaceCount)
    - (replacementCount * 18)
    - (controlCount * 20)
    - (mojibakeCount * 12)
    - (total > 0 && cjkCount === 0 && punctuationCount < 3 ? 10 : 0);
}

export function decodeStyleReferenceBuffer(buffer: Buffer): DecodedImport {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      encoding: "utf-8-sig",
      text: new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/u, ""),
    };
  }

  try {
    return {
      encoding: "utf-8",
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
    };
  } catch {
    // Try the remaining ordered fallbacks and keep the best-scoring decode.
  }

  let best: DecodedImport | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const encoding of ENCODING_ORDER.slice(2)) {
    const decoded = new TextDecoder(encoding).decode(buffer);
    const score = scoreDecodedText(decoded);
    if (score > bestScore) {
      best = {
        encoding,
        text: decoded,
      };
      bestScore = score;
    }
  }

  if (!best) {
    throw new Error("无法解码导入文本");
  }

  return best;
}

export function cleanImportedReferenceText(input: string) {
  const normalized = input
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/```[\s\S]*?```/gu, "\n");

  const lines = normalized
    .split("\n")
    .map((line) => normalizeMarkdown(line).replace(/\u00a0/gu, " ").trimEnd());

  const cleaned: string[] = [];
  let previousBlank = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (!previousBlank) {
        cleaned.push("");
      }
      previousBlank = true;
      continue;
    }

    if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }
    if (/^(?:上一[章节页]|下一[章节页]|目录|返回目录|←|→)+$/u.test(line)) {
      continue;
    }

    cleaned.push(line);
    previousBlank = false;
  }

  return cleaned.join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function splitStyleReferenceSections(text: string): ReferenceSection[] {
  const matches = Array.from(text.matchAll(CHAPTER_HEADING_RE));
  if (!matches.length) {
    return [
      {
        title: "正文片段",
        content: text,
        startOffset: 0,
        endOffset: text.length,
      },
    ];
  }

  const sections: ReferenceSection[] = [];
  const firstStart = matches[0]?.index ?? 0;

  if (firstStart > 240) {
    sections.push({
      title: "导言",
      content: text.slice(0, firstStart).trim(),
      startOffset: 0,
      endOffset: firstStart,
    });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]!;
    const next = matches[index + 1];
    const heading = current[0].trim();
    const start = current.index ?? 0;
    const contentStart = start + current[0].length;
    const end = next?.index ?? text.length;
    const content = text.slice(contentStart, end).trim();
    if (!content) {
      continue;
    }
    sections.push({
      title: heading,
      content,
      startOffset: contentStart,
      endOffset: end,
    });
  }

  return sections.length
    ? sections
    : [
      {
        title: "正文片段",
        content: text,
        startOffset: 0,
        endOffset: text.length,
      },
    ];
}

function splitLongParagraph(paragraph: string) {
  if (paragraph.length <= 360) {
    return [paragraph];
  }

  const sentences = paragraph.match(/[^。！？!?]+[。！？!?]?/gu) ?? [paragraph];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > 320 && current.length >= 160) {
      chunks.push(current.trim());
      current = sentence;
      continue;
    }
    current += sentence;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  if (chunks.length >= 2 && chunks[chunks.length - 1]!.length < 120) {
    chunks[chunks.length - 2] = `${chunks[chunks.length - 2]!}${chunks[chunks.length - 1]!}`;
    chunks.pop();
  }

  return chunks;
}

function extractDialogueRatio(text: string) {
  const dialogueSpans = text.match(/[“「『"][^”」』"]+[”」』"]/gu) ?? [];
  const dialogueChars = dialogueSpans.reduce((sum, span) => sum + span.length, 0);
  return clamp(dialogueChars / Math.max(1, text.length), 0, 1);
}

function splitSentenceLengths(text: string): number[] {
  return text
    .split(/[。！？!?\n]+/u)
    .map((entry) => entry.replace(/[\p{P}\p{S}\s]/gu, "").length)
    .filter((length) => length > 0);
}

function punctuationDensity(text: string, pattern: RegExp): number {
  const hits = (text.match(pattern) ?? []).length;
  const charCount = text.replace(/\s/gu, "").length;
  return charCount > 0 ? (hits / charCount) * 100 : 0;
}

function hasShorteningTrend(sentenceLengths: number[]): boolean {
  if (sentenceLengths.length < 4) {
    return false;
  }
  const mid = Math.floor(sentenceLengths.length / 2);
  const firstHalf = sentenceLengths.slice(0, mid);
  const secondHalf = sentenceLengths.slice(mid);
  const firstAverage = firstHalf.reduce((sum, length) => sum + length, 0) / firstHalf.length;
  const secondAverage = secondHalf.reduce((sum, length) => sum + length, 0) / secondHalf.length;

  if (secondAverage < firstAverage * 0.7) {
    return true;
  }

  if (sentenceLengths.length >= 5) {
    const leadingAverage = (sentenceLengths[0]! + sentenceLengths[1]!) / 2;
    const trailingAverage = (sentenceLengths[sentenceLengths.length - 1]! + sentenceLengths[sentenceLengths.length - 2]!) / 2;
    return trailingAverage < leadingAverage * 0.82;
  }

  return false;
}

function sentenceLengthVariance(sentenceLengths: number[]): number {
  if (sentenceLengths.length < 2) {
    return 0;
  }
  const average = sentenceLengths.reduce((sum, length) => sum + length, 0) / sentenceLengths.length;
  const variance = sentenceLengths.reduce((sum, length) => sum + ((length - average) ** 2), 0) / sentenceLengths.length;
  return Math.sqrt(variance) / Math.max(1, average);
}

function hasUnresolvedEnding(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return false;
  }
  if (/[.…，,；;：:\-—]$/u.test(trimmed)) {
    return true;
  }
  if (/[？?]$/u.test(trimmed)) {
    return true;
  }

  const sentences = trimmed.match(/[^。！？!?]+[。！？!?]?/gu) ?? [];
  if (!sentences.length) {
    return false;
  }
  const lastSentence = sentences[sentences.length - 1]!.trim();
  const previousSentences = sentences.slice(0, -1)
    .map((entry) => entry.replace(/[\p{P}\p{S}\s]/gu, "").length)
    .filter((length) => length > 0);
  const lastLength = lastSentence.replace(/[\p{P}\p{S}\s]/gu, "").length;
  const commaDensity = punctuationDensity(trimmed, /[，,]/gu);
  const periodDensity = punctuationDensity(trimmed, /[。.]/gu);

  if (previousSentences.length >= 2) {
    const previousAverage = previousSentences.reduce((sum, length) => sum + length, 0) / previousSentences.length;
    if (lastLength >= previousAverage * 1.15 && commaDensity >= periodDensity * 0.7) {
      return true;
    }
    if (lastLength <= previousAverage * 0.8 && commaDensity > periodDensity) {
      return true;
    }
  }

  return false;
}

function classifyExcerptTags(text: string, dialogueRatio: number): StyleExcerptTag[] {
  const tags: StyleExcerptTag[] = [];
  const sentenceLengths = splitSentenceLengths(text);
  const averageSentenceLength = sentenceLengths.length
    ? sentenceLengths.reduce((sum, length) => sum + length, 0) / sentenceLengths.length
    : 0;
  const variance = sentenceLengthVariance(sentenceLengths);
  const exclamationDensity = punctuationDensity(text, /[！!]/gu);
  const questionDensity = punctuationDensity(text, /[？?]/gu);
  const ellipsisDensity = punctuationDensity(text, /[…]+|\.{3,}/gu);
  const dashDensity = punctuationDensity(text, /[—-]{2,}/gu);
  const commaDensity = punctuationDensity(text, /[，,]/gu);
  const periodDensity = punctuationDensity(text, /[。.]/gu);
  const shortSentenceRatio = sentenceLengths.length
    ? sentenceLengths.filter((length) => length < 10).length / sentenceLengths.length
    : 0;

  if (dialogueRatio >= 0.18 || /[“「『"][^”」』"]+[”」』"]/u.test(text)) {
    tags.push("dialogue");
  }

  if (
    (variance > 0.52 && ((exclamationDensity + questionDensity) > 0.12 || shortSentenceRatio > 0.22))
    || (shortSentenceRatio > 0.32 && variance > 0.38)
    || (sentenceLengths.length >= 4 && averageSentenceLength < 36 && commaDensity > 5 && dialogueRatio < 0.12)
  ) {
    tags.push("conflict");
  }

  if (
    (ellipsisDensity + dashDensity) > 0.16
    || (variance > 0.4 && averageSentenceLength < 28 && dialogueRatio < 0.5)
    || (sentenceLengths.length >= 4 && averageSentenceLength < 36 && commaDensity > 5 && dialogueRatio < 0.12)
  ) {
    tags.push("emotion");
  }

  if (averageSentenceLength > 20 && commaDensity > 1.1 && dialogueRatio < 0.18 && variance < 0.55) {
    tags.push("mechanism");
  }

  if (
    averageSentenceLength <= 35
    && dialogueRatio < 0.22
    && variance < 0.22
    && periodDensity >= 1.2
    && (exclamationDensity + questionDensity) < 0.2
  ) {
    tags.push("silence");
  }

  if (
    hasShorteningTrend(sentenceLengths)
    || (sentenceLengths.length >= 3 && shortSentenceRatio > 0.24 && variance > 0.44)
    || (sentenceLengths.length >= 4 && averageSentenceLength >= 28 && commaDensity > 5 && dialogueRatio < 0.12)
  ) {
    tags.push("pressure");
  }

  if (hasUnresolvedEnding(text)) {
    tags.push("hook");
  }

  if (!tags.includes("dialogue") || dialogueRatio < 0.7) {
    tags.push("narrative");
  }

  return tags;
}

function createPassageCandidates(sourceTitle: string, text: string, sections: ReferenceSection[]) {
  const candidates: PassageCandidate[] = [];
  let cursor = 0;

  for (const section of sections) {
    const blocks = section.content
      .split(/\n{2,}/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .flatMap((entry) => splitLongParagraph(entry));

    let buffer = "";
    let bufferStart = -1;
    let bufferBlockCount = 0;

    for (const block of blocks) {
      const startOffset = text.indexOf(block, Math.max(cursor, section.startOffset));
      const resolvedStart = startOffset >= 0 ? startOffset : Math.max(cursor, section.startOffset);
      const resolvedEnd = resolvedStart + block.length;
      cursor = resolvedEnd;

      if (!buffer) {
        buffer = block;
        bufferStart = resolvedStart;
        bufferBlockCount = 1;
      } else if (
        bufferBlockCount < 2
        && (buffer.length < 160 || block.length < 110)
        && `${buffer}\n\n${block}`.length <= 360
      ) {
        buffer = `${buffer}\n\n${block}`;
        bufferBlockCount += 1;
      } else {
        const dialogueRatio = extractDialogueRatio(buffer);
        candidates.push({
          label: section.title,
          content: buffer,
          startOffset: bufferStart,
          endOffset: bufferStart + buffer.length,
          positionRatio: clamp((bufferStart + (buffer.length / 2)) / Math.max(1, text.length), 0, 1),
          dialogueRatio,
          wordCount: wordCount(buffer),
          tags: classifyExcerptTags(buffer, dialogueRatio),
        });
        buffer = block;
        bufferStart = resolvedStart;
        bufferBlockCount = 1;
      }
    }

    if (buffer) {
      const dialogueRatio = extractDialogueRatio(buffer);
      candidates.push({
        label: section.title,
        content: buffer,
        startOffset: bufferStart,
        endOffset: bufferStart + buffer.length,
        positionRatio: clamp((bufferStart + (buffer.length / 2)) / Math.max(1, text.length), 0, 1),
        dialogueRatio,
        wordCount: wordCount(buffer),
        tags: classifyExcerptTags(buffer, dialogueRatio),
      });
    }
  }

  return candidates
    .filter((candidate) => candidate.wordCount >= 30 && candidate.content.length >= 60)
    .sort((left, right) => left.startOffset - right.startOffset)
    .map((candidate) => ({
      ...candidate,
      label: candidate.label || sourceTitle,
    }));
}

export function resolveStyleImportConfidence(totalWords: number) {
  if (totalWords < 8_000) {
    return { excerptCount: 8, confidence: "low" as const };
  }
  if (totalWords < 20_000) {
    return { excerptCount: 12, confidence: "low" as const };
  }
  if (totalWords < 50_000) {
    return { excerptCount: 18, confidence: "medium" as const };
  }
  if (totalWords < 120_000) {
    return { excerptCount: 24, confidence: "high" as const };
  }
  return { excerptCount: 30, confidence: "high" as const };
}

function overlapRatio(left: PassageCandidate, right: PassageCandidate) {
  if (left.startOffset >= right.endOffset || right.startOffset >= left.endOffset) {
    return 0;
  }
  const overlap = Math.min(left.endOffset, right.endOffset) - Math.max(left.startOffset, right.startOffset);
  return overlap / Math.max(1, Math.min(left.endOffset - left.startOffset, right.endOffset - right.startOffset));
}

function bucketForRatio(positionRatio: number) {
  if (positionRatio <= 0.2) {
    return "opening";
  }
  if (positionRatio >= 0.8) {
    return "ending";
  }
  return "middle";
}

function scoreCandidate(candidate: PassageCandidate, tag?: StyleExcerptTag) {
  const targetWeight = 280;
  const tagBonus = tag && candidate.tags.includes(tag) ? 26 : 0;
  const dialoguePenalty = candidate.dialogueRatio > 0.85 ? 14 : 0;
  const diversityBonus = candidate.tags.length >= 3 ? 8 : 0;
  const positionBonus = (candidate.positionRatio > 0.1 && candidate.positionRatio < 0.9)
    ? 0
    : (candidate.positionRatio <= 0.05 || candidate.positionRatio >= 0.95 ? 6 : 0);

  return 100
    - Math.abs(candidate.content.length - targetWeight) / 8
    + (candidate.tags.length * 4)
    + tagBonus
    + diversityBonus
    + positionBonus
    - dialoguePenalty;
}

function resolveLabelCap(sectionCount: number, excerptCount: number) {
  if (sectionCount <= excerptCount) {
    return excerptCount;
  }
  return Math.max(2, Math.min(3, Math.ceil(excerptCount / Math.max(1, Math.min(sectionCount, 10)))));
}

function upgradeBookImportConfidence(input: {
  baseConfidence: StyleConfidence;
  excerpts: StyleExcerpt[];
  samplingContext?: StyleReferenceSamplingContext;
}) {
  const samplingContext = input.samplingContext;
  if (!samplingContext || samplingContext.sourceKind !== "book_import") {
    return input.baseConfidence;
  }

  const totalWordCount = samplingContext.totalWordCount ?? 0;
  const totalChapterCount = samplingContext.totalChapterCount ?? 0;
  const sampledChapterCount = samplingContext.sampledChapterCount ?? 0;
  const distinctLabels = new Set(input.excerpts.map((entry) => entry.label)).size;
  const hasMiddleCoverage = input.excerpts.some((entry) => {
    const bucket = bucketForRatio(entry.positionRatio);
    return bucket === "middle";
  });
  const hasLateCoverage = input.excerpts.some((entry) => entry.positionRatio >= 0.65);

  const canUpgradeToHigh =
    totalWordCount >= 500_000
    && totalChapterCount >= 200
    && sampledChapterCount >= 8
    && distinctLabels >= Math.min(6, sampledChapterCount)
    && hasMiddleCoverage
    && hasLateCoverage;

  if (canUpgradeToHigh) {
    return "high" as const;
  }

  return input.baseConfidence;
}

export function sampleStyleExcerpts(sourceId: string, sourceTitle: string, text: string, sections = splitStyleReferenceSections(text)): {
  confidence: StyleConfidence;
  excerpts: StyleExcerpt[];
  chapterCount: number;
} {
  const passages = createPassageCandidates(sourceTitle, text, sections);
  const { excerptCount, confidence } = resolveStyleImportConfidence(wordCount(text));
  const selected: PassageCandidate[] = [];
  let dialogueHeavyCount = 0;
  const labelCap = resolveLabelCap(sections.length, excerptCount);
  const requiredTags = [
    "narrative",
    "dialogue",
    "mechanism",
    "pressure",
    "silence",
    "hook",
    "conflict",
    "emotion",
  ] satisfies StyleExcerptTag[];

  const countByLabel = (pool: PassageCandidate[], label: string) =>
    pool.filter((entry) => entry.label === label).length;

  const canUseAgainst = (
    pool: PassageCandidate[],
    candidate: PassageCandidate,
    options: { allowLabelOverflow?: boolean } = {},
  ) => {
    const maxDialogueHeavy = Math.max(2, Math.round(excerptCount * 0.15));
    if (candidate.dialogueRatio > 0.85 && dialogueHeavyCount >= maxDialogueHeavy) {
      return false;
    }
    if (!options.allowLabelOverflow && countByLabel(pool, candidate.label) >= labelCap) {
      return false;
    }
    return !pool.some((existing) => overlapRatio(existing, candidate) > 0.6);
  };
  const canUse = (candidate: PassageCandidate) => canUseAgainst(selected, candidate);
  const keepsRequiredCoverage = (entries: PassageCandidate[]) =>
    requiredTags.every((tag) =>
      !selected.some((entry) => entry.tags.includes(tag)) || entries.some((entry) => entry.tags.includes(tag)));

  for (const tag of requiredTags) {
    const ranked = passages
      .filter((entry) => entry.tags.includes(tag))
      .sort((left, right) => scoreCandidate(right, tag) - scoreCandidate(left, tag));
    const candidate = ranked.find(canUse)
      ?? ranked.find((entry) => canUseAgainst(selected, entry, { allowLabelOverflow: true }));
    if (!candidate) {
      continue;
    }
    selected.push(candidate);
    if (candidate.dialogueRatio > 0.85) {
      dialogueHeavyCount += 1;
    }
  }

  const quotas = {
    opening: Math.max(1, Math.round(excerptCount * 0.2)),
    middle: Math.max(1, Math.round(excerptCount * 0.5)),
    ending: Math.max(1, Math.round(excerptCount * 0.2)),
  };

  const countByBucket = () => ({
    opening: selected.filter((entry) => bucketForRatio(entry.positionRatio) === "opening").length,
    middle: selected.filter((entry) => bucketForRatio(entry.positionRatio) === "middle").length,
    ending: selected.filter((entry) => bucketForRatio(entry.positionRatio) === "ending").length,
  });

  for (const bucket of ["opening", "middle", "ending"] as const) {
    while (countByBucket()[bucket] < quotas[bucket] && selected.length < excerptCount) {
      const ranked = passages
        .filter((entry) => bucketForRatio(entry.positionRatio) === bucket)
        .sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
      const candidate = ranked.find(canUse)
        ?? ranked.find((entry) => canUseAgainst(selected, entry, { allowLabelOverflow: true }));
      if (!candidate) {
        break;
      }
      selected.push(candidate);
      if (candidate.dialogueRatio > 0.85) {
        dialogueHeavyCount += 1;
      }
    }
  }

  while (selected.length < excerptCount) {
    const ranked = passages
      .sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
    const candidate = ranked.find(canUse)
      ?? ranked.find((entry) => canUseAgainst(selected, entry, { allowLabelOverflow: true }));
    if (!candidate) {
      break;
    }
    selected.push(candidate);
    if (candidate.dialogueRatio > 0.85) {
      dialogueHeavyCount += 1;
    }
  }

  for (const bucket of ["opening", "middle", "ending"] as const) {
    while (countByBucket()[bucket] < quotas[bucket]) {
      const replacement = passages
        .filter((entry) =>
          bucketForRatio(entry.positionRatio) === bucket
          && !selected.some((picked) => picked.startOffset === entry.startOffset && picked.endOffset === entry.endOffset))
        .sort((left, right) => scoreCandidate(right) - scoreCandidate(left))
        .find((candidate) => {
          for (let index = 0; index < selected.length; index += 1) {
            const candidatePool = selected.filter((_, selectedIndex) => selectedIndex !== index);
            const removable = selected[index]!;
            if (bucketForRatio(removable.positionRatio) === bucket) {
              continue;
            }
            if (countByBucket()[bucketForRatio(removable.positionRatio)] <= quotas[bucketForRatio(removable.positionRatio)]) {
              continue;
            }
            if (!keepsRequiredCoverage([...candidatePool, candidate])) {
              continue;
            }
            if (!canUseAgainst(candidatePool, candidate)) {
              continue;
            }
            return true;
          }
          return false;
        });

      if (!replacement) {
        break;
      }

      for (let index = 0; index < selected.length; index += 1) {
        const removable = selected[index]!;
        const candidatePool = selected.filter((_, selectedIndex) => selectedIndex !== index);
        if (bucketForRatio(removable.positionRatio) === bucket) {
          continue;
        }
        if (countByBucket()[bucketForRatio(removable.positionRatio)] <= quotas[bucketForRatio(removable.positionRatio)]) {
          continue;
        }
        if (!keepsRequiredCoverage([...candidatePool, replacement])) {
          continue;
        }
        if (!canUseAgainst(candidatePool, replacement)) {
          continue;
        }
        selected.splice(index, 1, replacement);
        break;
      }
    }
  }

  const excerpts = selected
    .sort((left, right) => left.startOffset - right.startOffset)
    .slice(0, excerptCount)
    .map((candidate) => ({
      id: nanoid(),
      sourceId,
      sourceTitle,
      label: candidate.label,
      tags: candidate.tags,
      content: candidate.content.trim(),
      wordCount: candidate.wordCount,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      positionRatio: candidate.positionRatio,
      dialogueRatio: candidate.dialogueRatio,
    } satisfies StyleExcerpt));

  return {
    confidence,
    excerpts,
    chapterCount: sections.length,
  };
}

export function prepareStyleReferenceImport(input: {
  buffer: Buffer;
  fileName: string;
  mediaType?: string;
  title?: string;
  author?: string;
  samplingContext?: StyleReferenceSamplingContext;
}) {
  const decoded = decodeStyleReferenceBuffer(input.buffer);
  const normalizedText = cleanImportedReferenceText(decoded.text);
  const sourceHash = createHash("sha256").update(input.buffer).digest("hex");
  const fallbackTitle = input.fileName.replace(/\.[^.]+$/u, "").trim() || "reference";
  const sections = splitStyleReferenceSections(normalizedText);
  const sampling = sampleStyleExcerpts(sourceHash, input.title?.trim() || fallbackTitle, normalizedText, sections);
  const fingerprint = computeStyleFingerprint(normalizedText, sections);
  const confidence = upgradeBookImportConfidence({
    baseConfidence: sampling.confidence,
    excerpts: sampling.excerpts,
    samplingContext: input.samplingContext,
  });

  return {
    title: input.title?.trim() || fallbackTitle,
    author: input.author?.trim() || undefined,
    originalFileName: input.fileName,
    mediaType: input.mediaType?.trim() || "text/plain",
    sourceHash,
    normalizedText,
    wordCount: wordCount(normalizedText),
    encoding: decoded.encoding,
    confidence,
    chapterCount: sampling.chapterCount,
    excerpts: sampling.excerpts,
    fingerprint,
  } satisfies PreparedStyleReferenceImport;
}

export function trimExcerptForExemplar(text: string, min = 150, max = 300) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }

  const sliced = normalized.slice(0, max);
  const boundary = Math.max(
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("！"),
    sliced.lastIndexOf("？"),
    sliced.lastIndexOf("”"),
  );

  if (boundary >= min) {
    return sliced.slice(0, boundary + 1).trim();
  }
  return sliced.trim();
}

export function toStyleReferenceImportRecord(
  projectId: string,
  input: PreparedStyleReferenceImport & { id: string; rawFilePath: string; normalizedFilePath: string; createdAt: string },
): StyleReferenceImport {
  return {
    id: input.id,
    projectId,
    title: input.title,
    author: input.author,
    originalFileName: input.originalFileName,
    mediaType: input.mediaType,
    sourceHash: input.sourceHash,
    rawFilePath: input.rawFilePath,
    normalizedFilePath: input.normalizedFilePath,
    wordCount: input.wordCount,
    encoding: input.encoding,
    confidence: input.confidence,
    chapterCount: input.chapterCount,
    excerpts: input.excerpts,
    createdAt: input.createdAt,
  };
}
