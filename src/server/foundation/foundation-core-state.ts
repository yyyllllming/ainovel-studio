import { createHash } from "node:crypto";

import { nanoid } from "nanoid";
import { z } from "zod";

import { normalizeEntityLookupKey, normalizeEntityLookupKeys } from "../character/lookup-normalization.ts";
import type {
  FoundationChangeSet,
  FoundationCoreEnvelope,
  FoundationDeltaV1,
  FoundationSyncResult,
  FoundationWorkshopDraft,
  RelationshipEdge,
  StyleExcerpt,
  SyncMeta,
} from "../types.ts";

const characterCardSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  goal: z.string().min(1),
  traits: z.array(z.string()).default([]),
  secrets: z.array(z.string()).optional(),
});

const worldRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

const relationshipEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1),
});

const styleExcerptSchema: z.ZodType<StyleExcerpt> = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceTitle: z.string().min(1),
  label: z.string().min(1),
  tags: z.array(z.enum(["narrative", "dialogue", "conflict", "emotion", "mechanism", "hook", "silence", "pressure"])).default([]),
  content: z.string().min(1),
  wordCount: z.number().int().nonnegative(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  positionRatio: z.number(),
  dialogueRatio: z.number(),
});

export const foundationWorkshopDraftSchema = z.object({
  premise: z.string().default(""),
  mainline: z.string().default(""),
  storyHook: z.string().default(""),
  desiredTone: z.string().default(""),
  characterIdeas: z.array(characterCardSchema).default([]),
  worldviewIdeas: z.array(worldRuleSchema).default([]),
  relationshipIdeas: z.array(relationshipEdgeSchema).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  styleReferences: z
    .array(
      z.object({
        kind: z.enum(["book", "author"]),
        label: z.string().min(1),
        author: z.string().optional(),
        source: z.enum(["network", "ai_fallback"]),
        relation: z.enum(["primary", "secondary"]),
      }),
    )
    .default([]),
  styleSamples: z.array(z.string()).default([]),
  styleManualGuidance: z.string().default(""),
  styleAvoidances: z.string().default(""),
  styleSteeringCard: z.string().default(""),
  styleProfile: z.custom<FoundationWorkshopDraft["styleProfile"]>((value) => value === undefined || (typeof value === "object" && value !== null)).optional(),
  styleDigest: z.string().default(""),
  styleExemplars: z.array(styleExcerptSchema).default([]),
  styleSnapshotId: z.string().nullable().optional().default(null),
  styleSnapshotVersion: z.number().nullable().optional().default(null),
});

const syncMetaSchema = z.object({
  version: z.number().int().positive().default(1),
  revisionId: z.string().min(1),
  revision: z.number().int().nonnegative().default(0),
  latestIntentDigest: z.string().default(""),
  coreFactsHash: z.string().default(""),
  conflictLog: z.array(
    z.object({
      field: z.string().min(1),
      oldValue: z.unknown(),
      newIntent: z.unknown(),
      resolution: z.enum(["overridden", "removed", "retained"]),
      resolvedAt: z.string().min(1),
    }),
  ).default([]),
  lockedFields: z.array(z.string()).default([]),
  lastAppliedAt: z.string().default(""),
  lastAppliedChangeSet: z.custom<FoundationChangeSet>((value) => value === undefined || value === null || (typeof value === "object" && value !== null)).nullable().optional().default(null),
  syncStatus: z.object({
    status: z.enum(["applied", "skipped", "failed"]).default("skipped"),
    mode: z.enum(["delta", "deterministic"]).default("delta"),
    reason: z.string().nullable().optional().default(null),
    coreFactsHashBefore: z.string().optional().default(""),
    coreFactsHashAfter: z.string().optional().default(""),
  }).default({
    status: "skipped",
    mode: "delta",
    reason: null,
    coreFactsHashBefore: "",
    coreFactsHashAfter: "",
  }),
});

const foundationCoreEnvelopeSchema = z.object({
  draft: foundationWorkshopDraftSchema,
  syncMeta: syncMetaSchema,
});

const characterOpSchema = z.object({
  op: z.enum(["upsert", "remove", "retain"]),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  payload: characterCardSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.op === "upsert" && !value.payload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "character upsert requires payload",
    });
  }
});

const worldviewOpSchema = z.object({
  op: z.enum(["upsert", "remove", "retain"]),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  payload: worldRuleSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.op === "upsert" && !value.payload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "worldview upsert requires payload",
    });
  }
});

const relationshipOpSchema = z.object({
  op: z.enum(["upsert", "remove", "retain"]),
  key: z.string().min(1),
  payload: relationshipEdgeSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.op === "upsert" && !value.payload) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "relationship upsert requires payload",
    });
  }
});

const questionOpSchema = z.object({
  op: z.enum(["upsert", "remove", "retain"]),
  value: z.string().min(1),
});

export const foundationDeltaV1Schema = z.object({
  schemaVersion: z.literal("foundation-delta.v1"),
  latestIntent: z.string().min(1),
  summaryPatch: z.object({
    premise: z.string().optional(),
    mainline: z.string().optional(),
    storyHook: z.string().optional(),
    desiredTone: z.string().optional(),
  }).default({}),
  characterOps: z.array(characterOpSchema).default([]),
  worldviewOps: z.array(worldviewOpSchema).default([]),
  relationshipOps: z.array(relationshipOpSchema).default([]),
  questionOps: z.array(questionOpSchema).default([]),
  conflictsWithPrevious: z.array(z.string()).default([]),
  lockedFields: z.array(z.string()).default([]),
  readyToGenerate: z.boolean().default(false),
  nextFocus: z.string().default("继续补充人物动机和世界规则。"),
}).strict();

function buildEmptyDraft(): FoundationWorkshopDraft {
  return foundationWorkshopDraftSchema.parse({});
}

function trimText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function truncateText(value: string | null | undefined, maxLength: number) {
  const trimmed = trimText(value);
  if (!trimmed || trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function truncateOptionalText(value: string | undefined, maxLength: number) {
  return value === undefined ? undefined : truncateText(value, maxLength);
}

function hashIntentDigest(value: string) {
  return createHash("sha1").update(trimText(value)).digest("hex");
}

export function buildFoundationCoreFactsHash(draft: FoundationWorkshopDraft) {
  return createHash("sha1").update(JSON.stringify({
    premise: trimText(draft.premise),
    mainline: trimText(draft.mainline),
    storyHook: trimText(draft.storyHook),
    characterGoals: draft.characterIdeas
      .map((item) => ({
        name: trimText(item.name),
        goal: trimText(item.goal),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
    worldview: draft.worldviewIdeas
      .map((item) => ({
        name: trimText(item.name),
        description: trimText(item.description),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN")),
  })).digest("hex");
}

function computeRevisionId(parts: unknown[]) {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

function normalizeQuestionKey(value: string) {
  return normalizeEntityLookupKey(value);
}

export function normalizeRelationshipLookupKey(value: string | RelationshipEdge) {
  if (typeof value !== "string") {
    return [
      normalizeEntityLookupKey(value.source),
      normalizeEntityLookupKey(value.label),
      normalizeEntityLookupKey(value.target),
    ].join("|");
  }

  const [source = "", label = "", target = ""] = value.split("|");
  return [
    normalizeEntityLookupKey(source),
    normalizeEntityLookupKey(label),
    normalizeEntityLookupKey(target),
  ].join("|");
}

function createSyncMeta(input: Partial<SyncMeta> = {}, revisionIdFactory: () => string = nanoid): SyncMeta {
  const fallbackDraft = foundationWorkshopDraftSchema.parse({});
  return syncMetaSchema.parse({
    version: 1,
    revisionId: input.revisionId || revisionIdFactory(),
    revision: input.revision ?? 0,
    latestIntentDigest: input.latestIntentDigest ?? "",
    coreFactsHash: input.coreFactsHash ?? buildFoundationCoreFactsHash(fallbackDraft),
    conflictLog: input.conflictLog ?? [],
    lockedFields: input.lockedFields ?? [],
    lastAppliedAt: input.lastAppliedAt ?? "",
    lastAppliedChangeSet: input.lastAppliedChangeSet ?? null,
    syncStatus: input.syncStatus ?? {
      status: "skipped",
      mode: "delta",
      reason: null,
      coreFactsHashBefore: input.coreFactsHash ?? buildFoundationCoreFactsHash(fallbackDraft),
      coreFactsHashAfter: input.coreFactsHash ?? buildFoundationCoreFactsHash(fallbackDraft),
    } satisfies FoundationSyncResult,
  });
}

export function createFoundationCoreEnvelope(
  draft: FoundationWorkshopDraft,
  input: Partial<SyncMeta> & { revisionIdFactory?: () => string } = {},
): FoundationCoreEnvelope {
  const parsedDraft = foundationWorkshopDraftSchema.parse(draft);
  const coreFactsHash = input.coreFactsHash ?? buildFoundationCoreFactsHash(parsedDraft);
  return foundationCoreEnvelopeSchema.parse({
    draft: parsedDraft,
    syncMeta: createSyncMeta({
      ...input,
      coreFactsHash,
      syncStatus: input.syncStatus ?? {
        status: "skipped",
        mode: "delta",
        reason: null,
        coreFactsHashBefore: coreFactsHash,
        coreFactsHashAfter: coreFactsHash,
      },
    }, input.revisionIdFactory),
  });
}

function salvageFoundationWorkshopDraft(
  fallbackDraft: FoundationWorkshopDraft,
  rawDraft: unknown,
): FoundationWorkshopDraft {
  const overrides = rawDraft && typeof rawDraft === "object"
    ? rawDraft as Record<string, unknown>
    : {};
  const direct = foundationWorkshopDraftSchema.safeParse({ ...fallbackDraft, ...overrides });
  if (direct.success) {
    return direct.data;
  }

  // 逐字段挽救：只丢弃确实损坏的字段/数组元素，避免一行坏 draft_json 抹掉整份草稿。
  const salvaged: Record<string, unknown> = { ...fallbackDraft };
  for (const key of Object.keys(foundationWorkshopDraftSchema.shape)) {
    if (!(key in overrides)) {
      continue;
    }
    const value = overrides[key];
    if (Array.isArray(value)) {
      const keptItems = value.filter((item) =>
        foundationWorkshopDraftSchema.safeParse({ ...salvaged, [key]: [item] }).success,
      );
      if (foundationWorkshopDraftSchema.safeParse({ ...salvaged, [key]: keptItems }).success) {
        salvaged[key] = keptItems;
      }
      continue;
    }
    if (foundationWorkshopDraftSchema.safeParse({ ...salvaged, [key]: value }).success) {
      salvaged[key] = value;
    }
  }

  return foundationWorkshopDraftSchema.parse(salvaged);
}

export function parseFoundationCoreEnvelope(
  rawDraftJson: string | null | undefined,
  input: {
    fallbackDraft?: FoundationWorkshopDraft;
    revisionIdFactory?: () => string;
  } = {},
) {
  const fallbackDraft = input.fallbackDraft ?? buildEmptyDraft();
  const parsed = (() => {
    try {
      return JSON.parse(rawDraftJson ?? "");
    } catch {
      return fallbackDraft;
    }
  })();

  if (
    parsed
    && typeof parsed === "object"
    && "draft" in parsed
    && "syncMeta" in parsed
  ) {
    const directEnvelope = foundationCoreEnvelopeSchema.safeParse(parsed);
    if (directEnvelope.success) {
      return {
        envelope: directEnvelope.data,
        wasLegacyBareDraft: false,
        wasCorrupted: false,
      };
    }

    // 读路径不抛：envelope 形状损坏时降级为挽救后的草稿 + 全新 syncMeta，避免快照/工坊接口反复 500。
    console.warn(
      "[foundation-core-state] envelope schema invalid, salvaging draft fields:",
      truncateText(directEnvelope.error.message, 500),
    );
    return {
      envelope: createFoundationCoreEnvelope(
        salvageFoundationWorkshopDraft(fallbackDraft, (parsed as { draft?: unknown }).draft),
        {
          revisionIdFactory: input.revisionIdFactory,
        },
      ),
      wasLegacyBareDraft: false,
      wasCorrupted: true,
    };
  }

  const legacyDraft = foundationWorkshopDraftSchema.safeParse({
    ...fallbackDraft,
    ...(parsed && typeof parsed === "object" ? parsed : {}),
  });
  if (legacyDraft.success) {
    return {
      envelope: createFoundationCoreEnvelope(legacyDraft.data, {
        revisionIdFactory: input.revisionIdFactory,
      }),
      wasLegacyBareDraft: true,
      wasCorrupted: false,
    };
  }

  console.warn(
    "[foundation-core-state] legacy draft schema invalid, salvaging draft fields:",
    truncateText(legacyDraft.error.message, 500),
  );
  return {
    envelope: createFoundationCoreEnvelope(
      salvageFoundationWorkshopDraft(fallbackDraft, parsed),
      {
        revisionIdFactory: input.revisionIdFactory,
      },
    ),
    wasLegacyBareDraft: true,
    wasCorrupted: true,
  };
}

const MAX_CONFLICT_LOG_ENTRIES = 100;
const MAX_CONFLICT_LOG_VALUE_LENGTH = 200;

function summarizeConflictValue(value: unknown) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return truncateText(value, MAX_CONFLICT_LOG_VALUE_LENGTH);
  }
  try {
    return truncateText(JSON.stringify(value), MAX_CONFLICT_LOG_VALUE_LENGTH);
  } catch {
    return truncateText(String(value), MAX_CONFLICT_LOG_VALUE_LENGTH);
  }
}

function appendConflictLog(input: {
  syncMeta: SyncMeta;
  field: string;
  oldValue: unknown;
  newIntent: unknown;
  resolution: "overridden" | "removed" | "retained";
  resolvedAt: string;
}) {
  // conflictLog 整体随 envelope 每回合读改写，必须保持有界：值存摘要、条数滚动窗口。
  input.syncMeta.conflictLog.push({
    field: input.field,
    oldValue: summarizeConflictValue(input.oldValue),
    newIntent: summarizeConflictValue(input.newIntent),
    resolution: input.resolution,
    resolvedAt: input.resolvedAt,
  });
  if (input.syncMeta.conflictLog.length > MAX_CONFLICT_LOG_ENTRIES) {
    input.syncMeta.conflictLog.splice(0, input.syncMeta.conflictLog.length - MAX_CONFLICT_LOG_ENTRIES);
  }
}

function isLocked(syncMeta: SyncMeta, field: string) {
  return syncMeta.lockedFields.includes(field);
}

function applySummaryPatch(
  draft: FoundationWorkshopDraft,
  syncMeta: SyncMeta,
  summaryPatch: FoundationDeltaV1["summaryPatch"],
  latestIntent: string,
  appliedAt: string,
) {
  for (const field of ["premise", "mainline", "storyHook", "desiredTone"] as const) {
    if (!(field in summaryPatch)) {
      continue;
    }

    const previous = draft[field];
    const nextValue = summaryPatch[field] ?? "";
    if (isLocked(syncMeta, field)) {
      appendConflictLog({
        syncMeta,
        field,
        oldValue: previous,
        newIntent: latestIntent,
        resolution: "retained",
        resolvedAt: appliedAt,
      });
      continue;
    }

    if (previous === nextValue) {
      continue;
    }

    draft[field] = nextValue;
    appendConflictLog({
      syncMeta,
      field,
      oldValue: previous,
      newIntent: nextValue,
      resolution: nextValue ? "overridden" : "removed",
      resolvedAt: appliedAt,
    });
  }
}

function resolveCharacterField(name: string) {
  return `character:${normalizeEntityLookupKey(name)}`;
}

function resolveWorldviewField(name: string) {
  return `worldview:${normalizeEntityLookupKey(name)}`;
}

function resolveRelationshipField(key: string | RelationshipEdge) {
  return `relationship:${normalizeRelationshipLookupKey(key)}`;
}

function resolveQuestionField(value: string) {
  return `question:${normalizeQuestionKey(value)}`;
}

function findIndexedMatch<T>(
  items: T[],
  targetKeys: string[],
  selector: (item: T) => string,
) {
  return items.findIndex((item) => targetKeys.includes(selector(item)));
}

function applyCharacterOps(
  draft: FoundationWorkshopDraft,
  syncMeta: SyncMeta,
  ops: FoundationDeltaV1["characterOps"],
  latestIntent: string,
  appliedAt: string,
) {
  for (const op of ops) {
    const payload = op.payload ? characterCardSchema.parse(op.payload) : undefined;
    const targetKeys = normalizeEntityLookupKeys([
      op.name,
      ...(op.aliases ?? []),
      payload?.name ?? "",
    ]);
    const existingIndex = findIndexedMatch(draft.characterIdeas, targetKeys, (item) => normalizeEntityLookupKey(item.name));
    const existing = existingIndex >= 0 ? draft.characterIdeas[existingIndex] : null;
    const field = resolveCharacterField(payload?.name ?? op.name);

    if (isLocked(syncMeta, field) && op.op !== "retain") {
      appendConflictLog({
        syncMeta,
        field,
        oldValue: existing,
        newIntent: latestIntent,
        resolution: "retained",
        resolvedAt: appliedAt,
      });
      continue;
    }

    if (op.op === "remove") {
      if (existingIndex >= 0) {
        draft.characterIdeas.splice(existingIndex, 1);
        appendConflictLog({
          syncMeta,
          field,
          oldValue: existing,
          newIntent: latestIntent,
          resolution: "removed",
          resolvedAt: appliedAt,
        });
      }
      continue;
    }

    if (op.op === "retain" || !payload) {
      continue;
    }

    if (existingIndex >= 0) {
      if (JSON.stringify(existing) !== JSON.stringify(payload)) {
        draft.characterIdeas.splice(existingIndex, 1, payload);
        appendConflictLog({
          syncMeta,
          field,
          oldValue: existing,
          newIntent: payload,
          resolution: "overridden",
          resolvedAt: appliedAt,
        });
      }
      continue;
    }

    draft.characterIdeas.push(payload);
  }
}

function applyWorldviewOps(
  draft: FoundationWorkshopDraft,
  syncMeta: SyncMeta,
  ops: FoundationDeltaV1["worldviewOps"],
  latestIntent: string,
  appliedAt: string,
) {
  for (const op of ops) {
    const payload = op.payload ? worldRuleSchema.parse(op.payload) : undefined;
    const targetKeys = normalizeEntityLookupKeys([
      op.name,
      ...(op.aliases ?? []),
      payload?.name ?? "",
    ]);
    const existingIndex = findIndexedMatch(draft.worldviewIdeas, targetKeys, (item) => normalizeEntityLookupKey(item.name));
    const existing = existingIndex >= 0 ? draft.worldviewIdeas[existingIndex] : null;
    const field = resolveWorldviewField(payload?.name ?? op.name);

    if (isLocked(syncMeta, field) && op.op !== "retain") {
      appendConflictLog({
        syncMeta,
        field,
        oldValue: existing,
        newIntent: latestIntent,
        resolution: "retained",
        resolvedAt: appliedAt,
      });
      continue;
    }

    if (op.op === "remove") {
      if (existingIndex >= 0) {
        draft.worldviewIdeas.splice(existingIndex, 1);
        appendConflictLog({
          syncMeta,
          field,
          oldValue: existing,
          newIntent: latestIntent,
          resolution: "removed",
          resolvedAt: appliedAt,
        });
      }
      continue;
    }

    if (op.op === "retain" || !payload) {
      continue;
    }

    if (existingIndex >= 0) {
      if (JSON.stringify(existing) !== JSON.stringify(payload)) {
        draft.worldviewIdeas.splice(existingIndex, 1, payload);
        appendConflictLog({
          syncMeta,
          field,
          oldValue: existing,
          newIntent: payload,
          resolution: "overridden",
          resolvedAt: appliedAt,
        });
      }
      continue;
    }

    draft.worldviewIdeas.push(payload);
  }
}

function applyRelationshipOps(
  draft: FoundationWorkshopDraft,
  syncMeta: SyncMeta,
  ops: FoundationDeltaV1["relationshipOps"],
  latestIntent: string,
  appliedAt: string,
) {
  for (const op of ops) {
    const payload = op.payload ? relationshipEdgeSchema.parse(op.payload) : undefined;
    const targetKey = normalizeRelationshipLookupKey(payload ?? op.key);
    const existingIndex = draft.relationshipIdeas.findIndex(
      (item) => normalizeRelationshipLookupKey(item) === targetKey,
    );
    const existing = existingIndex >= 0 ? draft.relationshipIdeas[existingIndex] : null;
    const field = resolveRelationshipField(payload ?? op.key);

    if (isLocked(syncMeta, field) && op.op !== "retain") {
      appendConflictLog({
        syncMeta,
        field,
        oldValue: existing,
        newIntent: latestIntent,
        resolution: "retained",
        resolvedAt: appliedAt,
      });
      continue;
    }

    if (op.op === "remove") {
      if (existingIndex >= 0) {
        draft.relationshipIdeas.splice(existingIndex, 1);
        appendConflictLog({
          syncMeta,
          field,
          oldValue: existing,
          newIntent: latestIntent,
          resolution: "removed",
          resolvedAt: appliedAt,
        });
      }
      continue;
    }

    if (op.op === "retain" || !payload) {
      continue;
    }

    if (existingIndex >= 0) {
      if (JSON.stringify(existing) !== JSON.stringify(payload)) {
        draft.relationshipIdeas.splice(existingIndex, 1, payload);
        appendConflictLog({
          syncMeta,
          field,
          oldValue: existing,
          newIntent: payload,
          resolution: "overridden",
          resolvedAt: appliedAt,
        });
      }
      continue;
    }

    draft.relationshipIdeas.push(payload);
  }
}

function applyQuestionOps(
  draft: FoundationWorkshopDraft,
  syncMeta: SyncMeta,
  ops: FoundationDeltaV1["questionOps"],
  latestIntent: string,
  appliedAt: string,
) {
  for (const op of ops) {
    const targetKey = normalizeQuestionKey(op.value);
    const existingIndex = draft.unresolvedQuestions.findIndex((item) => normalizeQuestionKey(item) === targetKey);
    const existing = existingIndex >= 0 ? draft.unresolvedQuestions[existingIndex] : null;
    const field = resolveQuestionField(op.value);

    if (isLocked(syncMeta, field) && op.op !== "retain") {
      appendConflictLog({
        syncMeta,
        field,
        oldValue: existing,
        newIntent: latestIntent,
        resolution: "retained",
        resolvedAt: appliedAt,
      });
      continue;
    }

    if (op.op === "remove") {
      if (existingIndex >= 0) {
        draft.unresolvedQuestions.splice(existingIndex, 1);
        appendConflictLog({
          syncMeta,
          field,
          oldValue: existing,
          newIntent: latestIntent,
          resolution: "removed",
          resolvedAt: appliedAt,
        });
      }
      continue;
    }

    if (op.op === "retain") {
      continue;
    }

    if (existingIndex < 0) {
      draft.unresolvedQuestions.push(op.value.trim());
    }
  }
}

export function applyFoundationDelta(
  envelope: FoundationCoreEnvelope,
  delta: FoundationDeltaV1,
  input: {
    revisionIdFactory?: () => string;
    appliedAt?: string;
  } = {},
) {
  const parsedDelta = foundationDeltaV1Schema.parse(delta);
  const appliedAt = input.appliedAt ?? new Date().toISOString();
  const nextDraft = foundationWorkshopDraftSchema.parse(envelope.draft);
  const previousMeta = syncMetaSchema.parse(envelope.syncMeta);
  const coreFactsHashBefore = previousMeta.coreFactsHash || buildFoundationCoreFactsHash(nextDraft);
  const latestIntentDigest = hashIntentDigest(parsedDelta.latestIntent);
  const nextMeta = createSyncMeta(
    {
      ...previousMeta,
      revisionId: previousMeta.revisionId,
      revision: previousMeta.revision,
      latestIntentDigest,
      coreFactsHash: coreFactsHashBefore,
      conflictLog: previousMeta.conflictLog.slice(-MAX_CONFLICT_LOG_ENTRIES),
      lockedFields: [...previousMeta.lockedFields],
      lastAppliedAt: appliedAt,
    },
    input.revisionIdFactory,
  );

  applySummaryPatch(nextDraft, nextMeta, parsedDelta.summaryPatch, parsedDelta.latestIntent, appliedAt);
  applyCharacterOps(nextDraft, nextMeta, parsedDelta.characterOps, parsedDelta.latestIntent, appliedAt);
  applyWorldviewOps(nextDraft, nextMeta, parsedDelta.worldviewOps, parsedDelta.latestIntent, appliedAt);
  applyRelationshipOps(nextDraft, nextMeta, parsedDelta.relationshipOps, parsedDelta.latestIntent, appliedAt);
  applyQuestionOps(nextDraft, nextMeta, parsedDelta.questionOps, parsedDelta.latestIntent, appliedAt);

  // 不采纳 LLM delta 输出的 lockedFields：提示词从未定义锁语义，一次幻觉锁字段会永久
  // 冻结该字段且没有任何解锁入口；锁仅允许由服务端显式写入 syncMeta.lockedFields。
  const coreFactsHashAfter = buildFoundationCoreFactsHash(nextDraft);
  nextMeta.revisionId = computeRevisionId([
    previousMeta.revisionId,
    latestIntentDigest,
    nextDraft,
    nextMeta.lockedFields,
  ]);
  nextMeta.revision = previousMeta.revision + 1;
  nextMeta.coreFactsHash = coreFactsHashAfter;
  nextMeta.lastAppliedChangeSet = {
    coreOverwrite: {
      premise: truncateOptionalText(parsedDelta.summaryPatch.premise, MAX_CONFLICT_LOG_VALUE_LENGTH),
      mainline: truncateOptionalText(parsedDelta.summaryPatch.mainline, MAX_CONFLICT_LOG_VALUE_LENGTH),
      storyHook: truncateOptionalText(parsedDelta.summaryPatch.storyHook, MAX_CONFLICT_LOG_VALUE_LENGTH),
      desiredTone: truncateOptionalText(parsedDelta.summaryPatch.desiredTone, MAX_CONFLICT_LOG_VALUE_LENGTH),
    },
    worldviewUpserts: parsedDelta.worldviewOps
      .filter((op) => op.op === "upsert" && op.payload)
      .map((op) => ({
        name: op.payload!.name,
        description: truncateText(op.payload!.description, MAX_CONFLICT_LOG_VALUE_LENGTH),
      })),
    worldviewDeprecations: parsedDelta.worldviewOps
      .filter((op) => op.op === "remove")
      .map((op) => op.name),
    characterGoalOverrides: parsedDelta.characterOps
      .filter((op) => op.op === "upsert" && op.payload?.goal)
      .map((op) => ({
        name: op.payload!.name,
        goal: truncateText(op.payload!.goal, MAX_CONFLICT_LOG_VALUE_LENGTH),
      })),
    notesOnly: Boolean(
      !Object.keys(parsedDelta.summaryPatch).length
      && !parsedDelta.characterOps.length
      && !parsedDelta.worldviewOps.length
      && !parsedDelta.relationshipOps.length
      && !parsedDelta.questionOps.length,
    ),
  };
  nextMeta.syncStatus = {
    status: "applied",
    mode: "delta",
    reason: null,
    coreFactsHashBefore,
    coreFactsHashAfter,
  };

  return {
    mode: "delta" as const,
    envelope: foundationCoreEnvelopeSchema.parse({
      draft: nextDraft,
      syncMeta: nextMeta,
    }),
    readyToGenerate: parsedDelta.readyToGenerate,
    nextFocus: parsedDelta.nextFocus,
  };
}

export async function syncFoundationDraftWithFallback(input: {
  envelope: FoundationCoreEnvelope;
  runDeltaSync: () => Promise<FoundationDeltaV1>;
  revisionIdFactory?: () => string;
  appliedAt?: string;
}) {
  let deltaFailures = 0;
  let lastDeltaError: unknown = null;

  while (deltaFailures < 2) {
    try {
      return applyFoundationDelta(
        input.envelope,
        await input.runDeltaSync(),
        {
          revisionIdFactory: input.revisionIdFactory,
          appliedAt: input.appliedAt,
        },
      );
    } catch (error) {
      deltaFailures += 1;
      lastDeltaError = error;
    }
  }

  return {
    mode: "skipped" as const,
    envelope: foundationCoreEnvelopeSchema.parse({
      draft: input.envelope.draft,
      syncMeta: {
        ...input.envelope.syncMeta,
        syncStatus: {
          status: "failed",
          mode: "delta",
          reason: lastDeltaError instanceof Error
            ? lastDeltaError.message
            : "delta sync failed",
          coreFactsHashBefore: input.envelope.syncMeta.coreFactsHash ?? buildFoundationCoreFactsHash(input.envelope.draft),
          coreFactsHashAfter: input.envelope.syncMeta.coreFactsHash ?? buildFoundationCoreFactsHash(input.envelope.draft),
        },
        lastAppliedAt: input.appliedAt ?? new Date().toISOString(),
      },
    }),
    readyToGenerate: false,
    nextFocus: "继续补充人物动机和世界规则。",
  };
}

/**
 * 并发回合的确定性 rebase：当本回合基于的 envelope 在 LLM 处理期间被其他写入方
 * （Runner 自动补强、style steering 等）推进时，把本回合的结果叠到最新状态上。
 * 策略：本回合代表最新用户意图，冲突字段以本回合为准；其他写入方新增的实体条目
 * 按归一化 key 取并集保留；本回合未填的 style 字段继承最新值（style steering 写入方）。
 */
export function rebaseFoundationEnvelope(
  latest: FoundationCoreEnvelope,
  turn: FoundationCoreEnvelope,
  input: { revisionIdFactory?: () => string; rebasedAt?: string } = {},
): FoundationCoreEnvelope {
  const latestDraft = foundationWorkshopDraftSchema.parse(latest.draft);
  const turnDraft = foundationWorkshopDraftSchema.parse(turn.draft);

  const unionByKey = <T>(primary: T[], secondary: T[], keyOf: (item: T) => string): T[] => {
    const seen = new Set(primary.map(keyOf).filter(Boolean));
    const merged = [...primary];
    for (const item of secondary) {
      const key = keyOf(item);
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  };

  const mergedDraft = foundationWorkshopDraftSchema.parse({
    ...latestDraft,
    ...turnDraft,
    characterIdeas: unionByKey(turnDraft.characterIdeas, latestDraft.characterIdeas, (item) => normalizeEntityLookupKey(item.name)),
    worldviewIdeas: unionByKey(turnDraft.worldviewIdeas, latestDraft.worldviewIdeas, (item) => normalizeEntityLookupKey(item.name)),
    relationshipIdeas: unionByKey(turnDraft.relationshipIdeas, latestDraft.relationshipIdeas, (item) => normalizeRelationshipLookupKey(item)),
    unresolvedQuestions: unionByKey(turnDraft.unresolvedQuestions, latestDraft.unresolvedQuestions, (item) => normalizeEntityLookupKey(item)),
    styleManualGuidance: turnDraft.styleManualGuidance || latestDraft.styleManualGuidance,
    styleAvoidances: turnDraft.styleAvoidances || latestDraft.styleAvoidances,
    styleSteeringCard: turnDraft.styleSteeringCard || latestDraft.styleSteeringCard,
    styleDigest: turnDraft.styleDigest || latestDraft.styleDigest,
    styleSamples: turnDraft.styleSamples.length ? turnDraft.styleSamples : latestDraft.styleSamples,
    styleReferences: turnDraft.styleReferences.length ? turnDraft.styleReferences : latestDraft.styleReferences,
    styleExemplars: turnDraft.styleExemplars.length ? turnDraft.styleExemplars : latestDraft.styleExemplars,
    styleProfile: turnDraft.styleProfile ?? latestDraft.styleProfile,
    styleSnapshotId: turnDraft.styleSnapshotId ?? latestDraft.styleSnapshotId,
    styleSnapshotVersion: turnDraft.styleSnapshotVersion ?? latestDraft.styleSnapshotVersion,
  });

  const rebasedAt = input.rebasedAt ?? new Date().toISOString();
  const revisionIdFactory = input.revisionIdFactory ?? nanoid;
  const turnMeta = syncMetaSchema.parse(turn.syncMeta);
  const latestMeta = syncMetaSchema.parse(latest.syncMeta);
  return foundationCoreEnvelopeSchema.parse({
    draft: mergedDraft,
    syncMeta: {
      ...turnMeta,
      revisionId: revisionIdFactory(),
      revision: Math.max(latestMeta.revision, turnMeta.revision) + 1,
      coreFactsHash: buildFoundationCoreFactsHash(mergedDraft),
      lockedFields: Array.from(new Set([...latestMeta.lockedFields, ...turnMeta.lockedFields])),
      lastAppliedAt: rebasedAt,
    },
  });
}

export function buildFoundationStateSummaryDigest(draft: FoundationWorkshopDraft) {
  const summaryLines = [
    `Premise: ${truncateText(draft.premise, 280) || "未定"}`,
    `Mainline: ${truncateText(draft.mainline, 320) || "未定"}`,
    `Story Hook: ${truncateText(draft.storyHook, 320) || "未定"}`,
    `Desired Tone: ${truncateText(draft.desiredTone, 120) || "未定"}`,
  ];
  const characterLines = draft.characterIdeas.length
    ? draft.characterIdeas.map((item) =>
      `- ${truncateText(item.name, 30) || "未命名"} | ${truncateText(item.role, 30) || "未定角色"} | ${truncateText(item.goal, 80) || "未定目标"}`
    )
    : ["- 无"];
  const worldviewLines = draft.worldviewIdeas.length
    ? draft.worldviewIdeas.map((item) =>
      `- ${truncateText(item.name, 30) || "未命名"}: ${truncateText(item.description, 80) || "未描述"}`
    )
    : ["- 无"];
  const questionLines = draft.unresolvedQuestions.length
    ? draft.unresolvedQuestions.map((item) => `- ${truncateText(item, 120)}`)
    : ["- 无"];

  const output = [
    ...summaryLines,
    "Characters:",
    ...characterLines,
    "Worldview:",
    ...worldviewLines,
    "Unresolved Questions:",
    ...questionLines,
    `Style Summary: ${
      truncateText(
        draft.styleDigest
        || draft.styleSteeringCard
        || [draft.styleManualGuidance, draft.styleAvoidances].filter(Boolean).join("；")
        || draft.desiredTone,
        300,
      ) || "未定"
    }`,
  ].join("\n");
  if (output.length <= 3500) {
    return output;
  }

  // 压缩态按段落分别截断，保留各段标题，避免世界观/未决问题被错标进 Characters 或整段丢失。
  const compactOutput = [
    ...summaryLines,
    "Characters:",
    ...characterLines.slice(0, 6).map((line) => truncateText(line, 60)),
    "Worldview:",
    ...worldviewLines.slice(0, 6).map((line) => truncateText(line, 60)),
    "Unresolved Questions:",
    ...questionLines.slice(0, 3).map((line) => truncateText(line, 60)),
    `Style Summary: ${
      truncateText(
        draft.styleDigest
        || draft.styleSteeringCard
        || draft.desiredTone,
        220,
      ) || "未定"
    }`,
  ].join("\n");

  return truncateText(compactOutput, 3500);
}
