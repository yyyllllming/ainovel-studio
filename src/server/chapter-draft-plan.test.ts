import test from "node:test";
import assert from "node:assert/strict";
import { buildChapterDraftPlan } from "./story/chapter-draft-plan.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import type { ContextPack } from "./types.ts";
import { createDefaultWritingDna } from "./writing/writing-dna.ts";

function createContextPack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    totalTokens: 0,
    breakdown: {
      systemRules: 0,
      styleCard: 0,
      characterCards: 0,
      dynamicFacts: 0,
      historySummaries: 0,
      currentDraft: 0,
      outputReserve: 0,
    },
    blueprint: {
      chapterNo: 1,
      sceneGoal: "让咿呀冒险贴近裂爪青狼暴露的灵纹，并立刻承担代价",
      characters: ["咿呀", "裂爪青狼", "黑羽鹫"],
      locations: ["断崖山场", "焦黑石涧"],
      conflicts: [
        "咿呀必须藏住伤势与气息，再冒险贴近裂爪青狼暴露的灵纹。",
        "偷学代价会顺着残留灵压逼近，让咿呀暴露行迹。",
      ],
      foreshadows: ["第一次刻下的灵纹会留下可被追咬的热痕。"],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2800,
    },
    styleCard: "",
    styleProfile: buildFallbackStyleProfile({ references: [] }),
    writingDna: createDefaultWritingDna(),
    projectPremise: "一只小兽能在异兽暴露天赋灵纹时偷学残缺能力。",
    previousChapterTail: null,
    storyContractSummary: "",
    currentVolumeGoal: "先活下来，再带着第一道灵纹逃出山场。",
    completionProgress: "5%",
    activeSteeringNotes: [],
    requiredCards: [
      {
        name: "咿呀",
        role: "protagonist",
        goal: "带着第一道灵纹活着逃出山场。",
        traits: ["主动", "敏感", "敢赌"],
      },
      {
        name: "裂爪青狼",
        role: "hunter",
        goal: "追回被窥走的灵纹气息。",
        traits: ["凶悍", "谨慎"],
      },
    ],
    worldviewCards: [
      {
        name: "灵纹偷学",
        description: "只有近距离承受灵压与杀机，才可能偷学残缺能力。",
      },
      {
        name: "偷学代价",
        description: "强行刻印灵纹，会带来刺痛、失血或被原主气息反咬。",
      },
    ],
    summaryWindow: {
      recentFullChapters: [],
      detailedSummaries: [],
      briefSummaries: [],
    },
    memory: {
      characterStates: [],
      activeThreads: [],
      sceneSteeringNotes: [],
      relationshipDeltas: [],
      timeMarker: "",
      unresolvedPromises: [],
      pendingConsequences: [],
      hookDiagnostics: null,
    },
    lorebook: {
      entries: [],
      renderedCards: [],
      debug: {
        matchedCardIds: [],
        triggeredBy: [],
        progressionCount: 0,
      },
    },
    facts: [],
    conflicts: [],
    writerNotes: ["保持荒古感，但不要把解释压过动作。"],
    plannerContextSummary: "",
    futureContext: "",
    ...overrides,
  };
}

test("buildChapterDraftPlan front-loads early chapters into five concrete beats", () => {
  const plan = buildChapterDraftPlan(createContextPack());

  assert.equal(plan.beats.length, 5);
  assert.equal(plan.sceneCards.length >= 2 && plan.sceneCards.length <= 4, true);
  assert.equal(plan.voiceBrief.positiveAnchors.length > 0, true);
  assert.equal(plan.mustMention.includes("咿呀"), true);
  assert.equal(plan.mustMention.includes("灵纹偷学"), true);
  assert.equal(plan.openingDirectives.some((entry) => entry.includes("开头前三段")), true);
  assert.equal(plan.antiAiDirectives.some((entry) => entry.includes("连续 6 句叙述")), true);
  assert.equal(plan.promptText.includes("Story Brief"), true);
  assert.equal(plan.promptText.includes("Scene Cards"), true);
  assert.equal(plan.promptText.includes("Voice Brief"), true);
  assert.equal(plan.promptText.includes("Beat 1"), true);
  assert.equal(plan.promptText.includes("句法硬约束"), true);
  assert.equal(plan.promptText.includes("去AI味硬约束"), true);
});

test("buildChapterDraftPlan forces handoff when previous chapter tail exists", () => {
  const plan = buildChapterDraftPlan(createContextPack({
    previousChapterTail: "咿呀顺着裂缝往下滑，头顶仍能听见狼爪拍击骨层。",
  }));

  assert.equal(plan.openingDirectives.some((entry) => entry.includes("承接上一章")), true);
  assert.equal(plan.beats[0]?.objective.includes("承接上一章"), true);
});

test("buildChapterDraftPlan collapses later chapters into four stronger beats", () => {
  const plan = buildChapterDraftPlan(createContextPack({
    blueprint: {
      chapterNo: 6,
      sceneGoal: "让咿呀带着新灵纹混入石岭外沿的兽群，并试探黑羽鹫的动向",
      characters: ["咿呀", "黑羽鹫"],
      locations: ["石岭外沿"],
      conflicts: ["咿呀必须先伪装住气息，再试探黑羽鹫的巡空路线。"],
      foreshadows: ["黑羽鹫背后还有更高位阶的追猎者。"],
      emotionalTone: "收住锋芒，暗里试探",
      estimatedWords: 2600,
    },
  }));

  assert.equal(plan.beats.length, 4);
  assert.equal(plan.beats[1]?.objective.includes("正面"), true);
  assert.equal(plan.promptText.includes("黑羽鹫背后还有更高位阶的追猎者"), true);
});

test("buildChapterDraftPlan adds mythic progression constraints for shanhai-like stories", () => {
  const plan = buildChapterDraftPlan(createContextPack({
    blueprint: {
      chapterNo: 9,
      sceneGoal: "让姜离顺着古地裂缝继续摸到新的线索",
      characters: ["姜离", "裂爪青狼"],
      locations: ["断崖山场"],
      conflicts: ["姜离必须先在断崖山场活下来，并把刚得到的机缘或线索带出去"],
      foreshadows: ["只留下一个和更深追猎有关的新疑问"],
      emotionalTone: "压低声势，逐步绷紧",
      estimatedWords: 2800,
    },
    projectPremise: "这是一个山海经的故事，里面有亿万种神兽，灵药成精，山川有灵。",
    currentVolumeGoal: "摸出赤钩热痕真正连着哪一道山海异谱。",
    worldviewCards: [
      {
        name: "山川有灵",
        description: "山壁会记住血气与灵纹，踩错就会引来整片地形反应。",
      },
      {
        name: "药精夜迁",
        description: "年份足够的灵药会在夜里迁移，甚至诱猎活物。",
      },
    ],
  }));

  assert.equal(plan.proseDirectives.some((entry) => entry.includes("山海/洪荒推进硬约束")), true);
  assert.equal(plan.reviewChecklist.some((entry) => entry.includes("新的异兽、怪地、灵药、禁忌")), true);
  assert.equal(plan.beats[2]?.objective.includes("新的异兽、怪地、灵药或古禁"), true);
  assert.equal(plan.beats[3]?.objective.includes("主线推进"), true);
  assert.equal(plan.promptText.includes("山海/洪荒硬约束"), true);
});

test("buildChapterDraftPlan turns cards and style profile into hard first-draft constraints", () => {
  const baseStyleProfile = buildFallbackStyleProfile({ references: [] });
  const plan = buildChapterDraftPlan(createContextPack({
    requiredCards: [
      {
        name: "咿呀",
        role: "protagonist",
        goal: "带着第一道灵纹活着逃出山场。",
        traits: ["先听后动", "逮到机会就赌", "受伤也先压住声息"],
      },
      {
        name: "裂爪青狼",
        role: "hunter",
        goal: "追回被窥走的灵纹气息。",
        traits: ["先封退路", "闻到血就追", "不轻易扑空"],
      },
    ],
    styleProfile: {
      ...baseStyleProfile,
      referenceAnchor: {
        primary: "荒兽求生、近身压迫、低饱和抒情",
        secondary: ["动作优先", "避免空泛总结"],
      },
      paragraphCadence: {
        narrativeRule: "每段只推进一个动作结果，不要平铺总述。",
        dialogueRule: "对白极少且必须带压力。",
        emphasisRule: "重点落在伤势、判断和代价。",
      },
      sentenceRhythm: {
        pacingRule: "短中句交替，遇险时收短。",
        transitionRule: "转场靠动作牵引，不靠总结句。",
        pauseRule: "停顿要服务警觉和试探。",
      },
      narrativeDistance: {
        intimacyRule: "紧贴咿呀的身体反馈和即时判断。",
        expositionRule: "设定只在遭遇后果时顺带露出。",
        textureRule: "优先写触感、血腥气和岩壁摩擦感。",
      },
      dialogueStyle: {
        voiceRule: "能不用对白就不用对白。",
        subtextRule: "兽类交流靠动作和气息变化显露。",
        distinctionRule: "不同异兽靠动作习性区分。",
      },
      imageryRegister: {
        densityRule: "比喻只点一下，不连排堆叠。",
        textureRule: "意象服务危险感，不写空灵抒情。",
        avoid: ["冷蛇一样", "仿佛命运在逼近"],
      },
      forbiddenLexicon: ["忽然", "不是……而是……"],
      toneGuardrails: ["不要先做总述", "不要把解释压过动作"],
      openingStrategy: "以动作骤压开篇，不做高空总述。",
      infoRevealRule: "信息通过危机和动作链自然露出。",
      emotionRenderingRule: "情绪落在疼痛、呼吸和环境压强上。",
      chapterClosureRule: "章末只钉一个新后患，不回钉总结。",
      writingCharter: {
        ...baseStyleProfile.writingCharter!,
        chapterLengthRule: "章长要写满完整追猎与偷学兑现，不短成梗概，也不要回钉同一风险凑字。",
        openingMoveRule: "首段直接把咿呀压进动作和危险，不先交代世界观。",
        infoRevealRule: "信息只顺着危机、试探和代价露出，不先做旁白定义。",
        mechanismRevealRule: "灵纹与偷学机制必须先写撞上去的异动、反噬和追咬，再补最少必要辨认。",
        mechanismRevealRedlines: [
          "不要写成解释 -> 验证 -> 总结三段式。",
          "不要把暗钩机制一次说透。",
        ],
        emotionLandingRule: "情绪先落在疼痛、呼吸和毛发炸起的身体反应上。",
        chapterClosureRule: "章末只留下一个新后患，不回钉总结。",
        transitionRule: "转场靠扑击、失手、气味和视线转移带动。",
        pauseRule: "停顿要落在试探、忍痛和环境回声上。",
        endingPolicy: {
          maxConclusionSentences: 1,
          conclusionMarkers: ["这意味着", "这也说明", "总之"],
        },
        mechanismRevealPolicy: {
          maxExplicitSummarySentences: 1,
          maxTriadPatterns: 0,
          explanationMarkers: ["这意味着", "这说明", "原来"],
          verificationMarkers: ["果然", "下一刻", "立刻"],
          summaryMarkers: ["这也说明", "总之"],
          mechanismKeywords: ["灵纹", "偷学", "反噬", "追咬"],
        },
        transitionBudget: {
          maxContrastTemplates: 1,
          maxAbruptTurns: 2,
          maxHardTransitionMarkers: 4,
          hardTransitionMarkers: ["忽然", "下一刻", "然而"],
        },
        simileBudget: {
          maxPerChapter: 3,
          maxPerParagraph: 1,
        },
        rhetoricBudget: {
          simileDensityPerThousand: 1.4,
          personificationDensityPerThousand: 0.5,
          rhetoricalQuestionPerChapter: 0,
          dominantDevice: "simile",
        },
        sensoryBudget: {
          sensoryDetailTargetPerThousand: 5.8,
          primaryChannels: ["视觉", "触觉", "听觉"],
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
          stopwords: ["自己", "对方"],
        },
        aiFlavorAvoidance: ["解释先于行动", "转折机械", "机制复述"],
        tabooReminders: ["空泛抒情", "总结式回钉"],
      },
      aiSmellPatterns: ["平均句式", "解释腔"],
      styleTaboos: ["空泛抒情", "总结式回钉"],
    },
  }));

  assert.equal(plan.promptText.includes("角色写作 DNA"), true);
  assert.equal(plan.promptText.includes("咿呀："), true);
  assert.equal(plan.promptText.includes("裂爪青狼："), true);
  assert.equal(plan.promptText.includes("世界规则落法"), true);
  assert.equal(plan.promptText.includes("文风落点"), true);
  assert.equal(plan.promptText.includes("禁用词"), true);
  assert.equal(plan.promptText.includes("首稿自检"), true);
  assert.equal(plan.promptText.includes("显性比喻"), true);
  assert.equal(plan.promptText.includes("目标字数"), true);
  assert.equal(plan.promptText.includes("机制类信息露出禁区"), true);
  assert.equal(plan.proseDirectives.some((entry) => entry.includes("解释 -> 验证 -> 总结")), true);
  assert.equal(plan.proseDirectives.some((entry) => entry.includes("章末收束必须遵守")), true);
  assert.equal(plan.antiAiDirectives.length > 0, true);
});

test("buildChapterDraftPlan trims future context into obligation cards instead of dumping the raw block", () => {
  const plan = buildChapterDraftPlan(createContextPack({
    futureContext: [
      "【本章之后的叙事要求】",
      "【下一章（第2章）】",
      "意图：让咿呀闯进石涧更深处。",
      "【本章不要做什么】",
      "- 不要再把本章主场景压回断崖山场。",
    ].join("\n"),
    obligationCards: [
      {
        id: "obl-1",
        type: "continuity",
        mustHold: "咿呀已经暴露了第一道热痕。",
        canHint: "下一章要闯进石涧更深处。",
        doNotRepeat: "不要再把本章主场景压回断崖山场。",
        expiryChapter: 2,
      },
    ],
  }));

  assert.equal(plan.promptText.includes("【本章之后的叙事要求】"), false);
  assert.equal(plan.promptText.includes("不要再把本章主场景压回断崖山场"), true);
  assert.equal(plan.promptText.includes("下一章要闯进石涧更深处"), true);
  assert.equal(plan.obligationDirectives.length > 0, true);
});
