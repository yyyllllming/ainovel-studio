import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFingerprintToCharter,
  batchExcerpts,
  buildFallbackStyleProfile,
  buildFallbackStyleSteeringCard,
  dedupeStyleReferenceCandidates,
  formatStyleProfileForPrompt,
  formatStyleProfileForStage,
  mapStyleFacets,
  reduceStyleProfile,
} from "./style/style-steering.ts";
import type { StyleReferenceCandidate, StyleReferenceSelection, StyleExcerpt } from "./types.ts";
import type { StyleFingerprint } from "./style-fingerprint.ts";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

function createFingerprint(overrides?: DeepPartial<StyleFingerprint>): StyleFingerprint {
  const deepTextureOverrides = overrides?.deepTexture;
  return {
    sentenceLength: {
      mean: 24,
      median: 22,
      stddev: 8,
      shortRatio: 0.25,
      mediumRatio: 0.65,
      longRatio: 0.1,
      ...overrides?.sentenceLength,
    },
    paragraphLength: {
      mean: 95,
      median: 88,
      singleSentenceRatio: 0.18,
      ...overrides?.paragraphLength,
    },
    dialogue: {
      overallRatio: 0.32,
      averageLength: 18,
      averageSurroundingAction: 72,
      ...overrides?.dialogue,
    },
    punctuation: {
      comma: 42,
      period: 19,
      exclamation: 1.8,
      question: 1.2,
      ellipsis: 0.6,
      dash: 0.4,
      semicolon: 0.1,
      ...overrides?.punctuation,
    },
    chapter: {
      count: 6,
      averageWords: 3200,
      minWords: 2800,
      maxWords: 3600,
      ...overrides?.chapter,
    },
    openingPattern: {
      sceneRatio: 0.4,
      dialogueRatio: 0.2,
      actionRatio: 0.25,
      introspectionRatio: 0.15,
      ...overrides?.openingPattern,
    },
    vocabulary: {
      uniqueRatio: 0.72,
      topBigrams: ["潮气", "石阶", "夜禁"],
      ...overrides?.vocabulary,
    },
    rhetoric: {
      simileCount: 6,
      simileDensity: 1.8,
      personificationCount: 2,
      synesthesiaCount: 1,
      contrastCount: 3,
      contrastIronyCount: 3,
      rhetoricalQuestionCount: 0,
      dominantDevice: "simile",
      ...overrides?.rhetoric,
    },
    narrativeRhythm: {
      sceneChangeFrequency: 1.2,
      tensionCurveShape: "rising",
      shortBurstRatio: 0.18,
      longFlowRatio: 0.1,
      rhythmVariance: 0.42,
      paragraphBreathingPattern: "mixed",
      ...overrides?.narrativeRhythm,
    },
    emotionRendering: {
      actionBasedRatio: 0.35,
      environmentBasedRatio: 0.28,
      introspectionRatio: 0.18,
      dialogueSubtextRatio: 0.19,
      sensoryDetailDensity: 5.4,
      restraintScore: 0.72,
      ...overrides?.emotionRendering,
    },
    deepTexture: {
      perspectiveShiftCount: deepTextureOverrides?.perspectiveShiftCount ?? 1,
      temporalDeviceCount: deepTextureOverrides?.temporalDeviceCount ?? 2,
      whitespaceRatio: deepTextureOverrides?.whitespaceRatio ?? 0.24,
      informationDensity: deepTextureOverrides?.informationDensity ?? 0.68,
      imageClusterCount: deepTextureOverrides?.imageClusterCount ?? 4,
      sensoryChannelDistribution: {
        visual: deepTextureOverrides?.sensoryChannelDistribution?.visual ?? 0.36,
        auditory: deepTextureOverrides?.sensoryChannelDistribution?.auditory ?? 0.22,
        tactile: deepTextureOverrides?.sensoryChannelDistribution?.tactile ?? 0.24,
        olfactory: deepTextureOverrides?.sensoryChannelDistribution?.olfactory ?? 0.1,
        gustatory: deepTextureOverrides?.sensoryChannelDistribution?.gustatory ?? 0.08,
        kinesthetic: deepTextureOverrides?.sensoryChannelDistribution?.kinesthetic ?? 0,
      },
      sensoryDetailDensity: deepTextureOverrides?.sensoryDetailDensity ?? 5.4,
    },
  };
}

function createExcerpt(id: string, content: string, tags: StyleExcerpt["tags"] = ["narrative"]): StyleExcerpt {
  return {
    id,
    sourceId: "source-1",
    sourceTitle: "测试来源",
    label: `第${id}章`,
    tags,
    content,
    wordCount: content.length,
    startOffset: 0,
    endOffset: content.length,
    positionRatio: 0.2,
    dialogueRatio: tags.includes("dialogue") ? 0.35 : 0.1,
  };
}

test("dedupeStyleReferenceCandidates keeps unique book/author labels across sources", () => {
  const deduped = dedupeStyleReferenceCandidates([
    {
      id: "network-book-1",
      kind: "book",
      label: "长夜潮声",
      author: "沈知白",
      source: "network",
      hint: "海边悬疑，克制叙述",
    },
    {
      id: "ai-book-1",
      kind: "book",
      label: "长夜潮声",
      author: "沈知白",
      source: "ai_fallback",
      hint: "同名候选",
    },
    {
      id: "author-1",
      kind: "author",
      label: "沈知白",
      source: "network",
      hint: "冷静、节制、悬疑感",
    },
  ] satisfies StyleReferenceCandidate[]);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0]?.source, "network");
});

test("buildFallbackStyleSteeringCard turns selected references into actionable constraints", () => {
  const card = buildFallbackStyleSteeringCard({
    references: [
      {
        kind: "book",
        label: "长夜潮声",
        author: "沈知白",
        source: "network",
        relation: "primary",
      },
      {
        kind: "author",
        label: "顾汀",
        source: "ai_fallback",
        relation: "secondary",
      },
    ] satisfies StyleReferenceSelection[],
    manualGuidance: "我想借那种慢慢拧紧的压迫感和带刺的对白。",
    avoidances: "不要套话总结，不要抒情过量。",
  });

  assert.match(card, /主参考/);
  assert.match(card, /慢慢拧紧的压迫感/);
  assert.match(card, /不要套话总结/);
});

test("buildFallbackStyleProfile turns references and workshop context into executable prose constraints", () => {
  const profile = buildFallbackStyleProfile({
    references: [
      {
        kind: "book",
        label: "长夜潮声",
        author: "沈知白",
        source: "network",
        relation: "primary",
      },
    ] satisfies StyleReferenceSelection[],
    manualGuidance: "我想借那种慢慢拧紧的压迫感和带刺的对白。",
    avoidances: "不要套话总结，不要把推进主线、阻力这种词写进正文。",
    worldContext: "世界基调偏冷，人物关系长期压抑但暗潮明显。",
    workshopContext: "用户强调要像真实中文小说，不要一句一段。",
  });

  assert.equal(profile.referenceAnchor.primary, "《长夜潮声》 / 沈知白");
  assert.match(profile.dialogueStyle.subtextRule, /带刺的对白/);
  assert.match(profile.narrativeDistance.textureRule, /长期压抑/);
  assert.equal(profile.forbiddenLexicon.includes("推进主线"), true);
  assert.equal(profile.forbiddenLexicon.includes("阻力"), true);
  assert.match(profile.writingCharter?.mechanismRevealRule ?? "", /动作|代价|后果/);
  assert.equal(
    profile.writingCharter?.mechanismRevealRedlines.some((entry) => entry.includes("解释 -> 验证 -> 总结")),
    true,
  );
  assert.equal((profile.writingCharter?.endingPolicy?.maxConclusionSentences ?? 0) >= 0, true);
  assert.equal((profile.writingCharter?.transitionBudget?.maxContrastTemplates ?? 0) >= 1, true);
  assert.equal((profile.writingCharter?.simileBudget?.maxPerChapter ?? 0) >= 1, true);
  assert.equal((profile.writingCharter?.subjectLeadBudget?.windowSize ?? 0) >= 4, true);
});

test("formatStyleProfileForPrompt serializes the structured profile for writer and reviewer prompts", () => {
  const profile = buildFallbackStyleProfile({
    references: [
      {
        kind: "author",
        label: "顾汀",
        source: "ai_fallback",
        relation: "primary",
      },
    ] satisfies StyleReferenceSelection[],
    manualGuidance: "多用克制的叙述，关键处突然收紧。",
    avoidances: "不要平均句式。",
  });

  const serialized = formatStyleProfileForPrompt(profile);
  assert.match(serialized, /段落节奏/);
  assert.match(serialized, /对白风格/);
  assert.match(serialized, /禁用词/);
  assert.match(serialized, /顾汀/);
  assert.match(serialized, /机制露出/);
  assert.match(serialized, /机制禁区/);
  assert.match(serialized, /章末策略/);
  assert.match(serialized, /转场预算/);
  assert.match(serialized, /母题复用预算/);
  assert.match(serialized, /修辞策略/);
  assert.match(serialized, /节奏DNA/);
  assert.match(serialized, /情绪谱系/);
  assert.match(serialized, /深层笔触/);
});

test("formatStyleProfileForStage keeps writer and reviewer on the same writingCharter terms", () => {
  const profile = buildFallbackStyleProfile({
    references: [
      {
        kind: "book",
        label: "长夜潮声",
        author: "沈知白",
        source: "network",
        relation: "primary",
      },
    ] satisfies StyleReferenceSelection[],
    manualGuidance: "重点保住沉默露出和章末钩子。",
    avoidances: "不要解释腔。",
  });

  const writerPrompt = formatStyleProfileForStage(profile, "writer");
  const reviewerPrompt = formatStyleProfileForStage(profile, "reviewer");

  for (const term of ["章末策略", "机制露出策略", "转场预算", "比喻预算", "修辞预算", "感官预算", "主体起句预算", "母题复用预算"]) {
    assert.match(writerPrompt, new RegExp(term));
    assert.match(reviewerPrompt, new RegExp(term));
  }
  for (const term of ["修辞策略", "节奏DNA", "情绪谱系", "深层笔触"]) {
    assert.match(writerPrompt, new RegExp(term));
    assert.match(reviewerPrompt, new RegExp(term));
  }
});

test("batchExcerpts splits excerpt collections into fixed-size batches", () => {
  const excerpts = Array.from({ length: 7 }, (_, index) => createExcerpt(String(index + 1), `片段 ${index + 1}`));
  const batches = batchExcerpts(excerpts, 5);

  assert.equal(batches.length, 2);
  assert.equal(batches[0]?.length, 5);
  assert.equal(batches[1]?.length, 2);
});

test("mapStyleFacets parses editor JSON for one excerpt batch", async () => {
  const facet = await mapStyleFacets({
    excerptBatch: [
      createExcerpt("1", "“别往前走。”她没有抬头，只把灯往高处举了举。", ["dialogue", "pressure"]),
      createExcerpt("2", "潮气顺着石阶往上涌，他把呼吸压得很轻。", ["narrative", "silence"]),
    ],
    batchIndex: 0,
    totalBatches: 1,
    genre: "悬疑",
    llmCall: async () => `分析如下：
\`\`\`json
${JSON.stringify({
  narrativeDistance: "贴近人物即时感受，少做高空解释。",
  dialogueStyle: "对白克制留白，关系压强比结论更重要。",
  emotionMethod: "情绪落在动作和感官后果上。",
  pacing: "长短句交替，关键处短段收紧。",
  distinctivePatterns: ["动作后果先行", "对白压着信息走"],
  antiPatterns: ["解释腔"],
  rhetoricFingerprint: "显性比喻克制，但会把冷硬物件当作压迫触点反复回钉。",
  narrativeRhythmDNA: "整体先压后扬，冲突节点前常用短句连发，段落呼吸偏紧。",
  emotionSpectrum: "情绪偏克制，优先落在动作失衡、呼吸变化和环境回声上。",
  deepTextureTraits: "偶尔借回忆切一刀，再迅速拉回当下视角，留白靠短段和断句完成。",
  sensoryPalette: "以视觉、触觉和听觉为主，少量气味用于抬高不安感。",
}, null, 2)}
\`\`\``,
  });

  assert.match(facet.narrativeDistance, /贴近人物/);
  assert.equal(facet.distinctivePatterns.includes("动作后果先行"), true);
  assert.deepEqual(facet.antiPatterns, ["解释腔"]);
  assert.match(facet.rhetoricFingerprint, /显性比喻克制/);
  assert.match(facet.narrativeRhythmDNA, /短句连发/);
  assert.match(facet.emotionSpectrum, /情绪偏克制/);
  assert.match(facet.deepTextureTraits, /回忆/);
  assert.match(facet.sensoryPalette, /视觉/);
});

test("mapStyleFacets fallback keeps new dimension fields non-empty", async () => {
  const facet = await mapStyleFacets({
    excerptBatch: [createExcerpt("x", "石门后传来很轻的脚步声。")],
    batchIndex: 1,
    totalBatches: 2,
    llmCall: async () => "not-json",
  });

  assert.match(facet.rhetoricFingerprint, /修辞|比喻/);
  assert.match(facet.narrativeRhythmDNA, /节奏|短句/);
  assert.match(facet.emotionSpectrum, /情绪|克制/);
  assert.match(facet.deepTextureTraits, /视角|留白/);
  assert.match(facet.sensoryPalette, /视觉|触觉|听觉/);
});

test("reduceStyleProfile applies fingerprint calibration to writingCharter budgets", async () => {
  const profile = await reduceStyleProfile({
    facets: [
      {
        narrativeDistance: "贴近人物即时感受，少做高空解释。",
        dialogueStyle: "对白自然留白，靠停顿显露关系压强。",
        emotionMethod: "动作和环境一起承担情绪落点。",
        pacing: "长短句交替，动作节点短段收紧。",
        distinctivePatterns: ["动作牵引", "章末余震"],
        antiPatterns: ["解释腔"],
        rhetoricFingerprint: "比喻低频但会反复钉冷硬物件，对比句多于抒情句。",
        narrativeRhythmDNA: "冲突前短句连发，整体张力逐级上扬，段落呼吸偏紧。",
        emotionSpectrum: "情绪外化重于内心直抒，克制度高。",
        deepTextureTraits: "视角贴身，偶尔切回旧记忆制造压迫回声。",
        sensoryPalette: "触觉、视觉、听觉优先，嗅觉少量点刺。",
      },
    ],
    fingerprint: createFingerprint({
      paragraphLength: { mean: 72, median: 66, singleSentenceRatio: 0.58 },
      dialogue: { overallRatio: 0.44, averageLength: 14, averageSurroundingAction: 48 },
      punctuation: { ellipsis: 2.6, dash: 1.9 },
      openingPattern: { sceneRatio: 0.22, dialogueRatio: 0.41, actionRatio: 0.24, introspectionRatio: 0.13 },
      chapter: { count: 8, averageWords: 3200, minWords: 2800, maxWords: 3600 },
      rhetoric: { simileDensity: 1.2, dominantDevice: "contrast", contrastCount: 5 },
      narrativeRhythm: { shortBurstRatio: 0.34, rhythmVariance: 0.61, paragraphBreathingPattern: "tight" },
      emotionRendering: { restraintScore: 0.84, sensoryDetailDensity: 6.6, environmentBasedRatio: 0.34, actionBasedRatio: 0.31, introspectionRatio: 0.14, dialogueSubtextRatio: 0.21 },
      deepTexture: {
        temporalDeviceCount: 3,
        whitespaceRatio: 0.33,
        imageClusterCount: 5,
        sensoryDetailDensity: 6.6,
        sensoryChannelDistribution: { visual: 0.32, auditory: 0.18, tactile: 0.31, olfactory: 0.12, gustatory: 0.07 },
      },
    }),
    llmCall: async () => `这里是合成结果：
\`\`\`json
${JSON.stringify({
  narrativeDistance: "叙述紧贴人物眼前所见所误判，不抬头做总括。",
  infoReveal: "信息借对白碰撞和动作结果渗出，不额外补讲背景说明。",
  openingStrategy: "开篇直接用冲突中的对白起势，后接动作压迫，不先铺高空背景。",
  chapterClosure: "章末只留一记余震，让风险悬在下一章门口。",
  paragraphCadence: "叙述段偏短，常用碎段追着动作和压迫感推进。",
  dialogueStyle: "对白极简单句为主，前后不补语境解释，靠顶句和打断制造压强。",
  emotionRendering: "情绪落在呼吸发紧、手上发麻和环境回声里，不明说结论。",
  pacing: "句子短促起落，转折时允许硬切，不能写成均匀说明文。",
  imageryRule: "意象只保留冷硬触感和压迫物件，不铺陈抒情比喻。",
  aiSmellPatterns: ["对白解释语境", "章末替角色总结", "把压迫感写成抽象判断"],
  styleTaboos: ["总结腔", "空转抒情", "匀速说明句"],
  signaturePatterns: ["对白顶句起势", "碎段追动作", "章末留余震"],
}, null, 2)}
\`\`\``,
  });

  assert.match(profile.writingCharter?.chapterLengthRule ?? "", /参考原作章均 3200 字/);
  assert.match(profile.dialogueStyle.voiceRule, /对白极简单句为主/);
  assert.match(profile.writingCharter?.openingMoveRule ?? "", /对白|一句话起势/);
  assert.match(profile.writingCharter?.infoRevealRule ?? "", /对白碰撞/);
  assert.match(profile.writingCharter?.emotionLandingRule ?? "", /呼吸发紧|手上发麻/);
  assert.match(profile.writingCharter?.transitionRule ?? "", /碎段|短段/);
  assert.equal(profile.writingCharter?.subjectLeadBudget.maxPronounLeads, 6);
  assert.equal((profile.writingCharter?.simileBudget.maxPerChapter ?? 0) <= 3, true);
  assert.equal((profile.writingCharter?.rhetoricBudget?.simileDensityPerThousand ?? 0) > 0, true);
  assert.equal((profile.writingCharter?.sensoryBudget?.sensoryDetailTargetPerThousand ?? 0) > 0, true);
  assert.match(profile.rhetoricRegister.densityRule, /比喻|修辞/);
  assert.match(profile.narrativeRhythmDNA.tensionRule, /张力|上扬|波形/);
  assert.match(profile.emotionSpectrum.restraintRule, /克制/);
  assert.match(profile.deepTexture.sensoryRule, /触觉|视觉|听觉|感官/);
  assert.equal(profile.aiSmellPatterns.includes("对白解释语境"), true);
  assert.equal(profile.styleTaboos.includes("总结腔"), true);
});

test("applyFingerprintToCharter keeps the original chapter rule when chapter counts are too low", () => {
  const base = buildFallbackStyleProfile({
    references: [],
    manualGuidance: "保持动作推进。",
    avoidances: "不要解释腔。",
  });
  const calibrated = applyFingerprintToCharter(base, createFingerprint({
    chapter: { count: 2, averageWords: 0, minWords: 0, maxWords: 0 },
  }));

  assert.equal(calibrated.writingCharter?.chapterLengthRule, base.writingCharter?.chapterLengthRule);
});

test("applyFingerprintToCharter calibrates dialogue density,碎段倾向, and punctuation budgets", () => {
  const base = buildFallbackStyleProfile({
    references: [],
    manualGuidance: "保持动作推进。",
    avoidances: "不要解释腔。",
  });
  const calibrated = applyFingerprintToCharter(base, createFingerprint({
    chapter: { count: 9, averageWords: 2811, minWords: 1900, maxWords: 3600 },
    dialogue: { overallRatio: 0.46, averageLength: 12, averageSurroundingAction: 38 },
    paragraphLength: { mean: 52, median: 46, singleSentenceRatio: 0.62 },
    punctuation: { ellipsis: 2.9, dash: 2.1 },
    openingPattern: { sceneRatio: 0.18, dialogueRatio: 0.44, actionRatio: 0.26, introspectionRatio: 0.12 },
  }));

  assert.match(calibrated.writingCharter?.chapterLengthRule ?? "", /章均 2811 字/);
  assert.match(calibrated.writingCharter?.openingMoveRule ?? "", /对白|对话/);
  assert.match(calibrated.writingCharter?.infoRevealRule ?? "", /对白/);
  assert.match(calibrated.writingCharter?.transitionRule ?? "", /碎段|单句/);
  assert.match(calibrated.writingCharter?.pauseRule ?? "", /省略号|破折号/);
  assert.equal((calibrated.writingCharter?.simileBudget.maxPerChapter ?? 0) <= 3, true);
  assert.equal((calibrated.writingCharter?.subjectLeadBudget.maxPronounLeads ?? 0) >= 5, true);
  assert.equal((calibrated.writingCharter?.rhetoricBudget?.dominantDevice ?? "").length > 0, true);
  assert.equal((calibrated.writingCharter?.sensoryBudget?.primaryChannels?.length ?? 0) >= 1, true);
});
