import type { ActiveStylePackage, ContextPack } from "../types.ts";
import { buildStructurePlan } from "../content/structure-engine.ts";
import { buildVoicePack } from "../content/voice-pack.ts";
import { buildVoiceBrief } from "../content/voice-engine.ts";
import type { SceneCard, VoiceBrief } from "../content/types.ts";

type DraftBeat = {
  label: string;
  objective: string;
  requiredAnchors: string[];
};

const MYTHIC_BESTIARY_PATTERN = /山海经|山海|洪荒|大荒|神兽|灵药|药精|山川有灵|古地|禁区|异谱|部族|巨兽/u;

export type ChapterDraftPlan = {
  storyBrief: string;
  structureBrief: string;
  sceneCards: SceneCard[];
  voiceBrief: VoiceBrief;
  obligationDirectives: string[];
  protagonistName: string;
  supportNames: string[];
  locationAnchors: string[];
  worldAnchors: string[];
  mustMention: string[];
  openingDirectives: string[];
  proseDirectives: string[];
  planningDirectives: string[];
  antiAiDirectives: string[];
  reviewChecklist: string[];
  characterDirectives: string[];
  worldDirectives: string[];
  styleDirectives: string[];
  bannedLexicon: string[];
  beats: DraftBeat[];
  promptText: string;
};

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function buildCharacterDirectives(contextPack: Pick<ContextPack, "requiredCards">, protagonistName: string) {
  return contextPack.requiredCards
    .slice(0, 4)
    .map((card) => {
      const parts = uniqueNonEmpty([
        card.role ? `身份职责：${card.role}` : "",
        card.goal ? `当前执念：${card.goal}` : "",
        card.traits.length ? `动作/判断倾向：${card.traits.slice(0, 3).join("、")}` : "",
        card.secrets?.length ? `隐藏压力：${card.secrets.slice(0, 2).join("、")}` : "",
        card.name === protagonistName
          ? "正文必须优先贴着它的身体反馈、风险判断和下一步动作来写。"
          : "一旦进场，就要通过动作、压迫或阻拦改变局势，不要只挂名字。",
      ]);

      return `${card.name}：${parts.join("；")}`;
    });
}

function buildWorldDirectives(contextPack: Pick<ContextPack, "worldviewCards" | "projectPremise">) {
  const directives = contextPack.worldviewCards
    .slice(0, 4)
    .map((rule) => `${rule.name}：${rule.description}；只允许通过遭遇、代价、判断结果显形。`);

  if (contextPack.projectPremise.trim()) {
    directives.unshift(`项目 premise：${contextPack.projectPremise.trim()}；正文里只能把它拆进具体行动，不要原句复述。`);
  }

  return directives;
}

function looksLikeMythicBestiaryStory(contextPack: Pick<ContextPack, "worldviewCards" | "projectPremise">) {
  const worldviewText = contextPack.worldviewCards
    .map((rule) => `${rule.name} ${rule.description}`)
    .join("；");
  return MYTHIC_BESTIARY_PATTERN.test(`${contextPack.projectPremise} ${worldviewText}`);
}

function buildMythicProgressionDirectives(input: {
  protagonistName: string;
  supportNames: string[];
  worldAnchors: string[];
  currentVolumeGoal: string;
}) {
  const surfacePressure = input.supportNames.slice(0, 2).join("、") || "旧追猎者";
  const wonderAnchor = input.worldAnchors[0] ?? "大荒异象";
  return uniqueNonEmpty([
    "山海/洪荒题材不能整章只围着同一场追猎或打斗打转；本章必须新增一种异兽、怪地、灵药、古禁或部族线索，并让它改写局势。",
    `如果表层压力还是“${surfacePressure}”，就必须让更大的异兽、山川异变或古老禁忌压进来，把旧追猎降成表层压力。`,
    `剧情推进必须兑现成一项实变：换地带、拿到新线索、确认新禁忌、引出新势力或改写目标之一，至少把“${input.currentVolumeGoal}”往前推一格。`,
    `新出现的异兽、怪地或灵药不要只用常见兽名直给，优先写出古怪体貌、异能习性或与“${wonderAnchor}”相关的诡异生态。`,
    `让${input.protagonistName}不是只在挨打和逃命，而是借新的异兽/怪地规则获得判断、误判、取舍或更大的路线变化。`,
  ]);
}

function buildStyleDirectives(contextPack: Pick<ContextPack, "styleProfile">) {
  const { styleProfile } = contextPack;
  const writingCharter = styleProfile.writingCharter;
  return uniqueNonEmpty([
    styleProfile.referenceAnchor.primary
      ? `参考锚点：${styleProfile.referenceAnchor.primary}`
      : "",
    styleProfile.referenceAnchor.secondary.length
      ? `辅助锚点：${styleProfile.referenceAnchor.secondary.slice(0, 3).join("、")}`
      : "",
    styleProfile.paragraphCadence.narrativeRule
      ? `段落推进：${styleProfile.paragraphCadence.narrativeRule}`
      : "",
    styleProfile.sentenceRhythm.pacingRule
      ? `句子节奏：${styleProfile.sentenceRhythm.pacingRule}`
      : "",
    styleProfile.narrativeDistance.intimacyRule
      ? `叙述贴近：${styleProfile.narrativeDistance.intimacyRule}`
      : "",
    styleProfile.narrativeDistance.expositionRule
      ? `设定露出：${styleProfile.narrativeDistance.expositionRule}`
      : "",
    styleProfile.dialogueStyle.voiceRule
      ? `对白策略：${styleProfile.dialogueStyle.voiceRule}`
      : "",
    styleProfile.imageryRegister.densityRule
      ? `意象密度：${styleProfile.imageryRegister.densityRule}`
      : "",
    styleProfile.imageryRegister.textureRule
      ? `质感优先级：${styleProfile.imageryRegister.textureRule}`
      : "",
    writingCharter?.chapterLengthRule
      ? `作者章长习惯：${writingCharter.chapterLengthRule}`
      : "",
    writingCharter?.openingMoveRule
      ? `作者开篇习惯：${writingCharter.openingMoveRule}`
      : "",
    writingCharter?.mechanismRevealRule
      ? `机制露出：${writingCharter.mechanismRevealRule}`
      : "",
    writingCharter?.mechanismRevealRedlines?.length
      ? `机制禁区：${writingCharter.mechanismRevealRedlines.join("；")}`
      : "",
    ...styleProfile.toneGuardrails.map((item) => `语气护栏：${item}`),
  ]);
}

function buildWritingDnaDirectives(contextPack: Pick<ContextPack, "writingDna">) {
  return {
    planningDirectives: uniqueNonEmpty(contextPack.writingDna.planningRules).slice(0, 5),
    antiAiDirectives: uniqueNonEmpty([
      ...contextPack.writingDna.antiAiRules,
      ...contextPack.writingDna.voiceRules,
      ...contextPack.writingDna.sceneRules,
    ]).slice(0, 10),
    reviewChecklist: uniqueNonEmpty(contextPack.writingDna.reviewChecklist).slice(0, 5),
  };
}

function buildEarlyChapterBeats(input: {
  protagonistName: string;
  supportNames: string[];
  locationAnchors: string[];
  worldAnchors: string[];
  sceneGoal: string;
  primaryConflict: string;
  secondaryConflict: string | null;
  foreshadow: string | null;
  hasPreviousTail: boolean;
}) {
  const primaryLocation = input.locationAnchors[0] ?? "当前场景";
  const contactTarget = input.supportNames[0] ?? input.worldAnchors[0] ?? "眼前机缘";
  const worldAnchor = input.worldAnchors[0] ?? "核心规则";
  const hook = input.foreshadow ?? input.secondaryConflict ?? "留下一个更深的后患";

  return [
    {
      label: "Beat 1",
      objective: input.hasPreviousTail
        ? `先承接上一章未完动作，让${input.protagonistName}在${primaryLocation}稳住呼吸与即时目标。`
        : `开场立刻把${input.protagonistName}放进${primaryLocation}的即时动作或危险里，不要先总述。`,
      requiredAnchors: uniqueNonEmpty([input.protagonistName, primaryLocation, input.sceneGoal]),
    },
    {
      label: "Beat 2",
      objective: `围绕“${input.primaryConflict}”推进靠近、判断或试探，把${worldAnchor}落进动作后果里。`,
      requiredAnchors: uniqueNonEmpty([input.primaryConflict, worldAnchor]),
    },
    {
      label: "Beat 3",
      objective: `让${input.protagonistName}与${contactTarget}发生直接接触、偷学、碰撞或夺路，不要隔空描述。`,
      requiredAnchors: uniqueNonEmpty([input.protagonistName, contactTarget]),
    },
    {
      label: "Beat 4",
      objective: `立刻兑现代价与暴露，优先写伤势、反噬、失手或被追踪，而不是轻飘得手。`,
      requiredAnchors: uniqueNonEmpty([input.secondaryConflict, input.worldAnchors[1] ?? input.worldAnchors[0]]),
    },
    {
      label: "Beat 5",
      objective: `收束到脱身、卡位或短暂喘息，同时只把“${hook}”留成一个章末后患，不要回头重复解释同一风险。`,
      requiredAnchors: uniqueNonEmpty([hook]),
    },
  ] satisfies DraftBeat[];
}

function buildLaterChapterBeats(input: {
  protagonistName: string;
  supportNames: string[];
  locationAnchors: string[];
  worldAnchors: string[];
  sceneGoal: string;
  primaryConflict: string;
  foreshadow: string | null;
  hasPreviousTail: boolean;
  mythicStory: boolean;
  currentVolumeGoal: string;
}) {
  const primaryLocation = input.locationAnchors[0] ?? "当前场景";
  const counterpart = input.supportNames[0] ?? "关键对手";
  const hook = input.foreshadow ?? "留下新的压力点";

  return [
    {
      label: "Beat 1",
      objective: input.hasPreviousTail
        ? `先承接上一章尾巴，再把${input.protagonistName}拉回${primaryLocation}中的当前目标。`
        : `开头迅速明确${input.protagonistName}当前要完成的事，不绕远路。`,
      requiredAnchors: uniqueNonEmpty([input.protagonistName, primaryLocation, input.sceneGoal]),
    },
    {
      label: "Beat 2",
      objective: input.mythicStory
        ? `把“${input.primaryConflict}”推到正面，但不要只重复旧追猎；至少让${counterpart}或相关阻力直接进场，并逼出不同于上一章的应对。`
        : `把“${input.primaryConflict}”推到正面，至少让${counterpart}或相关阻力直接进场。`,
      requiredAnchors: uniqueNonEmpty([input.primaryConflict, counterpart]),
    },
    {
      label: "Beat 3",
      objective: input.mythicStory
        ? `让一种新的异兽、怪地、灵药或古禁具体显形，并让它直接改写“${input.primaryConflict}”的胜负路径或通路。`
        : `写一次明确的局势改写，让${input.worldAnchors[0] ?? "既有规则"}通过动作与代价显形。`,
      requiredAnchors: uniqueNonEmpty(
        input.mythicStory
          ? [input.worldAnchors[0], input.worldAnchors[1] ?? input.currentVolumeGoal]
          : [input.worldAnchors[0], input.worldAnchors[1]],
      ),
    },
    {
      label: "Beat 4",
      objective: input.mythicStory
        ? `本章必须兑现一格主线推进：至少完成换地带、拿到新线索、确认新禁忌、引出新势力或改写目标之一；章末只留下“${hook}”这一根牵引，不要重复回钉。`
        : `在章末只留下“${hook}”这一根牵引，不要平铺收掉，也不要重复回钉同一后患。`,
      requiredAnchors: uniqueNonEmpty(input.mythicStory ? [hook, input.currentVolumeGoal] : [hook]),
    },
  ] satisfies DraftBeat[];
}

export function buildChapterDraftPlan(contextPack: Pick<
  ContextPack,
  | "blueprint"
  | "requiredCards"
  | "worldviewCards"
  | "previousChapterTail"
  | "currentVolumeGoal"
  | "writerNotes"
  | "memory"
  | "styleProfile"
  | "styleCard"
  | "writingDna"
  | "projectPremise"
  | "futureContext"
  | "structuredAvoidance"
  | "obligationCards"
  | "projectVoiceSnapshot"
>) {
  const protagonistName = contextPack.blueprint.characters[0]?.trim()
    || contextPack.requiredCards[0]?.name?.trim()
    || "主角";
  const supportNames = uniqueNonEmpty([
    ...contextPack.blueprint.characters.slice(1, 4),
    ...contextPack.requiredCards.map((card) => card.name).slice(1, 5),
  ]).filter((name) => name !== protagonistName);
  const locationAnchors = uniqueNonEmpty(contextPack.blueprint.locations).slice(0, 3);
  const worldAnchors = uniqueNonEmpty(
    contextPack.worldviewCards.flatMap((rule) => [rule.name, rule.description]),
  ).slice(0, 4);
  const activeThreadAnchors = uniqueNonEmpty(
    contextPack.memory.activeThreads.map((thread) => thread.content),
  ).slice(0, 2);
  const primaryConflict = contextPack.blueprint.conflicts[0]?.trim()
    || contextPack.blueprint.sceneGoal.trim();
  const secondaryConflict = contextPack.blueprint.conflicts[1]?.trim() || null;
  const foreshadow = contextPack.blueprint.foreshadows[0]?.trim()
    || activeThreadAnchors[0]
    || null;
  const hasPreviousTail = Boolean(contextPack.previousChapterTail?.trim());
  const mustMention = uniqueNonEmpty([
    protagonistName,
    ...supportNames,
    ...locationAnchors,
    ...contextPack.worldviewCards.map((rule) => rule.name),
    ...contextPack.blueprint.foreshadows,
  ]).slice(0, 8);
  const characterDirectives = buildCharacterDirectives(contextPack, protagonistName);
  const worldDirectives = buildWorldDirectives(contextPack);
  const styleDirectives = buildStyleDirectives(contextPack);
  const {
    planningDirectives: dnaPlanningDirectives,
    antiAiDirectives: dnaAntiAiDirectives,
    reviewChecklist: dnaReviewChecklist,
  } = buildWritingDnaDirectives(contextPack);
  const mythicStory = looksLikeMythicBestiaryStory(contextPack);
  const mythicProgressionDirectives = mythicStory
    ? buildMythicProgressionDirectives({
      protagonistName,
      supportNames,
      worldAnchors,
      currentVolumeGoal: contextPack.currentVolumeGoal,
    })
    : [];
  const planningDirectives = uniqueNonEmpty([
    ...dnaPlanningDirectives,
    ...mythicProgressionDirectives.slice(0, 2),
  ]).slice(0, 7);
  const antiAiDirectives = uniqueNonEmpty([
    ...dnaAntiAiDirectives,
    ...mythicProgressionDirectives.slice(2),
  ]).slice(0, 12);
  const reviewChecklist = uniqueNonEmpty([
    ...dnaReviewChecklist,
    mythicStory ? "检查本章是否真的把主线往前推了一格，而不是把同一追猎换个姿势再打一遍。" : "",
    mythicStory ? "检查本章是否至少让一种新的异兽、怪地、灵药、禁忌或更大的山川异象具体显形。" : "",
  ]).slice(0, 7);
  const writingCharter = contextPack.styleProfile.writingCharter;
  const mechanismRevealRule = writingCharter?.mechanismRevealRule
    || "机制类信息先写角色撞上的异动、代价和局势变化，再补最少必要辨认。";
  const mechanismRevealRedlines = uniqueNonEmpty(
    writingCharter?.mechanismRevealRedlines?.length
      ? writingCharter.mechanismRevealRedlines
      : ["不要写成解释 -> 验证 -> 总结三段式。"],
  );
  const bannedLexicon = uniqueNonEmpty([
    ...contextPack.styleProfile.forbiddenLexicon,
    ...contextPack.styleProfile.imageryRegister.avoid,
  ]).slice(0, 8);
  const obligationDirectives = (contextPack.obligationCards ?? [])
    .slice(0, 5)
    .flatMap((card) => uniqueNonEmpty([
      card.mustHold ? `必须保持：${card.mustHold}` : "",
      card.canHint ? `可以暗示：${card.canHint}` : "",
      card.doNotRepeat ? `不要重复：${card.doNotRepeat}` : "",
    ]));
  const activeStyle: ActiveStylePackage = {
    styleSnapshotId: contextPack.projectVoiceSnapshot?.id ?? null,
    styleSnapshotVersion: contextPack.projectVoiceSnapshot?.version ?? null,
    styleCard: contextPack.styleCard,
    styleProfile: contextPack.styleProfile,
    styleDigest: contextPack.projectVoiceSnapshot?.digest ?? "",
    styleExemplars: contextPack.projectVoiceSnapshot?.exemplars ?? [],
    confidence: null,
    sampledExcerpts: [],
    sourceIds: [],
  };
  const structurePlan = buildStructurePlan({
    chapterNo: contextPack.blueprint.chapterNo,
    sceneGoal: contextPack.blueprint.sceneGoal,
    primaryConflict,
    foreshadow,
    protagonistName,
    supportNames,
    locationAnchors,
    worldAnchors,
    currentVolumeGoal: contextPack.currentVolumeGoal,
    previousChapterTail: contextPack.previousChapterTail,
    obligationCards: contextPack.obligationCards ?? [],
    mythicStory,
    avoidAxes: uniqueNonEmpty([
      contextPack.structuredAvoidance?.avoidArenaKeys?.length ? "arena_loop" : "",
      contextPack.structuredAvoidance?.avoidObjectiveKeys?.length ? "objective_loop" : "",
    ]),
  });
  const voiceBrief = buildVoiceBrief({
    voicePack: buildVoicePack({
      projectId: "context-pack",
      activeStyle,
      projectVoiceSnapshot: contextPack.projectVoiceSnapshot ?? null,
    }),
    chapterNo: contextPack.blueprint.chapterNo,
    sceneCards: structurePlan.sceneCards,
  });

  const openingDirectives = uniqueNonEmpty([
    hasPreviousTail
      ? "本章开头必须先承接上一章未完动作、地点、伤势或危机，不要另起一段全新场面。"
      : `首段就让${protagonistName}进入动作、危险、发现或试探，不要先写空泛旁白。`,
    `开头前三段里至少两次明确点出“${protagonistName}”或其清晰身份锚点，不要只靠“它/他/她”。`,
    locationAnchors[0] ? `把“${locationAnchors[0]}”写成可感场景，而不是地点标签。` : "",
    worldAnchors[0] ? `把“${worldAnchors[0]}”写进动作结果或代价，不要另起百科解释。` : "",
    `本章主目标要始终围着“${contextPack.blueprint.sceneGoal}”推进，不要中途散掉。`,
    planningDirectives[0] ?? "",
    planningDirectives[1] ?? "",
  ]);

  const proseDirectives = uniqueNonEmpty([
    `正文目标字数优先靠近 ${contextPack.blueprint.estimatedWords} 字，不要明显短成梗概，也不要为了凑字数把同一风险反复回钉。`,
    "按连续场景写作，不要整章平均铺开；每个 beat 控制在 2-4 个自然段内推进。",
    "句首优先落在角色名、动作结果、身体反馈、环境异动、视线落点，不要连续多句代词起头。",
    "同一主体名词也不要机械连排起句，要主动打散句法与叙述重心。",
    "连续 6 句叙述里，同一代词或同一主体名词起句不要超过 2 次；需要主动换到动作结果、环境异动和身体反馈。",
    "显性比喻（像/仿佛/如同/宛如/似乎）全章尽量控制在 3 处内，同一段不要连着堆两处以上。",
    `如果${protagonistName}已经连续两句起头，第三句必须换到动作结果、环境异动、身体反馈或视线落点。`,
    writingCharter?.chapterLengthRule ? `作者章长习惯必须遵守：${writingCharter.chapterLengthRule}` : "",
    writingCharter?.openingMoveRule ? `作者开篇习惯必须遵守：${writingCharter.openingMoveRule}` : "",
    `章末收束必须遵守：${contextPack.styleProfile.chapterClosureRule}`,
    `信息露出必须遵守：${contextPack.styleProfile.infoRevealRule}`,
    `机制类信息露出必须遵守：${mechanismRevealRule}`,
    `机制类信息露出禁区：${mechanismRevealRedlines.join("；")}`,
    `情绪表达必须遵守：${contextPack.styleProfile.emotionRenderingRule}`,
    `开篇推进必须遵守：${contextPack.styleProfile.openingStrategy}`,
    `转场和转折必须遵守：${contextPack.styleProfile.sentenceRhythm.transitionRule}`,
    `停顿和留白必须遵守：${contextPack.styleProfile.sentenceRhythm.pauseRule}`,
    mythicStory ? "山海/洪荒推进硬约束：本章必须让新的异兽、怪地、灵药、古禁或山川异象真正改写局势，不要把同一场追打拖长。" : "",
    mythicStory ? "剧情推进硬约束：本章至少兑现一项实变，例如换地带、拿到新线索、确认新禁忌、引出新势力或改写目标。" : "",
    mythicStory ? "命名硬约束：新异兽或怪地不要总落狼、鹫、蛇这类常见兽名，优先写古怪体貌、异能习性和诡异生态。" : "",
    "关键设定只在角色遭遇、代价、判断和冲突里显形，不做讲义式解释，不要先下定义再补动作。",
    styleDirectives[0] ? `文风主锚点：${styleDirectives[0].replace(/^参考锚点：/u, "")}` : "",
    styleDirectives.find((entry) => entry.startsWith("段落推进：")) ?? "",
    styleDirectives.find((entry) => entry.startsWith("句子节奏：")) ?? "",
    styleDirectives.find((entry) => entry.startsWith("叙述贴近：")) ?? "",
    bannedLexicon.length ? `禁用词/禁句尽量避开：${bannedLexicon.join("、")}` : "",
    contextPack.styleProfile.aiSmellPatterns.length ? `重点规避这些 AI 味：${contextPack.styleProfile.aiSmellPatterns.join("、")}` : "",
    contextPack.styleProfile.styleTaboos.length ? `风格禁忌：${contextPack.styleProfile.styleTaboos.join("、")}` : "",
    antiAiDirectives[0] ?? "",
    antiAiDirectives[1] ?? "",
    antiAiDirectives[2] ?? "",
    contextPack.writerNotes[0] ? `额外吸收这一条 writer note：${contextPack.writerNotes[0]}` : "",
  ]);

  const beats = contextPack.blueprint.chapterNo <= 3
    ? buildEarlyChapterBeats({
      protagonistName,
      supportNames,
      locationAnchors,
      worldAnchors,
      sceneGoal: contextPack.blueprint.sceneGoal,
      primaryConflict,
      secondaryConflict,
      foreshadow,
      hasPreviousTail,
    })
    : buildLaterChapterBeats({
      protagonistName,
      supportNames,
      locationAnchors,
      worldAnchors,
      sceneGoal: contextPack.blueprint.sceneGoal,
      primaryConflict,
      foreshadow,
      hasPreviousTail,
      mythicStory,
      currentVolumeGoal: contextPack.currentVolumeGoal,
    });

  const promptText = [
    "当前章核心：",
    `- 主角锚点：${protagonistName}`,
    `- 当前主目标：${contextPack.blueprint.sceneGoal}`,
    `- 主冲突：${primaryConflict}`,
    `- 目标字数：约 ${contextPack.blueprint.estimatedWords} 字`,
    foreshadow ? `- 章末后患：${foreshadow}` : "",
    `- 必落锚点：${mustMention.join("、") || "无"}`,
    "",
    "Story Brief：",
    `- ${structurePlan.storyBrief}`,
    "Structure Brief：",
    `- ${structurePlan.structureBrief}`,
    "Scene Cards：",
    ...structurePlan.sceneCards.map((sceneCard) =>
      `- ${sceneCard.label}：要做=${sceneCard.objective}｜阻力=${sceneCard.obstacle}｜不可逆变化=${sceneCard.irreversibleChange}｜结尾钩子=${sceneCard.hookType}`
    ),
    "Voice Brief：",
    `- 摘要：${voiceBrief.summary}`,
    ...voiceBrief.positiveAnchors.slice(0, 4).map((anchor) => `- 正向锚点：${anchor}`),
    ...voiceBrief.antiPatterns.slice(0, 2).map((anchor) => `- 避免：${anchor}`),
    obligationDirectives.length ? "Obligation Cards：" : "",
    ...obligationDirectives.map((directive) => `- ${directive}`),
    "",
    "章节写作分拍：",
    ...beats.map((beat) =>
      `${beat.label}：${beat.objective}${beat.requiredAnchors.length ? ` 必落锚点：${beat.requiredAnchors.join("；")}` : ""}`
    ),
    "",
    "角色写作 DNA：",
    ...characterDirectives.slice(0, 3).map((directive) => `- ${directive}`),
    "世界规则落法：",
    ...worldDirectives.slice(0, 3).map((directive) => `- ${directive}`),
    "文风落点：",
    ...styleDirectives.slice(0, 8).map((directive) => `- ${directive}`),
    writingCharter?.mechanismRevealRule ? `- 机制类信息露出：${writingCharter.mechanismRevealRule}` : "",
    mechanismRevealRedlines.length ? `- 机制类信息露出禁区：${mechanismRevealRedlines.join("；")}` : "",
    "去AI味硬约束：",
    ...antiAiDirectives.slice(0, 8).map((directive) => `- ${directive}`),
    bannedLexicon.length ? `禁用词：${bannedLexicon.join("、")}` : "禁用词：无",
    `当前卷目标（写作时只能轻带，不要硬讲）：${contextPack.currentVolumeGoal}`,
    "开篇硬约束：",
    ...openingDirectives.slice(0, 4).map((directive) => `- ${directive}`),
    "句法硬约束：",
    ...proseDirectives.slice(0, 7).map((directive) => `- ${directive}`),
    "首稿自检：",
    ...reviewChecklist.slice(0, 3).map((directive) => `- ${directive}`),
    "前置规划规则：",
    ...planningDirectives.slice(0, 3).map((directive) => `- ${directive}`),
    mythicStory ? "山海/洪荒硬约束：" : "",
    ...mythicProgressionDirectives.slice(0, 4).map((directive) => `- ${directive}`),
  ].join("\n");

  return {
    storyBrief: structurePlan.storyBrief,
    structureBrief: structurePlan.structureBrief,
    sceneCards: structurePlan.sceneCards,
    voiceBrief,
    obligationDirectives,
    protagonistName,
    supportNames,
    locationAnchors,
    worldAnchors,
    mustMention,
    openingDirectives,
    proseDirectives,
    planningDirectives,
    antiAiDirectives,
    reviewChecklist,
    characterDirectives,
    worldDirectives,
    styleDirectives,
    bannedLexicon,
    beats,
    promptText,
  } satisfies ChapterDraftPlan;
}
