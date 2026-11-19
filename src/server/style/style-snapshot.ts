import type {
  FoundationWorkshopDraft,
  StyleCardSnapshot,
  StyleConfidence,
  StyleExcerpt,
  StyleImportMode,
  StyleProfile,
  StyleReferenceInterpretation,
  StyleReferenceSelection,
} from "../types.ts";
import { nowIso, unique } from "../utils.ts";
import { trimExcerptForExemplar } from "./style-reference-import.ts";
import {
  applyFingerprintToCharter,
  batchExcerpts,
  buildFallbackStyleProfile,
  compileStyleProfile,
  interpretStyleReference,
  mapStyleFacets,
  normalizeStyleProfile,
  reduceStyleProfile,
  type StyleFacet,
} from "./style-steering.ts";
import { computeStyleFingerprint, type StyleFingerprint } from "../style-fingerprint.ts";
import { splitStyleReferenceSections } from "./style-reference-import.ts";
import { iterativeStyleConvergence } from "../style-convergence.ts";
import type { ChatMessage } from "../llm.ts";
import { safeParseJson } from "../utils/safe-json.ts";

const MIN_DIGEST_CHARS = 1_200;
const MAX_DIGEST_CHARS = 1_800;
const MIN_RUNTIME_EXEMPLAR_CHARS = 120;
const MAX_RUNTIME_EXEMPLAR_CHARS = 320;

export interface StyleGenerationImport {
  id: string;
  title: string;
  author?: string;
  wordCount: number;
  confidence: StyleConfidence;
  excerpts: StyleExcerpt[];
  encoding?: string | null;
  normalizedText?: string;
  fingerprint?: StyleFingerprint | null;
}

export interface GenerateStyleCardFromExcerptsInput {
  mode: StyleImportMode;
  imports: StyleGenerationImport[];
  genre?: string;
  premise?: string;
  draft?: Pick<FoundationWorkshopDraft, "mainline" | "desiredTone" | "storyHook"> | null;
  references?: StyleReferenceSelection[];
  samples?: string[];
  manualGuidance?: string;
  avoidances?: string;
  worldContext?: string;
  workshopContext?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}

export interface GeneratedStyleCardData {
  mode: StyleImportMode;
  sourceIds: string[];
  styleCard: string;
  styleProfile: StyleProfile;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  sampledExcerpts: StyleExcerpt[];
  confidence: StyleConfidence;
  fingerprint?: StyleFingerprint | null;
}

export interface GenerateStyleSnapshotInput extends GenerateStyleCardFromExcerptsInput {
  id: string;
  projectId: string;
  version: number;
  createdAt?: string;
}

const DEFAULT_WRITER_SYSTEM_PROMPT = [
  "你是小说主笔 Writer。",
  "只输出正文，不解释你的决定。",
  "保留动作推进、对白留白和情绪外化，不写策划稿腔。",
].join("\n");

function fallbackInterpretation(signature: string): StyleReferenceInterpretation {
  return {
    narrativeDistance: "贴近当前人物视角，不用高空总结收束情节。",
    infoDelivery: "关键信息通过行动、细节和对白逐层露出，不提前旁白解释。",
    paragraphRhythm: "叙述段与对白段自然交替，关键动作和情绪点允许短段收紧。",
    dialogueBreathing: "对白保留气口、留白和关系压强，不把结论直接说透。",
    emotionRendering: "情绪依靠身体反应、环境牵引和动作后果外化。",
    chapterClosure: "章末留后患、留余震，不做总结式回钉。",
    forbiddenPatterns: ["解释腔", "平均句式", "空转比喻"],
    signature,
  };
}

function deriveReferences(mode: StyleImportMode, imports: StyleGenerationImport[], explicit?: StyleReferenceSelection[]) {
  if (explicit?.length) {
    return explicit;
  }

  if (mode === "author") {
    const author = imports[0]?.author?.trim() || imports[0]?.title || "作者参考";
    const primaryReference: StyleReferenceSelection = {
      kind: "author",
      label: author,
      source: "ai_fallback",
      relation: "primary",
    };
    return [
      primaryReference,
      ...imports.slice(0, 2).map((entry): StyleReferenceSelection => ({
        kind: "book",
        label: entry.title,
        author: entry.author,
        source: "ai_fallback",
        relation: "secondary",
      })),
    ].slice(0, 3);
  }

  return imports.slice(0, 3).map((entry, index): StyleReferenceSelection => ({
    kind: "book",
    label: entry.title,
    author: entry.author,
    source: "ai_fallback",
    relation: index === 0 ? "primary" : "secondary",
  }));
}

function buildImportedSourceSummary(mode: StyleImportMode, imports: StyleGenerationImport[]) {
  const lines = imports.map((entry) => {
    const tags = unique(entry.excerpts.flatMap((excerpt) => excerpt.tags)).join(" / ");
    return `来源：${entry.title}${entry.author ? ` / ${entry.author}` : ""}；字数=${entry.wordCount}；编码=${entry.encoding ?? "unknown"}；抽样覆盖=${tags || "narrative"}`;
  });

  if (mode === "author") {
    lines.push("聚合规则：只保留至少 60% 书目都稳定出现的写法，不把单本偶发现象当成作者恒定特征。");
  }

  return lines.join("\n");
}

function medianNumber(values: number[]) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function mergeFingerprintsToMedianFingerprint(fingerprints: StyleFingerprint[]) {
  if (!fingerprints.length) {
    return null;
  }

  return {
    sentenceLength: {
      mean: medianNumber(fingerprints.map((entry) => entry.sentenceLength.mean)),
      median: medianNumber(fingerprints.map((entry) => entry.sentenceLength.median)),
      stddev: medianNumber(fingerprints.map((entry) => entry.sentenceLength.stddev)),
      shortRatio: medianNumber(fingerprints.map((entry) => entry.sentenceLength.shortRatio)),
      mediumRatio: medianNumber(fingerprints.map((entry) => entry.sentenceLength.mediumRatio)),
      longRatio: medianNumber(fingerprints.map((entry) => entry.sentenceLength.longRatio)),
    },
    paragraphLength: {
      mean: medianNumber(fingerprints.map((entry) => entry.paragraphLength.mean)),
      median: medianNumber(fingerprints.map((entry) => entry.paragraphLength.median)),
      singleSentenceRatio: medianNumber(fingerprints.map((entry) => entry.paragraphLength.singleSentenceRatio)),
    },
    dialogue: {
      overallRatio: medianNumber(fingerprints.map((entry) => entry.dialogue.overallRatio)),
      averageLength: medianNumber(fingerprints.map((entry) => entry.dialogue.averageLength)),
      averageSurroundingAction: medianNumber(fingerprints.map((entry) => entry.dialogue.averageSurroundingAction)),
    },
    punctuation: {
      comma: medianNumber(fingerprints.map((entry) => entry.punctuation.comma)),
      period: medianNumber(fingerprints.map((entry) => entry.punctuation.period)),
      exclamation: medianNumber(fingerprints.map((entry) => entry.punctuation.exclamation)),
      question: medianNumber(fingerprints.map((entry) => entry.punctuation.question)),
      ellipsis: medianNumber(fingerprints.map((entry) => entry.punctuation.ellipsis)),
      dash: medianNumber(fingerprints.map((entry) => entry.punctuation.dash)),
      semicolon: medianNumber(fingerprints.map((entry) => entry.punctuation.semicolon)),
    },
    chapter: {
      count: Math.round(medianNumber(fingerprints.map((entry) => entry.chapter.count))),
      averageWords: Math.round(medianNumber(fingerprints.map((entry) => entry.chapter.averageWords))),
      minWords: Math.round(medianNumber(fingerprints.map((entry) => entry.chapter.minWords))),
      maxWords: Math.round(medianNumber(fingerprints.map((entry) => entry.chapter.maxWords))),
    },
    openingPattern: {
      sceneRatio: medianNumber(fingerprints.map((entry) => entry.openingPattern.sceneRatio)),
      dialogueRatio: medianNumber(fingerprints.map((entry) => entry.openingPattern.dialogueRatio)),
      actionRatio: medianNumber(fingerprints.map((entry) => entry.openingPattern.actionRatio)),
      introspectionRatio: medianNumber(fingerprints.map((entry) => entry.openingPattern.introspectionRatio)),
    },
    vocabulary: {
      uniqueRatio: medianNumber(fingerprints.map((entry) => entry.vocabulary.uniqueRatio)),
      topBigrams: unique(fingerprints.flatMap((entry) => entry.vocabulary.topBigrams)).slice(0, 20),
    },
    rhetoric: {
      simileCount: Math.round(medianNumber(fingerprints.map((entry) => entry.rhetoric.simileCount))),
      simileDensity: medianNumber(fingerprints.map((entry) => entry.rhetoric.simileDensity)),
      personificationCount: Math.round(medianNumber(fingerprints.map((entry) => entry.rhetoric.personificationCount))),
      synesthesiaCount: Math.round(medianNumber(fingerprints.map((entry) => entry.rhetoric.synesthesiaCount))),
      contrastCount: Math.round(medianNumber(fingerprints.map((entry) => entry.rhetoric.contrastCount))),
      contrastIronyCount: Math.round(medianNumber(fingerprints.map((entry) => entry.rhetoric.contrastIronyCount))),
      rhetoricalQuestionCount: Math.round(medianNumber(fingerprints.map((entry) => entry.rhetoric.rhetoricalQuestionCount))),
      dominantDevice: fingerprints.map((entry) => entry.rhetoric.dominantDevice).find((entry) => entry !== "none") ?? "none",
    },
    narrativeRhythm: {
      sceneChangeFrequency: medianNumber(fingerprints.map((entry) => entry.narrativeRhythm.sceneChangeFrequency)),
      tensionCurveShape: fingerprints.map((entry) => entry.narrativeRhythm.tensionCurveShape).find(Boolean) ?? "plateau",
      shortBurstRatio: medianNumber(fingerprints.map((entry) => entry.narrativeRhythm.shortBurstRatio)),
      longFlowRatio: medianNumber(fingerprints.map((entry) => entry.narrativeRhythm.longFlowRatio)),
      rhythmVariance: medianNumber(fingerprints.map((entry) => entry.narrativeRhythm.rhythmVariance)),
      paragraphBreathingPattern: fingerprints.map((entry) => entry.narrativeRhythm.paragraphBreathingPattern).find(Boolean) ?? "mixed",
    },
    emotionRendering: {
      actionBasedRatio: medianNumber(fingerprints.map((entry) => entry.emotionRendering.actionBasedRatio)),
      environmentBasedRatio: medianNumber(fingerprints.map((entry) => entry.emotionRendering.environmentBasedRatio)),
      introspectionRatio: medianNumber(fingerprints.map((entry) => entry.emotionRendering.introspectionRatio)),
      dialogueSubtextRatio: medianNumber(fingerprints.map((entry) => entry.emotionRendering.dialogueSubtextRatio)),
      sensoryDetailDensity: medianNumber(fingerprints.map((entry) => entry.emotionRendering.sensoryDetailDensity)),
      restraintScore: medianNumber(fingerprints.map((entry) => entry.emotionRendering.restraintScore)),
    },
    deepTexture: {
      perspectiveShiftCount: Math.round(medianNumber(fingerprints.map((entry) => entry.deepTexture.perspectiveShiftCount))),
      temporalDeviceCount: Math.round(medianNumber(fingerprints.map((entry) => entry.deepTexture.temporalDeviceCount))),
      whitespaceRatio: medianNumber(fingerprints.map((entry) => entry.deepTexture.whitespaceRatio)),
      informationDensity: medianNumber(fingerprints.map((entry) => entry.deepTexture.informationDensity)),
      imageClusterCount: Math.round(medianNumber(fingerprints.map((entry) => entry.deepTexture.imageClusterCount))),
      sensoryDetailDensity: medianNumber(fingerprints.map((entry) => entry.deepTexture.sensoryDetailDensity)),
      sensoryChannelDistribution: {
        visual: medianNumber(fingerprints.map((entry) => entry.deepTexture.sensoryChannelDistribution.visual)),
        auditory: medianNumber(fingerprints.map((entry) => entry.deepTexture.sensoryChannelDistribution.auditory)),
        olfactory: medianNumber(fingerprints.map((entry) => entry.deepTexture.sensoryChannelDistribution.olfactory)),
        gustatory: medianNumber(fingerprints.map((entry) => entry.deepTexture.sensoryChannelDistribution.gustatory)),
        tactile: medianNumber(fingerprints.map((entry) => entry.deepTexture.sensoryChannelDistribution.tactile)),
        kinesthetic: medianNumber(fingerprints.map((entry) => entry.deepTexture.sensoryChannelDistribution.kinesthetic)),
      },
    },
  } satisfies StyleFingerprint;
}

async function mergeBookProfilesToAuthorProfile(input: {
  bookResults: Array<{
    title: string;
    styleProfile: StyleProfile;
    fingerprint: StyleFingerprint | null;
  }>;
  manualGuidance?: string;
  avoidances?: string;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<StyleProfile> {
  const mergeSystemPrompt = `你是风格合并专家。你会收到多本书的独立风格分析。

任务：找出跨书稳定出现的写法特征，合并为一个作者级风格档案。

规则：
- 至少 60% 书目都出现的特征 -> 纳入作者风格
- 只出现在 1 本书中的特征 -> 标记为该书特有，不纳入
- 数值指标取各书的中位数
- 输出完整的 StyleProfile JSON，包含嵌套 writingCharter`;

  const booksSection = input.bookResults
    .map((book, index) => {
      const fingerprint = book.fingerprint;
      return [
        `=== 书目 ${index + 1}：${book.title} ===`,
        `叙事距离：${book.styleProfile.narrativeDistance.intimacyRule}`,
        `对白风格：${book.styleProfile.dialogueStyle.voiceRule}`,
        `情绪手法：${book.styleProfile.emotionRenderingRule}`,
        `开篇策略：${book.styleProfile.openingStrategy}`,
        `章末策略：${book.styleProfile.chapterClosureRule}`,
        fingerprint
          ? `文体指纹：句均${fingerprint.sentenceLength.mean.toFixed(0)}字，对白占${(fingerprint.dialogue.overallRatio * 100).toFixed(0)}%，章均${fingerprint.chapter.averageWords}字`
          : "",
      ].filter(Boolean).join("\n");
    })
    .join("\n\n");

  const mergedFingerprint = mergeFingerprintsToMedianFingerprint(
    input.bookResults.map((entry) => entry.fingerprint).filter((entry): entry is StyleFingerprint => Boolean(entry)),
  );

  const userPrompt = [
    booksSection,
    input.manualGuidance ? `用户补充指导：${input.manualGuidance}` : "",
    input.avoidances ? `明确回避：${input.avoidances}` : "",
    "",
    "请只保留跨书稳定出现的作者级写法。",
  ].filter(Boolean).join("\n");

  try {
    const raw = await input.llmCall([
      { role: "system", content: mergeSystemPrompt },
      { role: "user", content: userPrompt },
    ]);
    const parsed = JSON.parse(raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim()) as Record<string, unknown>;
    const merged = normalizeStyleProfile(parsed);
    return mergedFingerprint ? applyFingerprintToCharter(merged, mergedFingerprint) : merged;
  } catch {
    const fallback = buildFallbackStyleProfile({
      references: [],
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
    });
    return mergedFingerprint ? applyFingerprintToCharter(fallback, mergedFingerprint) : fallback;
  }
}

function hydrateStyleExemplar(excerpts: StyleExcerpt[], index: number) {
  const base = excerpts[index];
  if (!base) {
    throw new Error("style exemplar hydrate 失败：抽样片段不存在");
  }

  const collected = [base];
  let combined = base.content;
  let normalized = trimExcerptForExemplar(combined, MIN_RUNTIME_EXEMPLAR_CHARS, MAX_RUNTIME_EXEMPLAR_CHARS);

  if (normalized.length >= MIN_RUNTIME_EXEMPLAR_CHARS) {
    return {
      ...base,
      content: normalized,
    };
  }

  for (let distance = 1; distance < excerpts.length; distance += 1) {
    for (const neighborIndex of [index + distance, index - distance]) {
      const neighbor = excerpts[neighborIndex];
      if (!neighbor || neighbor.sourceId !== base.sourceId || collected.some((entry) => entry.id === neighbor.id)) {
        continue;
      }
      collected.push(neighbor);
      combined = neighborIndex < index
        ? `${neighbor.content}\n\n${combined}`
        : `${combined}\n\n${neighbor.content}`;
      normalized = trimExcerptForExemplar(combined, MIN_RUNTIME_EXEMPLAR_CHARS, MAX_RUNTIME_EXEMPLAR_CHARS);
      if (normalized.length >= MIN_RUNTIME_EXEMPLAR_CHARS) {
        return {
          ...base,
          content: normalized,
          tags: unique(collected.flatMap((entry) => entry.tags)),
        };
      }
    }
  }

  return {
    ...base,
    content: normalized,
    tags: unique(collected.flatMap((entry) => entry.tags)),
  };
}

function selectStyleExemplars(excerpts: StyleExcerpt[], confidence: StyleConfidence) {
  const targetCount = confidence === "low" ? 2 : confidence === "medium" ? 3 : 4;
  const selected: StyleExcerpt[] = [];
  const usedLabels = new Set<string>();
  const usedExemplarTexts = new Set<string>();

  const bucketForExemplar = (entry: StyleExcerpt) => {
    if (entry.positionRatio <= 0.25) {
      return "opening";
    }
    if (entry.positionRatio >= 0.7) {
      return "ending";
    }
    return "middle";
  };

  const scoreExemplar = (entry: StyleExcerpt, options: {
    tag?: StyleExcerpt["tags"][number];
    bucket?: "opening" | "middle" | "ending";
  } = {}) => {
    const lengthScore = 48 - (Math.abs(entry.content.length - 220) / 8);
    const tagScore = entry.tags.length * 8;
    const dialoguePenalty = entry.dialogueRatio > 0.9 ? 10 : 0;
    const labelBonus = usedLabels.has(entry.label) ? -12 : 18;
    const bucketBonus = options.bucket && bucketForExemplar(entry) === options.bucket ? 22 : 0;
    const tagBonus = options.tag && entry.tags.includes(options.tag) ? 18 : 0;

    return lengthScore + tagScore + bucketBonus + tagBonus + labelBonus - dialoguePenalty;
  };

  const pushExemplar = (entry: StyleExcerpt, allowDuplicateText = false) => {
    const normalizedText = entry.content.trim();
    if (!normalizedText || (!allowDuplicateText && usedExemplarTexts.has(normalizedText))) {
      return false;
    }
    selected.push(entry);
    usedLabels.add(entry.label);
    usedExemplarTexts.add(normalizedText);
    return true;
  };

  const pickBest = (options: {
    tag?: StyleExcerpt["tags"][number];
    bucket?: "opening" | "middle" | "ending";
    allowUsedLabel?: boolean;
    blockedIds?: Set<string>;
  } = {}) => {
    const candidates = excerpts
      .map((entry, index) => ({ entry: hydrateStyleExemplar(excerpts, index), index }))
      .filter(({ entry }) =>
        !selected.some((picked) => picked.id === entry.id)
        && !options.blockedIds?.has(entry.id)
        && (!options.tag || entry.tags.includes(options.tag))
        && (!options.bucket || bucketForExemplar(entry) === options.bucket)
        && (options.allowUsedLabel || !usedLabels.has(entry.label))
      );

    if (!candidates.length) {
      return null;
    }

    candidates.sort((left, right) => scoreExemplar(right.entry, options) - scoreExemplar(left.entry, options));
    return candidates[0]?.entry ?? null;
  };

  const trySelectCandidate = (options: {
    tag?: StyleExcerpt["tags"][number];
    bucket?: "opening" | "middle" | "ending";
    allowUsedLabel?: boolean;
    allowDuplicateText?: boolean;
  } = {}) => {
    const blockedIds = new Set<string>();
    while (true) {
      const candidate = pickBest({
        ...options,
        blockedIds,
      });
      if (!candidate) {
        return false;
      }
      if (pushExemplar(candidate, options.allowDuplicateText)) {
        return true;
      }
      blockedIds.add(candidate.id);
    }
  };

  const bucketTargets =
    targetCount === 2
      ? ["opening", "ending"] as const
      : ["opening", "middle", "ending"] as const;

  for (const bucket of bucketTargets) {
    const picked =
      trySelectCandidate({ bucket, allowDuplicateText: true })
      || trySelectCandidate({ bucket, allowUsedLabel: true, allowDuplicateText: true });
    if (!picked) {
      continue;
    }
    if (selected.length >= targetCount) {
      break;
    }
  }

  for (const tag of ["hook", "mechanism", "pressure", "silence", "conflict", "emotion", "dialogue", "narrative"] as const) {
    if (selected.length >= targetCount) {
      break;
    }
    const picked =
      trySelectCandidate({ tag })
      || trySelectCandidate({ tag, allowUsedLabel: true });
    if (!picked) {
      continue;
    }
  }

  while (selected.length < targetCount) {
    const picked =
      trySelectCandidate()
      || trySelectCandidate({ allowUsedLabel: true });
    if (!picked) {
      break;
    }
  }

  if (selected.length < targetCount) {
    for (let index = 0; index < excerpts.length; index += 1) {
      if (selected.length >= targetCount) {
        break;
      }
      const candidate = hydrateStyleExemplar(excerpts, index);
      if (selected.some((picked) => picked.id === candidate.id)) {
        continue;
      }
      pushExemplar(candidate, true);
    }
  }

  return selected.slice(0, targetCount);
}

function buildSnapshotDigest(input: {
  mode: StyleImportMode;
  imports: StyleGenerationImport[];
  styleProfile: StyleProfile;
  exemplars: StyleExcerpt[];
  confidence: StyleConfidence;
  importedSourceSummary: string;
}) {
  const sourceLine = input.imports.map((entry) => `${entry.title}${entry.author ? ` / ${entry.author}` : ""}`).join("、");
  const writingCharter = input.styleProfile.writingCharter;
  const digestFingerprint = mergeFingerprintsToMedianFingerprint(
    input.imports
      .map((entry) => entry.fingerprint)
      .filter((entry): entry is StyleFingerprint => Boolean(entry)),
  );
  const sceneCoverage = unique(
    input.exemplars.flatMap((entry) => entry.tags.filter((tag) => ["mechanism", "pressure", "silence", "hook"].includes(tag))),
  );
  const sections = [
    `${input.mode === "author" ? "作者" : "作品"}风格快照围绕 ${sourceLine} 建立，当前置信度为 ${input.confidence}。这份摘要只沉淀可长期注入的笔法边界，不复述整书剧情，也不保留整段原文。`,
    `${buildFingerprintDigestLine(digestFingerprint)} 以上量化指标用于锚定修辞偏好、节奏 DNA、情绪渲染策略与深层笔触取向。`,
    `叙述距离上，${input.styleProfile.narrativeDistance.intimacyRule} 信息露出上，${input.styleProfile.infoRevealRule} 开篇进入时，${input.styleProfile.openingStrategy} 章末处理上，${input.styleProfile.chapterClosureRule}`,
    `段落节奏以 ${input.styleProfile.paragraphCadence.narrativeRule} 为主，对白换段遵循 ${input.styleProfile.paragraphCadence.dialogueRule}，强调短段只留给 ${input.styleProfile.paragraphCadence.emphasisRule}`,
    `句法层面要求 ${input.styleProfile.sentenceRhythm.pacingRule}，转场必须 ${input.styleProfile.sentenceRhythm.transitionRule}，停顿要 ${input.styleProfile.sentenceRhythm.pauseRule}`,
    `修辞手法偏好上，${input.styleProfile.rhetoricRegister.densityRule}，常用手法是 ${input.styleProfile.rhetoricRegister.preferredDevices || "克制修辞"}，明确回避 ${input.styleProfile.rhetoricRegister.avoidDevices.join("、") || "空泛修辞"}`,
    `叙事节奏 DNA 呈现为 ${input.styleProfile.narrativeRhythmDNA.pacingPattern}；张力推进遵循 ${input.styleProfile.narrativeRhythmDNA.tensionRule}；段落呼吸保持 ${input.styleProfile.narrativeRhythmDNA.breathingRule}`,
    `情绪渲染策略强调 ${input.styleProfile.emotionSpectrum.renderingPreference}，克制度由 ${input.styleProfile.emotionSpectrum.restraintRule} 保底，情绪转折遵循 ${input.styleProfile.emotionSpectrum.transitionRule}`,
    `深层笔触与感官通道偏好是 ${input.styleProfile.deepTexture.perspectiveRule}；${input.styleProfile.deepTexture.temporalRule}；${input.styleProfile.deepTexture.whitespaceRule}；${input.styleProfile.deepTexture.sensoryRule}`,
    `对白应当 ${input.styleProfile.dialogueStyle.voiceRule}，潜台词处理需要 ${input.styleProfile.dialogueStyle.subtextRule}，角色区分继续执行 ${input.styleProfile.dialogueStyle.distinctionRule}`,
    `情绪表达遵循 ${input.styleProfile.emotionRenderingRule}，意象与修辞控制在 ${input.styleProfile.imageryRegister.densityRule} 与 ${input.styleProfile.imageryRegister.textureRule} 的边界之内，同时明确回避 ${input.styleProfile.imageryRegister.avoid.join("、") || "空泛修辞"}`,
    `风格护栏包括 ${input.styleProfile.toneGuardrails.join("；")} 禁用词和策划腔必须压住：${input.styleProfile.forbiddenLexicon.join("、") || "无"} 风格禁忌继续记为 ${input.styleProfile.styleTaboos.join("、") || "无"}`,
    writingCharter
      ? `作者习惯卡要求章长遵守 ${writingCharter.chapterLengthRule}。机制类信息必须 ${writingCharter.mechanismRevealRule}，明确禁区包括 ${writingCharter.mechanismRevealRedlines.join("；") || "无"}。情绪落点坚持 ${writingCharter.emotionLandingRule}，章末收束继续遵守 ${writingCharter.chapterClosureRule}。`
      : "",
    `抽样证据覆盖 ${input.exemplars.map((entry) => `${entry.label}(${entry.tags.join("/")})`).join("、")}。这些片段共同说明，这套笔法依赖场景牵引、动作后果、关系压强和情绪余震来组织正文，而不是依赖解释、提纲词和模板金句。`,
    sceneCoverage.length
      ? `关键写法场景覆盖 ${sceneCoverage.join("、")}，说明 runtime exemplar 不只对齐作者文气，也显式覆盖机制初现、沉默露出、压力升级和章末钩子等高价值写法场景。`
      : "",
    input.importedSourceSummary,
  ];

  let digest = sections.join("\n");
  const paddingPool = [
    `运行时使用这份快照时，应优先把人物视角、动作链和信息露出绑定在一起，避免把任何抽象结论直接写进正文。`,
    `如果出现模型味，优先回看段落节奏、主体锚点、对白留白和章末收束，而不是回到原始导入正文去拼接句子。`,
    `这份摘要存在的意义，是让写作链只携带结构化风格边界和少量 exemplar，而不是把参考书整段塞进 prompt。`,
    `额外证据说明：${input.exemplars.map((entry) => `${entry.sourceTitle}-${entry.label}-${entry.tags.join("/")}`).join("；")}`,
    `AI 味纠偏时，优先盯住 ${input.styleProfile.aiSmellPatterns.join("、") || "解释过早、句式过平与对白说透"}，并持续遵守 ${input.styleProfile.toneGuardrails.join("；")}`,
  ];
  let paddingIndex = 0;

  while (digest.length < MIN_DIGEST_CHARS && paddingIndex < 12) {
    digest = `${digest}\n${paddingPool[paddingIndex % paddingPool.length]!}`;
    paddingIndex += 1;
  }

  if (digest.length > MAX_DIGEST_CHARS) {
    const sliced = digest.slice(0, MAX_DIGEST_CHARS);
    const boundary = Math.max(sliced.lastIndexOf("。"), sliced.lastIndexOf("！"), sliced.lastIndexOf("？"));
    digest = sliced.slice(0, boundary > MIN_DIGEST_CHARS ? boundary + 1 : MAX_DIGEST_CHARS).trim();
  }

  return digest;
}

function buildFingerprintDigestLine(fingerprint: StyleFingerprint | null) {
  if (!fingerprint) {
    return "文体指纹：暂无稳定的全文统计数据，修辞偏好、节奏 DNA、情绪与深层笔触只能依靠规则侧写。";
  }

  const topBigramLine = fingerprint.vocabulary.topBigrams.slice(0, 3).join("、") || "暂无";
  return [
    `文体指纹：章均 ${fingerprint.chapter.averageWords} 字（范围 ${fingerprint.chapter.minWords}-${fingerprint.chapter.maxWords}），`,
    `句长均值 ${fingerprint.sentenceLength.mean.toFixed(1)} 字，`,
    `对白占比 ${(fingerprint.dialogue.overallRatio * 100).toFixed(0)}%，`,
    `一句一段占比 ${(fingerprint.paragraphLength.singleSentenceRatio * 100).toFixed(0)}%。`,
    `节奏 DNA 证据：短句 ${(fingerprint.sentenceLength.shortRatio * 100).toFixed(0)}%，长句 ${(fingerprint.sentenceLength.longRatio * 100).toFixed(0)}%，`,
    `开篇场景/对白/动作/内省占比分别为 ${(fingerprint.openingPattern.sceneRatio * 100).toFixed(0)}%/${(fingerprint.openingPattern.dialogueRatio * 100).toFixed(0)}%/${(fingerprint.openingPattern.actionRatio * 100).toFixed(0)}%/${(fingerprint.openingPattern.introspectionRatio * 100).toFixed(0)}%。`,
    `修辞与语气锚点：千字逗号 ${fingerprint.punctuation.comma.toFixed(1)}、省略号 ${fingerprint.punctuation.ellipsis.toFixed(1)}、破折号 ${fingerprint.punctuation.dash.toFixed(1)}；`,
    `词汇回钉（前 3）：${topBigramLine}。`,
  ].join("");
}

function normalizeGeneratedStyleDigest(raw: string) {
  const unfenced = raw
    .replace(/```(?:markdown|md|text)?\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  if (!unfenced) {
    throw new Error("style digest 为空");
  }
  if (safeParseJson<Record<string, unknown>>(unfenced)) {
    throw new Error("style digest 返回了 JSON，而不是自然语言摘要");
  }

  const lines = unfenced
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => !(index === 0 && /摘要|风格|内参/.test(line) && !/[。！？]/.test(line)));
  const normalized = lines.join("\n").trim();

  if (!normalized) {
    throw new Error("style digest 清洗后为空");
  }
  if (normalized.length < 800) {
    throw new Error("style digest 长度不足 800 字");
  }
  if (normalized.length <= 1_200) {
    return normalized;
  }

  const sliced = normalized.slice(0, 1_200);
  const boundary = Math.max(
    sliced.lastIndexOf("。"),
    sliced.lastIndexOf("！"),
    sliced.lastIndexOf("？"),
  );
  return sliced.slice(0, boundary > 800 ? boundary + 1 : 1_200).trim();
}

async function generateStyleDigest(input: {
  mode: StyleImportMode;
  imports: StyleGenerationImport[];
  styleProfile: StyleProfile;
  facets: StyleFacet[];
  fingerprint: StyleFingerprint | null;
  exemplars: StyleExcerpt[];
  confidence: StyleConfidence;
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}): Promise<string> {
  const writingCharter = input.styleProfile.writingCharter;
  const sourceLine = input.imports
    .map((entry) => `${entry.title}${entry.author ? ` / ${entry.author}` : ""}`)
    .join("、");
  const facetSummary = input.facets.length
    ? input.facets
      .map((facet, index) => [
        `切面 ${index + 1}：`,
        `叙事距离=${facet.narrativeDistance || "无"}`,
        `对白=${facet.dialogueStyle || "无"}`,
        `情绪=${facet.emotionMethod || "无"}`,
        `节奏=${facet.pacing || "无"}`,
        `显著特征=${facet.distinctivePatterns.join("、") || "无"}`,
      ].join("；"))
      .join("\n")
    : "无独立切面摘要，请以风格规则和指纹为主。";
  const profileSummary = [
    `叙述距离：${input.styleProfile.narrativeDistance.intimacyRule}`,
    `信息露出：${input.styleProfile.infoRevealRule}`,
    `开篇策略：${input.styleProfile.openingStrategy}`,
    `章末处理：${input.styleProfile.chapterClosureRule}`,
    `对白习惯：${input.styleProfile.dialogueStyle.voiceRule}`,
    `修辞手法偏好：${input.styleProfile.rhetoricRegister.densityRule}；常用 ${input.styleProfile.rhetoricRegister.preferredDevices || "克制修辞"}；回避 ${input.styleProfile.rhetoricRegister.avoidDevices.join("、") || "空泛修辞"}`,
    `叙事节奏 DNA：${input.styleProfile.narrativeRhythmDNA.pacingPattern}；${input.styleProfile.narrativeRhythmDNA.tensionRule}；${input.styleProfile.narrativeRhythmDNA.breathingRule}`,
    `情绪渲染策略：${input.styleProfile.emotionSpectrum.renderingPreference}；${input.styleProfile.emotionSpectrum.restraintRule}；${input.styleProfile.emotionSpectrum.transitionRule}`,
    `深层笔触与感官通道：${input.styleProfile.deepTexture.perspectiveRule}；${input.styleProfile.deepTexture.temporalRule}；${input.styleProfile.deepTexture.whitespaceRule}；${input.styleProfile.deepTexture.sensoryRule}`,
    `情绪写法：${input.styleProfile.emotionRenderingRule}`,
    `风格签名线索：${input.styleProfile.toneGuardrails.join("；") || "无"}`,
    writingCharter ? `作者习惯卡：${writingCharter.chapterLengthRule}；${writingCharter.mechanismRevealRule}；${writingCharter.emotionLandingRule}` : "",
    input.styleProfile.styleTaboos.length ? `明确禁忌：${input.styleProfile.styleTaboos.join("、")}` : "",
  ].filter(Boolean).join("\n");
  const exemplarTags = input.exemplars.length
    ? input.exemplars.map((entry) => `${entry.sourceTitle}/${entry.label}/${entry.tags.join("/") || "narrative"}`).join("；")
    : "无 exemplar 标签。";

  const systemPrompt = `你是一名出版编辑部的风格内参撰稿人。根据风格分析结果，写一段 800-1200 字的风格摘要。
要求：
- 用自然的中文描述这个作者/作品的写作风格，像编辑写给编辑的内参
- 必须包含具体、可感知的风格特征，避免泛泛空话
- 不要输出普适性写作建议，不要改写成规则清单
- 摘要必须串联四个维度：修辞手法偏好、叙事节奏 DNA、情绪渲染策略、深层笔触与感官通道偏好
- 每个维度都要引用至少一个文体指纹数据点（例如章均字数、句长结构、对白占比、开篇比例、标点密度）
- 直接输出摘要正文，不要加标题、围栏、JSON 或解释`;

  const userPrompt = [
    `分析对象：${input.mode === "author" ? "作者级风格" : "单书级风格"}`,
    `来源：${sourceLine}`,
    `置信度：${input.confidence}`,
    buildFingerprintDigestLine(input.fingerprint),
    "",
    "风格切面：",
    facetSummary,
    "",
    "编译后的风格规则（含修辞/节奏/情绪/深层笔触维度）：",
    profileSummary,
    "",
    `exemplar 标签：${exemplarTags}`,
  ].join("\n");

  const raw = await input.llmCall([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
  return normalizeGeneratedStyleDigest(raw);
}

function buildSnapshotStyleCard(signature: string, styleDigest: string, styleProfile: StyleProfile, fingerprint: StyleFingerprint | null = null) {
  const writingCharter = styleProfile.writingCharter;
  return [
    "风格约束卡",
    `风格签名：${signature}`,
    "",
    writingCharter ? "作者习惯卡：" : "",
    writingCharter ? `章长习惯：${writingCharter.chapterLengthRule}` : "",
    writingCharter ? `开篇落点：${writingCharter.openingMoveRule}` : "",
    writingCharter ? `机制露出：${writingCharter.mechanismRevealRule}` : "",
    writingCharter ? `机制禁区：${writingCharter.mechanismRevealRedlines.join("；") || "无"}` : "",
    writingCharter ? `情绪落点：${writingCharter.emotionLandingRule}` : "",
    writingCharter ? `章末收束：${writingCharter.chapterClosureRule}` : "",
    "",
    "风格维度速记：",
    `修辞手法偏好：${styleProfile.rhetoricRegister.densityRule}；常用 ${styleProfile.rhetoricRegister.preferredDevices || "克制修辞"}`,
    `叙事节奏 DNA：${styleProfile.narrativeRhythmDNA.pacingPattern}`,
    `情绪渲染策略：${styleProfile.emotionSpectrum.renderingPreference}`,
    `深层笔触与感官通道：${styleProfile.deepTexture.perspectiveRule}；${styleProfile.deepTexture.sensoryRule}`,
    buildFingerprintDigestLine(fingerprint),
    "",
    `风格摘要：\n${styleDigest}`,
  ].filter(Boolean).join("\n");
}

async function maybeConvergeStyleProfile(input: {
  styleProfile: StyleProfile;
  fingerprint: StyleFingerprint | null;
  excerpts: StyleExcerpt[];
  llmCall: (messages: ChatMessage[]) => Promise<string>;
}) {
  if (!input.fingerprint || input.excerpts.length < 8) {
    return input.styleProfile;
  }

  try {
    const convergenceResult = await iterativeStyleConvergence({
      initialProfile: input.styleProfile,
      referenceFingerprint: input.fingerprint,
      referenceExcerpts: input.excerpts,
      maxIterations: 2,
      writerSystemPrompt: DEFAULT_WRITER_SYSTEM_PROMPT,
      llmCall: input.llmCall,
    });
    return convergenceResult.convergenceScore > 0.5
      ? convergenceResult.refinedProfile
      : input.styleProfile;
  } catch {
    return input.styleProfile;
  }
}

async function buildSingleBookSnapshot(
  input: Omit<GenerateStyleCardFromExcerptsInput, "mode" | "imports"> & {
    importEntry: StyleGenerationImport;
  },
) {
  const imports = [input.importEntry];
  const references = deriveReferences("book", imports, input.references);
  const importedSourceSummary = buildImportedSourceSummary("book", imports);
  const genre = input.genre ?? "未指定题材";
  const premise = input.premise ?? "未提供作品 premise";
  const fingerprint = input.importEntry.fingerprint
    ?? (input.importEntry.normalizedText
      ? computeStyleFingerprint(
          input.importEntry.normalizedText,
          splitStyleReferenceSections(input.importEntry.normalizedText),
        )
      : null);
  let facets: StyleFacet[] = [];

  let interpretation: StyleReferenceInterpretation;
  let styleProfile: StyleProfile;

  if (fingerprint) {
    const batches = batchExcerpts(imports[0].excerpts, 5);
    facets = await Promise.all(
      batches.map((batch, index) =>
        mapStyleFacets({
          excerptBatch: batch,
          batchIndex: index,
          totalBatches: batches.length,
          genre,
          llmCall: input.llmCall,
        })),
    );
    styleProfile = await reduceStyleProfile({
      facets,
      fingerprint,
      genre,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      llmCall: input.llmCall,
    });
    styleProfile = await maybeConvergeStyleProfile({
      styleProfile,
      fingerprint,
      excerpts: imports[0].excerpts,
      llmCall: input.llmCall,
    });
    const signature = facets.length
      ? (facets.flatMap((entry) => entry.distinctivePatterns).filter(Boolean)[0] ?? "场景驱动叙事")
      : "场景驱动叙事";
    interpretation = {
      narrativeDistance: facets.map((entry) => entry.narrativeDistance).filter(Boolean).join("；"),
      infoDelivery: "",
      paragraphRhythm: facets.map((entry) => entry.pacing).filter(Boolean).join("；"),
      dialogueBreathing: facets.map((entry) => entry.dialogueStyle).filter(Boolean).join("；"),
      emotionRendering: facets.map((entry) => entry.emotionMethod).filter(Boolean).join("；"),
      chapterClosure: "",
      forbiddenPatterns: facets.flatMap((entry) => entry.antiPatterns),
      signature,
    };
  } else {
    const baseProfile = buildFallbackStyleProfile({
      references,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      worldContext: input.worldContext,
      workshopContext: input.workshopContext,
      draft: input.draft,
    });
    interpretation = await interpretStyleReference({
      references,
      samples: input.samples ?? [],
      genre,
      premise,
      importedSourceSummary,
      sampledExcerptEvidence: imports[0].excerpts,
      mode: "book",
      llmCall: input.llmCall,
    }).catch(() => fallbackInterpretation(`${imports[0].title} 的叙事锚点要稳定、克制并带压强。`)); // LLM interpretation fallback
    styleProfile = await compileStyleProfile({
      interpretation,
      baseProfile,
      manualGuidance: input.manualGuidance,
      avoidances: input.avoidances,
      llmCall: input.llmCall,
    }).catch(() => baseProfile); // profile compilation fallback to base
  }

  const confidence = imports[0].confidence;
  const styleExemplars = selectStyleExemplars(imports[0].excerpts, confidence);
  const fallbackStyleDigest = buildSnapshotDigest({
    mode: "book",
    imports,
    styleProfile,
    exemplars: styleExemplars,
    confidence,
    importedSourceSummary,
  });
  let styleDigest = fallbackStyleDigest;

  if (fingerprint && facets.length) {
    try {
      styleDigest = await generateStyleDigest({
        mode: "book",
        imports,
        styleProfile,
        facets,
        fingerprint,
        exemplars: styleExemplars,
        confidence,
        llmCall: input.llmCall,
      });
    } catch (error) {
      console.warn("[generateStyleDigest:book] fallback to template digest:", error instanceof Error ? error.message : error);
    }
  }

  return {
    interpretation,
    styleProfile,
    styleDigest,
    styleExemplars,
    sampledExcerpts: imports[0].excerpts,
    confidence,
    fingerprint,
    facets,
  };
}

export async function generateStyleCardSnapshot(input: GenerateStyleSnapshotInput): Promise<StyleCardSnapshot> {
  const generated = await generateStyleCardFromExcerpts(input);

  return {
    id: input.id,
    projectId: input.projectId,
    version: input.version,
    createdAt: input.createdAt ?? nowIso(),
    ...generated,
  };
}

export async function generateStyleCardFromExcerpts(input: GenerateStyleCardFromExcerptsInput): Promise<GeneratedStyleCardData> {
  if (!input.imports.length) {
    throw new Error("至少需要一个导入源来生成 style snapshot");
  }
  if (input.mode === "author" && input.imports.length < 2) {
    throw new Error("author 模式至少需要两本书");
  }

  const totalWords = input.imports.reduce((sum, entry) => sum + entry.wordCount, 0);
  const fallbackConfidence = totalWords < 20_000 ? "low" : totalWords < 50_000 ? "medium" : "high";

  if (input.mode === "book") {
    const built = await buildSingleBookSnapshot({
      ...input,
      importEntry: input.imports[0]!,
    });

    return {
      mode: "book",
      sourceIds: input.imports.map((entry) => entry.id),
      styleCard: buildSnapshotStyleCard(built.interpretation.signature, built.styleDigest, built.styleProfile, built.fingerprint),
      styleProfile: built.styleProfile,
      styleDigest: built.styleDigest,
      styleExemplars: built.styleExemplars,
      sampledExcerpts: built.sampledExcerpts,
      confidence: built.confidence,
      fingerprint: built.fingerprint,
    };
  }

  const bookSnapshots = await Promise.all(
    input.imports.map((entry) =>
      buildSingleBookSnapshot({
        ...input,
        importEntry: entry,
      })),
  );
  const sampledExcerpts = bookSnapshots.flatMap((entry) => entry.sampledExcerpts);
  const importedSourceSummary = [
    buildImportedSourceSummary("author", input.imports),
    ...bookSnapshots.map((entry, index) => `书目 ${index + 1} 摘要：${entry.styleDigest.slice(0, 420)}`),
  ].join("\n");
  const styleProfile = await mergeBookProfilesToAuthorProfile({
    bookResults: bookSnapshots.map((entry, index) => ({
      title: input.imports[index]!.title,
      styleProfile: entry.styleProfile,
      fingerprint: entry.fingerprint ?? null,
    })),
    manualGuidance: input.manualGuidance,
    avoidances: input.avoidances,
    llmCall: input.llmCall,
  });
  const confidence = input.imports.length === 2 && fallbackConfidence === "high" ? "medium" : fallbackConfidence;
  const styleExemplars = selectStyleExemplars(sampledExcerpts, confidence);
  const authorFingerprint = mergeFingerprintsToMedianFingerprint(
    bookSnapshots
      .map((entry) => entry.fingerprint)
      .filter((entry): entry is StyleFingerprint => Boolean(entry)),
  );
  const authorFacets = bookSnapshots.flatMap((entry) => entry.facets ?? []);
  const fallbackStyleDigest = buildSnapshotDigest({
    mode: "author",
    imports: input.imports,
    styleProfile,
    exemplars: styleExemplars,
    confidence,
    importedSourceSummary,
  });
  let styleDigest = fallbackStyleDigest;

  if (authorFingerprint && authorFacets.length) {
    try {
      styleDigest = await generateStyleDigest({
        mode: "author",
        imports: input.imports,
        styleProfile,
        facets: authorFacets,
        fingerprint: authorFingerprint,
        exemplars: styleExemplars,
        confidence,
        llmCall: input.llmCall,
      });
    } catch (error) {
      console.warn("[generateStyleDigest:author] fallback to template digest:", error instanceof Error ? error.message : error);
    }
  }
  const signature = unique(
    bookSnapshots.flatMap((entry) =>
      [entry.interpretation.signature, ...entry.styleExemplars.flatMap((excerpt) => excerpt.tags)].filter(Boolean),
    ),
  )[0] ?? "场景驱动叙事";

  return {
    mode: "author",
    sourceIds: input.imports.map((entry) => entry.id),
    styleCard: buildSnapshotStyleCard(signature, styleDigest, styleProfile, authorFingerprint),
    styleProfile,
    styleDigest,
    styleExemplars,
    sampledExcerpts,
    confidence,
  };
}
