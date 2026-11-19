import type {
  ChapterBlueprint,
  FoundationPayload,
  StyleProfile,
  WritingDnaProfile,
} from "../types.ts";
import { unique } from "../utils.ts";

const FANTASY_GENRE_PATTERN = /玄幻|修仙|奇幻|洪荒|异兽|妖兽|灵纹|荒古|兽神/u;
const MYTHIC_BESTIARY_PATTERN = /山海经|山海|洪荒|大荒|神兽|灵药|药精|山川有灵|古地|禁区|异谱|部族/u;

function compactText(input?: string | null) {
  return input?.replace(/\s+/g, " ").trim() ?? "";
}

function looksLikeFantasy(input: { genre: string; premise: string; foundation?: FoundationPayload | null }) {
  const worldText = input.foundation?.worldview
    .map((item) => `${item.name} ${item.description}`)
    .join("；") ?? "";
  return FANTASY_GENRE_PATTERN.test(`${input.genre} ${input.premise} ${worldText}`);
}

function looksLikeMythicBestiary(input: { genre: string; premise: string; foundation?: FoundationPayload | null }) {
  const worldText = input.foundation?.worldview
    .map((item) => `${item.name} ${item.description}`)
    .join("；") ?? "";
  return MYTHIC_BESTIARY_PATTERN.test(`${input.genre} ${input.premise} ${worldText}`);
}

function collectStyleGuardrails(styleProfile?: Partial<StyleProfile> | null) {
  if (!styleProfile) {
    return [] as string[];
  }

  return unique([
    ...(styleProfile.toneGuardrails ?? []),
    ...(styleProfile.forbiddenLexicon ?? []).map((entry) => `避免把“${entry}”这类策划词直接写进正文。`),
    ...((styleProfile.imageryRegister?.avoid ?? []).map((entry) => `避免${entry}。`)),
    ...(styleProfile.rhetoricRegister?.avoidDevices ?? []).map((entry) => `避免${entry}。`),
    styleProfile.rhetoricRegister?.densityRule ? `修辞预算遵守：${styleProfile.rhetoricRegister.densityRule}` : "",
    styleProfile.narrativeRhythmDNA?.tensionRule ? `节奏DNA遵守：${styleProfile.narrativeRhythmDNA.tensionRule}` : "",
    styleProfile.emotionSpectrum?.restraintRule ? `情绪克制遵守：${styleProfile.emotionSpectrum.restraintRule}` : "",
    styleProfile.deepTexture?.sensoryRule ? `感官调用遵守：${styleProfile.deepTexture.sensoryRule}` : "",
    styleProfile.writingCharter?.rhetoricBudget
      ? `修辞预算硬约束：比喻密度<=${Number(styleProfile.writingCharter.rhetoricBudget.simileDensityPerThousand ?? 0).toFixed(1)}/千字，拟人密度<=${Number(styleProfile.writingCharter.rhetoricBudget.personificationDensityPerThousand ?? 0).toFixed(1)}/千字，反问<=${Math.max(0, Math.round(Number(styleProfile.writingCharter.rhetoricBudget.rhetoricalQuestionPerChapter ?? 0)))}/章。`
      : "",
    styleProfile.writingCharter?.sensoryBudget
      ? `感官预算硬约束：细节密度目标=${Number(styleProfile.writingCharter.sensoryBudget.sensoryDetailTargetPerThousand ?? 0).toFixed(1)}/千字，主通道=${(styleProfile.writingCharter.sensoryBudget.primaryChannels ?? []).join("、") || "无"}。`
      : "",
  ]);
}

function buildPremiseRule(
  premise: string,
  blueprint?: Pick<ChapterBlueprint, "sceneGoal" | "conflicts"> | null,
) {
  const normalizedPremise = compactText(premise);
  if (!normalizedPremise) {
    return "";
  }

  const sceneGoal = compactText(blueprint?.sceneGoal);
  const mainConflict = compactText(blueprint?.conflicts?.[0]);
  const prompt = sceneGoal || mainConflict;
  if (!prompt) {
    return `项目核心卖点是“${normalizedPremise}”，正文里每次触发它，都要写出触发条件、即时收益、代价和后患。`;
  }

  return `项目核心卖点是“${normalizedPremise}”，本章围绕“${prompt}”推进时，必须把卖点拆成触发条件、动作兑现、代价和局势变化，而不是空口介绍。`;
}

export function createDefaultWritingDna(): WritingDnaProfile {
  return {
    sourceTags: [
      "feishu.low-ai",
      "skills.ai.txt",
      "skills.3.planning-with-files",
      "linuxdo.stateful-memory",
      "linuxdo.single-draft",
    ],
    planningRules: [
      "角色卡、世界书、风格卡必须先展开成可执行的场景目标、阻力、代价与后患，再允许落笔。",
      "默认只读取与当前章直接相关的近窗上下文，先保因果闭环，不机械追满全文。",
      "角色卡和世界书按剧情推进增量更新，正文只注入当前章会改变局势的状态，不一次性塞满百科背景。",
      "蓝图优先收缩成当前章必须执行的 4-5 个 beats；开篇和重建阶段默认只规划当前章，不把后面几章一起摊平。",
      "每章先锁定即时目标、地点、危险与利益，再扩展设定和悬念，不要一上来横向铺太多信息。",
      "首稿按单稿强规划直写执行，不预留“三候选再筛”的试探空间。",
    ],
    sceneRules: [
      "开头先落场景、身体反馈、动作链和外部压强，让读者先站进现场，再知道结论。",
      "推进靠动作、原话、器物、气味、伤势、价格、制度摩擦和对手反应，不靠抽象概括。",
      "重要桥段不能一笔带过，必须写出阻力、代价、试探与回击，让过程自己生长出爽点。",
      "情绪不要直接宣布，优先落在微动作、生理反应、语气停顿和环境变化上。",
    ],
    voiceRules: [
      "句式长短要错开，主体锚点要轮换，别让代词、角色名或同一模板句连续占住句首。",
      "多用动词和名词，少用空泛形容词；能写动作结果，就不要只写情绪判断。",
      "对白必须贴身份、关系、处境和时代气口，允许打断、留白和未说完的话。",
      "段落按信息焦点自然组织，非刻意强调时不要一句一段，也不要整章都切成碎片。",
    ],
    antiAiRules: [
      "避免解释性总结、策划腔、审稿腔、过度工整的因果闭环和一步到位的结论感。",
      "连续 6 句叙述里，同一代词或同一显性主体名词起句不要超过 2 次，尤其别把“主角名……主角名……”写成排比。",
      "比喻预算要硬控：每个关键场面只保留 1 处必要比喻，全章尽量不要超过 4 次“像/仿佛/如同/宛如/似乎”类显性提示。",
      "章节尾段只允许把一个新后患或新动作钉死，不要连着两三段复述同一风险、同一结论或同一情绪。",
      "避免重复、固定的句式结构，不要靠“像/仿佛/不是……而是……”这类模板句反复堆气氛。",
      "真实比优美更重要，允许人物有误判、停顿、啰嗦和不完美，不要把所有话都说得过于标准。",
      "比喻、抒情和大词要收紧，只保留最有用的一两处，其余让细节自己发声。",
      "禁止密集使用叠词副词（微微、缓缓、轻轻、淡淡、静静、默默），用具体动作结果替代。全章同一叠词最多出现 2 次。",
      "眼睛描写不要用'眸'字系列（眸中闪过、凤眸、目光微凝），用角色的动作反应代替内心独白式五官特写。",
      "对话标签只用'说''问''喊'三个基本动词 + 偶尔省略标签，不要写'沉声道''冷声道''喃喃自语'这类文艺腔标签。",
    ],
    reviewChecklist: [
      "检查这一章是否真的让角色在现场行动，而不是在替剧情写摘要。",
      "检查情绪、关系和文气是否落在动作、语气和细节上，而不是靠作者解释。",
      "检查是否出现固定句式疲劳、代词连排、同一主体名词连排、模板转折和空泛修辞。",
      "检查章末是否只钉住一个新的风险、发现或位置变化，而不是反复回钉同一后患。",
      "检查文本是否更像目标作品/作者的笔触与节奏，而不是只有剧情方向相似。",
    ],
  };
}

export function buildIntegratedWritingDna(input: {
  genre: string;
  premise: string;
  styleProfile?: Partial<StyleProfile> | null;
  foundation?: FoundationPayload | null;
  blueprint?: Pick<ChapterBlueprint, "sceneGoal" | "conflicts"> | null;
}): WritingDnaProfile {
  const defaults = createDefaultWritingDna();
  const isFantasy = looksLikeFantasy({
    genre: input.genre,
    premise: input.premise,
    foundation: input.foundation,
  });
  const isMythicBestiary = looksLikeMythicBestiary({
    genre: input.genre,
    premise: input.premise,
    foundation: input.foundation,
  });
  const styleGuardrails = collectStyleGuardrails(input.styleProfile);
  const premiseRule = buildPremiseRule(input.premise, input.blueprint);

  const planningRules = [
    ...defaults.planningRules,
    premiseRule,
  ].filter(Boolean);

  const sceneRules = [...defaults.sceneRules];
  const voiceRules = [...defaults.voiceRules];
  const antiAiRules = [...defaults.antiAiRules, ...styleGuardrails];
  const reviewChecklist = [...defaults.reviewChecklist];
  const sourceTags = [...defaults.sourceTags];

  if (isFantasy) {
    sourceTags.push("skills.2.dark-fantasy-engine");
    planningRules.push("能力、机缘和升级要前置拆成“触发条件 -> 冒险动作 -> 反噬成本 -> 被追咬后患”的强因果链。");
    sceneRules.push("玄幻/异兽场景要有高压迫、高反馈和强因果，能力显形必须连着求生处境、风险和追猎压力一起写。");
    sceneRules.push("不要把金手指写成保姆外挂，任何收获都要伴随反噬、失误、暴露或新的猎手。");
    voiceRules.push("压迫感优先靠骨肉触感、气味、伤势、地形和对手习性撑起来，不靠空心狠话和大词装重。");
    reviewChecklist.push("检查能力展示是否连着触发条件、代价、追猎压力和世界规则，而不是临时开挂。");
  }

  if (isMythicBestiary) {
    sourceTags.push("skills.shanhai-mythic-engine");
    planningRules.push("山海/洪荒题材每 1-2 章至少兑现一次新的异兽、怪地、灵药、古禁或主线线索，单纯把同一场追猎拖长不算推进。");
    planningRules.push("如果上一章已经靠旧追猎者顶满压迫，本章必须改赛道：换地带、换生态、换禁忌、换线索或引出更古老的存在。");
    sceneRules.push("洪荒感要落在巨兽体量、怪异器官、山川灵应、活着的灵药和禁地生态上，不要整章只剩追打。");
    sceneRules.push("战斗只是显形手段，不是唯一推进器；让异兽习性、怪地规则、古遗留或部族祭痕直接改写路径。");
    voiceRules.push("新出现的异兽、怪地或灵药命名要带古怪性和辨识度，别总落回狼、鹫、蛇这类常见兽名直给。");
    reviewChecklist.push("检查本章是否真的带出了新的异兽、怪地、灵药、禁忌或主线线索，而不是把同一场追猎换皮再打一遍。");
    reviewChecklist.push("检查洪荒/山海感是否落在山川异性、巨兽奇观和诡异生态上，而不是只靠血腥打斗硬撑。");
  }

  return {
    sourceTags: unique(sourceTags),
    planningRules: unique(planningRules),
    sceneRules: unique(sceneRules),
    voiceRules: unique(voiceRules),
    antiAiRules: unique(antiAiRules),
    reviewChecklist: unique(reviewChecklist),
  };
}

export function formatWritingDnaForPrompt(dna: WritingDnaProfile) {
  return [
    `来源：${dna.sourceTags.join("、") || "内置默认"}`,
    `前置规划：${dna.planningRules.join("；")}`,
    `场景执行：${dna.sceneRules.join("；")}`,
    `语言笔触：${dna.voiceRules.join("；")}`,
    `去AI味：${dna.antiAiRules.join("；")}`,
    `自检清单：${dna.reviewChecklist.join("；")}`,
  ].join("\n");
}
