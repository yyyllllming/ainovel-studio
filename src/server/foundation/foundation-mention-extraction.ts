import type { CharacterCard } from "../types.ts";

export type FoundationMentionSourceKind = "message" | "draft" | "project_premise";
export type FoundationMentionEntityType = "character" | "world";

export interface RawFoundationMentionCandidate {
  entityType: FoundationMentionEntityType;
  raw: string;
  sourceKind: FoundationMentionSourceKind;
  evidenceSnippet: string;
}

export interface RawFoundationCharacterMentionCandidate extends RawFoundationMentionCandidate {
  entityType: "character";
  roleHint: CharacterCard["role"];
  goalHint: string;
  traitsHint: string[];
}

export interface RawFoundationWorldMentionCandidate extends RawFoundationMentionCandidate {
  entityType: "world";
  descriptionHint: string;
}

const TRANSCRIPT_PROTAGONIST_PATTERNS = [
  /(?:主角叫|主人公叫|男主叫|女主叫|我叫)([\p{sc=Han}]{2,6}(?:氏)?)/gu,
  /(?:姓名|名字|主角姓名)\s*[:：]\s*([\p{sc=Han}]{2,6}(?:氏)?)/gu,
  /(?:[一二三四五六七八九十百千0-9]{1,3}岁(?:的)?)([\p{sc=Han}]{2,6}(?:氏)?)(?=[^\n。！？!?]{0,12}(?:蹲|站|盯|看|听|跑|跪|扑|缩|望|想))/gu,
] as const;

const TRANSCRIPT_SUPPORT_TITLES = [
  "养父",
  "父亲",
  "母亲",
  "养母",
  "师父",
  "师尊",
  "师兄",
  "师姐",
  "兄长",
  "哥哥",
  "姐姐",
  "弟弟",
  "妹妹",
  "叔父",
  "叔母",
  "伯父",
  "伯母",
  "义父",
  "义母",
] as const;

const TRANSCRIPT_SUPPORT_TITLE_PATTERN = new RegExp(
  `(?:${TRANSCRIPT_SUPPORT_TITLES.map((title) => title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})`,
  "gu",
);

const TRANSCRIPT_NAME_LEADING_STOP_CHARS = new Set([
  "用",
  "看",
  "听",
  "说",
  "笑",
  "哭",
  "跑",
  "走",
  "来",
  "去",
  "拿",
  "给",
  "把",
  "让",
  "令",
]);

const TRANSCRIPT_NAME_INTERNAL_STOP_CHARS = new Set([
  "是",
  "在",
  "就",
  "则",
  "会",
  "正",
  "再",
  "还",
  "已",
  "只",
  "都",
  "并",
  "又",
  "也",
  "不",
  "像",
]);

const TRANSCRIPT_NAME_BOUNDARY_CHARS = new Set([
  "则",
  "便",
  "却",
  "仍",
  "只",
  "都",
  "并",
  "又",
  "也",
  "将",
  "会",
  "正",
  "在",
  "就",
  "与",
  "和",
  "令",
  "让",
  "来",
  "去",
  "归",
  "赴",
  "现",
  "出",
  "入",
  "离",
  "返",
  "成",
  "为",
  "要",
  "即",
  "把",
  "向",
  "对",
  "看",
  "听",
  "说",
  "笑",
  "哭",
  "跑",
  "走",
  "拿",
  "给",
  "缠",
  "蹲",
  "站",
  "盯",
  "望",
  "扑",
  "缩",
  "杀",
  "猎",
  "偷",
]);

const TRANSCRIPT_TITLE_CONTINUATION_CHARS = new Set([
  "的",
  "们",
  "和",
  "与",
  "及",
  "母",
  "父",
  "兄",
  "姐",
  "弟",
  "妹",
  "叔",
  "伯",
  "婶",
  "姨",
  "姑",
  "舅",
]);

function normalizeText(input: string | null | undefined) {
  return input?.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() ?? "";
}

function trimClause(input: string | null | undefined) {
  return normalizeText(input).replace(/[。！？!?,，；;]+$/u, "").trim();
}

function looksLikeTranscriptCharacterRaw(name: string | null | undefined) {
  const trimmed = trimClause(name);
  if (!trimmed || trimmed.length < 2 || trimmed.length > 6) {
    return false;
  }
  const [first, ...rest] = Array.from(trimmed);
  if (!first || TRANSCRIPT_NAME_LEADING_STOP_CHARS.has(first)) {
    return false;
  }
  return !rest.some((char) => TRANSCRIPT_NAME_INTERNAL_STOP_CHARS.has(char));
}

function isTranscriptNameBoundary(text: string) {
  const nextVisible = text.match(/^\s*([\s\S])/u)?.[1] ?? "";
  if (!nextVisible) {
    return true;
  }
  if (/[，。！？!?、；;：:,.()（）]/u.test(nextVisible)) {
    return true;
  }
  return TRANSCRIPT_NAME_BOUNDARY_CHARS.has(nextVisible);
}

function buildCharacterMention(raw: string, evidenceSnippet: string, roleHint: CharacterCard["role"]): RawFoundationCharacterMentionCandidate {
  return {
    entityType: "character",
    raw,
    sourceKind: "message",
    evidenceSnippet,
    roleHint,
    goalHint: roleHint === "protagonist" ? "推动主线完成" : "卷入主线冲突",
    traitsHint: roleHint === "protagonist" ? ["主动", "敏感", "有成长空间"] : ["与主线相关", "有自己的立场"],
  };
}

export function extractCharacterMentionCandidates(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  limit = 16,
) {
  const mentions: RawFoundationCharacterMentionCandidate[] = [];

  for (const message of [...messages].reverse().slice(0, 8)) {
    const content = normalizeText(message.content);
    if (!content) {
      continue;
    }

    for (const pattern of TRANSCRIPT_PROTAGONIST_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const name = trimClause(match[1]);
        if (!looksLikeTranscriptCharacterRaw(name)) {
          continue;
        }
        mentions.push(buildCharacterMention(name, content, "protagonist"));
        if (mentions.length >= limit) {
          return mentions;
        }
      }
    }

    for (const match of content.matchAll(TRANSCRIPT_SUPPORT_TITLE_PATTERN)) {
      const title = match[0];
      const titleIndex = match.index;
      if (!title || typeof titleIndex !== "number") {
        continue;
      }

      const nameStart = titleIndex + title.length;
      const rawTail = content.slice(nameStart);
      const nextVisible = rawTail.match(/^\s*([\s\S])/u)?.[1] ?? "";
      if (nextVisible && TRANSCRIPT_TITLE_CONTINUATION_CHARS.has(nextVisible)) {
        continue;
      }
      const separatorLength = rawTail.match(/^[\s:：、，,]*/u)?.[0].length ?? 0;
      const candidateStart = nameStart + separatorLength;

      for (let length = 2; length <= 6 && candidateStart + length <= content.length; length += 1) {
        const candidate = content.slice(candidateStart, candidateStart + length);
        if (!/^[\p{sc=Han}]{2,6}$/u.test(candidate)) {
          break;
        }
        if (!looksLikeTranscriptCharacterRaw(candidate)) {
          continue;
        }
        if (!isTranscriptNameBoundary(content.slice(candidateStart + length))) {
          continue;
        }
        mentions.push(buildCharacterMention(candidate, content, "supporting"));
        break;
      }

      if (mentions.length >= limit) {
        return mentions;
      }
    }
  }

  return mentions;
}

export function extractWorldMentionCandidates(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  limit = 8,
) {
  const mentions: RawFoundationWorldMentionCandidate[] = [];
  const seen = new Set<string>();

  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") {
      continue;
    }

    const paragraphs = message.content
      .split(/\r?\n\r?\n+/)
      .map((item) => item.trim())
      .filter(Boolean);

    for (const [index, paragraph] of paragraphs.entries()) {
      const headingMatch = paragraph.match(/\*\*([^*\n]{2,40})\*\*/u);
      if (!headingMatch) {
        continue;
      }

      const rawName = trimClause(headingMatch[1]);
      if (!rawName || seen.has(rawName)) {
        continue;
      }

      const normalizedParagraph = paragraph.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
      const nextParagraph = paragraphs[index + 1]?.replace(/\s+/g, " ").trim() ?? "";
      const descriptionHint = normalizedParagraph.length < 24 && nextParagraph
        ? `${normalizedParagraph} ${nextParagraph}`.trim()
        : normalizedParagraph;

      seen.add(rawName);
      mentions.push({
        entityType: "world",
        raw: rawName,
        sourceKind: "message",
        evidenceSnippet: descriptionHint,
        descriptionHint,
      });
      if (mentions.length >= limit) {
        return mentions;
      }
    }
  }

  return mentions;
}

export function normalizeFoundationMentionText(input: string | null | undefined) {
  return normalizeText(input);
}

export function trimFoundationMentionClause(input: string | null | undefined) {
  return trimClause(input);
}
