import "../server-only.ts";

import { nanoid } from "nanoid";
import { z } from "zod";
import { type ChatMessage } from "../llm.ts";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { getPrompt } from "../prompts.ts";
import type {
  CanonFact,
  CharacterSnapshot,
  ChapterBlueprint,
  ConflictRecord,
  FoundationPayload,
  LlmProfile,
  SegmentPlanItem,
} from "../types.ts";
import { nowIso, unique } from "../utils.ts";

const CANON_COVERAGE_CATEGORIES = [
  "character_state",
  "location_change",
  "item_acquired",
  "plot_event",
  "foreshadow",
  "world_rule",
  "relationship",
  "timeline_marker",
] as const;

type CanonCoverageCategory = (typeof CANON_COVERAGE_CATEGORIES)[number];
export type CanonComponentName = "summaries" | "facts" | "snapshot";
export type CanonComponentStatus = "success" | "degraded";
export interface CanonDiagnostics {
  usedFallback: boolean;
  aggregateStatus: "success" | "partial_success" | "fallback";
  components: Record<CanonComponentName, CanonComponentStatus>;
  factCount: number;
  snapshotCharacterCount: number;
  missingCategories: CanonCoverageCategory[];
}
export interface CanonArtifacts {
  summaries: { brief: string; detailed: string; full: string };
  facts: CanonFact[];
  snapshot: CharacterSnapshot;
  diagnostics: CanonDiagnostics;
}

const factSchema = z.object({
  type: z.enum(CANON_COVERAGE_CATEGORIES),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  keywords: z.array(z.string()).optional().default([]),
});

const factCoverageSchema = z.object({
  category: z.enum(CANON_COVERAGE_CATEGORIES),
  present: z.boolean(),
  facts: z.array(factSchema).default([]),
});

const factsCoverageResultSchema = z.object({
  categories: z.array(factCoverageSchema).min(8),
  missingCategories: z.array(z.enum(CANON_COVERAGE_CATEGORIES)).default([]),
});

const CANON_SUMMARY_LIMITS = {
  brief: 100,
  detailed: 500,
  full: 1200,
} as const;

const summarySchema = z.object({
  brief: z.string().min(1).max(CANON_SUMMARY_LIMITS.brief),
  detailed: z.string().min(1).max(CANON_SUMMARY_LIMITS.detailed),
  full: z.string().min(1).max(CANON_SUMMARY_LIMITS.full),
});

const snapshotEvidenceValueSchema = z.object({
  value: z.string().min(1),
  evidence: z.string().min(4),
});

const snapshotRelationshipEvidenceValueSchema = z.object({
  value: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  change: z.string().min(1).optional(),
  evidence: z.string().min(4),
}).refine((entry) => Boolean(entry.value ?? entry.status ?? entry.change), {
  message: "relationship requires value, status, or change",
}).transform((entry) => ({
  value: entry.value ?? entry.status ?? entry.change!,
  evidence: entry.evidence,
}));

const snapshotSchema = z.object({
  characters: z.record(
    z.string(),
    z.object({
      location: snapshotEvidenceValueSchema.optional(),
      emotion: snapshotEvidenceValueSchema.optional(),
      relationships: z.record(z.string(), snapshotRelationshipEvidenceValueSchema).optional(),
      items: z.array(snapshotEvidenceValueSchema).optional(),
      notes: z.array(snapshotEvidenceValueSchema).optional(),
      currentGoal: snapshotEvidenceValueSchema.optional(),
      currentPressure: snapshotEvidenceValueSchema.optional(),
      hiddenIntent: snapshotEvidenceValueSchema.optional(),
      injuries: z.array(snapshotEvidenceValueSchema).optional(),
    }),
  ),
});

type SnapshotExtraction = z.infer<typeof snapshotSchema>;

function normalizeEvidenceText(value: string) {
  return value.replace(/\s+/gu, "");
}

function hasGroundedEvidence(chapterContent: string, characterName: string, quote: string, relatedName?: string) {
  const normalizedChapter = normalizeEvidenceText(chapterContent);
  const normalizedQuote = normalizeEvidenceText(quote);
  const normalizedCharacterName = normalizeEvidenceText(characterName);
  if (normalizedQuote.length < 4 || !normalizedChapter.includes(normalizedQuote)) return false;
  if (!normalizedQuote.includes(normalizedCharacterName)) return false;
  if (
    normalizedQuote.includes(`${normalizedCharacterName}暂时联系不上`)
    || normalizedQuote.includes(`${normalizedCharacterName}联系不上`)
    || normalizedQuote.includes(`${normalizedCharacterName}本章未出场`)
  ) return false;
  return relatedName ? normalizedQuote.includes(normalizeEvidenceText(relatedName)) : true;
}

function isMeaningfulSnapshotValue(value: string) {
  return !/^(?:(?:未知|不明)(?:$|[\s（(：:])|无$|没有$|unknown$|none$|n\/?a$|not applicable$|not known$)/iu.test(value.trim());
}

function normalizeCharacterSnapshot(
  chapterNo: number,
  chapterContent: string,
  extraction: SnapshotExtraction,
): CharacterSnapshot {
  const characters: CharacterSnapshot["characters"] = {};
  const scalarFields = ["location", "emotion", "currentGoal", "currentPressure", "hiddenIntent"] as const;
  const arrayFields = ["items", "notes", "injuries"] as const;

  for (const [characterName, rawState] of Object.entries(extraction.characters)) {
    const state: CharacterSnapshot["characters"][string] = {};
    const evidence: NonNullable<CharacterSnapshot["characters"][string]["evidence"]> = [];

    for (const field of scalarFields) {
      const entry = rawState[field];
      if (
        !entry
        || !isMeaningfulSnapshotValue(entry.value)
        || !hasGroundedEvidence(chapterContent, characterName, entry.evidence)
      ) continue;
      state[field] = entry.value;
      evidence.push({ field, quote: entry.evidence });
    }

    for (const field of arrayFields) {
      const entries = rawState[field]?.filter((entry) => (
        isMeaningfulSnapshotValue(entry.value)
        &&
        hasGroundedEvidence(chapterContent, characterName, entry.evidence)
      ));
      if (!entries?.length) continue;
      state[field] = entries.map((entry) => entry.value);
      evidence.push(...entries.map((entry) => ({ field, quote: entry.evidence })));
    }

    const relationships = Object.fromEntries(
      Object.entries(rawState.relationships ?? {}).flatMap(([relatedName, entry]) => (
        isMeaningfulSnapshotValue(entry.value)
          && hasGroundedEvidence(chapterContent, characterName, entry.evidence, relatedName)
          ? [[relatedName, entry.value]]
          : []
      )),
    );
    if (Object.keys(relationships).length > 0) {
      state.relationships = relationships;
      for (const [relatedName, entry] of Object.entries(rawState.relationships ?? {})) {
        if (relationships[relatedName] !== undefined) {
          evidence.push({ field: `relationships.${relatedName}`, quote: entry.evidence });
        }
      }
    }

    if (evidence.length === 0) continue;
    state.evidence = evidence;
    characters[characterName] = state;
  }

  return { chapterNo, characters };
}

function normalizeFacts(chapterNo: number, facts: z.infer<typeof factSchema>[]): CanonFact[] {
  return facts.map((fact) => ({
    id: nanoid(),
    type: fact.type,
    chapterNo,
    content: fact.content,
    metadata: fact.metadata ?? {},
    timestamp: nowIso(),
    keywords: unique([
      ...fact.keywords,
      ...fact.content.split(/[^\p{L}\p{N}_]+/u).filter(Boolean).slice(0, 8),
    ]),
  }));
}

function normalizeCoverageResult(raw: z.infer<typeof factsCoverageResultSchema>) {
  const categoryMap = new Map<CanonCoverageCategory, z.infer<typeof factCoverageSchema>>();
  for (const entry of raw.categories) {
    categoryMap.set(entry.category, entry);
  }

  const categories = CANON_COVERAGE_CATEGORIES.map((category) =>
    categoryMap.get(category) ?? {
      category,
      present: false,
      facts: [],
    });
  const extractedTypes = new Set(categories.flatMap((entry) => entry.facts.map((fact) => fact.type)));
  const missingCategories = unique([
    ...raw.missingCategories,
    ...categories
      .filter((entry) => !entry.present || !entry.facts.length)
      .map((entry) => entry.category),
    ...CANON_COVERAGE_CATEGORIES.filter((category) => !extractedTypes.has(category)),
  ]);

  return {
    categories,
    missingCategories,
  };
}

function buildCanonDiagnostics(input: {
  usedFallback: boolean;
  components: Record<CanonComponentName, CanonComponentStatus>;
  facts: CanonFact[];
  snapshot: CharacterSnapshot;
  missingCategories: CanonCoverageCategory[];
}) {
  return {
    usedFallback: input.usedFallback,
    aggregateStatus: Object.values(input.components).every((status) => status === "success")
      ? "success" as const
      : Object.values(input.components).every((status) => status === "degraded")
        ? "fallback" as const
        : "partial_success" as const,
    components: input.components,
    factCount: input.facts.length,
    snapshotCharacterCount: Object.keys(input.snapshot.characters).length,
    missingCategories: input.missingCategories,
  };
}

function looksLikeRelationshipShift(text: string) {
  return /信任|怀疑|疏离|靠拢|结盟|翻脸|背叛|站到一边|立场/u.test(text);
}

export function buildFallbackCanonArtifacts(
  chapterNo: number,
  chapterContent: string,
  blueprint: ChapterBlueprint,
  foundation: FoundationPayload,
) {
  const paragraphs = chapterContent.split(/\n{2,}/).filter(Boolean);
  const brief = paragraphs.slice(0, 1).join(" ").slice(0, CANON_SUMMARY_LIMITS.brief) || blueprint.sceneGoal;
  const detailed = paragraphs.slice(0, 3).join("\n\n").slice(0, CANON_SUMMARY_LIMITS.detailed)
    || chapterContent.slice(0, CANON_SUMMARY_LIMITS.detailed);
  const full = chapterContent.slice(0, CANON_SUMMARY_LIMITS.full);

  const facts: CanonFact[] = [
    {
      id: nanoid(),
      type: "plot_event",
      chapterNo,
      content: paragraphs[0]?.slice(0, 160) || blueprint.sceneGoal,
      metadata: {
        derivedFrom: "fallback",
        sceneGoal: blueprint.sceneGoal,
      },
      timestamp: nowIso(),
      keywords: unique([blueprint.sceneGoal, ...blueprint.conflicts].join(" ").split(/[^\p{L}\p{N}_]+/u).filter(Boolean).slice(0, 10)),
    },
  ];

  for (const name of blueprint.characters) {
    if (chapterContent.includes(name)) {
      facts.push({
        id: nanoid(),
        type: "character_state",
        chapterNo,
        content: `${name}在第${chapterNo}章出场并卷入当前冲突。`,
        metadata: {
          character: name,
          field: "appearance",
          value: "present",
        },
        timestamp: nowIso(),
        keywords: [name, "出场", "appearance"],
      });
    }
  }

  for (const location of blueprint.locations) {
    facts.push({
      id: nanoid(),
      type: "location_change",
      chapterNo,
      content: `本章主要场景推进到${location}。`,
      metadata: { location, to: location },
      timestamp: nowIso(),
      keywords: [location, "地点", "scene"],
    });
  }

  for (const foreshadow of blueprint.foreshadows) {
    if (!foreshadow.trim()) {
      continue;
    }
    facts.push({
      id: nanoid(),
      type: "foreshadow",
      chapterNo,
      content: foreshadow,
      metadata: { status: "active" },
      timestamp: nowIso(),
      keywords: unique(foreshadow.split(/[^\p{L}\p{N}_]+/u).filter(Boolean)),
    });
  }

  for (const edge of foundation.relationships) {
    if (chapterContent.includes(edge.source) && chapterContent.includes(edge.target) && looksLikeRelationshipShift(chapterContent)) {
      facts.push({
        id: nanoid(),
        type: "relationship",
        chapterNo,
        content: `${edge.source}与${edge.target}的关系在本章出现明显变化。`,
        metadata: {
          source: edge.source,
          target: edge.target,
          change: edge.label,
        },
        timestamp: nowIso(),
        keywords: [edge.source, edge.target, "关系变化"],
      });
      break;
    }
  }

  const snapshot: CharacterSnapshot = {
    chapterNo,
    characters: Object.fromEntries(
      foundation.characters
        .filter((character) => (
          blueprint.characters.includes(character.name)
          && chapterContent.includes(character.name)
        ))
        .map((character) => [
          character.name,
          {},
        ]),
    ),
  };

  const missingCategories = CANON_COVERAGE_CATEGORIES.filter((category) => !facts.some((fact) => fact.type === category));

  return {
    summaries: {
      brief,
      detailed,
      full,
    },
    facts,
    snapshot,
    diagnostics: buildCanonDiagnostics({
      usedFallback: true,
      components: { summaries: "degraded", facts: "degraded", snapshot: "degraded" },
      facts,
      snapshot,
      missingCategories,
    }),
  };
}

export async function extractCanonArtifacts(input: {
  profile: LlmProfile;
  model: string;
  chapterNo: number;
  blueprint: ChapterBlueprint;
  foundation: FoundationPayload;
  chapterContent: string;
  prompts?: {
    summaryPrompt?: string;
    archivistPrompt?: string;
  };
  previousArtifacts?: CanonArtifacts | null;
  componentExtractors?: {
    summaries?: () => Promise<z.infer<typeof summarySchema>>;
    facts?: () => Promise<z.infer<typeof factsCoverageResultSchema>>;
    snapshot?: () => Promise<z.infer<typeof snapshotSchema>>;
  };
}) {
  const [summaryPrompt, archivistPrompt] = await Promise.all([
    input.prompts?.summaryPrompt ? Promise.resolve(input.prompts.summaryPrompt) : getPrompt("archivist").catch(() => ""), // prompt loading failure is non-critical for canon
    input.prompts?.archivistPrompt ? Promise.resolve(input.prompts.archivistPrompt) : getPrompt("archivist").catch(() => ""),
  ]);

  const sharedContext = [
    `章节号：${input.chapterNo}`,
    `蓝图：${JSON.stringify(input.blueprint, null, 2)}`,
    `角色：${JSON.stringify(input.foundation.characters, null, 2)}`,
    `正文：\n${input.chapterContent}`,
  ].join("\n\n");

  const summaryMessages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "你负责提炼章节摘要。必须输出 JSON，字段只有 brief、detailed、full。",
        `brief 不超过 ${CANON_SUMMARY_LIMITS.brief} 个字符；detailed 不超过 ${CANON_SUMMARY_LIMITS.detailed} 个字符；full 不超过 ${CANON_SUMMARY_LIMITS.full} 个字符。`,
        "三个层级都必须是摘要，full 也要压缩情节、证据与状态变化，禁止复制整章正文。",
        "不要输出 facts、characterStates、解释或 markdown 代码块。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `${summaryPrompt}\n\n本次子任务只输出 brief、detailed、full 三层摘要，并严格遵守各字段长度上限。\n${sharedContext}`,
    },
  ];

  const factsMessages: ChatMessage[] = [
    {
      role: "system",
      content: `${archivistPrompt}

你负责做八类覆盖式事实提取。必须输出 JSON，字段只有：
- categories：长度固定为 8，每项包含 category、present、facts
- missingCategories：缺失类别数组

八类必须全部覆盖：character_state / location_change / item_acquired / plot_event / foreshadow / world_rule / relationship / timeline_marker。
每一类都必须明确 present=true/false；没有就写 facts=[]。`,
    },
    {
      role: "user",
      content: `请从下面章节中做覆盖式提取。
要求：
1. 八类都要判断“有/无”。
2. facts 只写已经在正文中成立的内容，不要脑补。
3. plot_event 至少覆盖本章最关键的不可逆事件。
4. relationship 只在关系、立场、信任、绑定发生变化时填写。
5. world_rule 只在规则被确认、触发、打破或抬高时填写。
\n${sharedContext}`,
    },
  ];

  const snapshotMessages: ChatMessage[] = [
    {
      role: "system",
      content: `${archivistPrompt}

你负责生成角色状态快照。必须输出 JSON，字段只有 characters。
每个状态值必须写成 {"value":"状态结论","evidence":"正文中的连续逐字原文"}；数组字段的每一项也使用该结构。
evidence 必须包含对应角色姓名；relationships 的 evidence 必须同时包含双方姓名。没有直接证据就省略字段，人物没有任何直接证据就不要输出。
relationships 示例：{"何春玲":{"value":"信任加深","evidence":"林砚把记录递给何春玲，何春玲点头接过"}}。关系结论字段也可命名为 status 或 change。
优先补出：currentGoal / currentPressure / hiddenIntent / relationship delta / injuries。`,
    },
    {
      role: "user",
      content: `请根据下面章节输出角色状态快照。
重点：
1. currentGoal：角色此刻真正想做什么
2. currentPressure：此刻正逼着他/她行动的压力
3. hiddenIntent：只在正文里能推断出暗线意图时填写
4. relationships：只记录有变化的关系状态
5. injuries：只写正文里真实出现的伤势
\n${sharedContext}`,
    },
  ];

  const fallback = buildFallbackCanonArtifacts(input.chapterNo, input.chapterContent, input.blueprint, input.foundation);
  const previous = input.previousArtifacts ?? null;
  const summaryPromise = previous?.diagnostics.components.summaries === "success"
    ? Promise.resolve(previous.summaries)
    : (input.componentExtractors?.summaries?.() ?? chatJsonWithWorkflowPolicy({
        workflow: "canon_summary",
        profile: input.profile,
        model: input.model,
        messages: summaryMessages,
        assignmentMaxTokens: Number.MAX_SAFE_INTEGER,
        temperature: 0.2,
      }, summarySchema)).then((summaries) => summarySchema.parse(summaries));
  const factsPromise = previous?.diagnostics.components.facts === "success"
    ? Promise.resolve({
        facts: previous.facts,
        missingCategories: previous.diagnostics.missingCategories,
      })
    : (input.componentExtractors?.facts?.() ?? chatJsonWithWorkflowPolicy({
        workflow: "canon_facts",
        profile: input.profile,
        model: input.model,
        messages: factsMessages,
        assignmentMaxTokens: Number.MAX_SAFE_INTEGER,
        temperature: 0.1,
      }, factsCoverageResultSchema)).then((rawCoverage) => {
        const coverage = normalizeCoverageResult(rawCoverage);
        return {
          facts: normalizeFacts(
            input.chapterNo,
            coverage.categories.flatMap((entry) => entry.facts),
          ),
          missingCategories: coverage.missingCategories,
        };
      });
  const snapshotPromise = previous?.diagnostics.components.snapshot === "success"
    ? Promise.resolve(previous.snapshot)
    : (input.componentExtractors?.snapshot?.() ?? chatJsonWithWorkflowPolicy({
        workflow: "canon_snapshot",
        profile: input.profile,
        model: input.model,
        messages: snapshotMessages,
        assignmentMaxTokens: Number.MAX_SAFE_INTEGER,
        temperature: 0.2,
      }, snapshotSchema)).then((snapshot) => normalizeCharacterSnapshot(
        input.chapterNo,
        input.chapterContent,
        snapshotSchema.parse(snapshot),
      ));

  const [summariesResult, factsResult, snapshotResult] = await Promise.allSettled([
    summaryPromise,
    factsPromise,
    snapshotPromise,
  ]);
  const componentResults = {
    summaries: summariesResult,
    facts: factsResult,
    snapshot: snapshotResult,
  } as const;
  for (const [component, result] of Object.entries(componentResults)) {
    if (result.status === "rejected") {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[canon] ${component} degraded: ${reason}`);
    }
  }
  const components: Record<CanonComponentName, CanonComponentStatus> = {
    summaries: summariesResult.status === "fulfilled" ? "success" : "degraded",
    facts: factsResult.status === "fulfilled" ? "success" : "degraded",
    snapshot: snapshotResult.status === "fulfilled" ? "success" : "degraded",
  };
  const summaries = summariesResult.status === "fulfilled" ? summariesResult.value : fallback.summaries;
  const factsPayload = factsResult.status === "fulfilled"
    ? factsResult.value
    : { facts: fallback.facts, missingCategories: fallback.diagnostics.missingCategories };
  const snapshot = snapshotResult.status === "fulfilled" ? snapshotResult.value : fallback.snapshot;

  return {
    summaries,
    facts: factsPayload.facts,
    snapshot,
    diagnostics: buildCanonDiagnostics({
      usedFallback: Object.values(components).some((status) => status === "degraded"),
      components,
      facts: factsPayload.facts,
      snapshot,
      missingCategories: factsPayload.missingCategories,
    }),
  };
}

function containsAny(text: string, values: string[]) {
  return values.some((value) => value.trim() && text.includes(value.trim()));
}

function buildUnifiedConflict(type: string, severity: ConflictRecord["severity"], message: string) {
  return {
    id: nanoid(),
    type,
    severity,
    message,
  } satisfies ConflictRecord;
}

export function detectContextConflicts(input: {
  chapterNo: number;
  blueprint: ChapterBlueprint;
  facts: CanonFact[];
  foreshadows: Array<Record<string, unknown>>;
  segmentItem?: SegmentPlanItem | null;
}) {
  const conflicts: ConflictRecord[] = [];
  const blueprintText = [
    input.blueprint.sceneGoal,
    ...input.blueprint.conflicts,
    ...input.blueprint.foreshadows,
    ...input.blueprint.locations,
    ...input.blueprint.characters,
  ].join(" ");

  for (const character of input.blueprint.characters) {
    const deathFact = input.facts
      .filter((fact) => fact.type === "character_state")
      .find((fact) => {
        const factCharacter = String(fact.metadata.character ?? "");
        const factValue = String(fact.metadata.value ?? "");
        return factCharacter === character && /死亡|已死|确认死亡/u.test(factValue);
      });

    if (deathFact) {
      conflicts.push(buildUnifiedConflict(
        "character_state",
        "hard",
        `${character} 已在第 ${deathFact.chapterNo} 章死亡，但蓝图仍要求其正常出场`,
      ));
    }
  }

  const lostItemFacts = input.facts.filter((fact) =>
    fact.type === "item_acquired"
    && /毁|碎|失去|遗失|耗尽|消失/u.test(
      `${String(fact.metadata.status ?? "")}${String(fact.metadata.value ?? "")}${fact.content}`,
    ),
  );
  for (const fact of lostItemFacts) {
    const itemName = String(fact.metadata.item ?? fact.metadata.name ?? "").trim();
    const isUnique = Boolean(fact.metadata.unique ?? itemName);
    if (isUnique && itemName && blueprintText.includes(itemName)) {
      conflicts.push(buildUnifiedConflict(
        "item_conflict",
        "hard",
        `${itemName} 已在第 ${fact.chapterNo} 章失去或毁坏，但当前蓝图又把它当作仍可直接使用的要素`,
      ));
    }
  }

  const timeMarkers = input.facts
    .filter((fact) => fact.type === "timeline_marker")
    .map((fact) => Number(fact.metadata.order ?? fact.chapterNo))
    .filter((value) => Number.isFinite(value));
  const sorted = [...timeMarkers].sort((left, right) => left - right);
  if (timeMarkers.length > 1 && JSON.stringify(timeMarkers) !== JSON.stringify(sorted)) {
    conflicts.push(buildUnifiedConflict(
      "timeline_order",
      "hard",
      "检测到明确时间顺序倒流，请先修正蓝图或补出解释。",
    ));
  }

  const locationFacts = input.facts.filter((fact) => fact.type === "location_change");
  const locationMap = new Map<string, Set<string>>();
  for (const fact of locationFacts) {
    const character = String(fact.metadata.character ?? "");
    const location = String(fact.metadata.location ?? fact.metadata.to ?? "");
    if (!character || !location) {
      continue;
    }
    const bucket = locationMap.get(character) ?? new Set<string>();
    bucket.add(location);
    locationMap.set(character, bucket);
  }

  for (const [character, locations] of locationMap.entries()) {
    if (locations.size > 1) {
      conflicts.push(buildUnifiedConflict(
        "location_migration",
        "soft",
        `${character} 最近记录出现在多个地点：${[...locations].join("、")}`,
      ));
    }
  }

  if (input.segmentItem) {
    const mismatchReasons: string[] = [];
    if (
      input.blueprint.requiredProgressDelta
      && !input.segmentItem.requiredProgressDeltas.includes(input.blueprint.requiredProgressDelta)
    ) {
      mismatchReasons.push(`requiredProgressDelta 从 ${input.segmentItem.requiredProgressDeltas.join("、") || "未设定"} 偏到了 ${input.blueprint.requiredProgressDelta}`);
    }
    if (
      input.segmentItem.focusCharacters.length
      && !input.segmentItem.focusCharacters.some((name) => input.blueprint.characters.includes(name))
    ) {
      mismatchReasons.push("蓝图的聚焦角色已经偏离当前段落要求");
    }
    if (
      input.segmentItem.arenaHints.length
      && !containsAny(blueprintText, input.segmentItem.arenaHints)
    ) {
      mismatchReasons.push("蓝图没有承接当前段落的主场景提示");
    }
    if (mismatchReasons.length) {
      conflicts.push(buildUnifiedConflict(
        "segment_blueprint_mismatch",
        "soft",
        `SegmentPlan 与 Blueprint 不一致：${mismatchReasons.join("；")}`,
      ));
    }
  }

  for (const fact of input.facts) {
    if (fact.type !== "world_rule") {
      continue;
    }
    const broken = /打破|失效|越界|反噬/u.test(`${fact.content}${String(fact.metadata.status ?? "")}${String(fact.metadata.violation ?? "")}`);
    if (broken) {
      conflicts.push(buildUnifiedConflict(
        "world_rule_break",
        "soft",
        `规则层发生变化或被打破：${fact.content}`,
      ));
    }
  }

  for (const entry of input.foreshadows) {
    const chapter = Number(entry.chapterNo ?? 0);
    const status = String(entry.status ?? "active");
    if (status === "active" && chapter > 0 && input.chapterNo - chapter > 10) {
      conflicts.push(buildUnifiedConflict(
        "foreshadow_overdue",
        "soft",
        `伏笔“${String(entry.content ?? "未命名伏笔")}”已经超过 10 章未回收`,
      ));
    }
  }

  return conflicts;
}

export function buildForeshadowLedger(chapterNo: number, facts: CanonFact[]) {
  return facts
    .filter((fact) => fact.type === "foreshadow")
    .map((fact) => ({
      id: fact.id,
      chapterNo,
      content: fact.content,
      status: String(fact.metadata.status ?? "active"),
      timestamp: fact.timestamp,
    }));
}
