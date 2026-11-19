import test from "node:test";
import assert from "node:assert/strict";

import type { FoundationWorkshopDraft } from "./types.ts";
import {
  applyFoundationDelta,
  buildFoundationStateSummaryDigest,
  createFoundationCoreEnvelope,
  foundationDeltaV1Schema,
  parseFoundationCoreEnvelope,
  syncFoundationDraftWithFallback,
} from "./foundation/foundation-core-state.ts";

function createDraft(overrides: Partial<FoundationWorkshopDraft> = {}): FoundationWorkshopDraft {
  return {
    premise: "",
    mainline: "",
    storyHook: "",
    desiredTone: "default",
    characterIdeas: [],
    worldviewIdeas: [],
    relationshipIdeas: [],
    unresolvedQuestions: [],
    styleReferences: [],
    styleSamples: [],
    styleManualGuidance: "",
    styleAvoidances: "",
    styleSteeringCard: "",
    styleProfile: undefined,
    styleSnapshotId: null,
    styleSnapshotVersion: null,
    styleDigest: "",
    styleExemplars: [],
    ...overrides,
  };
}

test("parseFoundationCoreEnvelope auto-wraps a legacy bare draft with default sync metadata", () => {
  const legacyDraft = createDraft({
    premise: "这是一个山海经的故事。",
    characterIdeas: [
      {
        name: "陆渊",
        role: "protagonist",
        goal: "活下去",
        traits: ["谨慎"],
      },
    ],
  });

  const parsed = parseFoundationCoreEnvelope(JSON.stringify(legacyDraft), {
    revisionIdFactory: () => "revision-1",
  });

  assert.equal(parsed.wasLegacyBareDraft, true);
  assert.equal(parsed.envelope.draft.premise, "这是一个山海经的故事。");
  assert.equal(parsed.envelope.syncMeta.version, 1);
  assert.equal(parsed.envelope.syncMeta.revisionId, "revision-1");
  assert.equal(parsed.envelope.syncMeta.latestIntentDigest, "");
  assert.equal(parsed.envelope.syncMeta.revision, 0);
  assert.equal(parsed.envelope.syncMeta.coreFactsHash.length > 0, true);
  assert.equal(parsed.envelope.syncMeta.syncStatus.status, "skipped");
  assert.deepEqual(parsed.envelope.syncMeta.conflictLog, []);
  assert.deepEqual(parsed.envelope.syncMeta.lockedFields, []);
});

test("parseFoundationCoreEnvelope salvages a corrupted envelope instead of throwing", () => {
  const corrupted = {
    draft: {
      ...createDraft({ premise: "premise 还能救回来" }),
      characterIdeas: [
        { name: "陆渊", role: "protagonist", goal: "活下去", traits: [] },
        { name: "坏卡", role: "", goal: "", traits: [] },
      ],
    },
    syncMeta: { version: "not-a-number" },
  };

  const parsed = parseFoundationCoreEnvelope(JSON.stringify(corrupted), {
    revisionIdFactory: () => "revision-salvaged",
  });

  assert.equal(parsed.wasLegacyBareDraft, false);
  assert.equal(parsed.wasCorrupted, true);
  assert.equal(parsed.envelope.draft.premise, "premise 还能救回来");
  assert.deepEqual(
    parsed.envelope.draft.characterIdeas.map((item) => item.name),
    ["陆渊"],
  );
  assert.equal(parsed.envelope.syncMeta.revisionId, "revision-salvaged");
  assert.equal(parsed.envelope.syncMeta.syncStatus.status, "skipped");
});

test("parseFoundationCoreEnvelope salvages a legacy bare draft with invalid entries", () => {
  const legacy = {
    premise: "旧 premise",
    characterIdeas: [{ name: "无目标", role: "support" }],
    worldviewIdeas: [{ name: "完整规则", description: "这条规则是完整的。" }],
  };

  const parsed = parseFoundationCoreEnvelope(JSON.stringify(legacy), {
    revisionIdFactory: () => "revision-legacy-salvaged",
  });

  assert.equal(parsed.wasLegacyBareDraft, true);
  assert.equal(parsed.wasCorrupted, true);
  assert.equal(parsed.envelope.draft.premise, "旧 premise");
  assert.deepEqual(parsed.envelope.draft.characterIdeas, []);
  assert.deepEqual(parsed.envelope.draft.worldviewIdeas, [
    { name: "完整规则", description: "这条规则是完整的。" },
  ]);
});

test("foundationDeltaV1Schema rejects invalid ops, missing payloads, and free-text pollution", () => {
  assert.throws(() =>
    foundationDeltaV1Schema.parse({
      schemaVersion: "foundation-delta.v1",
      latestIntent: "同步一下",
      summaryPatch: {},
      characterOps: [{ op: "rewrite", name: "陆渊" }],
      worldviewOps: [],
      relationshipOps: [],
      questionOps: [],
      conflictsWithPrevious: [],
      lockedFields: [],
      readyToGenerate: false,
      nextFocus: "继续补充",
    })
  );

  assert.throws(() =>
    foundationDeltaV1Schema.parse({
      schemaVersion: "foundation-delta.v1",
      latestIntent: "同步一下",
      summaryPatch: {},
      characterOps: [{ op: "upsert", name: "陆渊" }],
      worldviewOps: [],
      relationshipOps: [],
      questionOps: [],
      conflictsWithPrevious: [],
      lockedFields: [],
      readyToGenerate: false,
      nextFocus: "继续补充",
      note: "这一段自由文本不该混进 schema",
    })
  );
});

test("applyFoundationDelta merges aliases through normalized keys and remains deterministic across replays", () => {
  const base = createFoundationCoreEnvelope(
    createDraft({
      premise: "旧 premise",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "旧目标",
          traits: ["谨慎"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "旧分支",
        },
      ],
      relationshipIdeas: [
        {
          source: "陆渊",
          label: "畏惧",
          target: "山神体系",
        },
      ],
      unresolvedQuestions: ["旧问题"],
    }),
    {
      revisionId: "revision-base",
      lastAppliedAt: "2026-04-06T00:00:00.000Z",
    },
  );

  const delta = foundationDeltaV1Schema.parse({
    schemaVersion: "foundation-delta.v1",
    latestIntent: "山只是有灵，核心还是山海经万灵，主角方向改成剥纹骨书还债问白泽。",
    summaryPatch: {
      premise: "山只是有灵，核心还是山海经万灵。",
      mainline: "陆渊背着骨书灵债去问白泽。",
      storyHook: "开篇他刚剥下一道骨纹，灵债立刻反噬。",
    },
    characterOps: [
      {
        op: "upsert",
        name: "陆 渊",
        aliases: ["陆渊。"],
        payload: {
          name: "陆渊",
          role: "protagonist",
          goal: "剥纹、还债、去问白泽",
          traits: ["谨慎", "会伪装"],
        },
      },
    ],
    worldviewOps: [
      {
        op: "remove",
        name: "山神体系",
        aliases: ["山神体系。"],
      },
      {
        op: "upsert",
        name: "山海经万灵",
        aliases: ["山 海经万灵"],
        payload: {
          name: "山海经万灵",
          description: "核心是万灵，不是祭祀山神体系。",
        },
      },
    ],
    relationshipOps: [
      {
        op: "remove",
        key: "陆 渊 | 畏惧 | 山神体系。",
      },
      {
        op: "upsert",
        key: "陆渊|背负|骨书灵债",
        payload: {
          source: "陆渊",
          label: "背负",
          target: "骨书灵债",
        },
      },
    ],
    questionOps: [
      { op: "remove", value: "旧问题" },
      { op: "upsert", value: "白泽会如何安抚骨书里的灵？" },
    ],
    conflictsWithPrevious: ["山神体系不再是主要体系"],
    lockedFields: [],
    readyToGenerate: false,
    nextFocus: "继续细化骨书与灵债规则。",
  });

  const expected = JSON.stringify(
    applyFoundationDelta(base, delta, {
      revisionIdFactory: () => "revision-2",
      appliedAt: "2026-04-06T08:34:24.173Z",
    }),
  );

  for (let index = 0; index < 10; index += 1) {
    const replayed = applyFoundationDelta(base, delta, {
      revisionIdFactory: () => `revision-${index + 2}`,
      appliedAt: "2026-04-06T08:34:24.173Z",
    });

    assert.equal(replayed.envelope.draft.characterIdeas.length, 1);
    assert.deepEqual(replayed.envelope.draft.characterIdeas[0], {
      name: "陆渊",
      role: "protagonist",
      goal: "剥纹、还债、去问白泽",
      traits: ["谨慎", "会伪装"],
    });
    assert.deepEqual(
      replayed.envelope.draft.worldviewIdeas.map((item) => item.name),
      ["山海经万灵"],
    );
    assert.deepEqual(
      replayed.envelope.draft.relationshipIdeas,
      [{ source: "陆渊", label: "背负", target: "骨书灵债" }],
    );
    assert.deepEqual(replayed.envelope.draft.unresolvedQuestions, ["白泽会如何安抚骨书里的灵？"]);
    assert.equal(JSON.stringify(replayed), expected);
  }
});

test("applyFoundationDelta keeps conflictLog bounded and summarizes oversized payloads", () => {
  const longPremise = "新 premise 内容".repeat(60);
  const base = createFoundationCoreEnvelope(
    createDraft({ premise: "旧 premise" }),
    {
      revisionId: "revision-base",
      conflictLog: Array.from({ length: 150 }, (_, index) => ({
        field: `field-${index}`,
        oldValue: "旧值".repeat(150),
        newIntent: "新意图".repeat(150),
        resolution: "overridden" as const,
        resolvedAt: "2026-04-06T00:00:00.000Z",
      })),
    },
  );

  const result = applyFoundationDelta(
    base,
    foundationDeltaV1Schema.parse({
      schemaVersion: "foundation-delta.v1",
      latestIntent: "改写 premise",
      summaryPatch: { premise: longPremise },
      characterOps: [],
      worldviewOps: [],
      relationshipOps: [],
      questionOps: [],
      conflictsWithPrevious: [],
      lockedFields: [],
      readyToGenerate: false,
      nextFocus: "继续",
    }),
    {
      revisionIdFactory: () => "revision-next",
      appliedAt: "2026-04-06T08:34:24.173Z",
    },
  );

  assert.equal(result.envelope.syncMeta.conflictLog.length <= 100, true);
  const lastEntry = result.envelope.syncMeta.conflictLog.at(-1)!;
  assert.equal(lastEntry.field, "premise");
  assert.equal(typeof lastEntry.newIntent, "string");
  assert.equal((lastEntry.newIntent as string).length <= 200, true);
  // 草稿本体不截断，只有日志/变更记录存摘要。
  assert.equal(result.envelope.draft.premise, longPremise);
  assert.equal(
    (result.envelope.syncMeta.lastAppliedChangeSet?.coreOverwrite?.premise ?? "").length <= 200,
    true,
  );
});

test("applyFoundationDelta ignores LLM-provided lockedFields so fields never freeze permanently", () => {
  const base = createFoundationCoreEnvelope(
    createDraft({ premise: "初始 premise" }),
    { revisionId: "revision-base" },
  );
  const buildDelta = (premise: string, lockedFields: string[]) =>
    foundationDeltaV1Schema.parse({
      schemaVersion: "foundation-delta.v1",
      latestIntent: `改成 ${premise}`,
      summaryPatch: { premise },
      characterOps: [],
      worldviewOps: [],
      relationshipOps: [],
      questionOps: [],
      conflictsWithPrevious: [],
      lockedFields,
      readyToGenerate: false,
      nextFocus: "继续",
    });

  const lockAttempt = applyFoundationDelta(
    base,
    buildDelta("第一次修改", ["premise", "character:陆渊"]),
    { revisionIdFactory: () => "revision-1", appliedAt: "2026-04-06T08:00:00.000Z" },
  );

  assert.deepEqual(lockAttempt.envelope.syncMeta.lockedFields, []);
  assert.equal(lockAttempt.envelope.draft.premise, "第一次修改");

  const followUp = applyFoundationDelta(
    lockAttempt.envelope,
    buildDelta("第二次修改", []),
    { revisionIdFactory: () => "revision-2", appliedAt: "2026-04-06T09:00:00.000Z" },
  );

  assert.equal(followUp.envelope.draft.premise, "第二次修改");
});

test("buildFoundationStateSummaryDigest stays compact and deterministic", () => {
  const digest = buildFoundationStateSummaryDigest(
    createDraft({
      premise: "这是一个非常长的 premise ".repeat(20),
      mainline: "主线".repeat(120),
      storyHook: "钩子".repeat(120),
      desiredTone: "冷峻、洪荒、压迫",
      characterIdeas: Array.from({ length: 12 }, (_, index) => ({
        name: `角色${index + 1}`,
        role: "supporting",
        goal: "推动设定",
        traits: ["test"],
      })),
      worldviewIdeas: Array.from({ length: 8 }, (_, index) => ({
        name: `世界规则${index + 1}`,
        description: "世界规则描述".repeat(60),
      })),
      unresolvedQuestions: Array.from({ length: 20 }, (_, index) => `问题 ${index + 1}`),
      styleDigest: "风格摘要".repeat(200),
      styleSteeringCard: "风格卡".repeat(200),
    }),
  );

  assert.equal(digest.length <= 3500, true);
  assert.equal(digest.includes("\"characterIdeas\""), false);
  assert.match(digest, /Premise|Mainline|Story Hook|Worldview|Style Summary/);
});

test("buildFoundationStateSummaryDigest keeps worldview and question sections in compressed mode", () => {
  const digest = buildFoundationStateSummaryDigest(
    createDraft({
      premise: "超长 premise ".repeat(40),
      mainline: "主线".repeat(160),
      storyHook: "钩子".repeat(160),
      desiredTone: "冷峻",
      characterIdeas: Array.from({ length: 40 }, (_, index) => ({
        name: `角色${index + 1}`,
        role: "supporting",
        goal: "推动设定并保持冲突持续升级，直到角色目标全部摊开。",
        traits: ["test"],
      })),
      worldviewIdeas: Array.from({ length: 10 }, (_, index) => ({
        name: `世界规则${index + 1}`,
        description: "世界规则描述".repeat(40),
      })),
      unresolvedQuestions: Array.from({ length: 10 }, (_, index) => `未决问题 ${index + 1}`),
    }),
  );

  assert.equal(digest.length <= 3500, true);
  const charactersIndex = digest.indexOf("Characters:");
  const worldviewIndex = digest.indexOf("Worldview:");
  const questionsIndex = digest.indexOf("Unresolved Questions:");
  assert.equal(charactersIndex > 0, true);
  assert.equal(worldviewIndex > charactersIndex, true);
  assert.equal(questionsIndex > worldviewIndex, true);
  assert.equal(digest.includes("世界规则1"), true);
  assert.equal(digest.includes("未决问题 1"), true);

  // Characters 段只包含角色行，不混入世界观/未决问题行。
  const charactersSection = digest.slice(charactersIndex, worldviewIndex);
  assert.equal(charactersSection.includes("世界规则"), false);
  assert.equal(charactersSection.includes("未决问题"), false);
  const characterLineCount = charactersSection
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .length;
  assert.equal(characterLineCount <= 6, true);
});

test("syncFoundationDraftWithFallback never lets legacy fallback overwrite canonical state after repeated delta failures", async () => {
  const draft = createDraft({
    premise: "旧 premise",
    mainline: "旧 mainline",
    storyHook: "旧 hook",
  });

  const result = await syncFoundationDraftWithFallback({
    envelope: createFoundationCoreEnvelope(draft, {
      revisionId: "revision-legacy",
      lastAppliedAt: "2026-04-06T00:00:00.000Z",
    }),
    runDeltaSync: async () => {
      throw new Error("delta schema invalid");
    },
    revisionIdFactory: () => "revision-after-legacy",
    appliedAt: "2026-04-06T08:40:00.000Z",
  });

  assert.equal(result.mode, "skipped");
  assert.equal(result.readyToGenerate, false);
  assert.equal(result.nextFocus, "继续补充人物动机和世界规则。");
  assert.equal(result.envelope.draft.premise, "旧 premise");
  assert.equal(result.envelope.draft.mainline, "旧 mainline");
  assert.equal(result.envelope.draft.storyHook, "旧 hook");
  assert.equal(result.envelope.syncMeta.syncStatus.status, "failed");
  assert.equal(result.envelope.syncMeta.syncStatus.mode, "delta");
  assert.match(result.envelope.syncMeta.syncStatus.reason ?? "", /delta schema invalid/i);
});
