import type { ObligationCard, SceneCard, StructurePlan, StructureScore } from "./types.ts";

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

function summarizeObligationType(input: string): ObligationCard["type"] {
  if (/关系|同盟|情感/u.test(input)) {
    return "relationship";
  }
  if (/伏笔|禁忌|后患/u.test(input)) {
    return "foreshadow";
  }
  if (/灵纹|规则|代价|机制/u.test(input)) {
    return "mechanic";
  }
  if (/神话|山海|异兽|怪地/u.test(input)) {
    return "mythic";
  }
  return "continuity";
}

export function deriveObligationCards(input: {
  chapterNo: number;
  futureContext: string[];
  nextSegmentIntent?: string | null;
  requiredObligations?: string[];
}): ObligationCard[] {
  const cards: ObligationCard[] = [];
  const meaningfulLines = input.futureContext
    .map((line) => line.trim())
    .filter((line) =>
      line
      && !line.startsWith("【")
      && (
        line.includes("必须")
        || line.includes("意图：")
        || line.includes("预埋")
        || line.includes("不要")
        || line.includes("本章必推")
      ),
    )
    .sort((left, right) => {
      const priority = (value: string) => {
        if (value.includes("不要")) {
          return 0;
        }
        if (value.includes("本章必推") || value.includes("必须")) {
          return 1;
        }
        if (value.includes("意图：") || value.includes("预埋")) {
          return 2;
        }
        return 3;
      };
      return priority(left) - priority(right);
    });

  for (const normalized of meaningfulLines) {
    const stripped = normalized.replace(/^-+\s*/u, "").replace(/^【硬性禁止】/u, "").trim();
    const mustHold = stripped.match(/^(必须保持|必须推进|本章必推)[:：](.+)$/u)?.[2]?.trim() ?? "";
    const canHint = stripped.match(/^(可以暗示|需要预埋|意图)[:：](.+)$/u)?.[2]?.trim() ?? "";
    const doNotRepeat = stripped.match(/^(不要重复|本章不要做什么)[:：](.+)$/u)?.[2]?.trim()
      || (stripped.includes("不要") ? stripped : "");
    const basis = mustHold || canHint || doNotRepeat || stripped;

    cards.push({
      id: `obl-${input.chapterNo}-${cards.length + 1}`,
      type: summarizeObligationType(basis),
      mustHold: mustHold || (canHint ? "保持当前章既有连续性，不要跳脱已发生事实。" : basis),
      canHint: canHint || input.nextSegmentIntent?.trim() || "",
      doNotRepeat: doNotRepeat || "不要把上一章已经讲清的压力整段复述。",
      expiryChapter: input.chapterNo + 2,
    });
  }

  for (const obligation of input.requiredObligations ?? []) {
    cards.push({
      id: `obl-${input.chapterNo}-${cards.length + 1}`,
      type: summarizeObligationType(obligation),
      mustHold: `本章必须回应题材义务：${obligation}。`,
      canHint: input.nextSegmentIntent?.trim() || "",
      doNotRepeat: "不要把义务写成解释清单，要落进动作后果。",
      expiryChapter: input.chapterNo + 1,
    });
  }

  return cards.slice(0, 8);
}

export function buildStructurePlan(input: {
  chapterNo: number;
  sceneGoal: string;
  primaryConflict: string;
  foreshadow?: string | null;
  protagonistName: string;
  supportNames: string[];
  locationAnchors: string[];
  worldAnchors: string[];
  currentVolumeGoal: string;
  previousChapterTail?: string | null;
  obligationCards: ObligationCard[];
  mythicStory?: boolean;
  requiredProgressDeltas?: string[];
  avoidAxes?: string[];
}): StructurePlan {
  const leadLocation = input.locationAnchors[0] ?? "当前场域";
  const secondLocation = input.locationAnchors[1] ?? input.locationAnchors[0] ?? "下一处落点";
  const worldAnchor = input.worldAnchors[0] ?? "核心规则";
  const support = input.supportNames[0] ?? "外部阻力";
  const hook = input.foreshadow?.trim() || "章末留下一根必须接住的新后患。";
  const sceneCards: SceneCard[] = [
    {
      id: `scene-${input.chapterNo}-1`,
      label: "Scene 1",
      objective: input.previousChapterTail?.trim()
        ? `先承接${input.protagonistName}在${leadLocation}的未完动作，把“${input.sceneGoal}”重新压到眼前。`
        : `开场立刻把${input.protagonistName}放进${leadLocation}里的即时动作，不要先总述。`,
      obstacle: input.primaryConflict,
      irreversibleChange: `${input.protagonistName}必须暴露一次新的判断、站位或代价，不能还停在原地。`,
      hookType: "position_shift",
      requiredAnchors: uniqueNonEmpty([input.protagonistName, leadLocation, input.sceneGoal]),
    },
    {
      id: `scene-${input.chapterNo}-2`,
      label: "Scene 2",
      objective: `让${input.protagonistName}与${worldAnchor}正面接触，拿到会改写下一步的新信息或新限制。`,
      obstacle: `${support}或${worldAnchor}会把本章目标推成更硬的抉择。`,
      irreversibleChange: `本章必须兑现至少一项推进：${(input.requiredProgressDeltas ?? ["information_shift"]).join(" / ")}。`,
      hookType: input.mythicStory ? "new_discovery" : "new_risk",
      requiredAnchors: uniqueNonEmpty([worldAnchor, secondLocation, input.currentVolumeGoal]),
    },
    {
      id: `scene-${input.chapterNo}-3`,
      label: "Scene 3",
      objective: `收束到新的局面变化，不要回钉解释；只保留一根后续牵引。`,
      obstacle: "已经付出的代价会逼着主角改路，而不是原地重复同一种对抗。",
      irreversibleChange: `不可逆变化：${hook}`,
      hookType: "new_risk",
      requiredAnchors: uniqueNonEmpty([hook, input.currentVolumeGoal]),
    },
  ];

  if (input.chapterNo <= 3) {
    sceneCards.splice(1, 0, {
      id: `scene-${input.chapterNo}-opening`,
      label: "Scene Opening",
      objective: `先把${input.protagonistName}的身体反馈、环境压强和即时目标钉实。`,
      obstacle: "任何解释都要让位给动作链。",
      irreversibleChange: `${input.protagonistName}确认本章不能再按上一章的旧路线行事。`,
      hookType: "new_discovery",
      requiredAnchors: uniqueNonEmpty([input.protagonistName, worldAnchor]),
    });
  }

  return {
    storyBrief: `当前章要做的事：围绕“${input.sceneGoal}”推进，并把“${input.currentVolumeGoal}”往前推一格。`,
    structureBrief: [
      `本章结构骨架以 ${sceneCards.length} 个 scene cards 推进。`,
      `不可逆变化必须真实发生，不能只把同一追逐/对抗换个姿势再写一遍。`,
      input.obligationCards.length ? `优先兑现 ${input.obligationCards.length} 条 obligation cards。` : "",
    ].filter(Boolean).join(" "),
    sceneCards: sceneCards.slice(0, 4),
    obligationCards: input.obligationCards.slice(0, 8),
    riskFlags: uniqueNonEmpty((input.avoidAxes ?? []).map((item) => `avoid:${item}`)),
  };
}

export function scoreStructure(input: {
  sceneCards: SceneCard[];
  chapterContent?: string | null;
}): StructureScore {
  const flags: string[] = [];
  let penalty = 0;
  const chapterContent = input.chapterContent?.trim() ?? "";

  if (/上一章|此前|先前|回想/u.test(chapterContent) || input.sceneCards[0]?.objective.includes("复述")) {
    penalty += 0.24;
    flags.push("recap_opening");
  }

  const obstacleSet = new Set(input.sceneCards.map((card) => card.obstacle));
  if (obstacleSet.size <= Math.max(1, input.sceneCards.length - 2)) {
    penalty += 0.22;
    flags.push("loop_risk:repeated_obstacle");
  }

  if (input.sceneCards.every((card) => /没有变化|仍旧没有新变化|原地/u.test(card.irreversibleChange))) {
    penalty += 0.26;
    flags.push("loop_risk:no_irreversible_change");
  }

  const anchorPool = input.sceneCards.flatMap((card) => card.requiredAnchors);
  const uniqueAnchors = new Set(anchorPool);
  if (anchorPool.length > 0 && uniqueAnchors.size <= Math.max(1, Math.floor(anchorPool.length / 3))) {
    penalty += 0.14;
    flags.push("loop_risk:narrow_anchor_band");
  }

  const score = Math.max(0, 1 - penalty);
  return {
    score,
    risk: score >= 0.75 ? "pass" : score >= 0.55 ? "watch" : "risk",
    flags,
  };
}
