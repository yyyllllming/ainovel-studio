import "../server-only.ts";

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getFoundationWorkshopSnapshot } from "../foundation/foundation-workshop.ts";
import { isPlaceholderWorldCardDraft } from "../foundation/foundation-quality-guards.ts";
import { listCards } from "../repositories/card.repository.ts";
import { getFoundation } from "../repositories/foundation.repository.ts";
import type { FoundationPayload, FoundationWorkshopDraft, ProjectCard } from "../types.ts";

function trimText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function truncateText(value: string | null | undefined, maxLength: number) {
  const trimmed = trimText(value);
  if (!trimmed || trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isPlaceholderWorldCard(card: ProjectCard) {
  if (card.cardType !== "world") {
    return false;
  }

  const draft = card.draft as { name?: string; description?: string };
  return isPlaceholderWorldCardDraft(draft);
}

function extractLatestCorrection(messages: Array<{ role: "user" | "assistant"; content: string }>) {
  return [...messages]
    .reverse()
    .find((message) =>
      message.role === "user"
      && /(不是|而是|核心|重心|方向|不需要|只是|改成)/u.test(message.content)
    )?.content ?? "";
}

function buildAcceptedDirection(draft: FoundationWorkshopDraft | null | undefined, messages: Array<{ role: "user" | "assistant"; content: string }>) {
  const latestCorrection = trimText(extractLatestCorrection(messages));
  const parts: string[] = [];

  for (const candidate of [trimText(draft?.premise), trimText(draft?.mainline), latestCorrection]) {
    if (!candidate) {
      continue;
    }
    if (parts.some((part) => part.includes(candidate) || candidate.includes(part))) {
      continue;
    }
    parts.push(candidate);
  }

  return truncateText(parts.join("；"), 240) || truncateText(draft?.storyHook, 160);
}

function buildSupersededBranches(
  draft: FoundationWorkshopDraft | null | undefined,
  formalFoundation: FoundationPayload | null,
) {
  const draftWorldviewNames = new Set(
    (draft?.worldviewIdeas ?? []).map((item) => trimText(item.name)).filter(Boolean),
  );
  const draftCharacterNames = new Set(
    (draft?.characterIdeas ?? []).map((item) => trimText(item.name)).filter(Boolean),
  );
  const branches: string[] = [];

  // 已废弃分支 = 正式设定里仍存在、但已不在当前共创草案中的实体；不依赖任何具体小说的硬编码词表。
  if (draftWorldviewNames.size) {
    for (const rule of formalFoundation?.worldview ?? []) {
      const name = trimText(rule.name);
      if (name && !draftWorldviewNames.has(name)) {
        branches.push(`旧世界规则：${name}`);
      }
    }
  }
  if (draftCharacterNames.size) {
    for (const character of formalFoundation?.characters ?? []) {
      const name = trimText(character.name);
      if (name && !draftCharacterNames.has(name)) {
        branches.push(`旧角色：${name}`);
      }
    }
  }

  return branches;
}

function buildProtagonistGiftAndCost(draft: FoundationWorkshopDraft | null | undefined, messages: Array<{ role: "user" | "assistant"; content: string }>) {
  const protagonist = draft?.characterIdeas?.[0];
  const goal = trimText(protagonist?.goal);
  if (protagonist?.name && goal) {
    return `主角${trimText(protagonist.name)}的当前方向：${truncateText(goal, 120)}。`;
  }

  const latestCorrection = trimText(extractLatestCorrection(messages));
  if (latestCorrection) {
    return `当前需要以最新纠偏为准固化主角天赋与代价链：${truncateText(latestCorrection, 120)}`;
  }

  return "当前需要把主角天赋、承载方式与代价链再明确固化。";
}

function buildWorldRules(draft: FoundationWorkshopDraft | null | undefined) {
  return (draft?.worldviewIdeas ?? []).map((item) => `${item.name}：${truncateText(item.description, 120)}`);
}

function buildKeyConflicts(
  draft: FoundationWorkshopDraft | null | undefined,
  formalFoundation: FoundationPayload | null,
  supersededBranches: string[],
) {
  const conflicts: string[] = [];

  if (supersededBranches.length) {
    conflicts.push(`正式设定仍保留已被共创草案替换的旧条目：${supersededBranches.join("；")}。`);
  }

  const draftMainline = trimText(draft?.mainline);
  if (draftMainline && draftMainline !== trimText(formalFoundation?.mainline)) {
    conflicts.push("共创草案的主线尚未被正式设定完整吸收。");
  }

  return conflicts;
}

function buildRebuildGuide(input: {
  protagonistName: string;
  cards: ProjectCard[];
  formalStatus: "stale" | "current" | "missing";
}) {
  const guidance = [
    "以 acceptedDirection 为唯一重建起点，不要把已废弃分支直接当真相源。",
    input.protagonistName
      ? `先重建${input.protagonistName}的主角卡，再把主角目标与代价链写进结构化 draft。`
      : "先确定主角并重建主角卡，再把主角目标与代价链写进结构化 draft。",
  ];

  if (input.cards.some((card) => isPlaceholderWorldCard(card))) {
    guidance.push("当前世界卡仍是占位“世界基调”，需要在新项目里先补真正的世界规则卡。");
  }

  if (input.formalStatus === "stale") {
    guidance.push("formalFoundation 只作历史参考，不可直接拿来初始化新项目。");
  }

  return guidance;
}

export function buildFoundationHandoffExport(projectId: string) {
  const snapshot = getFoundationWorkshopSnapshot(projectId);
  const persistedFoundation = getFoundation(projectId);
  const cards = listCards(projectId);
  const draft = snapshot.state?.draft;
  const acceptedDirection = buildAcceptedDirection(draft, snapshot.messages);
  const supersededBranches = buildSupersededBranches(draft, persistedFoundation);
  const latestCorrection = trimText(extractLatestCorrection(snapshot.messages));
  const protagonistName =
    trimText(draft?.characterIdeas?.[0]?.name)
    || trimText(persistedFoundation?.characters?.[0]?.name);
  const formalStatus =
    snapshot.derivedFoundationMeta?.staleComparedToPersisted
        ? "stale" as const
        : persistedFoundation
          ? "current" as const
          : "missing" as const;

  const json = {
    coreState: {
      acceptedDirection,
      premise: trimText(draft?.premise),
      mainline: trimText(draft?.mainline),
      storyHook: trimText(draft?.storyHook),
      protagonistGiftAndCost: buildProtagonistGiftAndCost(draft, snapshot.messages),
      worldRules: buildWorldRules(draft),
      keyConflicts: buildKeyConflicts(draft, persistedFoundation, supersededBranches),
      unresolvedQuestions: draft?.unresolvedQuestions ?? [],
      latestCorrection,
      supersededBranches,
      rebuildGuide: buildRebuildGuide({
        protagonistName,
        cards,
        formalStatus,
      }),
    },
    formalFoundation: {
      status: formalStatus,
      premise: persistedFoundation?.premise ?? "",
      characters: persistedFoundation?.characters ?? [],
      worldview: persistedFoundation?.worldview ?? [],
      relationships: persistedFoundation?.relationships ?? [],
    },
    cards: {
      validCharacterCards: cards
        .filter((card) => card.cardType === "character" && card.status === "confirmed")
        .map((card) => ({
          name: card.name,
          status: card.status,
          draft: card.draft,
        })),
      placeholderWorldCards: cards
        .filter((card) => card.status === "confirmed" && isPlaceholderWorldCard(card))
        .map((card) => ({
          name: card.name,
          status: card.status,
          draft: card.draft,
        })),
    },
    messagesSummary: {
      totalMessages: snapshot.messages.length,
      latestCorrection,
      correctionMessages: [...snapshot.messages]
        .reverse()
        .filter((message) => message.role === "user" && /(不是|核心|方向|改成|只是)/u.test(message.content))
        .slice(0, 3)
        .map((message) => trimText(message.content)),
      latestMessages: snapshot.messages.slice(-6).map((message) => ({
        role: message.role,
        content: trimText(message.content),
        createdAt: message.createdAt,
      })),
    },
  };

  const markdown = [
    "# Foundation Handoff",
    "",
    "## Premise",
    json.coreState.premise || "未定",
    "",
    "## 主线",
    json.coreState.mainline || "未定",
    "",
    "## 钩子",
    json.coreState.storyHook || "未定",
    "",
    "## 主角天赋与代价",
    json.coreState.protagonistGiftAndCost,
    "",
    "## 世界规则",
    ...(json.coreState.worldRules.length ? json.coreState.worldRules.map((item) => `- ${item}`) : ["- 未定"]),
    "",
    "## 关键冲突",
    ...(json.coreState.keyConflicts.length ? json.coreState.keyConflicts.map((item) => `- ${item}`) : ["- 未定"]),
    "",
    "## 未决问题",
    ...(json.coreState.unresolvedQuestions.length ? json.coreState.unresolvedQuestions.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "## 最新纠偏记录",
    latestCorrection || "无",
    "",
    "## 已废弃分支",
    ...(json.coreState.supersededBranches.length ? json.coreState.supersededBranches.map((item) => `- ${item}`) : ["- 无"]),
    "",
    "## 重建引导",
    ...json.coreState.rebuildGuide.map((item) => `- ${item}`),
  ].join("\n");

  return {
    markdown,
    json,
  };
}

export async function writeFoundationHandoffExport(projectId: string, outputDir: string) {
  const exportPayload = buildFoundationHandoffExport(projectId);
  await mkdir(outputDir, { recursive: true });

  const markdownPath = resolve(outputDir, "foundation-handoff.md");
  const jsonPath = resolve(outputDir, "foundation-handoff.json");

  await Promise.all([
    writeFile(markdownPath, `${exportPayload.markdown}\n`, "utf8"),
    writeFile(jsonPath, `${JSON.stringify(exportPayload.json, null, 2)}\n`, "utf8"),
  ]);

  return {
    ...exportPayload,
    markdownPath,
    jsonPath,
  };
}
