export interface CrossChapterAuditInput {
  chapterNo: number;
  currentText: string;
  previousChapters: Array<{ chapterNo: number; text: string }>;
  previousEndState: {
    location: string | null;
    timeMarker: string | null;
    charactersPresent: string[];
  } | null;
  currentStartState: {
    location: string | null;
    timeMarker: string | null;
    charactersPresent: string[];
  } | null;
}

export interface CrossChapterAuditIssue {
  type: string;
  location: string;
  severity: "minor" | "major";
  evidence: string;
}

export interface CrossChapterAuditResult {
  verdict: "pass" | "escalate";
  issues: CrossChapterAuditIssue[];
  repeatedSceneTags: string[];
  overlapScore: number;
}

const FLASHBACK_MARKERS = /(?:回忆|想起|记忆里|梦中|往事|时间退回|那一年|多年前|前情)/;

function isInsideDialogueQuotes(text: string, index: number) {
  const before = text.slice(0, index);
  return (before.match(/[“「『]/g) ?? []).length > (before.match(/[”」』]/g) ?? []).length;
}

function findSceneMention(text: string, name: string) {
  if (!name) return -1;
  let from = 0;
  while (from <= text.length - name.length) {
    const mention = text.indexOf(name, from);
    if (mention < 0) return -1;
    const prefix = text.slice(Math.max(0, mention - 12), mention);
    if (!isInsideDialogueQuotes(text, mention) && !FLASHBACK_MARKERS.test(prefix)) {
      return mention;
    }
    from = mention + name.length;
  }
  return -1;
}

export function charactersPresentInWindow(text: string, candidates: string[]) {
  return candidates.filter((name) => findSceneMention(text, name) >= 0);
}
const TRAVEL_BRIDGES = /(?:乘|搭|坐|沿|穿过|越过|离开|出发|赶往|赶到|抵达|来到|走到|跑到|回到|转场|路上|途中|次日|翌日|数小时后|半小时后)/;
const CHARACTER_BRIDGES = /(?:赶到|抵达|来到|走进|推门|出现|返回|回来|跟上|追来|随后|这时|此刻|仍在|一直|守在|留在|坐在|站在)/;
const PLACEHOLDER = /(?:TODO|TBD|FIXME|XXX|【\s*(?:待补|补写|占位)|\[\s*(?:待补|补写|placeholder))/i;

const SCENE_TEMPLATES: Array<{ tag: string; keywords: string[]; minimum: number }> = [
  { tag: "ritual_gate", keywords: ["铜铃", "禁令", "血印", "石门", "守门", "宣读"], minimum: 3 },
  { tag: "warning_scene", keywords: ["警告", "不得", "否则", "后果", "禁令", "规矩"], minimum: 3 },
  { tag: "interrogation_warning", keywords: ["审讯", "问话", "沉默", "威胁", "供词"], minimum: 3 },
];

function normalize(input: string) {
  return input.replace(/\s+/g, "").replace(/[，。！？；：、“”‘’（）()《》【】\[\]…—-]/g, "");
}

function ngrams(input: string, size = 10) {
  const normalized = normalize(input);
  const result = new Set<string>();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

function computeOverlap(currentText: string, previousTexts: string[]) {
  const current = ngrams(currentText);
  if (!current.size) return 0;
  const previous = new Set(previousTexts.flatMap((text) => [...ngrams(text)]));
  let shared = 0;
  for (const gram of current) {
    if (previous.has(gram)) shared += 1;
  }
  return shared / current.size;
}

function timeRank(marker: string | null) {
  if (!marker) return null;
  if (/前夜|昨夜|昨日/.test(marker)) return 1;
  if (/深夜|夜里|当夜/.test(marker)) return 2;
  if (/清晨|黎明|早晨/.test(marker)) return 3;
  if (/上午|中午/.test(marker)) return 4;
  if (/下午|傍晚/.test(marker)) return 5;
  if (/次日|翌日|第二天/.test(marker)) return 6;
  return null;
}

export function inferTimeMarkerFromText(text: string) {
  return text.match(/(?:前夜|昨夜|昨日|深夜|夜里|当夜|清晨|黎明|早晨|上午|中午|下午|傍晚|次日|翌日|第二天)/)?.[0] ?? null;
}

function countPair(input: string, token: string) {
  return input.split(token).length - 1;
}

function hasUnpairedPunctuation(input: string) {
  return [
    ["（", "）"],
    ["(", ")"],
    ["【", "】"],
    ["[", "]"],
    ["《", "》"],
    ["“", "”"],
    ["‘", "’"],
  ].some(([open, close]) => countPair(input, open) !== countPair(input, close));
}

function issue(type: string, location: string, evidence: string, severity: "minor" | "major" = "major") {
  return { type, location, severity, evidence } satisfies CrossChapterAuditIssue;
}

export function auditCrossChapterManuscript(input: CrossChapterAuditInput): CrossChapterAuditResult {
  const issues: CrossChapterAuditIssue[] = [];
  const previousTexts = input.previousChapters.map((chapter) => chapter.text).filter(Boolean);
  const overlapScore = computeOverlap(input.currentText, previousTexts);
  const currentParagraphs = input.currentText.split(/\n\s*\n/).map(normalize).filter((paragraph) => paragraph.length >= 24);
  const previousParagraphs = new Set(
    previousTexts.flatMap((text) => text.split(/\n\s*\n/).map(normalize).filter((paragraph) => paragraph.length >= 24)),
  );
  const copiedParagraph = currentParagraphs.find((paragraph) => previousParagraphs.has(paragraph));
  if (copiedParagraph || overlapScore >= 0.28) {
    issues.push(issue(
      "cross_chapter_overlap",
      `第 ${input.chapterNo} 章`,
      copiedParagraph ? `发现跨章重复段落：${copiedParagraph.slice(0, 60)}` : `长 n-gram 重叠率 ${(overlapScore * 100).toFixed(1)}%`,
    ));
  }

  const repeatedSceneTags = SCENE_TEMPLATES.filter((template) => {
    const currentHits = template.keywords.filter((keyword) => input.currentText.includes(keyword)).length;
    return currentHits >= template.minimum && previousTexts.some((text) =>
      template.keywords.filter((keyword) => text.includes(keyword)).length >= template.minimum
    );
  }).map((template) => template.tag);
  for (const tag of repeatedSceneTags) {
    issues.push(issue("repeated_scene_template", `第 ${input.chapterNo} 章开场/场景`, `重复场景模板：${tag}`));
  }

  const previousState = input.previousEndState;
  const currentState = input.currentStartState;
  const opening = input.currentText.slice(0, 220);
  if (previousState && currentState) {
    const newCharacters = currentState.charactersPresent.filter((name) => !previousState.charactersPresent.includes(name));
    for (const name of newCharacters) {
      const mention = findSceneMention(opening, name);
      if (mention < 0) continue;
      const bridgeContext = opening.slice(Math.max(0, mention - 24), mention + name.length + 32);
      if (!CHARACTER_BRIDGES.test(bridgeContext)) {
        issues.push(issue("character_reentry_without_bridge", "章首", `${name} 未经出场动作直接进入当前场景`));
      }
    }
    if (
      previousState.location
      && currentState.location
      && previousState.location !== currentState.location
      && !TRAVEL_BRIDGES.test(opening)
    ) {
      issues.push(issue(
        "location_jump_without_bridge",
        "章首",
        `${previousState.location} -> ${currentState.location}，未检测到移动或转场桥接`,
      ));
    }
    const previousRank = timeRank(previousState.timeMarker);
    const currentRank = timeRank(currentState.timeMarker);
    if (previousRank !== null && currentRank !== null && currentRank < previousRank && !FLASHBACK_MARKERS.test(opening)) {
      issues.push(issue(
        "time_reversal_without_flashback",
        "章首",
        `${previousState.timeMarker ?? "未知"} -> ${currentState.timeMarker ?? "未知"}，未标记倒叙`,
      ));
    }
  }

  if (PLACEHOLDER.test(input.currentText)) {
    issues.push(issue("placeholder", "全文", "检测到 TODO/待补/占位文本"));
  }
  if (hasUnpairedPunctuation(input.currentText)) {
    issues.push(issue("unpaired_punctuation", "全文", "成对标点未闭合"));
  }
  const trimmed = input.currentText.trim();
  if (trimmed && !/[。！？!?…”’】）)]$/.test(trimmed)) {
    issues.push(issue("incomplete_sentence", "章末", `正文以不完整句结束：${trimmed.slice(-40)}`));
  }
  const lastParagraph = trimmed.split(/\n\s*\n/).at(-1) ?? "";
  if (/(?:总之|综上|由此可见|这一章说明|回顾起来|归根结底)/.test(lastParagraph)) {
    issues.push(issue("summary_ending", "章末", lastParagraph.slice(0, 100)));
  }
  if (
    /[？?]$/.test(trimmed)
    && /(?:这一切|这一切究竟|究竟意味着什么|接下来会怎样|真相到底是什么|谁也不知道)/.test(lastParagraph)
  ) {
    issues.push(issue("empty_question_hook", "章末", lastParagraph.slice(-100)));
  }

  return {
    verdict: issues.some((entry) => entry.severity === "major") ? "escalate" : "pass",
    issues,
    repeatedSceneTags,
    overlapScore,
  };
}
