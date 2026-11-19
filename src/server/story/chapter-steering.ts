import type {
  ChapterBlueprint,
  ReviewIssue,
  StyleChecklistHit,
  WritingCharterBudgetViolation,
} from "../types.ts";

const OPENING_LOCATION_PATTERN = /山|林|谷|涧|崖|洞|部族|村|巢|石缝|湿地|荒原|遗迹|古地/u;
const PURSUIT_PATTERN = /追猎|追踪|气息|标记|猎/u;
const RULE_LIKE_LOCATION_PATTERN = /灵纹|偷学|代价|追猎|气息|规则|机制|血脉|法门|印记/u;
const GENERIC_SCENE_GOAL_PATTERN = /当前主线|关键行动|新的阻力|推进.+主线|围绕眼前的异兽灵纹或求生机缘采取一次冒险行动/u;
const GENERIC_LOCATION_PATTERN = /当前主场景|当前地点|某地|某处|此地/u;
const GENERIC_CONFLICT_PATTERN = /当前地点|机缘或线索|带出去|试探会立刻|或追踪压力/u;
const GENERIC_FORESHADOW_PATTERN = /只留下一个|新疑问|更深追猎|天赋灵纹来源/u;

function unique(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function isGenericSceneGoal(sceneGoal: string) {
  return GENERIC_SCENE_GOAL_PATTERN.test(sceneGoal);
}

function countGenericLocations(locations: string[]) {
  return locations.filter((item) => GENERIC_LOCATION_PATTERN.test(item)).length;
}

function countRuleLikeLocations(locations: string[]) {
  return locations.filter((item) => RULE_LIKE_LOCATION_PATTERN.test(item) && !OPENING_LOCATION_PATTERN.test(item)).length;
}

function countGenericConflicts(conflicts: string[]) {
  return conflicts.filter((item) => GENERIC_CONFLICT_PATTERN.test(item)).length;
}

function countGenericForeshadows(foreshadows: string[]) {
  return foreshadows.filter((item) => GENERIC_FORESHADOW_PATTERN.test(item)).length;
}

function clampSteeringAnchor(input: string, max = 30) {
  const trimmed = input.replace(/\s+/gu, " ").trim().replace(/[。！？!?，,；;]+$/u, "");
  if (trimmed.length <= max) {
    return trimmed;
  }
  return trimmed.slice(0, max);
}

function countHeavyRevealForeshadows(foreshadows: string[]) {
  return foreshadows.filter((item) => /更古|上古|远古|整片|整座|更大|真正|苏醒|被唤醒/u.test(item)).length;
}

export function buildOpeningChapterSteering(input: {
  chapterNo: number;
  protagonistName: string;
  currentVolumeGoal: string;
  projectPremise: string;
}) {
  if (input.chapterNo > 5) {
    return [];
  }

  const phaseLabel = input.chapterNo <= 2 ? "开篇锁定阶段" : "早期承接阶段";

  return unique([
    `${phaseLabel}：本章先稳住${input.protagonistName}的即时目标、地点和危险，再扩展外部信息，不要一上来就横向铺太多支线。`,
    `当前卷目标是“${input.currentVolumeGoal}”，所以本章至少要落下一条能被后文持续承接的主行动线。`,
    `前五章默认每章只抬一个核心新疑问；更大的存在、整片山场异动或更高层规则，只能留一道影子，不要并排抬出。`,
    `项目核心卖点是“${input.projectPremise}”，所以能力展示必须连着触发条件、代价和求生处境一起写，不要像临时外挂。`,
  ]);
}

export function repairOpeningBlueprintPlaceholders(input: {
  blueprint: ChapterBlueprint;
  protagonistName: string;
  currentVolumeGoal: string;
  projectPremise: string;
  foundationCharacters: Array<{ name: string; role?: string }>;
  foundationWorldview: Array<{ name: string; description: string }>;
}) {
  const blueprint = input.blueprint;
  if (blueprint.chapterNo > 5) {
    return blueprint;
  }

  // 只在检测到占位写法时才做具体化替换；干净的蓝图原样通过，不注入任何模板内容。
  const needsSceneGoalRepair = isGenericSceneGoal(blueprint.sceneGoal);
  const needsLocationRepair = countGenericLocations(blueprint.locations) > 0 || blueprint.locations.length === 0;
  const needsConflictRepair = countGenericConflicts(blueprint.conflicts) > 0 || blueprint.conflicts.length === 0;
  const needsForeshadowRepair = countGenericForeshadows(blueprint.foreshadows) > 0;
  if (!needsSceneGoalRepair && !needsLocationRepair && !needsConflictRepair && !needsForeshadowRepair) {
    return blueprint;
  }

  const protagonistName = input.protagonistName.trim() || blueprint.characters[0] || "主角";
  const supportingCharacters = input.foundationCharacters.filter((card) => card.name !== protagonistName);
  const hunterName =
    supportingCharacters.find((card) => /hunter|追|猎|狼|鹰|鹫/u.test(`${card.role ?? ""}${card.name}`))?.name
    ?? supportingCharacters[0]?.name
    ?? "追迹者";
  const rivalName =
    supportingCharacters.find((card) => card.name !== hunterName)?.name
    ?? supportingCharacters[1]?.name
    ?? "截胡者";
  const locationRule =
    input.foundationWorldview.find((rule) => OPENING_LOCATION_PATTERN.test(`${rule.name}${rule.description}`))
    ?? input.foundationWorldview[0];
  const pursuitRule = input.foundationWorldview.find((rule) => PURSUIT_PATTERN.test(`${rule.name}${rule.description}`));
  const concreteBlueprintLocation = blueprint.locations.find((item) => !GENERIC_LOCATION_PATTERN.test(item));
  const openingLocation = locationRule?.name?.trim() || concreteBlueprintLocation || "开篇核心场地";
  // 替换文案只从项目自身的卷目标 / premise / 正式设定实体拼装，不携带任何题材预设。
  const goalAnchor = clampSteeringAnchor(input.currentVolumeGoal || input.projectPremise || blueprint.sceneGoal);
  const pursuitPressure = pursuitRule?.name?.trim()
    ? `${pursuitRule.name.trim()}带来的压力`
    : `${hunterName}的追逼`;

  const concreteSceneGoal = `让${protagonistName}在${openingLocation}直面${hunterName}带来的迫近威胁，为“${goalAnchor}”踏出第一步，并当场承担行动后果。`;
  const concreteConflicts = [
    `${protagonistName}必须在${openingLocation}先稳住自己的处境，否则“${goalAnchor}”的第一步就会当场断掉。`,
    `${pursuitPressure}正顺着${protagonistName}留下的痕迹逼近，${protagonistName}一旦贸然行动，就会把最不能暴露的底牌摆到${hunterName}眼前。`,
  ];
  const concreteForeshadow = `${protagonistName}在${openingLocation}注意到一个与${hunterName}有关、却暂时解释不通的细节，它指向一段还未揭开的隐情。`;

  const sceneGoal = needsSceneGoalRepair ? concreteSceneGoal : blueprint.sceneGoal;
  const locations = needsLocationRepair
    ? unique([
      ...blueprint.locations.filter((item) => !GENERIC_LOCATION_PATTERN.test(item)),
      openingLocation,
    ]).slice(0, blueprint.chapterNo <= 3 ? 2 : 3)
    : blueprint.locations;
  const conflicts = needsConflictRepair
    ? unique([
      ...blueprint.conflicts.filter((item) => !GENERIC_CONFLICT_PATTERN.test(item)),
      ...concreteConflicts,
    ]).slice(0, blueprint.chapterNo <= 2 ? 2 : 3)
    : blueprint.conflicts;
  const foreshadows = needsForeshadowRepair
    ? unique([
      ...blueprint.foreshadows.filter((item) => !GENERIC_FORESHADOW_PATTERN.test(item)),
      concreteForeshadow,
    ]).slice(0, blueprint.chapterNo <= 2 ? 1 : 2)
    : blueprint.foreshadows;
  const characters = needsSceneGoalRepair || needsConflictRepair || needsForeshadowRepair
    ? unique([
      protagonistName,
      ...blueprint.characters,
      hunterName,
      rivalName,
    ]).slice(0, blueprint.chapterNo <= 3 ? 3 : 4)
    : blueprint.characters;

  return {
    ...blueprint,
    sceneGoal,
    characters,
    locations,
    conflicts,
    foreshadows,
  };
}

export function assessBlueprintFocusRisk(blueprint: ChapterBlueprint) {
  const earlyChapter = blueprint.chapterNo <= 5;

  const notes: string[] = [];
  let score = 0;
  const characterLimit = earlyChapter ? (blueprint.chapterNo <= 3 ? 3 : 4) : 4;
  const locationLimit = earlyChapter ? (blueprint.chapterNo <= 3 ? 2 : 3) : 3;
  const conflictLimit = earlyChapter ? (blueprint.chapterNo <= 2 ? 2 : 3) : 3;
  const foreshadowLimit = earlyChapter ? (blueprint.chapterNo <= 2 ? 1 : 2) : 2;

  if (isGenericSceneGoal(blueprint.sceneGoal)) {
    score += 2;
    notes.push(
      earlyChapter
        ? "sceneGoal 仍然过泛，像占位任务，不够像可直接开写的场景目标。"
        : "sceneGoal 又退回泛化求生/机缘占位，像默认 fallback，不像当前剧情真的前进了一格。",
    );
  }

  if (blueprint.characters.length > characterLimit) {
    score += 1;
    notes.push(`${earlyChapter ? "开篇阶段" : "当前章节"}同章角色过多（${blueprint.characters.length} 人），容易分散镜头。`);
  }

  if (blueprint.locations.length > locationLimit) {
    score += 1;
    notes.push(`${earlyChapter ? "开篇阶段" : "当前章节"}地点切换偏多（${blueprint.locations.length} 处），容易让承接发虚。`);
  }

  const genericLocationCount = countGenericLocations(blueprint.locations);
  if (genericLocationCount > 0) {
    score += 2;
    notes.push(`地点仍有 ${genericLocationCount} 处占位写法，像“当前主场景”这类词必须落成具体场域。`);
  }

  const ruleLikeLocationCount = countRuleLikeLocations(blueprint.locations);
  if (ruleLikeLocationCount > 0) {
    score += 2;
    notes.push("地点里混入了“灵纹偷学/追猎压力”这类机制名词，说明蓝图还没把世界规则落成具体场域。");
  }

  if (blueprint.conflicts.length > conflictLimit) {
    score += 2;
    notes.push(`当前章冲突装载过多（${blueprint.conflicts.length} 条），应收束到即时目标链。`);
  }

  const genericConflictCount = countGenericConflicts(blueprint.conflicts);
  if (genericConflictCount > 0) {
    score += 2;
    notes.push(
      earlyChapter
        ? "冲突里还残留“当前地点 / 机缘或线索”这类摘要词，缺少可直接开写的具体阻力。"
        : "中后段蓝图仍在用“当前地点活下来 / 把机缘带出去”这类占位冲突，剧情会原地打转。",
    );
  }

  if (blueprint.foreshadows.length > foreshadowLimit) {
    score += 2;
    notes.push(
      earlyChapter
        ? `当前章伏笔过量（${blueprint.foreshadows.length} 条），容易把新疑问一次抬太满。`
        : `当前章伏笔过量（${blueprint.foreshadows.length} 条），容易把新线索和新风险摊成摘要。`,
    );
  }

  const genericForeshadowCount = countGenericForeshadows(blueprint.foreshadows);
  if (genericForeshadowCount > 0) {
    score += earlyChapter ? 1 : 2;
    notes.push(
      earlyChapter
        ? "伏笔仍像摘要口吻，只说“新疑问/来源”，还没落到可感的异常或线索。"
        : "中后段伏笔仍是“更深追猎/新疑问/来源”这种空钩，没有新增线索、异象或更大存在的具体影子。",
    );
  }

  const heavyRevealCount = countHeavyRevealForeshadows(blueprint.foreshadows);
  if (earlyChapter && heavyRevealCount >= 2) {
    score += 2;
    notes.push("伏笔里同时抬出了多个宏大揭示，开篇阶段容易透支神秘感。");
  }

  const severity: "ok" | "warn" | "fail" = score >= 5 ? "fail" : score >= 2 ? "warn" : "ok";

  return {
    severity,
    notes,
    score,
    shouldRepair: severity !== "ok",
  };
}

export function buildReviewSteeringInstructions(input: {
  chapterNo: number;
  issues: ReviewIssue[];
  fixInstructions: string;
  reason: string;
  styleChecklistHits?: StyleChecklistHit[];
  charterViolations?: WritingCharterBudgetViolation[];
}) {
  const types = new Set(input.issues.map((issue) => issue.type));
  const combined = `${input.reason}\n${input.fixInstructions}`;
  const instructions: string[] = [];

  if (types.has("progression") || types.has("structure_break") || /承接|衔接|开头/u.test(combined)) {
    instructions.push("章节开头先承接上一章最后动作、地点与伤势，再推进新场面，避免硬切。");
  }

  if (types.has("world_rule") || /规则|生效|失控|能力|灵纹/u.test(combined)) {
    instructions.push("新能力或规则第一次生效时，要写清触发条件、代价和失控边界，不能像临时外挂。");
  }

  if (types.has("foreshadow_debt") || types.has("blueprint_drift") || types.has("pacing") || /压低揭示|核心新疑问|揭示过量/u.test(combined)) {
    instructions.push("前几章每章最多只保留一个核心新疑问，宏大异象和更大存在只留一道影子，不要并排抬升。");
  }

  if (types.has("motivation") || types.has("emotion") || /即时目标|求生|脱身/u.test(combined)) {
    instructions.push("先保住主角当章的即时目标链，让行动、代价和情绪落在身体与选择上，不要被大设定盖过去。");
  }

  if (types.has("pov_tone") || types.has("prose") || types.has("style_drift")) {
    instructions.push("少写总结句和解释句，尽量贴住第三人称近距感知，用动作和感官代替抽象归纳。");
  }

  if (types.has("pacing") || types.has("prose") || /结尾|末段|重复强调|反复|回钉/u.test(combined)) {
    instructions.push("章末只保留一个新的风险、发现或位置变化，不要连着两三段重复回钉同一后患、同一结论或同一情绪。");
  }

  for (const violation of input.charterViolations ?? []) {
    if (violation.key === "ending_conclusion_sentence") {
      instructions.push("章末策略继续收紧：结尾只留一个新后患或动作尾钩，不要再用“这意味着/总之”回钉同一结论。");
    }
    if (violation.key === "mechanism_explicit_summary") {
      instructions.push("机制露出策略继续收紧：先写异动、代价和动作结果，再补最少必要辨认，别先写定义句。");
    }
    if (violation.key === "mechanism_triad_pattern") {
      instructions.push("机制露出策略继续收紧：拆掉解释 -> 验证 -> 总结三段式，把机制说明打散进遭遇、反噬和误判。");
    }
    if (violation.key === "transition_contrast_template" || violation.key === "transition_abrupt_turn" || violation.key === "transition_hard_marker") {
      instructions.push("转场预算继续收紧：优先用动作结果、环境异动和视线牵引完成转折，少用“不是……而是……”“忽然”与硬转词。");
    }
    if (violation.key === "simile_per_chapter" || violation.key === "simile_per_paragraph") {
      instructions.push("比喻预算继续收紧：能直接写动作、触感和结果就直接写，不要把一种比喻换成另一种比喻。");
    }
    if (violation.key === "subject_pronoun_lead" || violation.key === "subject_dominant_lead" || violation.key === "subject_window_repeat") {
      instructions.push("主体起句预算继续收紧：别让同一主体或代词连排起句，用环境、动作结果和身体反馈分散句首。");
    }
    if (violation.key === "motif_reuse") {
      instructions.push("母题复用预算继续收紧：同一意象不要原词原意反复敲回，复现时必须带来新的动作后果或局势变化。");
    }
  }

  for (const hit of input.styleChecklistHits ?? []) {
    if (/机制/u.test(hit.dimension) && !instructions.some((entry) => entry.includes("机制露出策略继续收紧"))) {
      instructions.push("机制露出策略继续收紧：别把暗钩写成讲义，要让角色先撞上代价，再让辨认慢半拍出现。");
    }
    if (/章末/u.test(hit.dimension) && !instructions.some((entry) => entry.includes("章末策略继续收紧"))) {
      instructions.push("章末策略继续收紧：宁可删掉回钉总结，也要把尾钩留在新动作、新位置或新后患上。");
    }
  }

  return unique(instructions);
}
