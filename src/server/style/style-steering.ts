import type {
  FoundationWorkshopDraft,
  StyleProfile,
  StyleExcerpt,
  StyleImportMode,
  StyleReferenceCandidate,
  StyleReferenceInterpretation,
  StyleReferenceSelection,
  WritingCharter,
} from "../types.ts";
import { WRITING_CHARTER_BUDGET_LABELS } from "../types.ts";
import type { ChatMessage } from "../llm.ts";
import type { StyleFingerprint } from "../style-fingerprint.ts";
import { unique } from "../utils.ts";
import { safeParseJson } from "../utils/safe-json.ts";

export type AgentStage = "planner" | "writer" | "stylePass" | "reviewer";

export interface StyleFacet {
  narrativeDistance: string;
  dialogueStyle: string;
  emotionMethod: string;
  pacing: string;
  distinctivePatterns: string[];
  antiPatterns: string[];
  rhetoricFingerprint: string;
  narrativeRhythmDNA: string;
  emotionSpectrum: string;
  deepTextureTraits: string;
  sensoryPalette: string;
}

interface LightweightStyleRules {
  narrativeDistance: string;
  infoReveal: string;
  openingStrategy: string;
  chapterClosure: string;
  paragraphCadence: string;
  dialogueStyle: string;
  emotionRendering: string;
  pacing: string;
  imageryRule: string;
  aiSmellPatterns: string[];
  styleTaboos: string[];
  signaturePatterns: string[];
  rhetoricRule: string;
  rhythmDNARule: string;
  emotionSpectrumRule: string;
  perspectiveRule: string;
  sensoryRule: string;
}

type CompatibleStyleFingerprint = StyleFingerprint & {
  rhetoric?: {
    simileDensity?: number;
    personificationCount?: number;
    rhetoricalQuestionCount?: number;
    dominantDevice?: string;
  };
  narrativeRhythm?: {
    tensionCurveShape?: string;
    rhythmVariance?: number;
    paragraphBreathingPattern?: string;
    shortBurstRatio?: number;
    longFlowRatio?: number;
  };
  emotionRendering?: {
    restraintScore?: number;
    actionBasedRatio?: number;
    environmentBasedRatio?: number;
    introspectionRatio?: number;
    dialogueSubtextRatio?: number;
    sensoryDetailDensity?: number;
  };
  deepTexture?: {
    perspectiveShiftCount?: number;
    temporalDeviceCount?: number;
    whitespaceRatio?: number;
    informationDensity?: number;
    imageClusterCount?: number;
    sensoryDetailDensity?: number;
    sensoryChannelDistribution?: Record<string, number>;
  };
};

function asCompatibleFingerprint(fingerprint: StyleFingerprint): CompatibleStyleFingerprint {
  return fingerprint as CompatibleStyleFingerprint;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function pickTopSensoryChannels(distribution?: Record<string, number>, limit = 3) {
  if (!distribution) {
    return [] as string[];
  }
  return Object.entries(distribution)
    .sort((left, right) => finiteNumber(right[1]) - finiteNumber(left[1]))
    .slice(0, limit)
    .map(([channel]) => channel)
    .filter(Boolean);
}

const MAP_SYSTEM_PROMPT = `你是一位资深文学编辑，正在分析小说文本的写作风格。

你会收到一组文本片段（来自同一本书的不同位置）。请分析这些片段的写作风格特征。

输出严格合法的 JSON，包含以下字段：
- narrativeDistance: 叙事距离（作者站多远？解释多不多？贴近角色还是俯瞰？）
- dialogueStyle: 对白风格（角色怎么说话？留白多不多？对白标签的使用？）
- emotionMethod: 情绪表达（直接写内心还是用动作/环境暗示？）
- pacing: 节奏特征（句长变化、段落组织、场景切换速度）
- distinctivePatterns: 2-4 条这批文本中最显著的写法特征
- antiPatterns: 1-3 条这种风格明显在避免的写法
- rhetoricFingerprint: 修辞手法偏好与密度特征（例如比喻/拟人/通感/对比的使用方式）
- narrativeRhythmDNA: 叙事节奏 DNA（长短句交替、张力波形、段落呼吸模式）
- emotionSpectrum: 情绪渲染谱系（偏动作外化、环境映射、内心独白还是对白潜台词，整体克制还是直抒）
- deepTextureTraits: 深层笔触（视角策略、时间手法、留白技巧）
- sensoryPalette: 感官调色板（视觉/听觉/触觉/嗅觉/味觉的调用偏好）

只分析提供的文本片段，不要假设或推断未给出的内容。
不要模仿原句，只提取可泛化的技法特征。
每个字段都要写成具体、可执行、能区分作者的观察，而不是空泛文学评论。`;

const REDUCE_SYSTEM_PROMPT = `你是风格规则编译器。你会收到两类输入：
1. 多个风格切面（从不同文本段落独立提取的质性分析）
2. 文体指纹（从全文统计的确定性数据）

任务：将风格切面合并为 17 条具体的写作执行规则。

要求：
- 每条规则必须是具体的祈使句，直接反映这个作品/作者的独特写法
- 不要输出泛泛的通用建议（如“避免总结式旁白”），要输出针对这个作品的具体观察
- 例如好的规则：“对白极简，单句为主，不超过两行，前后不解释语境”
- 例如差的规则：“对白像人说话，允许留白和打断”（太通用，对任何小说都适用）
- aiSmellPatterns 列出如果 AI 来写这种风格最容易写偏的点
- signaturePatterns 列出这个作品最有辨识度的写法特征
- 数值约束由调用方根据文体指纹程序化填充，所以这里不要猜数字
- 必须把文体指纹中的修辞统计、节奏波形、情绪克制度、感官分布纳入规则编译

只输出 JSON，不要在 JSON 前后添加任何解释文字或 markdown 围栏。
输出格式：
{
  "narrativeDistance": "...",
  "infoReveal": "...",
  "openingStrategy": "...",
  "chapterClosure": "...",
  "paragraphCadence": "...",
  "dialogueStyle": "...",
  "emotionRendering": "...",
  "pacing": "...",
  "imageryRule": "...",
  "aiSmellPatterns": ["...", "..."],
  "styleTaboos": ["...", "..."],
  "signaturePatterns": ["...", "..."],
  "rhetoricRule": "...",
  "rhythmDNARule": "...",
  "emotionSpectrumRule": "...",
  "perspectiveRule": "...",
  "sensoryRule": "..."
}`;

const STAGE_FIELDS: Record<AgentStage, readonly (keyof StyleProfile)[] | "ALL"> = {
  planner: ["referenceAnchor", "openingStrategy", "infoRevealRule", "chapterClosureRule", "narrativeRhythmDNA", "deepTexture", "writingCharter"],
  writer: [
    "referenceAnchor", "paragraphCadence", "sentenceRhythm", "narrativeDistance",
    "dialogueStyle", "rhetoricRegister", "narrativeRhythmDNA", "emotionSpectrum",
    "deepTexture", "imageryRegister", "emotionRenderingRule", "openingStrategy",
    "forbiddenLexicon", "toneGuardrails", "writingCharter",
  ],
  stylePass: [
    "paragraphCadence", "sentenceRhythm", "rhetoricRegister", "emotionSpectrum",
    "aiSmellPatterns", "styleTaboos",
    "forbiddenLexicon", "toneGuardrails",
  ],
  reviewer: "ALL",
};

function normalizeCandidateKey(candidate: Pick<StyleReferenceCandidate, "kind" | "label" | "author">) {
  return [
    candidate.kind.trim().toLowerCase(),
    candidate.label.trim().toLowerCase(),
    candidate.author?.trim().toLowerCase() ?? "",
  ].join("::");
}

function sourceScore(source: StyleReferenceCandidate["source"]) {
  if (source === "network") {
    return 2;
  }
  return 1;
}

export function dedupeStyleReferenceCandidates(candidates: StyleReferenceCandidate[]) {
  const bestByKey = new Map<string, StyleReferenceCandidate>();

  for (const candidate of candidates) {
    const key = normalizeCandidateKey(candidate);
    const existing = bestByKey.get(key);
    if (!existing || sourceScore(candidate.source) > sourceScore(existing.source)) {
      bestByKey.set(key, candidate);
    }
  }

  return [...bestByKey.values()];
}

export function batchExcerpts(excerpts: StyleExcerpt[], batchSize = 5): StyleExcerpt[][] {
  const batches: StyleExcerpt[][] = [];
  for (let index = 0; index < excerpts.length; index += batchSize) {
    batches.push(excerpts.slice(index, index + batchSize));
  }
  return batches;
}

function stripJsonFences(text: string) {
  return text
    .replace(/```json?\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const cleaned = stripJsonFences(text);
  if (!cleaned) {
    return null;
  }
  if (safeParseJson<Record<string, unknown>>(cleaned)) {
    return cleaned;
  }

  for (let start = cleaned.indexOf("{"); start >= 0; start = cleaned.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < cleaned.length; index += 1) {
      const char = cleaned[index]!;

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char !== "}") {
        continue;
      }

      depth -= 1;
      if (depth !== 0) {
        continue;
      }

      const candidate = cleaned.slice(start, index + 1).trim();
      if (safeParseJson<Record<string, unknown>>(candidate)) {
        return candidate;
      }
      break;
    }
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = cleaned.slice(start, end + 1).trim();
    if (safeParseJson<Record<string, unknown>>(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseLlmJsonObject(text: string) {
  const extracted = extractJsonObject(text);
  if (!extracted) {
    return null;
  }
  return safeParseJson<Record<string, unknown>>(extracted);
}

function normalizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length >= 2)
    .slice(0, limit);
}

function normalizeLightweightStyleRules(parsed?: Record<string, unknown> | null): LightweightStyleRules {
  return {
    narrativeDistance: String(parsed?.narrativeDistance ?? "").trim(),
    infoReveal: String(parsed?.infoReveal ?? "").trim(),
    openingStrategy: String(parsed?.openingStrategy ?? "").trim(),
    chapterClosure: String(parsed?.chapterClosure ?? "").trim(),
    paragraphCadence: String(parsed?.paragraphCadence ?? "").trim(),
    dialogueStyle: String(parsed?.dialogueStyle ?? "").trim(),
    emotionRendering: String(parsed?.emotionRendering ?? "").trim(),
    pacing: String(parsed?.pacing ?? "").trim(),
    imageryRule: String(parsed?.imageryRule ?? "").trim(),
    aiSmellPatterns: normalizeStringArray(parsed?.aiSmellPatterns, 6),
    styleTaboos: normalizeStringArray(parsed?.styleTaboos, 6),
    signaturePatterns: normalizeStringArray(parsed?.signaturePatterns, 4),
    rhetoricRule: String(parsed?.rhetoricRule ?? "").trim(),
    rhythmDNARule: String(parsed?.rhythmDNARule ?? "").trim(),
    emotionSpectrumRule: String(parsed?.emotionSpectrumRule ?? "").trim(),
    perspectiveRule: String(parsed?.perspectiveRule ?? "").trim(),
    sensoryRule: String(parsed?.sensoryRule ?? "").trim(),
  };
}

function hasMeaningfulLightweightRules(rules: LightweightStyleRules) {
  const scalarSignals = [
    rules.narrativeDistance,
    rules.infoReveal,
    rules.openingStrategy,
    rules.chapterClosure,
    rules.paragraphCadence,
    rules.dialogueStyle,
    rules.emotionRendering,
    rules.pacing,
    rules.imageryRule,
    rules.rhetoricRule,
    rules.rhythmDNARule,
    rules.emotionSpectrumRule,
    rules.perspectiveRule,
    rules.sensoryRule,
  ].filter(Boolean).length;

  return scalarSignals >= 5 || rules.signaturePatterns.length >= 2;
}

function synthesizeStyleProfile(rules: LightweightStyleRules, fingerprint: StyleFingerprint): StyleProfile {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { writingCharter: _baseWritingCharter, ...base } = createDefaultStyleProfile();
  const compatibleFingerprint = asCompatibleFingerprint(fingerprint);
  const rhetoric = compatibleFingerprint.rhetoric;
  const rhythm = compatibleFingerprint.narrativeRhythm;
  const emotion = compatibleFingerprint.emotionRendering;
  const deepTexture = compatibleFingerprint.deepTexture;
  const signatureGuardrails = rules.signaturePatterns.map((pattern) => `优先保住这种辨识度写法：${pattern}`);
  const dominantDevice = rhetoric?.dominantDevice && rhetoric.dominantDevice !== "none"
    ? rhetoric.dominantDevice
    : "克制修辞";
  const dominantChannels = pickTopSensoryChannels(deepTexture?.sensoryChannelDistribution).join("、");
  const tensionCurveShape = rhythm?.tensionCurveShape || "rising";
  const breathingPattern = rhythm?.paragraphBreathingPattern || "mixed";
  const rhythmVariance = finiteNumber(rhythm?.rhythmVariance, 0.42);
  const restraintScore = finiteNumber(emotion?.restraintScore, 0.72);
  const temporalDeviceCount = Math.max(0, Math.round(finiteNumber(deepTexture?.temporalDeviceCount, 2)));
  const whitespaceRatio = finiteNumber(deepTexture?.whitespaceRatio, 0.24);

  const profile = normalizeStyleProfile({
    ...base,
    narrativeDistance: {
      intimacyRule: rules.narrativeDistance || base.narrativeDistance.intimacyRule,
      expositionRule: rules.infoReveal || base.narrativeDistance.expositionRule,
      textureRule: base.narrativeDistance.textureRule,
    },
    paragraphCadence: {
      narrativeRule: rules.paragraphCadence || base.paragraphCadence.narrativeRule,
      dialogueRule: rules.dialogueStyle || base.paragraphCadence.dialogueRule,
      emphasisRule: rules.signaturePatterns[0]
        ? `只在需要放大 ${rules.signaturePatterns[0]} 这类辨识度时留短段，其余段落继续成组推进。`
        : base.paragraphCadence.emphasisRule,
    },
    sentenceRhythm: {
      pacingRule: rules.pacing || base.sentenceRhythm.pacingRule,
      transitionRule: base.sentenceRhythm.transitionRule,
      pauseRule: base.sentenceRhythm.pauseRule,
    },
    dialogueStyle: {
      voiceRule: rules.dialogueStyle || base.dialogueStyle.voiceRule,
      subtextRule: base.dialogueStyle.subtextRule,
      distinctionRule: base.dialogueStyle.distinctionRule,
    },
    rhetoricRegister: {
      densityRule: rules.rhetoricRule || `修辞密度跟随 ${dominantDevice} 主导，保持低频但精准命中。`,
      preferredDevices: rules.rhetoricRule
        ? `${dominantDevice} 优先；${rules.rhetoricRule}`
        : base.rhetoricRegister.preferredDevices,
      avoidDevices: unique([
        ...base.rhetoricRegister.avoidDevices,
        ...rules.styleTaboos.filter((entry) => /修辞|抒情|比喻|排比/u.test(entry)),
      ]),
    },
    narrativeRhythmDNA: {
      pacingPattern: rules.rhythmDNARule || rules.pacing || base.narrativeRhythmDNA.pacingPattern,
      tensionRule: rules.rhythmDNARule
        ? `张力波形遵守：${rules.rhythmDNARule}`
        : `张力整体偏 ${tensionCurveShape}，不要写成均匀平推。`,
      breathingRule: rules.rhythmDNARule
        ? rules.rhythmDNARule
        : `段落呼吸偏 ${breathingPattern}，短长句波动维持在 ${rhythmVariance.toFixed(2)} 附近。`,
    },
    emotionSpectrum: {
      renderingPreference: rules.emotionSpectrumRule || rules.emotionRendering || base.emotionSpectrum.renderingPreference,
      restraintRule: rules.emotionSpectrumRule
        ? `${rules.emotionSpectrumRule}（克制度约 ${restraintScore.toFixed(2)}）`
        : `整体克制度维持在 ${restraintScore.toFixed(2)} 左右，优先外化，不抢着明说。`,
      transitionRule: rules.emotionSpectrumRule
        ? rules.emotionSpectrumRule
        : `情绪转折优先借动作、环境与对白潜台词带出，而不是直接宣布心境变化。`,
    },
    deepTexture: {
      perspectiveRule: rules.perspectiveRule || base.deepTexture.perspectiveRule,
      temporalRule: rules.perspectiveRule
        ? rules.perspectiveRule
        : `时间手法保持克制，参考 ${temporalDeviceCount} 次级别的闪回/预叙密度。`,
      whitespaceRule: rules.perspectiveRule
        ? rules.perspectiveRule
        : `留白依靠短段、断句与省略解释完成，留白比例维持在 ${(whitespaceRatio * 100).toFixed(0)}% 左右。`,
      sensoryRule: rules.sensoryRule || `感官优先调用 ${dominantChannels || "visual、tactile、auditory"}，其余通道只做点刺。`,
    },
    imageryRegister: {
      densityRule: rules.imageryRule || base.imageryRegister.densityRule,
      textureRule: base.imageryRegister.textureRule,
      avoid: unique([
        ...base.imageryRegister.avoid,
        ...rules.styleTaboos.filter((entry) => entry.length >= 2),
      ]),
    },
    toneGuardrails: unique([
      ...base.toneGuardrails,
      ...signatureGuardrails,
    ]),
    openingStrategy: rules.openingStrategy || base.openingStrategy,
    infoRevealRule: rules.infoReveal || base.infoRevealRule,
    emotionRenderingRule: rules.emotionRendering || base.emotionRenderingRule,
    chapterClosureRule: rules.chapterClosure || base.chapterClosureRule,
    aiSmellPatterns: rules.aiSmellPatterns,
    styleTaboos: rules.styleTaboos,
  });

  return applyFingerprintToCharter(profile, fingerprint);
}

export function renderStyleReference(selection: StyleReferenceSelection) {
  const subject = selection.kind === "book"
    ? `《${selection.label}》${selection.author ? ` / ${selection.author}` : ""}`
    : selection.label;
  return `${selection.relation === "primary" ? "主参考" : "辅参考"}：${subject}（${selection.source === "network" ? "联网" : "AI检索"}）`;
}

function renderReferenceSubject(selection: StyleReferenceSelection) {
  return selection.kind === "book"
    ? `《${selection.label}》${selection.author ? ` / ${selection.author}` : ""}`
    : selection.label;
}

function compactText(input?: string) {
  return input?.replace(/\s+/g, " ").trim() ?? "";
}

function buildGuidanceSummary(input: {
  manualGuidance?: string;
  worldContext?: string;
  workshopContext?: string;
  draft?: Pick<FoundationWorkshopDraft, "mainline" | "desiredTone" | "storyHook"> | null;
}) {
  return [
    compactText(input.manualGuidance),
    compactText(input.worldContext),
    compactText(input.workshopContext),
    compactText(input.draft?.mainline),
    compactText(input.draft?.desiredTone),
    compactText(input.draft?.storyHook),
  ]
    .filter(Boolean)
    .join("；");
}

function collectForbiddenLexicon(input: { avoidances?: string; manualGuidance?: string }) {
  const defaults = [
    "推进主线",
    "阻力",
    "信息投放",
    "升级危机",
    "爽点",
    "情绪价值",
    "名场面",
    "反转点",
  ];
  const explicit = `${input.avoidances ?? ""} ${input.manualGuidance ?? ""}`
    .split(/[，,、；;。！？!\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return unique([...defaults, ...explicit]);
}

type WritingCharterSource = {
  openingStrategy: string;
  infoRevealRule: string;
  emotionRenderingRule: string;
  chapterClosureRule: string;
  transitionRule: string;
  pauseRule: string;
  aiSmellPatterns: string[];
  styleTaboos: string[];
};

function createDefaultWritingCharter(source: WritingCharterSource): WritingCharter {
  return {
    chapterLengthRule: "章长要写满完整场景推进、代价兑现和章末牵引，不短成梗概，也不要靠重复回钉同一风险凑字。",
    openingMoveRule: source.openingStrategy,
    infoRevealRule: source.infoRevealRule,
    mechanismRevealRule: "机制类信息先写角色撞上的异动、代价和局势变化，再补最少必要辨认，不先做抽象定义。",
    mechanismRevealRedlines: [
      "不要写成解释 -> 验证 -> 总结三段式。",
      "不要在角色还没吃到代价前先复述机制条款。",
      "不要把暗钩机制一次说透，再让角色按讲义去执行。",
    ],
    emotionLandingRule: source.emotionRenderingRule,
    chapterClosureRule: source.chapterClosureRule,
    transitionRule: source.transitionRule,
    pauseRule: source.pauseRule,
    endingPolicy: {
      maxConclusionSentences: 1,
      conclusionMarkers: ["这意味着", "这也说明", "这说明", "总之", "归根结底", "由此看来", "可见", "说到底"],
    },
    mechanismRevealPolicy: {
      maxExplicitSummarySentences: 1,
      maxTriadPatterns: 0,
      explanationMarkers: ["这意味着", "这说明", "也就是说", "换句话说", "其实", "原来", "关键在于", "所谓"],
      verificationMarkers: ["果然", "下一刻", "随即", "立刻", "很快", "果真"],
      summaryMarkers: ["这也说明", "这说明", "总之", "原来如此", "于是", "可见"],
      mechanismKeywords: ["机制", "规则", "异动", "代价", "征兆", "痕迹", "线索", "门道"],
    },
    transitionBudget: {
      maxContrastTemplates: 1,
      maxAbruptTurns: 2,
      maxHardTransitionMarkers: 4,
      hardTransitionMarkers: ["忽然", "骤然", "蓦地", "下一刻", "转眼", "与此同时", "然而", "可是", "偏偏", "旋即"],
    },
    simileBudget: {
      maxPerChapter: 4,
      maxPerParagraph: 1,
    },
    rhetoricBudget: {
      simileDensityPerThousand: 1.2,
      personificationDensityPerThousand: 0.4,
      rhetoricalQuestionPerChapter: 1,
      dominantDevice: "simile",
    },
    subjectLeadBudget: {
      maxPronounLeads: 4,
      maxDominantLeadCount: 6,
      maxSameLeadInWindow: 2,
      windowSize: 6,
    },
    motifReuseBudget: {
      maxPerMotif: 3,
      minParagraphSpan: 2,
      minMotifLength: 2,
      stopwords: ["自己", "对方", "时候", "东西", "一下", "一点", "没有", "可以"],
    },
    sensoryBudget: {
      sensoryDetailTargetPerThousand: 4.5,
      primaryChannels: ["visual", "tactile"],
    },
    aiFlavorAvoidance: unique([
      ...source.aiSmellPatterns,
      "解释先于行动",
      "章末总结感",
      "机械转折",
      "机制复述",
    ]),
    tabooReminders: unique(source.styleTaboos),
  };
}

function normalizeWritingCharter(
  charter: Partial<WritingCharter> | null | undefined,
  source: WritingCharterSource,
): WritingCharter {
  const defaults = createDefaultWritingCharter(source);
  return {
    chapterLengthRule: charter?.chapterLengthRule || defaults.chapterLengthRule,
    openingMoveRule: charter?.openingMoveRule || source.openingStrategy || defaults.openingMoveRule,
    infoRevealRule: charter?.infoRevealRule || source.infoRevealRule || defaults.infoRevealRule,
    mechanismRevealRule: charter?.mechanismRevealRule || defaults.mechanismRevealRule,
    mechanismRevealRedlines: unique([
      ...(charter?.mechanismRevealRedlines?.filter(Boolean) ?? []),
      ...defaults.mechanismRevealRedlines,
    ]),
    emotionLandingRule: charter?.emotionLandingRule || source.emotionRenderingRule || defaults.emotionLandingRule,
    chapterClosureRule: charter?.chapterClosureRule || source.chapterClosureRule || defaults.chapterClosureRule,
    transitionRule: charter?.transitionRule || source.transitionRule || defaults.transitionRule,
    pauseRule: charter?.pauseRule || source.pauseRule || defaults.pauseRule,
    endingPolicy: {
      maxConclusionSentences: Number.isFinite(charter?.endingPolicy?.maxConclusionSentences)
        ? Math.max(0, Math.round(charter!.endingPolicy!.maxConclusionSentences))
        : defaults.endingPolicy.maxConclusionSentences,
      conclusionMarkers: unique(charter?.endingPolicy?.conclusionMarkers?.filter(Boolean) ?? defaults.endingPolicy.conclusionMarkers),
    },
    mechanismRevealPolicy: {
      maxExplicitSummarySentences: Number.isFinite(charter?.mechanismRevealPolicy?.maxExplicitSummarySentences)
        ? Math.max(0, Math.round(charter!.mechanismRevealPolicy!.maxExplicitSummarySentences))
        : defaults.mechanismRevealPolicy.maxExplicitSummarySentences,
      maxTriadPatterns: Number.isFinite(charter?.mechanismRevealPolicy?.maxTriadPatterns)
        ? Math.max(0, Math.round(charter!.mechanismRevealPolicy!.maxTriadPatterns))
        : defaults.mechanismRevealPolicy.maxTriadPatterns,
      explanationMarkers: unique(charter?.mechanismRevealPolicy?.explanationMarkers?.filter(Boolean) ?? defaults.mechanismRevealPolicy.explanationMarkers),
      verificationMarkers: unique(charter?.mechanismRevealPolicy?.verificationMarkers?.filter(Boolean) ?? defaults.mechanismRevealPolicy.verificationMarkers),
      summaryMarkers: unique(charter?.mechanismRevealPolicy?.summaryMarkers?.filter(Boolean) ?? defaults.mechanismRevealPolicy.summaryMarkers),
      mechanismKeywords: unique(charter?.mechanismRevealPolicy?.mechanismKeywords?.filter(Boolean) ?? defaults.mechanismRevealPolicy.mechanismKeywords),
    },
    transitionBudget: {
      maxContrastTemplates: Number.isFinite(charter?.transitionBudget?.maxContrastTemplates)
        ? Math.max(0, Math.round(charter!.transitionBudget!.maxContrastTemplates))
        : defaults.transitionBudget.maxContrastTemplates,
      maxAbruptTurns: Number.isFinite(charter?.transitionBudget?.maxAbruptTurns)
        ? Math.max(0, Math.round(charter!.transitionBudget!.maxAbruptTurns))
        : defaults.transitionBudget.maxAbruptTurns,
      maxHardTransitionMarkers: Number.isFinite(charter?.transitionBudget?.maxHardTransitionMarkers)
        ? Math.max(0, Math.round(charter!.transitionBudget!.maxHardTransitionMarkers))
        : defaults.transitionBudget.maxHardTransitionMarkers,
      hardTransitionMarkers: unique(charter?.transitionBudget?.hardTransitionMarkers?.filter(Boolean) ?? defaults.transitionBudget.hardTransitionMarkers),
    },
    simileBudget: {
      maxPerChapter: Number.isFinite(charter?.simileBudget?.maxPerChapter)
        ? Math.max(0, Math.round(charter!.simileBudget!.maxPerChapter))
        : defaults.simileBudget.maxPerChapter,
      maxPerParagraph: Number.isFinite(charter?.simileBudget?.maxPerParagraph)
        ? Math.max(0, Math.round(charter!.simileBudget!.maxPerParagraph))
        : defaults.simileBudget.maxPerParagraph,
    },
    rhetoricBudget: {
      simileDensityPerThousand: Number.isFinite(charter?.rhetoricBudget?.simileDensityPerThousand)
        ? Math.max(0, Number(charter!.rhetoricBudget!.simileDensityPerThousand))
        : defaults.rhetoricBudget.simileDensityPerThousand,
      personificationDensityPerThousand: Number.isFinite(charter?.rhetoricBudget?.personificationDensityPerThousand)
        ? Math.max(0, Number(charter!.rhetoricBudget!.personificationDensityPerThousand))
        : defaults.rhetoricBudget.personificationDensityPerThousand,
      rhetoricalQuestionPerChapter: Number.isFinite(charter?.rhetoricBudget?.rhetoricalQuestionPerChapter)
        ? Math.max(0, Math.round(charter!.rhetoricBudget!.rhetoricalQuestionPerChapter))
        : defaults.rhetoricBudget.rhetoricalQuestionPerChapter,
      dominantDevice: charter?.rhetoricBudget?.dominantDevice?.trim() || defaults.rhetoricBudget.dominantDevice,
    },
    subjectLeadBudget: {
      maxPronounLeads: Number.isFinite(charter?.subjectLeadBudget?.maxPronounLeads)
        ? Math.max(0, Math.round(charter!.subjectLeadBudget!.maxPronounLeads))
        : defaults.subjectLeadBudget.maxPronounLeads,
      maxDominantLeadCount: Number.isFinite(charter?.subjectLeadBudget?.maxDominantLeadCount)
        ? Math.max(0, Math.round(charter!.subjectLeadBudget!.maxDominantLeadCount))
        : defaults.subjectLeadBudget.maxDominantLeadCount,
      maxSameLeadInWindow: Number.isFinite(charter?.subjectLeadBudget?.maxSameLeadInWindow)
        ? Math.max(0, Math.round(charter!.subjectLeadBudget!.maxSameLeadInWindow))
        : defaults.subjectLeadBudget.maxSameLeadInWindow,
      windowSize: Number.isFinite(charter?.subjectLeadBudget?.windowSize)
        ? Math.max(2, Math.round(charter!.subjectLeadBudget!.windowSize))
        : defaults.subjectLeadBudget.windowSize,
    },
    motifReuseBudget: {
      maxPerMotif: Number.isFinite(charter?.motifReuseBudget?.maxPerMotif)
        ? Math.max(1, Math.round(charter!.motifReuseBudget!.maxPerMotif))
        : defaults.motifReuseBudget.maxPerMotif,
      minParagraphSpan: Number.isFinite(charter?.motifReuseBudget?.minParagraphSpan)
        ? Math.max(2, Math.round(charter!.motifReuseBudget!.minParagraphSpan))
        : defaults.motifReuseBudget.minParagraphSpan,
      minMotifLength: Number.isFinite(charter?.motifReuseBudget?.minMotifLength)
        ? Math.max(2, Math.round(charter!.motifReuseBudget!.minMotifLength))
        : defaults.motifReuseBudget.minMotifLength,
      stopwords: unique(charter?.motifReuseBudget?.stopwords?.filter(Boolean) ?? defaults.motifReuseBudget.stopwords),
    },
    sensoryBudget: {
      sensoryDetailTargetPerThousand: Number.isFinite(charter?.sensoryBudget?.sensoryDetailTargetPerThousand)
        ? Math.max(0, Number(charter!.sensoryBudget!.sensoryDetailTargetPerThousand))
        : defaults.sensoryBudget.sensoryDetailTargetPerThousand,
      primaryChannels: unique(charter?.sensoryBudget?.primaryChannels?.filter(Boolean) ?? defaults.sensoryBudget.primaryChannels),
    },
    aiFlavorAvoidance: unique([
      ...(charter?.aiFlavorAvoidance?.filter(Boolean) ?? []),
      ...defaults.aiFlavorAvoidance,
      ...source.aiSmellPatterns,
    ]),
    tabooReminders: unique([
      ...(charter?.tabooReminders?.filter(Boolean) ?? []),
      ...defaults.tabooReminders,
      ...source.styleTaboos,
    ]),
  };
}

function formatWritingCharterLines(writingCharter: WritingCharter) {
  return [
    `章长习惯：${writingCharter.chapterLengthRule}`,
    `开篇落点：${writingCharter.openingMoveRule}`,
    `信息露出：${writingCharter.infoRevealRule}`,
    `机制露出：${writingCharter.mechanismRevealRule}`,
    `机制禁区：${writingCharter.mechanismRevealRedlines.join("；") || "无"}`,
    `情绪落点：${writingCharter.emotionLandingRule}`,
    `作者收束习惯：${writingCharter.chapterClosureRule}`,
    `转场控制：${writingCharter.transitionRule}`,
    `停顿控制：${writingCharter.pauseRule}`,
    `章末策略：结论句<=${writingCharter.endingPolicy.maxConclusionSentences}；结论标记=${writingCharter.endingPolicy.conclusionMarkers.join("、")}`,
    `机制露出策略：显性总结句<=${writingCharter.mechanismRevealPolicy.maxExplicitSummarySentences}；三段式<=${writingCharter.mechanismRevealPolicy.maxTriadPatterns}；解释标记=${writingCharter.mechanismRevealPolicy.explanationMarkers.join("、")}；总结标记=${writingCharter.mechanismRevealPolicy.summaryMarkers.join("、")}`,
    `转场预算：不是…而是…<=${writingCharter.transitionBudget.maxContrastTemplates}；忽然类<=${writingCharter.transitionBudget.maxAbruptTurns}；硬转词<=${writingCharter.transitionBudget.maxHardTransitionMarkers}`,
    `比喻预算：全章<=${writingCharter.simileBudget.maxPerChapter}；单段<=${writingCharter.simileBudget.maxPerParagraph}`,
    `修辞预算：比喻密度<=${writingCharter.rhetoricBudget.simileDensityPerThousand.toFixed(1)}/千字；拟人密度<=${writingCharter.rhetoricBudget.personificationDensityPerThousand.toFixed(1)}/千字；反问<=${writingCharter.rhetoricBudget.rhetoricalQuestionPerChapter}/章；主导修辞=${writingCharter.rhetoricBudget.dominantDevice}`,
    `主体起句预算：代词起句<=${writingCharter.subjectLeadBudget.maxPronounLeads}；单主体句首<=${writingCharter.subjectLeadBudget.maxDominantLeadCount}；${writingCharter.subjectLeadBudget.windowSize}句窗口内同句首<=${writingCharter.subjectLeadBudget.maxSameLeadInWindow}`,
    `母题复用预算：同一意象/词块<=${writingCharter.motifReuseBudget.maxPerMotif} 次；至少跨 ${writingCharter.motifReuseBudget.minParagraphSpan} 段才算重复；最短词长=${writingCharter.motifReuseBudget.minMotifLength}`,
    `感官预算：细节密度目标=${writingCharter.sensoryBudget.sensoryDetailTargetPerThousand.toFixed(1)}/千字；主通道=${writingCharter.sensoryBudget.primaryChannels.join("、") || "无"}`,
    writingCharter.aiFlavorAvoidance.length ? `AI味规避：${writingCharter.aiFlavorAvoidance.join("；")}` : "",
    writingCharter.tabooReminders.length ? `作者禁忌：${writingCharter.tabooReminders.join("；")}` : "",
  ].filter(Boolean);
}

export function buildWritingCharterPromptContract(input: {
  writingCharter: WritingCharter;
  stage: "writer" | "reviewer" | "selector";
}) {
  const labels = [
    WRITING_CHARTER_BUDGET_LABELS.ending_conclusion_sentence,
    WRITING_CHARTER_BUDGET_LABELS.mechanism_explicit_summary,
    WRITING_CHARTER_BUDGET_LABELS.mechanism_triad_pattern,
    WRITING_CHARTER_BUDGET_LABELS.transition_contrast_template,
    WRITING_CHARTER_BUDGET_LABELS.transition_abrupt_turn,
    WRITING_CHARTER_BUDGET_LABELS.transition_hard_marker,
    WRITING_CHARTER_BUDGET_LABELS.simile_per_chapter,
    WRITING_CHARTER_BUDGET_LABELS.simile_per_paragraph,
    WRITING_CHARTER_BUDGET_LABELS.rhetoric_density,
    WRITING_CHARTER_BUDGET_LABELS.sensory_density,
    WRITING_CHARTER_BUDGET_LABELS.subject_pronoun_lead,
    WRITING_CHARTER_BUDGET_LABELS.subject_dominant_lead,
    WRITING_CHARTER_BUDGET_LABELS.subject_window_repeat,
    WRITING_CHARTER_BUDGET_LABELS.motif_reuse,
  ];

  return [
    `作者习惯卡统一术语：${labels.join("；")}。`,
    input.stage === "writer"
      ? "这些术语都是硬约束。写作时直接按这些名字执行，不要把章末策略、机制露出策略、转场预算、比喻预算、修辞预算、感官预算、主体起句预算、母题复用预算改写成另一套近义说法。"
      : "如果你判定 style drift、AI味、budget miss 或给 fixInstructions/styleChecklistHits/charterViolations，必须直接沿用以上术语，不要自造另一套解释语言。",
    input.stage === "selector"
      ? "选版时也要沿用同一套术语判断风险，优先淘汰章末策略、机制露出策略、转场预算、比喻预算、修辞预算、感官预算、主体起句预算或母题复用预算明显失守的版本。"
      : "",
  ].filter(Boolean);
}

export function createDefaultStyleProfile(): StyleProfile {
  const profile = {
    referenceAnchor: {
      primary: "以当前题材和设定自然生成",
      secondary: [],
    },
    paragraphCadence: {
      narrativeRule: "叙述段以 2-5 句相关动作、感受和细节为主，避免几乎每句都独立成段。",
      dialogueRule: "对白切换、动作骤变、视角焦点明显移动时再换段。",
      emphasisRule: "揭示、停顿、情绪陡转时允许短段，但不要整章都碎裂。",
    },
    sentenceRhythm: {
      pacingRule: "长短句交替，避免每句长度和结构都过于平均。",
      transitionRule: "场景推进依靠动作、感官与反应衔接，不用提纲词硬转。",
      pauseRule: "关键处保留停顿，但停顿要落在画面和动作上。",
    },
    narrativeDistance: {
      intimacyRule: "贴近当前 POV 的即时感受，不做高空俯瞰式总结。",
      expositionRule: "解释要克制，能落在场景里的信息不要抽象概括。",
      textureRule: "正文质感以正常中文小说叙述为准，不写策划点评腔。",
    },
    dialogueStyle: {
      voiceRule: "对白像人说话，允许留白和打断，不要所有角色一个腔。",
      subtextRule: "冲突尽量藏在语气、停顿和动作里，而不是直接讲结论。",
      distinctionRule: "角色说话方式要与身份、关系和当下情境相连。",
    },
    rhetoricRegister: {
      densityRule: "修辞密度保持克制，只在必须放大触感、压迫或回声时落一针。",
      preferredDevices: "优先低频比喻、轻度拟人与克制对比句。",
      avoidDevices: ["甜腻抒情", "连续排比", "空转金句"],
    },
    narrativeRhythmDNA: {
      pacingPattern: "节奏以长短句错开为主，危险逼近前允许短句连发。",
      tensionRule: "张力应逐级上扬，不写成均匀平推。",
      breathingRule: "段落呼吸以 mixed 为默认，短段服务压迫与揭示。",
    },
    emotionSpectrum: {
      renderingPreference: "情绪优先借动作、环境和对白潜台词外化。",
      restraintRule: "能不直说就不直说，把结论压在动作之后。",
      transitionRule: "情绪转折要由局势变化、身体反馈或旧事刺入带出。",
    },
    deepTexture: {
      perspectiveRule: "默认贴住当前人物的即时感受，不轻易跳出视角解释。",
      temporalRule: "时间手法保持克制，闪回/预叙只用来压暗当前局势。",
      whitespaceRule: "留白依靠短段、断句和省略解释完成。",
      sensoryRule: "以视觉、触觉和听觉为主，嗅觉/味觉只在关键处点刺。",
    },
    imageryRegister: {
      densityRule: "意象点到为止，优先服务氛围和人物感受。",
      textureRule: "修辞要顺着场景生长，不堆华丽词。",
      avoid: ["空泛抒情", "平均句式", "解释性总结"],
    },
    forbiddenLexicon: collectForbiddenLexicon({}),
    toneGuardrails: [
      "不要把审稿、策划、分镜、提纲口吻直接写进正文。",
      "不要把人物动机写成条目式总结。",
    ],
    openingStrategy: "以场景或动作切入，不用总结式开场白。",
    infoRevealRule: "信息通过场景、对话和行动自然露出，不做旁白解释。",
    emotionRenderingRule: "情绪通过动作、感官和环境反射外化，不直接复述心理。",
    chapterClosureRule: "章末留悬念或情绪余韵，不做要点回顾式总结。",
    aiSmellPatterns: [],
    styleTaboos: [],
  } satisfies Omit<StyleProfile, "writingCharter">;

  return {
    ...profile,
    writingCharter: createDefaultWritingCharter({
      openingStrategy: profile.openingStrategy,
      infoRevealRule: profile.infoRevealRule,
      emotionRenderingRule: profile.emotionRenderingRule,
      chapterClosureRule: profile.chapterClosureRule,
      transitionRule: profile.sentenceRhythm.transitionRule,
      pauseRule: profile.sentenceRhythm.pauseRule,
      aiSmellPatterns: profile.aiSmellPatterns,
      styleTaboos: profile.styleTaboos,
    }),
  };
}

export function normalizeStyleProfile(profile?: Partial<StyleProfile> | null): StyleProfile {
  const defaults = createDefaultStyleProfile();
  const normalized = {
    referenceAnchor: {
      primary: profile?.referenceAnchor?.primary || defaults.referenceAnchor.primary,
      secondary: profile?.referenceAnchor?.secondary?.filter(Boolean) ?? defaults.referenceAnchor.secondary,
    },
    paragraphCadence: {
      narrativeRule: profile?.paragraphCadence?.narrativeRule || defaults.paragraphCadence.narrativeRule,
      dialogueRule: profile?.paragraphCadence?.dialogueRule || defaults.paragraphCadence.dialogueRule,
      emphasisRule: profile?.paragraphCadence?.emphasisRule || defaults.paragraphCadence.emphasisRule,
    },
    sentenceRhythm: {
      pacingRule: profile?.sentenceRhythm?.pacingRule || defaults.sentenceRhythm.pacingRule,
      transitionRule: profile?.sentenceRhythm?.transitionRule || defaults.sentenceRhythm.transitionRule,
      pauseRule: profile?.sentenceRhythm?.pauseRule || defaults.sentenceRhythm.pauseRule,
    },
    narrativeDistance: {
      intimacyRule: profile?.narrativeDistance?.intimacyRule || defaults.narrativeDistance.intimacyRule,
      expositionRule: profile?.narrativeDistance?.expositionRule || defaults.narrativeDistance.expositionRule,
      textureRule: profile?.narrativeDistance?.textureRule || defaults.narrativeDistance.textureRule,
    },
    dialogueStyle: {
      voiceRule: profile?.dialogueStyle?.voiceRule || defaults.dialogueStyle.voiceRule,
      subtextRule: profile?.dialogueStyle?.subtextRule || defaults.dialogueStyle.subtextRule,
      distinctionRule: profile?.dialogueStyle?.distinctionRule || defaults.dialogueStyle.distinctionRule,
    },
    rhetoricRegister: {
      densityRule: profile?.rhetoricRegister?.densityRule || defaults.rhetoricRegister.densityRule,
      preferredDevices: profile?.rhetoricRegister?.preferredDevices || defaults.rhetoricRegister.preferredDevices,
      avoidDevices: profile?.rhetoricRegister?.avoidDevices?.filter(Boolean) ?? defaults.rhetoricRegister.avoidDevices,
    },
    narrativeRhythmDNA: {
      pacingPattern: profile?.narrativeRhythmDNA?.pacingPattern || defaults.narrativeRhythmDNA.pacingPattern,
      tensionRule: profile?.narrativeRhythmDNA?.tensionRule || defaults.narrativeRhythmDNA.tensionRule,
      breathingRule: profile?.narrativeRhythmDNA?.breathingRule || defaults.narrativeRhythmDNA.breathingRule,
    },
    emotionSpectrum: {
      renderingPreference: profile?.emotionSpectrum?.renderingPreference || defaults.emotionSpectrum.renderingPreference,
      restraintRule: profile?.emotionSpectrum?.restraintRule || defaults.emotionSpectrum.restraintRule,
      transitionRule: profile?.emotionSpectrum?.transitionRule || defaults.emotionSpectrum.transitionRule,
    },
    deepTexture: {
      perspectiveRule: profile?.deepTexture?.perspectiveRule || defaults.deepTexture.perspectiveRule,
      temporalRule: profile?.deepTexture?.temporalRule || defaults.deepTexture.temporalRule,
      whitespaceRule: profile?.deepTexture?.whitespaceRule || defaults.deepTexture.whitespaceRule,
      sensoryRule: profile?.deepTexture?.sensoryRule || defaults.deepTexture.sensoryRule,
    },
    imageryRegister: {
      densityRule: profile?.imageryRegister?.densityRule || defaults.imageryRegister.densityRule,
      textureRule: profile?.imageryRegister?.textureRule || defaults.imageryRegister.textureRule,
      avoid: profile?.imageryRegister?.avoid?.filter(Boolean) ?? defaults.imageryRegister.avoid,
    },
    forbiddenLexicon: profile?.forbiddenLexicon?.filter(Boolean) ?? defaults.forbiddenLexicon,
    toneGuardrails: profile?.toneGuardrails?.filter(Boolean) ?? defaults.toneGuardrails,
    openingStrategy: profile?.openingStrategy || defaults.openingStrategy,
    infoRevealRule: profile?.infoRevealRule || defaults.infoRevealRule,
    emotionRenderingRule: profile?.emotionRenderingRule || defaults.emotionRenderingRule,
    chapterClosureRule: profile?.chapterClosureRule || defaults.chapterClosureRule,
    aiSmellPatterns: profile?.aiSmellPatterns?.filter(Boolean) ?? defaults.aiSmellPatterns,
    styleTaboos: profile?.styleTaboos?.filter(Boolean) ?? defaults.styleTaboos,
  } satisfies Omit<StyleProfile, "writingCharter">;

  return {
    ...normalized,
    writingCharter: normalizeWritingCharter(profile?.writingCharter, {
      openingStrategy: normalized.openingStrategy,
      infoRevealRule: normalized.infoRevealRule,
      emotionRenderingRule: normalized.emotionRenderingRule,
      chapterClosureRule: normalized.chapterClosureRule,
      transitionRule: normalized.sentenceRhythm.transitionRule,
      pauseRule: normalized.sentenceRhythm.pauseRule,
      aiSmellPatterns: normalized.aiSmellPatterns,
      styleTaboos: normalized.styleTaboos,
    }),
  };
}

export function buildFallbackStyleProfile(input: {
  references: StyleReferenceSelection[];
  manualGuidance?: string;
  avoidances?: string;
  worldContext?: string;
  workshopContext?: string;
  draft?: Pick<FoundationWorkshopDraft, "mainline" | "desiredTone" | "storyHook"> | null;
}): StyleProfile {
  const defaults = createDefaultStyleProfile();
  const primary = input.references.find((reference) => reference.relation === "primary");
  const secondary = input.references
    .filter((reference) => reference.relation === "secondary")
    .map(renderReferenceSubject);
  const guidance = buildGuidanceSummary(input);
  const avoidances = compactText(input.avoidances);
  const worldTexture = compactText(input.worldContext) || compactText(input.draft?.desiredTone);

  return normalizeStyleProfile({
    referenceAnchor: {
      primary: primary ? renderReferenceSubject(primary) : defaults.referenceAnchor.primary,
      secondary,
    },
    paragraphCadence: {
      narrativeRule: guidance
        ? `以 ${guidance} 统摄叙述段，通常保持 2-5 句成段，避免流水账式断句。`
        : defaults.paragraphCadence.narrativeRule,
      dialogueRule: guidance
        ? `对白跟着人物动作和气口断开；${guidance.includes("对白") ? guidance : "对白不要只是传递信息"}`
        : defaults.paragraphCadence.dialogueRule,
      emphasisRule: "强调段只留给揭示、停顿、惊变或情绪断裂，不要拿它代替正常段落组织。",
    },
    sentenceRhythm: {
      pacingRule: guidance
        ? `句法节奏跟着 ${guidance} 调整，避免每句都像同一个模板。`
        : defaults.sentenceRhythm.pacingRule,
      transitionRule: "转场靠动作、视线、物件或情绪牵引完成，不写\u201c推进主线/信息投放\u201d式过桥句。",
      pauseRule: "停顿要落到人物呼吸、动作和环境细节，不要空白喊口号。",
    },
    narrativeDistance: {
      intimacyRule: "尽量贴近当下人物所见所感所误判，减少站在章节外解释。",
      expositionRule: avoidances
        ? `说明性旁白从严控制，尤其避免：${avoidances}`
        : defaults.narrativeDistance.expositionRule,
      textureRule: worldTexture
        ? `正文气口要被这层世界和关系气质托住：${worldTexture}`
        : defaults.narrativeDistance.textureRule,
    },
    dialogueStyle: {
      voiceRule: guidance
        ? `对白要保留 ${guidance} 的气口，但不能变成统一腔调。`
        : defaults.dialogueStyle.voiceRule,
      subtextRule: compactText(input.manualGuidance) || defaults.dialogueStyle.subtextRule,
      distinctionRule: "让人物身份、关系远近和当下压强决定说话方式，不直接替角色总结心理。",
    },
    imageryRegister: {
      densityRule: worldTexture
        ? `意象密度服从当前世界和人物压强：${worldTexture}`
        : defaults.imageryRegister.densityRule,
      textureRule: "修辞优先服务场景、触感和局势，不做空转金句。",
      avoid: unique([
        ...defaults.imageryRegister.avoid,
        ...avoidances.split(/[，,、；;。！？!\s]+/u).map((item) => item.trim()).filter((item) => item.length >= 2),
      ]),
    },
    forbiddenLexicon: collectForbiddenLexicon(input),
    toneGuardrails: unique([
      ...defaults.toneGuardrails,
      primary ? `整体笔法向 ${renderReferenceSubject(primary)} 靠拢，但不能复刻原句。` : "",
      worldTexture ? `不要让文气脱离当前世界气质：${worldTexture}` : "",
    ].filter(Boolean)),
    openingStrategy: primary
      ? `以 ${renderReferenceSubject(primary)} 的开篇节奏为基准，优先用场景或动作切入。`
      : defaults.openingStrategy,
    infoRevealRule: guidance
      ? `信息随场景自然露出，${guidance.includes("悬念") ? "优先延迟揭示" : "不做旁白解释"}。`
      : defaults.infoRevealRule,
    emotionRenderingRule: worldTexture
      ? `情绪通过身体反应和环境折射外化，贴合世界气质：${worldTexture}`
      : defaults.emotionRenderingRule,
    chapterClosureRule: primary
      ? `章末收束参考 ${renderReferenceSubject(primary)} 的节奏，留牵引不回钉。`
      : defaults.chapterClosureRule,
    aiSmellPatterns: defaults.aiSmellPatterns,
    styleTaboos: unique([
      ...defaults.styleTaboos,
      ...avoidances.split(/[，,、；;。！？!\s]+/u).map((item) => item.trim()).filter((item) => item.length >= 2),
    ]),
  });
}

export function formatStyleProfileForPrompt(profile: StyleProfile) {
  const writingCharter = profile.writingCharter ?? createDefaultStyleProfile().writingCharter!;
  return [
    `参考锚点：主参考=${profile.referenceAnchor.primary}${profile.referenceAnchor.secondary.length ? `；辅参考=${profile.referenceAnchor.secondary.join("、")}` : ""}`,
    `段落节奏：${profile.paragraphCadence.narrativeRule}`,
    `对白分段：${profile.paragraphCadence.dialogueRule}`,
    `强调短段：${profile.paragraphCadence.emphasisRule}`,
    `句法节奏：${profile.sentenceRhythm.pacingRule}`,
    `转场规则：${profile.sentenceRhythm.transitionRule}`,
    `停顿规则：${profile.sentenceRhythm.pauseRule}`,
    `叙述距离：${profile.narrativeDistance.intimacyRule}`,
    `说明密度：${profile.narrativeDistance.expositionRule}`,
    `正文质感：${profile.narrativeDistance.textureRule}`,
    `对白风格：${profile.dialogueStyle.voiceRule}`,
    `潜台词：${profile.dialogueStyle.subtextRule}`,
    `角色区分：${profile.dialogueStyle.distinctionRule}`,
    `修辞策略：${profile.rhetoricRegister.densityRule}`,
    `偏好修辞：${profile.rhetoricRegister.preferredDevices}`,
    `避免修辞模板：${profile.rhetoricRegister.avoidDevices.join("、") || "无"}`,
    `节奏DNA：${profile.narrativeRhythmDNA.pacingPattern}`,
    `张力波形：${profile.narrativeRhythmDNA.tensionRule}`,
    `段落呼吸：${profile.narrativeRhythmDNA.breathingRule}`,
    `情绪谱系：${profile.emotionSpectrum.renderingPreference}`,
    `情绪克制：${profile.emotionSpectrum.restraintRule}`,
    `情绪转折：${profile.emotionSpectrum.transitionRule}`,
    `深层笔触：${profile.deepTexture.perspectiveRule}`,
    `时间手法：${profile.deepTexture.temporalRule}`,
    `留白策略：${profile.deepTexture.whitespaceRule}`,
    `感官调色板：${profile.deepTexture.sensoryRule}`,
    `意象密度：${profile.imageryRegister.densityRule}`,
    `修辞质感：${profile.imageryRegister.textureRule}`,
    `避免修辞：${profile.imageryRegister.avoid.join("、") || "无"}`,
    `禁用词：${profile.forbiddenLexicon.join("、") || "无"}`,
    `风格护栏：${profile.toneGuardrails.join("；") || "无"}`,
    `开篇策略：${profile.openingStrategy}`,
    `信息投放规则：${profile.infoRevealRule}`,
    `情绪表达规则：${profile.emotionRenderingRule}`,
    `章末收束规则：${profile.chapterClosureRule}`,
    ...formatWritingCharterLines(writingCharter),
    ...buildWritingCharterPromptContract({
      writingCharter,
      stage: "writer",
    }),
    profile.aiSmellPatterns.length ? `AI味特征：${profile.aiSmellPatterns.join("；")}` : "",
    profile.styleTaboos.length ? `风格禁忌：${profile.styleTaboos.join("；")}` : "",
  ].filter(Boolean).join("\n");
}

const FIELD_FORMATTERS: Record<keyof StyleProfile, (profile: StyleProfile) => string[]> = {
  referenceAnchor: (p) => [
    `参考锚点：主参考=${p.referenceAnchor.primary}${p.referenceAnchor.secondary.length ? `；辅参考=${p.referenceAnchor.secondary.join("、")}` : ""}`,
  ],
  paragraphCadence: (p) => [
    `段落节奏：${p.paragraphCadence.narrativeRule}`,
    `对白分段：${p.paragraphCadence.dialogueRule}`,
    `强调短段：${p.paragraphCadence.emphasisRule}`,
  ],
  sentenceRhythm: (p) => [
    `句法节奏：${p.sentenceRhythm.pacingRule}`,
    `转场规则：${p.sentenceRhythm.transitionRule}`,
    `停顿规则：${p.sentenceRhythm.pauseRule}`,
  ],
  narrativeDistance: (p) => [
    `叙述距离：${p.narrativeDistance.intimacyRule}`,
    `说明密度：${p.narrativeDistance.expositionRule}`,
    `正文质感：${p.narrativeDistance.textureRule}`,
  ],
  dialogueStyle: (p) => [
    `对白风格：${p.dialogueStyle.voiceRule}`,
    `潜台词：${p.dialogueStyle.subtextRule}`,
    `角色区分：${p.dialogueStyle.distinctionRule}`,
  ],
  rhetoricRegister: (p) => [
    `修辞策略：${p.rhetoricRegister.densityRule}`,
    `偏好修辞：${p.rhetoricRegister.preferredDevices}`,
    `避免修辞模板：${p.rhetoricRegister.avoidDevices.join("、") || "无"}`,
  ],
  narrativeRhythmDNA: (p) => [
    `节奏DNA：${p.narrativeRhythmDNA.pacingPattern}`,
    `张力波形：${p.narrativeRhythmDNA.tensionRule}`,
    `段落呼吸：${p.narrativeRhythmDNA.breathingRule}`,
  ],
  emotionSpectrum: (p) => [
    `情绪谱系：${p.emotionSpectrum.renderingPreference}`,
    `情绪克制：${p.emotionSpectrum.restraintRule}`,
    `情绪转折：${p.emotionSpectrum.transitionRule}`,
  ],
  deepTexture: (p) => [
    `深层笔触：${p.deepTexture.perspectiveRule}`,
    `时间手法：${p.deepTexture.temporalRule}`,
    `留白策略：${p.deepTexture.whitespaceRule}`,
    `感官调色板：${p.deepTexture.sensoryRule}`,
  ],
  imageryRegister: (p) => [
    `意象密度：${p.imageryRegister.densityRule}`,
    `修辞质感：${p.imageryRegister.textureRule}`,
    `避免修辞：${p.imageryRegister.avoid.join("、") || "无"}`,
  ],
  forbiddenLexicon: (p) => [
    `禁用词：${p.forbiddenLexicon.join("、") || "无"}`,
  ],
  toneGuardrails: (p) => [
    `风格护栏：${p.toneGuardrails.join("；") || "无"}`,
  ],
  openingStrategy: (p) => [`开篇策略：${p.openingStrategy}`],
  infoRevealRule: (p) => [`信息投放规则：${p.infoRevealRule}`],
  emotionRenderingRule: (p) => [`情绪表达规则：${p.emotionRenderingRule}`],
  chapterClosureRule: (p) => [`章末收束规则：${p.chapterClosureRule}`],
  writingCharter: (p) => {
    const writingCharter = p.writingCharter ?? createDefaultStyleProfile().writingCharter!;
    return formatWritingCharterLines(writingCharter);
  },
  aiSmellPatterns: (p) =>
    p.aiSmellPatterns.length ? [`AI味特征：${p.aiSmellPatterns.join("；")}`] : [],
  styleTaboos: (p) =>
    p.styleTaboos.length ? [`风格禁忌：${p.styleTaboos.join("；")}`] : [],
};

export function formatStyleProfileForStage(profile: StyleProfile, stage: AgentStage): string {
  const fields = STAGE_FIELDS[stage];
  if (fields === "ALL") {
    return formatStyleProfileForPrompt(profile);
  }
  return fields
    .flatMap((field) => FIELD_FORMATTERS[field]?.(profile) ?? [])
    .filter(Boolean)
    .join("\n");
}

export function buildFallbackStyleSteeringCard(input: {
  references: StyleReferenceSelection[];
  manualGuidance?: string;
  avoidances?: string;
}) {
  const primary = input.references.find((reference) => reference.relation === "primary");
  const secondary = input.references.filter((reference) => reference.relation === "secondary");

  return [
    "风格约束卡",
    "",
    primary ? renderStyleReference(primary) : "主参考：以当前题材和设定自然生成，不做作者硬模仿。",
    ...(secondary.length ? secondary.map(renderStyleReference) : ["辅参考：无。"]),
    "",
    "允许借用：",
    input.manualGuidance?.trim() || "借用节奏、叙事密度、氛围组织和人物对话张力，不复刻具体句子。",
    "",
    "明确避免：",
    input.avoidances?.trim() || "避免解释性总结、平均句式、模板化转折和空泛心理复述。",
    "",
    "执行规则：",
    "只抽取可泛化的风格特征，不模仿具体作者的标志性措辞或句群。",
    "段落按正常小说习惯组织，非刻意强调时不要一句一段。",
    "不要把\u201c推进主线、阻力、升级危机\u201d等策划词直接写进正文。",
  ].join("\n");
}

export async function mapStyleFacets(input: {
  excerptBatch: StyleExcerpt[];
  batchIndex: number;
  totalBatches: number;
  genre?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleFacet> {
  const excerptText = input.excerptBatch
    .map((entry, index) => `--- 片段 ${index + 1} / ${entry.label} / ${entry.tags.join("/") || "narrative"} ---\n${entry.content}`)
    .join("\n\n");

  const userPrompt = [
    input.genre ? `题材：${input.genre}` : "",
    `分析批次：${input.batchIndex + 1}/${input.totalBatches}`,
    "",
    excerptText,
  ].filter(Boolean).join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: MAP_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    const parsed = parseLlmJsonObject(raw);
    if (!parsed) {
      console.error("[mapStyleFacets] raw LLM output (first 800 chars):", raw.slice(0, 800));
      throw new Error("map facet JSON parse failed");
    }
    return {
      narrativeDistance: String(parsed.narrativeDistance ?? ""),
      dialogueStyle: String(parsed.dialogueStyle ?? ""),
      emotionMethod: String(parsed.emotionMethod ?? ""),
      pacing: String(parsed.pacing ?? ""),
      distinctivePatterns: Array.isArray(parsed.distinctivePatterns)
        ? parsed.distinctivePatterns.map(String).filter(Boolean)
        : [],
      antiPatterns: Array.isArray(parsed.antiPatterns)
        ? parsed.antiPatterns.map(String).filter(Boolean)
        : [],
      rhetoricFingerprint: String(parsed.rhetoricFingerprint ?? "").trim(),
      narrativeRhythmDNA: String(parsed.narrativeRhythmDNA ?? "").trim(),
      emotionSpectrum: String(parsed.emotionSpectrum ?? "").trim(),
      deepTextureTraits: String(parsed.deepTextureTraits ?? "").trim(),
      sensoryPalette: String(parsed.sensoryPalette ?? "").trim(),
    };
  } catch (err) {
    console.error(`[mapStyleFacets] batch ${input.batchIndex} failed:`, err instanceof Error ? err.message : err);
    return {
      narrativeDistance: "贴近 POV 即时感受",
      dialogueStyle: "对白自然留白",
      emotionMethod: "动作和感官外化",
      pacing: "长短句交替",
      distinctivePatterns: [],
      antiPatterns: [],
      rhetoricFingerprint: "修辞克制，优先低频而精准的比喻或对比。",
      narrativeRhythmDNA: "节奏以长短句错开为主，关键处短句收紧。",
      emotionSpectrum: "情绪偏克制，优先外化到动作和环境。",
      deepTextureTraits: "视角贴身，留白靠短段和断句完成。",
      sensoryPalette: "优先视觉、触觉和听觉。",
    };
  }
}

export function applyFingerprintToCharter(
  profile: StyleProfile,
  fingerprint: StyleFingerprint,
): StyleProfile {
  const charter = profile.writingCharter;
  if (!charter) {
    return profile;
  }
  const defaultCharter = createDefaultStyleProfile().writingCharter!;
  const rhetoricBudget = charter.rhetoricBudget ?? defaultCharter.rhetoricBudget;
  const sensoryBudget = charter.sensoryBudget ?? defaultCharter.sensoryBudget;
  const compatibleFingerprint = asCompatibleFingerprint(fingerprint);
  const rhetoric = compatibleFingerprint.rhetoric;
  const deepTexture = compatibleFingerprint.deepTexture;
  const emotion = compatibleFingerprint.emotionRendering;

  const dialogueRatioPercent = Math.round(fingerprint.dialogue.overallRatio * 100);
  const singleSentencePercent = Math.round(fingerprint.paragraphLength.singleSentenceRatio * 100);
  const pauseDensity = fingerprint.punctuation.ellipsis + fingerprint.punctuation.dash;
  const dialogueHeavy = fingerprint.dialogue.overallRatio >= 0.4;
  const dialogueLight = fingerprint.dialogue.overallRatio <= 0.2;
  const fragmentHeavy = fingerprint.paragraphLength.singleSentenceRatio >= 0.5;
  const fragmentLight = fingerprint.paragraphLength.singleSentenceRatio <= 0.18;
  const dialogueLedOpening =
    fingerprint.openingPattern.dialogueRatio >= Math.max(
      fingerprint.openingPattern.sceneRatio,
      fingerprint.openingPattern.actionRatio,
      fingerprint.openingPattern.introspectionRatio,
    )
    && fingerprint.openingPattern.dialogueRatio >= 0.32;
  const sceneLedOpening = fingerprint.openingPattern.sceneRatio >= 0.35;
  const actionLedOpening = fingerprint.openingPattern.actionRatio >= 0.28;
  const dominantDevice = rhetoric?.dominantDevice && rhetoric.dominantDevice !== "none"
    ? rhetoric.dominantDevice
    : rhetoricBudget.dominantDevice;
  const rhetoricalQuestionPerChapter = rhetoric?.rhetoricalQuestionCount != null
    ? Math.max(
      0,
      Math.round(finiteNumber(rhetoric.rhetoricalQuestionCount) / Math.max(1, fingerprint.chapter.count || 1)),
    )
    : rhetoricBudget.rhetoricalQuestionPerChapter;
  const sensoryDetailTarget = Math.max(
    0,
    finiteNumber(
      deepTexture?.sensoryDetailDensity,
      finiteNumber(emotion?.sensoryDetailDensity, sensoryBudget.sensoryDetailTargetPerThousand),
    ),
  );
  const calibratedPrimaryChannels = pickTopSensoryChannels(deepTexture?.sensoryChannelDistribution, 2);

  return {
    ...profile,
    writingCharter: {
      ...charter,
      chapterLengthRule: fingerprint.chapter.count >= 3
        ? `参考原作章均 ${fingerprint.chapter.averageWords} 字（范围 ${fingerprint.chapter.minWords}-${fingerprint.chapter.maxWords}），写满完整场景推进。`
        : charter.chapterLengthRule,
      openingMoveRule: dialogueLedOpening
        ? `开篇优先用对白或对峙中的一句话起势，再接动作和压迫，不先铺高空背景。`
        : sceneLedOpening
          ? `开篇先落场景压强和人物眼前所见，再把动作推出来，不先总结前情。`
          : actionLedOpening
            ? `开篇先把动作和异动推到台前，再补最少必要背景，不让起势发虚。`
            : charter.openingMoveRule,
      infoRevealRule: dialogueHeavy
        ? `对白占比约 ${dialogueRatioPercent}%，信息优先借对白碰撞和动作结果露出，不补长段语境解释。`
        : dialogueLight
          ? `对白占比约 ${dialogueRatioPercent}%，正文以叙述推进为主；对白只留必要碰撞，不靠长对话讲解设定。`
          : charter.infoRevealRule,
      transitionRule: fragmentHeavy
        ? `一句一段占比约 ${singleSentencePercent}%，允许碎段贴着动作和压迫感推进，但碎段也要形成连续镜头，不要切成口号。`
        : fragmentLight
          ? `一句一段占比约 ${singleSentencePercent}%，段落应以成组推进为主，不要把正常叙述硬拆成碎段。`
          : charter.transitionRule,
      pauseRule: pauseDensity >= 3
        ? `省略号与破折号密度偏高（合计 ${pauseDensity.toFixed(1)} / 千字），停顿可借断气和插入压住语势，但不要满页拖尾。`
        : pauseDensity <= 1
          ? `停顿主要靠动作、句号和段落切换完成，少用省略号或破折号制造假紧张。`
          : charter.pauseRule,
      subjectLeadBudget: {
        ...charter.subjectLeadBudget,
        maxPronounLeads: fingerprint.paragraphLength.singleSentenceRatio > 0.25
          ? Math.min(8, charter.subjectLeadBudget.maxPronounLeads + 2)
          : charter.subjectLeadBudget.maxPronounLeads,
      },
      simileBudget: {
        ...charter.simileBudget,
        maxPerChapter: pauseDensity >= 3
          ? Math.min(charter.simileBudget.maxPerChapter, 3)
          : pauseDensity <= 1
            ? Math.min(charter.simileBudget.maxPerChapter, 2)
            : charter.simileBudget.maxPerChapter,
      },
      transitionBudget: {
        ...charter.transitionBudget,
        maxAbruptTurns: fragmentHeavy
          ? Math.min(charter.transitionBudget.maxAbruptTurns + 1, 3)
          : fragmentLight
            ? Math.max(charter.transitionBudget.maxAbruptTurns - 1, 1)
            : charter.transitionBudget.maxAbruptTurns,
      },
      rhetoricBudget: {
        ...rhetoricBudget,
        simileDensityPerThousand: rhetoric?.simileDensity != null
          ? Math.max(0, finiteNumber(rhetoric.simileDensity, rhetoricBudget.simileDensityPerThousand))
          : rhetoricBudget.simileDensityPerThousand,
        personificationDensityPerThousand: rhetoric?.personificationCount != null
          ? Math.max(
            0,
            finiteNumber(rhetoric.personificationCount) / Math.max(1, finiteNumber(fingerprint.chapter.averageWords, 0) / 1000),
          )
          : rhetoricBudget.personificationDensityPerThousand,
        rhetoricalQuestionPerChapter,
        dominantDevice,
      },
      sensoryBudget: {
        ...sensoryBudget,
        sensoryDetailTargetPerThousand: sensoryDetailTarget,
        primaryChannels: calibratedPrimaryChannels.length
          ? calibratedPrimaryChannels
          : sensoryBudget.primaryChannels,
      },
    },
  };
}

export async function reduceStyleProfile(input: {
  facets: StyleFacet[];
  fingerprint: StyleFingerprint;
  genre?: string;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  const fingerprint = asCompatibleFingerprint(input.fingerprint);
  const facetSummary = input.facets
    .map((facet, index) => [
      `=== 切面 ${index + 1} ===`,
      `叙事距离：${facet.narrativeDistance}`,
      `对白风格：${facet.dialogueStyle}`,
      `情绪手法：${facet.emotionMethod}`,
      `节奏：${facet.pacing}`,
      `显著特征：${facet.distinctivePatterns.join("；") || "无"}`,
      `避免写法：${facet.antiPatterns.join("；") || "无"}`,
      `修辞指纹：${facet.rhetoricFingerprint || "无"}`,
      `节奏DNA：${facet.narrativeRhythmDNA || "无"}`,
      `情绪谱系：${facet.emotionSpectrum || "无"}`,
      `深层笔触：${facet.deepTextureTraits || "无"}`,
      `感官调色板：${facet.sensoryPalette || "无"}`,
    ].join("\n"))
    .join("\n\n");
  const rhetoric = fingerprint.rhetoric;
  const narrativeRhythm = fingerprint.narrativeRhythm;
  const emotionRendering = fingerprint.emotionRendering;
  const deepTexture = fingerprint.deepTexture;
  const sensoryChannelSummary = deepTexture?.sensoryChannelDistribution
    ? Object.entries(deepTexture.sensoryChannelDistribution)
      .map(([channel, ratio]) => `${channel}=${(finiteNumber(ratio) * 100).toFixed(0)}%`)
      .join("，")
    : "";
  const fingerprintSection = [
    "=== 文体指纹（确定性数据，以此为准）===",
    `句长：均值=${fingerprint.sentenceLength.mean.toFixed(1)}字，中位数=${fingerprint.sentenceLength.median}字，短句占${(fingerprint.sentenceLength.shortRatio * 100).toFixed(0)}%，中句占${(fingerprint.sentenceLength.mediumRatio * 100).toFixed(0)}%，长句占${(fingerprint.sentenceLength.longRatio * 100).toFixed(0)}%`,
    `段落：均值=${fingerprint.paragraphLength.mean.toFixed(0)}字，一句一段占比=${(fingerprint.paragraphLength.singleSentenceRatio * 100).toFixed(0)}%`,
    `对白：占比=${(fingerprint.dialogue.overallRatio * 100).toFixed(0)}%，平均长度=${fingerprint.dialogue.averageLength.toFixed(0)}字`,
    `标点每千字：逗号=${fingerprint.punctuation.comma.toFixed(1)}，句号=${fingerprint.punctuation.period.toFixed(1)}，感叹=${fingerprint.punctuation.exclamation.toFixed(1)}，问号=${fingerprint.punctuation.question.toFixed(1)}，省略号=${fingerprint.punctuation.ellipsis.toFixed(1)}，破折号=${fingerprint.punctuation.dash.toFixed(1)}`,
    rhetoric
      ? `修辞统计：主导修辞=${rhetoric.dominantDevice ?? "none"}；比喻密度=${finiteNumber(rhetoric.simileDensity, 0).toFixed(2)}/千字；拟人频次=${Math.max(0, Math.round(finiteNumber(rhetoric.personificationCount, 0)))}；反问频次=${Math.max(0, Math.round(finiteNumber(rhetoric.rhetoricalQuestionCount, 0)))}`
      : "",
    narrativeRhythm
      ? `叙事节奏：张力曲线=${narrativeRhythm.tensionCurveShape ?? "unknown"}；短促爆发占比=${(finiteNumber(narrativeRhythm.shortBurstRatio, 0) * 100).toFixed(0)}%；长流段占比=${(finiteNumber(narrativeRhythm.longFlowRatio, 0) * 100).toFixed(0)}%；波动系数=${finiteNumber(narrativeRhythm.rhythmVariance, 0).toFixed(2)}；段落呼吸=${narrativeRhythm.paragraphBreathingPattern ?? "mixed"}`
      : "",
    emotionRendering
      ? `情绪渲染：动作=${(finiteNumber(emotionRendering.actionBasedRatio, 0) * 100).toFixed(0)}%；环境=${(finiteNumber(emotionRendering.environmentBasedRatio, 0) * 100).toFixed(0)}%；内心=${(finiteNumber(emotionRendering.introspectionRatio, 0) * 100).toFixed(0)}%；潜台词=${(finiteNumber(emotionRendering.dialogueSubtextRatio, 0) * 100).toFixed(0)}%；克制度=${finiteNumber(emotionRendering.restraintScore, 0).toFixed(2)}；感官密度=${finiteNumber(emotionRendering.sensoryDetailDensity, 0).toFixed(2)}/千字`
      : "",
    deepTexture
      ? `深层纹理：视角切换=${Math.max(0, Math.round(finiteNumber(deepTexture.perspectiveShiftCount, 0)))}；时间装置=${Math.max(0, Math.round(finiteNumber(deepTexture.temporalDeviceCount, 0)))}；留白=${(finiteNumber(deepTexture.whitespaceRatio, 0) * 100).toFixed(0)}%；信息密度=${finiteNumber(deepTexture.informationDensity, 0).toFixed(2)}；意象簇=${Math.max(0, Math.round(finiteNumber(deepTexture.imageClusterCount, 0)))}；感官分布=${sensoryChannelSummary || "无"}`
      : "",
    fingerprint.chapter.count >= 2 ? `章节：${fingerprint.chapter.count}章，均值=${fingerprint.chapter.averageWords}字，范围${fingerprint.chapter.minWords}-${fingerprint.chapter.maxWords}字` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = [
    input.genre ? `题材：${input.genre}` : "",
    input.manualGuidance ? `用户补充指导：${input.manualGuidance}` : "",
    input.avoidances ? `明确回避：${input.avoidances}` : "",
    "",
    facetSummary,
    "",
    fingerprintSection,
    "",
    "请综合以上信息，只输出 17 字段的 LightweightStyleRules JSON。",
    "不要输出完整 StyleProfile，也不要输出 writingCharter。",
    "规则必须直指这部作品/作者的独特写法，避免任何放到别的小说也成立的空泛建议。",
    "signaturePatterns 只保留最有辨识度的 2-4 条写法；aiSmellPatterns 列出 AI 最容易写偏的地方。",
  ].filter(Boolean).join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: REDUCE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    const parsed = parseLlmJsonObject(raw);
    if (!parsed) {
      console.error("[reduceStyleProfile] raw LLM output (first 800 chars):", raw.slice(0, 800));
      throw new Error("reduce profile JSON parse failed");
    }
    const rules = normalizeLightweightStyleRules(parsed);
    if (!hasMeaningfulLightweightRules(rules)) {
      throw new Error("reduce profile JSON lacks meaningful lightweight rules");
    }
    return synthesizeStyleProfile(rules, input.fingerprint);
  } catch (err) {
    console.error("[reduceStyleProfile] failed:", err instanceof Error ? err.message : err);
    const fallback = buildFallbackStyleProfile({
      references: [],
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
    });
    return applyFingerprintToCharter(fallback, input.fingerprint);
  }
}

const INTERPRET_SYSTEM_PROMPT = `你是一位资深文学编辑。分析参考作品/作者的文风特征，拆解到可执行级别。
不模仿具体原句，只提取叙事技法层面的可泛化规律。
输出 JSON，字段：narrativeDistance, infoDelivery, paragraphRhythm, dialogueBreathing, emotionRendering, chapterClosure, forbiddenPatterns(数组), signature(一句话总结)。`;

/**
 * @deprecated Use `mapStyleFacets` + `reduceStyleProfile` for fingerprint-aware style analysis.
 */
export async function interpretStyleReference(input: {
  references: StyleReferenceSelection[];
  samples: string[];
  genre: string;
  premise: string;
  importedSourceSummary?: string;
  sampledExcerptEvidence?: StyleExcerpt[];
  mode?: StyleImportMode;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleReferenceInterpretation> {
  const primary = input.references.find((r) => r.relation === "primary");
  const secondary = input.references.filter((r) => r.relation === "secondary");

  const referenceDesc = [
    primary ? `主参考：${renderReferenceSubject(primary)}` : "",
    ...secondary.map((r) => `辅参考：${renderReferenceSubject(r)}`),
  ].filter(Boolean).join("\n");

  const samplesSection = input.samples.length
    ? `\n代表性样本文本（用于校准风格理解）：\n${input.samples.map((s, i) => `--- 样本 ${i + 1} ---\n${s}`).join("\n")}`
    : "";
  const importedSourceSummary = input.importedSourceSummary?.trim()
    ? `\n导入源摘要（仅作为风格证据，不代表可直接复用的原文）：\n${input.importedSourceSummary.trim()}`
    : "";
  const sampledExcerptEvidence = input.sampledExcerptEvidence?.length
    ? `\n抽样证据（只用于理解笔法，不允许在输出里复刻原句）：\n${
      input.sampledExcerptEvidence
        .slice(0, 12)
        .map((entry, index) => `--- 证据 ${index + 1} / ${entry.sourceTitle} / ${entry.label} / ${entry.tags.join("/") || "narrative"} ---\n${entry.content}`)
        .join("\n")
    }`
    : "";

  const userPrompt = [
    `分析模式：${input.mode ?? "book"}`,
    `题材：${input.genre}`,
    `故事前提：${input.premise}`,
    referenceDesc,
    importedSourceSummary,
    samplesSection,
    sampledExcerptEvidence,
    "",
    "请从以下 7 个维度分析这个参考风格：",
    "1. narrativeDistance: 叙事距离——作者站多远？用什么视角？解释多不多？",
    "2. infoDelivery: 信息投放——关键信息提前铺还是延迟揭？用旁白、对话还是行动？",
    "3. paragraphRhythm: 段落节奏——长段还是碎段？对白密度如何？场景转换快慢？",
    "4. dialogueBreathing: 对白气口——角色怎么说话？留白多不多？打断和省略的习惯？",
    "5. emotionRendering: 情绪外化——直写内心还是动作暗示？用环境映射还是身体反应？",
    "6. chapterClosure: 章末处理——留钩还是封合？回顾总结还是戛然而止？",
    "7. forbiddenPatterns: 这种风格最忌讳什么？列出 3-6 条。",
    "8. signature: 一句话风格签名。",
  ].filter(Boolean).join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: INTERPRET_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    const parsed = safeParseJson<Record<string, unknown>>(
      raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim(),
    );
    if (!parsed) {
      throw new Error("style interpretation JSON 无法解析");
    }
    return {
      narrativeDistance: String(parsed.narrativeDistance ?? ""),
      infoDelivery: String(parsed.infoDelivery ?? ""),
      paragraphRhythm: String(parsed.paragraphRhythm ?? ""),
      dialogueBreathing: String(parsed.dialogueBreathing ?? ""),
      emotionRendering: String(parsed.emotionRendering ?? ""),
      chapterClosure: String(parsed.chapterClosure ?? ""),
      forbiddenPatterns: Array.isArray(parsed.forbiddenPatterns)
        ? parsed.forbiddenPatterns.map(String)
        : [],
      signature: String(parsed.signature ?? ""),
    };
  } catch (err) {
    console.error("[interpretStyleReference] failed:", err instanceof Error ? err.message : err);
    return {
      narrativeDistance: "贴近 POV 即时感受",
      infoDelivery: "信息随场景自然露出",
      paragraphRhythm: "2-5 句成段，对白与叙述交替",
      dialogueBreathing: "对白留白自然，不解释",
      emotionRendering: "动作和感官外化为主",
      chapterClosure: "留悬念，不回钉总结",
      forbiddenPatterns: ["解释腔", "总结式旁白", "平均句式"],
      signature: "场景驱动、动作推进的自然叙事",
    };
  }
}

const COMPILE_SYSTEM_PROMPT = `你是风格规则编译器。把参考风格解读转化成具体的写作执行规则。
每条规则必须是祈使句，可以直接放进 LLM 的 system prompt 执行。
不模仿具体原句措辞，只抽取叙事技法。
输出 JSON，包含 StyleProfile 的所有字段，以及嵌套 writingCharter。`;

/**
 * @deprecated Use `mapStyleFacets` + `reduceStyleProfile` for fingerprint-aware style analysis.
 */
export async function compileStyleProfile(input: {
  interpretation: StyleReferenceInterpretation;
  baseProfile: StyleProfile;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  const interp = input.interpretation;
  const userPrompt = [
    "风格解读摘要：",
    `叙事距离：${interp.narrativeDistance}`,
    `信息投放：${interp.infoDelivery}`,
    `段落节奏：${interp.paragraphRhythm}`,
    `对白气口：${interp.dialogueBreathing}`,
    `情绪外化：${interp.emotionRendering}`,
    `章末处理：${interp.chapterClosure}`,
    `禁忌模式：${interp.forbiddenPatterns.join("、")}`,
    `风格签名：${interp.signature}`,
    input.manualGuidance ? `\n用户补充指导：${input.manualGuidance}` : "",
    input.avoidances ? `\n明确回避：${input.avoidances}` : "",
    "",
    "请生成完整的 StyleProfile JSON。每个规则字段都必须是具体的祈使句指令。",
    "重点：openingStrategy, infoRevealRule, emotionRenderingRule, chapterClosureRule 必须直接反映上面的风格解读。",
    "必须额外输出完整的 writingCharter，其中至少包含 chapterLengthRule, openingMoveRule, infoRevealRule, mechanismRevealRule, mechanismRevealRedlines, emotionLandingRule, chapterClosureRule, transitionRule, pauseRule, endingPolicy, mechanismRevealPolicy, transitionBudget, simileBudget, subjectLeadBudget, motifReuseBudget, aiFlavorAvoidance, tabooReminders。",
    "其中 mechanismRevealRule 和 mechanismRevealRedlines 要特别约束“机制类信息先撞上后果，再补辨认”，禁止解释 -> 验证 -> 总结三段式。",
    "motifReuseBudget 要能约束同一意象/词块在一章里反复回钉，至少给出 maxPerMotif, minParagraphSpan, minMotifLength, stopwords。",
    "aiSmellPatterns 要列出这种风格最容易被 AI 写偏的特征（如解释过早、对白太直等）。",
    "styleTaboos 要列出这种风格最忌讳的写法。",
  ].filter(Boolean).join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: COMPILE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);
    const parsed = safeParseJson<Record<string, unknown>>(
      raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim(),
    );
    if (!parsed) {
      throw new Error("style profile JSON 无法解析");
    }
    return normalizeStyleProfile(parsed);
  } catch (err) {
    console.error("[compileStyleProfile] failed:", err instanceof Error ? err.message : err);
    return applyInterpretationToProfile(input.interpretation, input.baseProfile);
  }
}

function applyInterpretationToProfile(
  interp: StyleReferenceInterpretation,
  base: StyleProfile,
): StyleProfile {
  return normalizeStyleProfile({
    ...base,
    narrativeDistance: {
      ...base.narrativeDistance,
      intimacyRule: interp.narrativeDistance || base.narrativeDistance.intimacyRule,
    },
    openingStrategy: interp.paragraphRhythm
      ? `${interp.paragraphRhythm.includes("快") ? "快速切入场景" : "以场景或动作切入"}，不用总结式开场白。`
      : base.openingStrategy,
    infoRevealRule: interp.infoDelivery || base.infoRevealRule,
    emotionRenderingRule: interp.emotionRendering || base.emotionRenderingRule,
    chapterClosureRule: interp.chapterClosure || base.chapterClosureRule,
    aiSmellPatterns: unique([
      ...base.aiSmellPatterns,
      ...interp.forbiddenPatterns.filter((p) => p.length >= 2),
    ]),
    styleTaboos: unique([
      ...base.styleTaboos,
      ...interp.forbiddenPatterns.filter((p) => p.length >= 2),
    ]),
  });
}
