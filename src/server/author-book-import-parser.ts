import { createHash } from "node:crypto";
import { wordCount } from "./utils.ts";

const BOOK_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
const BOOK_IMPORT_MAX_CHAPTERS = 3000;
const SHORT_CHAPTER_WORDS = 800;
const LONG_CHAPTER_WORDS = 6000;
const PREVIEW_SUMMARY_LIMIT = 120;

const STRICT_HEADING_PATTERNS = [
  /^第[零一二三四五六七八九十百千万两〇0-9]+[章节回卷集部篇].*$/u,
  /^(?:序章|终章|番外|尾声|后记|楔子|引子)(?:[\s：:—-].*)?$/u,
  /^chapter\s*\d+.*$/iu,
  /^chap\.\s*\d+.*$/iu,
  /^(?:prologue|epilogue|afterword|interlude|preface|introduction)(?:\s+.+)?$/iu,
 ] as const;

const RELAXED_HEADING_PATTERNS = [
  ...STRICT_HEADING_PATTERNS,
  /^\d+\.\s+\S.*$/u,
  /^【\d+】\S.*$/u,
] as const;

const MARKER_HEADING_PATTERN = /^(#{2,6})\s+(.+?)\s*$/u;
const NUMBERED_CHAPTER_HEADING_PATTERN = /^第([零一二三四五六七八九十百千万两〇0-9]+)(?:章|回)/u;

const ENCODING_ORDER = ["utf-8", "utf-8-sig", "gb18030", "gbk", "big5"] as const;
const FRONTMATTER_TITLE_PATTERNS = [
  /^前言$/u,
  /^目录$/u,
  /^章节目录$/u,
  /^内容简介$/u,
  /^作品相关$/u,
] as const;
const FRONTMATTER_CONTENT_PATTERNS = [
  /章节目录/u,
  /新书即将开始/u,
  /版权归作者或出版社/u,
  /啃书小说网/iu,
  /遮天结束时跟大家说/u,
] as const;
const BOOK_IMPORT_NOISE_LINE_PATTERNS = [
  /啃书小说网/iu,
  /版权归作者或出版社/u,
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
] as const;

export interface AuthorBookImportChapterManifest {
  chapterNumber: number;
  title: string;
  summary: string;
  wordCount: number;
  startOffset: number;
  endOffset: number;
}

export interface AuthorBookImportWarning {
  code: string;
  message: string;
  level: "info" | "warning";
}

export interface AuthorBookImportSamplePlan {
  indexes: number[];
  skippedShort: number[];
  total: number;
}

export type ParsePreviewResult =
  | {
      needsEncodingChoice: true;
      encodingCandidates: string[];
    }
  | {
      needsEncodingChoice: false;
      encoding: string;
      parseConfidence: "low" | "medium" | "high";
      parserMode: "heading_strict" | "heading_relaxed" | "marker" | "window_fallback";
      normalizedText: string;
      wordCount: number;
      chapterCount: number;
      warnings: AuthorBookImportWarning[];
      chapters: AuthorBookImportChapterManifest[];
      samplePlan: AuthorBookImportSamplePlan;
      sourceHash: string;
    };

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

function decodeWithEncoding(buffer: Buffer, encoding: string) {
  if (encoding === "utf-8-sig") {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/u, "");
  }
  const decoder = new TextDecoder(encoding as ConstructorParameters<typeof TextDecoder>[0], { fatal: true });
  return decoder.decode(buffer);
}

function detectEncoding(buffer: Buffer) {
  if (buffer.length > BOOK_IMPORT_MAX_BYTES) {
    throw new Error(`拆书导入暂只支持不超过 ${Math.floor(BOOK_IMPORT_MAX_BYTES / 1024 / 1024)}MB 的 TXT 文件。`);
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return {
      encoding: "utf-8-sig",
      parseConfidence: "high" as const,
      text: new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/u, ""),
    };
  }

  try {
    return {
      encoding: "utf-8",
      parseConfidence: "high" as const,
      text: decodeWithEncoding(buffer, "utf-8"),
    };
  } catch {
    // fall through
  }

  const scored = ENCODING_ORDER.slice(2).map((encoding) => {
    const text = new TextDecoder(encoding).decode(buffer);
    return {
      encoding,
      text,
      score: scoreDecodedText(text),
    };
  }).sort((left, right) => right.score - left.score);

  const best = scored[0];
  const second = scored[1];
  if (!best) {
    throw new Error("无法识别 TXT 编码，请手动指定编码后重试。");
  }

  const gap = best.score - (second?.score ?? 0);
  const parseConfidence =
    gap >= 32 && best.score >= 120
      ? "high"
      : gap >= 16 && best.score >= 80
        ? "medium"
        : "low";

  return {
    encoding: best.encoding,
    parseConfidence: parseConfidence as "low" | "medium" | "high",
    text: best.text,
    candidates: scored.map((entry) => entry.encoding),
  };
}

function normalizeLineText(input: string) {
  return input.replace(/\s+/gu, " ").trim();
}

function formatChineseChapterNumber(value: number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;
  const units = ["", "十", "百", "千"] as const;
  const source = String(value);
  let result = "";
  let pendingZero = false;

  for (let index = 0; index < source.length; index += 1) {
    const digit = Number(source[index]);
    const unit = units[source.length - index - 1] ?? "";
    if (digit === 0) {
      pendingZero = Boolean(result) && [...source.slice(index + 1)].some((entry) => entry !== "0");
      continue;
    }
    if (pendingZero) {
      result += "零";
      pendingZero = false;
    }
    result += `${digits[digit]}${unit}`;
  }

  return result.replace(/^一十/u, "十");
}

const CHINESE_CHAPTER_NUMBER_LOOKUP = new Map(
  Array.from({ length: BOOK_IMPORT_MAX_CHAPTERS }, (_, index) => {
    const chapterNo = index + 1;
    return [formatChineseChapterNumber(chapterNo), chapterNo] as const;
  }),
);

function parseHeadingChapterNumber(title: string) {
  const match = normalizeLineText(title).match(NUMBERED_CHAPTER_HEADING_PATTERN);
  const token = match?.[1];
  if (!token) {
    return null;
  }
  if (/^\d+$/u.test(token)) {
    const chapterNo = Number(token);
    return Number.isSafeInteger(chapterNo)
      && chapterNo >= 1
      && chapterNo <= BOOK_IMPORT_MAX_CHAPTERS
      && String(chapterNo) === token
      ? chapterNo
      : null;
  }
  if (/\d/u.test(token)) {
    return null;
  }
  return CHINESE_CHAPTER_NUMBER_LOOKUP.get(token.replace(/两/gu, "二").replace(/〇/gu, "零")) ?? null;
}

function cleanImportedBookText(input: string) {
  const normalized = input
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/```[\s\S]*?```/gu, "\n");

  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\u00a0/gu, " ").trimEnd());

  const cleaned: string[] = [];
  let previousBlank = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (!previousBlank) {
        cleaned.push("");
      }
      previousBlank = true;
      continue;
    }

    if (BOOK_IMPORT_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
      continue;
    }
    if (/^(?:上一[章节页]|下一[章节页]|目录|返回目录|←|→)+$/u.test(trimmed)) {
      continue;
    }

    cleaned.push(trimmed);
    previousBlank = false;
  }

  return cleaned.join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function buildSummary(content: string) {
  const compact = normalizeLineText(content);
  if (compact.length <= PREVIEW_SUMMARY_LIMIT) {
    return compact;
  }
  return `${compact.slice(0, PREVIEW_SUMMARY_LIMIT - 1)}…`;
}

function isFrontMatterSection(input: {
  title: string;
  content: string;
}) {
  const normalizedTitle = normalizeLineText(input.title);
  if (FRONTMATTER_TITLE_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return true;
  }
  const normalizedContent = normalizeLineText(input.content);
  return FRONTMATTER_CONTENT_PATTERNS.some((pattern) => pattern.test(normalizedContent));
}

function trimOffsets(source: string, startOffset: number, endOffset: number) {
  const fragment = source.slice(startOffset, endOffset);
  const trimmedStart = fragment.length - fragment.trimStart().length;
  const trimmedEnd = fragment.length - fragment.trimEnd().length;
  return {
    startOffset: startOffset + trimmedStart,
    endOffset: Math.max(startOffset + trimmedStart, endOffset - trimmedEnd),
  };
}

function buildHeadingChapters(text: string): {
  chapters: AuthorBookImportChapterManifest[];
  mode: "heading_strict" | "heading_relaxed";
} {
  const lines = text.split("\n");
  const lineOffsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineOffsets.push(cursor);
    cursor += line.length + 1;
  }

  const headingEntries = lines
    .map((line, index) => ({ line: normalizeLineText(line), index }))
    .filter((entry) => entry.line && RELAXED_HEADING_PATTERNS.some((pattern) => pattern.test(entry.line)));

  const chapters: AuthorBookImportChapterManifest[] = [];
  if (!headingEntries.length) {
    return {
      chapters,
      mode: "heading_relaxed",
    };
  }

  const mode = headingEntries.every((entry) => STRICT_HEADING_PATTERNS.some((pattern) => pattern.test(entry.line)))
    ? "heading_strict"
    : "heading_relaxed";
  const headingIndexes = headingEntries.map((entry) => entry.index);

  let chapterNumber = 1;
  const firstHeading = headingIndexes[0] ?? 0;
  if (firstHeading > 0) {
    const leading = text.slice(0, lineOffsets[firstHeading]).trim();
    if (leading.length >= 200 && !isFrontMatterSection({ title: "前言", content: leading })) {
      chapters.push({
        chapterNumber,
        title: "前言",
        summary: buildSummary(leading),
        wordCount: wordCount(leading),
        startOffset: 0,
        endOffset: lineOffsets[firstHeading],
      });
      chapterNumber += 1;
    }
  }

  for (let index = 0; index < headingIndexes.length; index += 1) {
    const startLine = headingIndexes[index]!;
    const nextLine = headingIndexes[index + 1];
    const heading = normalizeLineText(lines[startLine] ?? "") || `第${chapterNumber}章`;
    const bodyStart = lineOffsets[startLine] + (lines[startLine]?.length ?? 0) + (startLine < lines.length - 1 ? 1 : 0);
    const rawEnd = nextLine === undefined ? text.length : lineOffsets[nextLine];
    const offsets = trimOffsets(text, bodyStart, rawEnd);
    const content = text.slice(offsets.startOffset, offsets.endOffset).trim();
    if (!content) {
      continue;
    }
    chapters.push({
      chapterNumber,
      title: heading.slice(0, 200),
      summary: buildSummary(content),
      wordCount: wordCount(content),
      startOffset: offsets.startOffset,
      endOffset: offsets.endOffset,
    });
    chapterNumber += 1;
  }

  return { chapters, mode };
}

function buildMarkerChapters(text: string): AuthorBookImportChapterManifest[] {
  const lines = text.split("\n");
  const lineOffsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    lineOffsets.push(cursor);
    cursor += line.length + 1;
  }

  const markerHeadings = lines
    .map((line, index) => {
      const match = line.match(MARKER_HEADING_PATTERN);
      if (!match) {
        return null;
      }
      return {
        index,
        level: match[1]!.length,
        title: normalizeLineText(match[2] ?? ""),
      };
    })
    .filter((entry): entry is { index: number; level: number; title: string } => Boolean(entry));

  if (!markerHeadings.length) {
    return [];
  }

  const levelCounts = new Map<number, number>();
  for (const heading of markerHeadings) {
    if (heading.level <= 1) {
      continue;
    }
    levelCounts.set(heading.level, (levelCounts.get(heading.level) ?? 0) + 1);
  }

  const selectedLevel = [...levelCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0];

  if (!selectedLevel) {
    return [];
  }

  const selectedHeadings = markerHeadings.filter((heading) => heading.level === selectedLevel);
  const chapters: AuthorBookImportChapterManifest[] = [];
  let chapterNumber = 1;

  for (let index = 0; index < selectedHeadings.length; index += 1) {
    const current = selectedHeadings[index]!;
    const next = selectedHeadings[index + 1];
    const bodyStart = lineOffsets[current.index] + (lines[current.index]?.length ?? 0) + (current.index < lines.length - 1 ? 1 : 0);
    const rawEnd = next ? lineOffsets[next.index] : text.length;
    const offsets = trimOffsets(text, bodyStart, rawEnd);
    const content = text.slice(offsets.startOffset, offsets.endOffset).trim();
    if (!content) {
      continue;
    }
    chapters.push({
      chapterNumber,
      title: current.title.slice(0, 200) || `第${chapterNumber}章`,
      summary: buildSummary(content),
      wordCount: wordCount(content),
      startOffset: offsets.startOffset,
      endOffset: offsets.endOffset,
    });
    chapterNumber += 1;
  }

  return chapters;
}

function buildFallbackChapters(text: string): AuthorBookImportChapterManifest[] {
  const chapters: AuthorBookImportChapterManifest[] = [];
  let start = 0;
  let chapterNumber = 1;
  const minWindow = 3000;
  const maxWindow = 5000;
  const boundaryPunctuations = "。！？!?\n";

  while (start < text.length) {
    const idealEnd = Math.min(start + maxWindow, text.length);
    let end = idealEnd;

    if (idealEnd < text.length) {
      const searchFrom = Math.min(start + minWindow, text.length);
      const segment = text.slice(searchFrom, idealEnd);
      const offset = Math.max(...boundaryPunctuations.split("").map((char) => segment.lastIndexOf(char)));
      if (offset >= 0) {
        end = searchFrom + offset + 1;
      }
    }

    const offsets = trimOffsets(text, start, end);
    const content = text.slice(offsets.startOffset, offsets.endOffset).trim();
    if (content) {
      chapters.push({
        chapterNumber,
        title: `第${chapterNumber}章`,
        summary: buildSummary(content),
        wordCount: wordCount(content),
        startOffset: offsets.startOffset,
        endOffset: offsets.endOffset,
      });
      chapterNumber += 1;
    }
    start = Math.max(end, start + 1);
  }

  return chapters;
}

function buildWarnings(chapters: AuthorBookImportChapterManifest[]): AuthorBookImportWarning[] {
  const warnings: AuthorBookImportWarning[] = [];
  const titleCounts = new Map<string, number>();
  const numberedChapterTitles = new Map<number, string[]>();

  chapters.forEach((chapter) => {
    const key = chapter.title.trim();
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
    const headingChapterNo = parseHeadingChapterNumber(key);
    if (headingChapterNo !== null) {
      const titles = numberedChapterTitles.get(headingChapterNo) ?? [];
      titles.push(key);
      numberedChapterTitles.set(headingChapterNo, titles);
    }
  });

  for (const [chapterNo, titles] of numberedChapterTitles) {
    if (titles.length > 1) {
      warnings.push({
        code: "duplicate_chapter_number",
        message: `章节号第${chapterNo}章重复：${titles.map((title) => `《${title}》`).join("、")}。`,
        level: "warning",
      });
    }
  }

  chapters.forEach((chapter, index) => {
    if (chapter.wordCount < SHORT_CHAPTER_WORDS) {
      warnings.push({
        code: "chapter_too_short",
        message: `第${index + 1}章《${chapter.title}》偏短，可能影响采样质量。`,
        level: "warning",
      });
    }
    if (chapter.wordCount > LONG_CHAPTER_WORDS) {
      warnings.push({
        code: "chapter_too_long",
        message: `第${index + 1}章《${chapter.title}》偏长，建议留意拆章是否过粗。`,
        level: "info",
      });
    }
    if ((titleCounts.get(chapter.title.trim()) ?? 0) > 1) {
      warnings.push({
        code: "duplicate_title",
        message: `章节标题《${chapter.title}》重复出现，建议确认是否为卷章混排。`,
        level: "warning",
      });
    }
  });

  return warnings;
}

function selectSampleIndexes(chapters: AuthorBookImportChapterManifest[]): AuthorBookImportSamplePlan {
  const preferred = chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter((entry) => entry.chapter.wordCount >= SHORT_CHAPTER_WORDS)
    .map((entry) => entry.index);
  const skippedShort = chapters
    .map((chapter, index) => ({ chapter, index }))
    .filter((entry) => entry.chapter.wordCount < SHORT_CHAPTER_WORDS)
    .map((entry) => entry.index);
  const source = preferred.length ? preferred : chapters.map((_, index) => index);
  const sourceLength = source.length;
  const longFormPicks = sourceLength >= 300
    ? [
        ...source.slice(0, 3),
        source[Math.floor(sourceLength * 0.2)],
        source[Math.floor(sourceLength * 0.4)],
        source[Math.floor(sourceLength * 0.6)],
        source[Math.floor(sourceLength * 0.8)],
        ...source.slice(Math.max(0, sourceLength - 3)),
      ]
    : [
        ...source.slice(0, 3),
        source[Math.floor(sourceLength / 2)] ?? source[0],
        ...source.slice(Math.max(0, sourceLength - 2)),
      ];
  const picks = longFormPicks.filter((value): value is number => typeof value === "number");

  return {
    indexes: [...new Set(picks)].sort((left, right) => left - right),
    skippedShort,
    total: chapters.length,
  };
}

export function parseAuthorBookImportBuffer(input: {
  buffer: Buffer;
  explicitEncoding?: string;
  sourceHash: string;
}) : ParsePreviewResult {
  const detection = input.explicitEncoding?.trim()
    ? {
        encoding: input.explicitEncoding.trim().toLowerCase(),
        parseConfidence: "high" as const,
        text: decodeWithEncoding(input.buffer, input.explicitEncoding.trim().toLowerCase()),
      }
    : detectEncoding(input.buffer);

  if (!input.explicitEncoding && "candidates" in detection && detection.parseConfidence === "low") {
    return {
      needsEncodingChoice: true,
      encodingCandidates: detection.candidates,
    };
  }

  const normalizedText = cleanImportedBookText(detection.text);
  const markerChapters = buildMarkerChapters(normalizedText);
  const headingResult = markerChapters.length
    ? { chapters: [], mode: "heading_relaxed" as const }
    : buildHeadingChapters(normalizedText);
  const parserMode = markerChapters.length
    ? "marker"
    : headingResult.chapters.length
      ? headingResult.mode
      : "window_fallback";
  const chapters = markerChapters.length
    ? markerChapters
    : headingResult.chapters.length
      ? headingResult.chapters
      : buildFallbackChapters(normalizedText);

  if (!chapters.length) {
    throw new Error("未能从 TXT 中识别出有效正文内容。");
  }

  if (chapters.length > BOOK_IMPORT_MAX_CHAPTERS) {
    throw new Error(`章节数超过 ${BOOK_IMPORT_MAX_CHAPTERS} 章，当前版本暂不支持该体量的拆书预览。`);
  }

  const warnings = buildWarnings(chapters);
  return {
    needsEncodingChoice: false,
    encoding: detection.encoding,
    parseConfidence: detection.parseConfidence,
    parserMode,
    normalizedText,
    wordCount: wordCount(normalizedText),
    chapterCount: chapters.length,
    warnings,
    chapters,
    samplePlan: selectSampleIndexes(chapters),
    sourceHash: input.sourceHash,
  };
}

export function buildSourceHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export const authorBookImportLimits = {
  maxBytes: BOOK_IMPORT_MAX_BYTES,
  maxChapters: BOOK_IMPORT_MAX_CHAPTERS,
  previewTtlMs: 2 * 60 * 60 * 1000,
  shortChapterWords: SHORT_CHAPTER_WORDS,
};
