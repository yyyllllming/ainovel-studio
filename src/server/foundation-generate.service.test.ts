import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanonicalFoundationOutput,
  buildFoundationFallbackPayload,
  enrichCandidateFoundationFromProposal,
  mergeAuthoritativeFoundationCharacters,
  resolveFoundationCharacterRenameMaxTokens,
  resolveFoundationGenerationMaxTokens,
  shouldReuseLockedFoundation,
} from "./services/foundation-generate.service.ts";
import {
  buildTranscriptCharacterFallback,
  buildTranscriptWorldviewFallback,
  deriveDraftCoreSummaries,
  deriveFoundationCandidate,
  selectFoundationFromCandidate,
} from "./foundation/foundation-candidate.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import type { ProjectCard } from "./types.ts";

test("resolveFoundationGenerationMaxTokens follows the project coauthor assignment without a hard 2600 cap", () => {
  assert.equal(resolveFoundationGenerationMaxTokens(1800), 1800);
  assert.equal(resolveFoundationGenerationMaxTokens(4096), 4096);
  assert.equal(resolveFoundationGenerationMaxTokens(6400), 6400);
});

test("resolveFoundationCharacterRenameMaxTokens follows the project coauthor assignment without a hard 2400 cap", () => {
  assert.equal(resolveFoundationCharacterRenameMaxTokens(1600), 1600);
  assert.equal(resolveFoundationCharacterRenameMaxTokens(4096), 4096);
  assert.equal(resolveFoundationCharacterRenameMaxTokens(7200), 7200);
});

test("shouldReuseLockedFoundation only reuses a locked foundation when there is no core drift", () => {
  assert.equal(shouldReuseLockedFoundation({
    hasExistingFoundation: true,
    foundationLocked: true,
    coreDrift: false,
  }), true);
  assert.equal(shouldReuseLockedFoundation({
    hasExistingFoundation: true,
    foundationLocked: true,
    coreDrift: true,
  }), false);
  assert.equal(shouldReuseLockedFoundation({
    hasExistingFoundation: false,
    foundationLocked: true,
    coreDrift: false,
  }), false);
});

test("assertCanonicalFoundationOutput blocks placeholder residue from entering formal foundation", () => {
  assert.throws(
    () => assertCanonicalFoundationOutput({
      premise: "主角在夜禁城市里寻找失踪者。",
      mainline: "主角必须继续潜入。",
      storyHook: "主角第一次越过夜禁边界就被盯上。",
      styleCard: "风格卡",
      characters: [
        {
          name: "主角",
          role: "protagonist",
          goal: "活下去",
          traits: ["谨慎"],
        },
      ],
      worldview: [
        {
          name: "世界基调",
          description: "玄幻修仙 类型故事，保持 default 风格",
        },
      ],
      relationships: [],
    }),
    /placeholder 残留/u,
  );

  assert.doesNotThrow(() => assertCanonicalFoundationOutput({
    premise: "墨渊在夜禁城市里寻找失踪者。",
    mainline: "墨渊必须继续潜入。",
    storyHook: "墨渊第一次越过夜禁边界就被盯上。",
    styleCard: "风格卡",
    characters: [
      {
        name: "墨渊",
        role: "protagonist",
        goal: "活下去",
        traits: ["谨慎"],
      },
    ],
    worldview: [
      {
        name: "夜禁律",
        description: "夜里越界者会被城禁追踪。",
      },
    ],
    relationships: [],
  }));
});

test("mergeAuthoritativeFoundationCharacters keeps user-authored transcript实名角色 when no fixed cast exists", () => {
  const merged = mergeAuthoritativeFoundationCharacters({
    proposed: [
      {
        name: "墨渊",
        role: "protagonist",
        goal: "先藏住活骨书，再查清自己被谁盯上。",
        traits: ["警惕", "求生欲强"],
      },
      {
        name: "慕忘",
        role: "mentor",
        goal: "在挽世找到墨渊之前把他送离山谷。",
        traits: ["沉稳", "克制"],
      },
    ],
    workshopMessages: [
      {
        role: "user",
        content: ["姓名：墨渊。", "养父：慕忘。"].join("\n"),
      },
    ],
    workshopDraft: undefined,
    existing: null,
  });

  assert.deepEqual(merged.map((entry) => entry.name), ["墨渊", "慕忘"]);
});

test("buildFoundationFallbackPayload preserves applied style snapshot metadata and mines worldview from transcript", () => {
  const styleProfile = buildFallbackStyleProfile({
    references: [],
    draft: {
      mainline: "",
      desiredTone: "default",
      storyHook: "",
    },
  });

  const fallback = buildFoundationFallbackPayload({
    project: {
      genre: "玄幻修仙",
      premise: "这是一个山海经的故事。",
      style: "default",
    },
    workshopDraft: {
      premise: "这是一个山海经的故事。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    workshopMessages: [
      { role: "user", content: "继续完善" },
      {
        role: "assistant",
        content: [
          "**山神不是兽，是地纹的具象**",
          "山神的纹刻在岩层深处，是静纹，会以注视、位格和山势回应闯入者。",
          "",
          "**玄龟**（背负石碑的巨龟）",
          "它潜入深海时会把周围海水压成重水，主角若拓印此纹，骨骼会沉得几乎无法御空。",
        ].join("\n\n"),
      },
    ],
    context: {
      agents: {} as never,
      prompts: {
        planner: "",
        writer: "",
        reviewerQuick: "",
        reviewerDeep: "",
        editor: "",
        archivist: "",
      },
      activeStyle: {
        styleSnapshotId: "snapshot-2",
        styleSnapshotVersion: 2,
        styleCard: "风格卡",
        styleProfile,
        styleDigest: "快照摘要",
        styleExemplars: [],
        confidence: "high",
        sampledExcerpts: [],
        sourceIds: [],
      },
      styleCard: "风格卡",
      styleProfile,
      chapterWordTarget: {
        sourceAverage: null,
        min: 2400,
        target: 2800,
        max: 3200,
        sourceLabel: "测试参考",
      },
    },
    existing: {
      premise: "旧 premise",
      styleCard: "旧风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-2",
      styleSnapshotVersion: 2,
      styleDigest: "快照摘要",
      styleExemplars: [],
      characters: [],
      worldview: [],
      relationships: [],
    },
  });

  assert.equal(fallback.styleSnapshotId, "snapshot-2");
  assert.equal(fallback.styleSnapshotVersion, 2);
  assert.equal(fallback.styleDigest, "快照摘要");
  assert.equal(fallback.worldview.length >= 2, true);
  assert.equal(fallback.worldview[0]?.name, "山神不是兽");
});

test("deriveDraftCoreSummaries fills empty premise, mainline, and storyHook from structured draft plus recent user input", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个山海经的故事。",
    },
    draft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "盗取将死之山的地纹",
          traits: ["谨慎", "嘴硬", "狠得下心"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "山川不是兽，而是有位格的存在，会通过地纹与祭祀回应闯入者。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      { role: "user", content: "主角叫陆渊，是个专门寻找将死之山盗纹的渎神者。" },
      { role: "assistant", content: "可以把他做成被山神规则追杀的渎神者。" },
      { role: "user", content: "开篇就是他第一次对山神下手，差点被同化成石头。" },
    ],
  });

  assert.match(summary.premise, /陆渊/);
  assert.match(summary.premise, /山神/);
  assert.match(summary.mainline, /将死之山|盗纹|渎神/);
  assert.match(summary.storyHook, /第一次对山神下手|同化成石头/);
});

test("deriveDraftCoreSummaries upgrades a seed premise when richer facts already exist in the draft", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个山海经的故事。",
    },
    draft: {
      premise: "这是一个山海经的故事。",
      mainline: "陆渊在各方追杀中不断盗纹求生。",
      storyHook: "他第一次对山神下手时，差点被整座山同化成石头。",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "盗取将死之山的地纹",
          traits: ["谨慎", "狠", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "山川不是兽，而是有位格的存在，会通过地纹与祭祀回应闯入者。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      { role: "user", content: "主角叫陆渊，是个专门寻找将死之山盗纹的渎神者。" },
      { role: "assistant", content: "可以把他做成被山神规则追杀的渎神者。" },
      { role: "user", content: "开篇就是他第一次对山神下手，差点被同化成石头。" },
    ],
  });

  assert.notEqual(summary.premise, "这是一个山海经的故事。");
  assert.match(summary.premise, /陆渊/);
  assert.match(summary.premise, /山神体系|山神/);
});

test("deriveDraftCoreSummaries ignores meta writing directives when deriving mainline and storyHook", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个山海经的故事。",
    },
    draft: {
      premise: "这是一个山海经的故事。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "盗取将死之山的地纹",
          traits: ["谨慎", "狠", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "山川不是兽，而是有位格的存在，会通过地纹与祭祀回应闯入者。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      { role: "user", content: "你必须最大程度参考山海经还有各种志怪故事，宝物兵器也都要符合。" },
      { role: "user", content: "别第一章，你应该拓展具体世界设定。" },
    ],
  });

  assert.match(summary.mainline, /陆渊/);
  assert.match(summary.mainline, /盗取将死之山的地纹/);
  assert.doesNotMatch(summary.mainline, /参考山海经|宝物兵器/);
  assert.match(summary.storyHook, /开篇陆渊第一次触犯山神体系/);
  assert.doesNotMatch(summary.storyHook, /拓展具体世界设定/);
});

test("deriveDraftCoreSummaries ignores unrelated older plot branches when they are not anchored to the current draft", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个山海经的故事。",
    },
    draft: {
      premise: "这是一个山海经的故事。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "盗取将死之山的地纹",
          traits: ["谨慎", "狠", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "山川不是兽，而是有位格的存在，会通过地纹与祭祀回应闯入者。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      {
        role: "user",
        content: "第一章就是他被捡到了，然后在一对异兽夫妇的照料下开始长大，主线就是这个小兽找自己的身世。",
      },
      {
        role: "assistant",
        content: "可以把这个小兽的身世线再拉长一些。",
      },
    ],
  });

  assert.match(summary.mainline, /陆渊/);
  assert.match(summary.mainline, /盗取将死之山的地纹/);
  assert.match(summary.storyHook, /开篇陆渊第一次触犯山神体系/);
  assert.doesNotMatch(summary.storyHook, /小兽|被捡到|异兽夫妇/);
});

test("deriveDraftCoreSummaries can fall back to transcript worldview and still emit a hook", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个山海经的故事。",
    },
    draft: {
      premise: "这是一个山海经的故事。",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      {
        role: "assistant",
        content: "**山神体系**\n\n山川不是兽，而是有位格的存在，会通过地纹与祭祀回应闯入者。",
      },
    ],
  });

  assert.match(summary.mainline, /山神体系/);
  assert.match(summary.storyHook, /开篇有人第一次触犯山神体系/);
});

test("deriveDraftCoreSummaries prefers the latest matched correction hook when primary anchors are missing", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个山海经的故事。",
    },
    draft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "剥纹、还债、去问白泽",
          traits: ["谨慎", "狠", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "旧分支残留。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      {
        role: "user",
        content: "第一章就是他被捡到，在异兽夫妇照料下找身世。",
      },
      {
        role: "assistant",
        content: "可以把这个小兽的身世线再拉长一些。",
      },
      {
        role: "user",
        content: "山神不是主要体系啊，只是山的灵作为这样。核心还是山海经里面各种灵。",
      },
      {
        role: "user",
        content: "开篇是他刚剥下一道骨纹，灵债立刻反噬，他只能去问白泽。",
      },
    ],
  });

  assert.match(summary.mainline, /剥纹|还债|白泽/);
  assert.match(summary.storyHook, /骨纹|灵债|白泽/);
  assert.doesNotMatch(summary.storyHook, /被捡到|异兽夫妇|山神体系/);
});

test("deriveFoundationCandidate keeps richer draft facts and ignores placeholder confirmed world cards", () => {
  const styleProfile = buildFallbackStyleProfile({
    references: [],
    draft: {
      mainline: "",
      desiredTone: "default",
      storyHook: "",
    },
  });

  const confirmedCards = [
    {
      cardType: "world",
      status: "confirmed",
      draft: {
        name: "世界基调",
        description: "玄幻修仙 类型故事，保持 default 风格",
      },
    },
    {
      cardType: "character",
      status: "confirmed",
      draft: {
        name: "陆渊",
        role: "protagonist",
        goal: "盗取将死之山的地纹",
        traits: ["谨慎", "狠", "会伪装"],
      },
    },
  ] satisfies Array<Pick<ProjectCard, "cardType" | "status" | "draft">>;

  const foundation = deriveFoundationCandidate({
    project: {
      genre: "玄幻修仙",
      premise: "这是一个山海经的故事。",
      style: "default",
    },
    workshopDraft: {
      premise: "陆渊为了盗取将死之山的地纹，踏入会注视人的山神体系。",
      mainline: "陆渊在各方追杀中不断盗纹求生。",
      storyHook: "他第一次对山神下手时，差点被整座山同化成石头。",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "盗取将死之山的地纹",
          traits: ["谨慎", "狠", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山神体系",
          description: "山川有位格，会通过地纹和祭祀回应闯入者。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-9",
      styleSnapshotVersion: 9,
      styleDigest: "摘要",
      styleExemplars: [],
    },
    workshopMessages: [],
    activeStyle: {
      styleSnapshotId: "snapshot-9",
      styleSnapshotVersion: 9,
      styleCard: "风格卡",
      styleProfile,
      styleDigest: "摘要",
      styleExemplars: [],
      confidence: "high",
      sampledExcerpts: [],
      sourceIds: [],
    },
    confirmedCards,
    existing: null,
  });

  assert.equal(foundation.premise, "陆渊为了盗取将死之山的地纹，踏入会注视人的山神体系。");
  assert.deepEqual(
    foundation.worldview.map((entry) => entry.name),
    ["山神体系"],
  );
  assert.deepEqual(
    foundation.characters.map((entry) => entry.name),
    ["陆渊"],
  );
});

test("deriveFoundationCandidate mines a concrete protagonist from transcript when characterIdeas are empty", () => {
  const styleProfile = buildFallbackStyleProfile({
    references: [],
    draft: {
      mainline: "",
      desiredTone: "default",
      storyHook: "",
    },
  });

  const foundation = deriveFoundationCandidate({
    project: {
      genre: "山海玄幻",
      premise: "这是一个山海经的故事。",
      style: "default",
    },
    workshopDraft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    workshopMessages: [
      {
        role: "assistant",
        content: [
          "别从\"我叫姜尘\"开始写。",
          "开篇动作：七岁的姜尘蹲在涧边一块风化的夔牛骨上，看姜烈处理一头刚猎得的异兽。",
          "母亲风氏则默默给他手腕系上一截萆荔藤，说这藤子能镇骨躁。",
        ].join("\n\n"),
      },
    ],
    activeStyle: {
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleCard: "风格卡",
      styleProfile,
      styleDigest: "",
      styleExemplars: [],
      confidence: "high",
      sampledExcerpts: [],
      sourceIds: [],
    },
    confirmedCards: [],
    existing: null,
  });

  assert.equal(foundation.characters[0]?.name, "姜尘");
});

test("buildTranscriptCharacterFallback ignores kinship action phrases that are not real names", () => {
  const characters = buildTranscriptCharacterFallback([
    {
      role: "assistant",
      content: [
        "开篇动作：七岁的姜尘蹲在涧边一块风化的夔牛骨上。",
        "父亲用刀剜骨时像在剔石，母亲看不见血，只会把萆荔藤往他腕上缠得更紧。",
      ].join("\n\n"),
    },
  ]);

  assert.deepEqual(characters.map((entry) => entry.name), ["姜尘"]);
});

test("buildTranscriptCharacterFallback trims kinship names before narration continues", () => {
  const characters = buildTranscriptCharacterFallback([
    {
      role: "assistant",
      content: "哥哥姜烈就是在这里用刀剜骨，母亲风氏则默默给他手腕系上一截萆荔藤。",
    },
  ]);

  assert.deepEqual(characters.map((entry) => entry.name), ["姜烈", "风氏"]);
});

test("buildTranscriptCharacterFallback ignores compound kinship narration fragments like 养父母的警告", () => {
  const characters = buildTranscriptCharacterFallback([
    {
      role: "user",
      content: [
        "养父母严令：绝对不能暴露骨书能力。",
        "以及养父母的分裂：慕忘想镇压，岚柔想安抚。",
        "开篇的雷雨夜和养父母的警告就有了具体的恐惧锚点。",
        "最开始写一个雷雨夜大荒，养父母捡到了小兽。",
        "关键人物仍然是养父慕忘。",
      ].join("\n\n"),
    },
  ]);

  assert.deepEqual(characters.map((entry) => entry.name), ["慕忘"]);
});

test("buildTranscriptCharacterFallback detects protagonist declarations like 姓名：墨渊", () => {
  const characters = buildTranscriptCharacterFallback([
    {
      role: "user",
      content: [
        "姓名：墨渊",
        "身份：来历不明、身世神秘的顶级异兽。",
        "养父：慕忘（狻猊）。",
      ].join("\n"),
    },
  ]);

  assert.deepEqual(characters.map((entry) => entry.name), ["墨渊", "慕忘"]);
});

test("deriveDraftCoreSummaries does not preserve polluted kinship fragments from stale workshop summaries", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个洪荒玄幻故事。",
    },
    draft: {
      premise: "主角母的禁，卷入第一。",
      mainline: "主角母的警告，卷入第一。",
      storyHook: "主角母的分裂，立刻付出惨重代价。",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      {
        role: "user",
        content: "主角叫墨渊。最开始写一个雷雨夜大荒，养父母捡到了小兽。第一章必须是这样，描写世界的宏大。",
      },
      {
        role: "assistant",
        content: "养父慕忘与养母岚柔将他带回山谷，严令不能暴露骨书能力。",
      },
    ],
  });

  assert.doesNotMatch(summary.premise, /母的|母捡|母严/u);
  assert.doesNotMatch(summary.mainline, /母的|母捡|母严/u);
  assert.doesNotMatch(summary.storyHook, /母的|母捡|母严/u);
});

test("buildTranscriptWorldviewFallback ignores ordinal coaching headings like 第一第二第三", () => {
  const worldview = buildTranscriptWorldviewFallback([
    {
      role: "assistant",
      content: [
        "**第一，关于“债”的具体形态**",
        "你提到每学一种天赋都会留下债与反噬。",
        "",
        "**山海骨书**",
        "骨书会在骨髓深处生长新的骨页，并持续啃噬旧骨。",
      ].join("\n\n"),
    },
  ]);

  assert.deepEqual(worldview.map((entry) => entry.name), ["山海骨书"]);
});

test("deriveDraftCoreSummaries ignores polluted project premise and ordinal worldview placeholders from stale state", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "玄幻修仙 长篇故事，等待与作者共创细化，卷入第一，开篇有人第一次触犯第一时，立刻付出惨重代价，主角母的禁。",
    },
    draft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [
        {
          name: "第一",
          description: "第一，关于债的具体形态。你提到每学一种天赋都会留下债与反噬。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      {
        role: "user",
        content: "主角叫墨渊，被养父慕忘和养母岚柔收养。",
      },
    ],
  });

  assert.match(summary.premise, /墨渊/u);
  assert.doesNotMatch(summary.premise, /母的|卷入第一|触犯第一/u);
  assert.doesNotMatch(summary.mainline, /卷入第一|触犯第一/u);
  assert.doesNotMatch(summary.storyHook, /卷入第一|触犯第一/u);
});

test("deriveDraftCoreSummaries discards stale ordinal placeholder summaries from draft mainline and storyHook", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个洪荒玄幻故事。",
    },
    draft: {
      premise: "",
      mainline: "开篇有人第一次触犯第一时，立刻付出惨重代价。",
      storyHook: "开篇有人第一次触犯第一时，立刻付出惨重代价。",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      {
        role: "user",
        content: "姓名：墨渊。养父：慕忘。",
      },
    ],
  });

  assert.match(summary.premise, /墨渊/u);
  assert.doesNotMatch(summary.mainline, /卷入第一|触犯第一/u);
  assert.doesNotMatch(summary.storyHook, /卷入第一|触犯第一/u);
});

test("deriveDraftCoreSummaries lets later corrective transcript override stale non-empty mainline and storyHook", () => {
  const summary = deriveDraftCoreSummaries({
    project: {
      premise: "这是一个山海经的故事。",
    },
    draft: {
      premise: "山只是有灵，核心还是山海经万灵。",
      mainline: "陆渊在山神体系追杀下盗纹求生。",
      storyHook: "开篇陆渊第一次触犯山神体系，差点被同化成石头。",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "剥纹、还债、去问白泽",
          traits: ["谨慎", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山海经万灵",
          description: "核心是万灵，不是祭祀山神体系。",
        },
        {
          name: "骨书灵债",
          description: "剥纹会背上灵债，骨书会持续反噬。",
        },
      ],
      relationshipIdeas: [
        {
          source: "陆渊",
          label: "背负",
          target: "骨书灵债",
        },
      ],
      unresolvedQuestions: ["白泽会如何安抚骨书里的灵？"],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    messages: [
      { role: "user", content: "第一章就是他被捡到，在异兽夫妇照料下找身世。" },
      { role: "assistant", content: "可以把异兽夫妇线再拉长。" },
      { role: "user", content: "山神不是主要体系啊，只是山的灵作为这样。" },
      { role: "assistant", content: "我理解错了重心。" },
      { role: "user", content: "核心还是山海经万灵，主角方向是剥纹、骨书、还债、问白泽。" },
      { role: "user", content: "开篇不是触犯山神体系，是他刚剥下一道骨纹，灵债立刻反噬。" },
    ],
  });

  assert.match(summary.mainline, /剥纹/);
  assert.match(summary.mainline, /骨书/);
  assert.match(summary.mainline, /白泽/);
  assert.doesNotMatch(summary.mainline, /山神体系追杀/);
  assert.match(summary.storyHook, /骨纹/);
  assert.match(summary.storyHook, /灵债/);
  assert.doesNotMatch(summary.storyHook, /触犯山神体系/);
});

test("deriveFoundationCandidate does not mistake worldview nouns for transcript characters", () => {
  const styleProfile = buildFallbackStyleProfile({
    references: [],
    draft: {
      mainline: "",
      desiredTone: "default",
      storyHook: "",
    },
  });

  const foundation = deriveFoundationCandidate({
    project: {
      genre: "山海玄幻",
      premise: "这是一个山海经的故事。",
      style: "default",
    },
    workshopDraft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    workshopMessages: [
      {
        role: "assistant",
        content: [
          "第一章的场景放在非山脚下的葬骨涧。",
          "那棵枯死的若木仍在流金色汁液。",
          "夔牛骨与狰吼一起把危险压进画面里。",
        ].join("\n\n"),
      },
    ],
    activeStyle: {
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleCard: "风格卡",
      styleProfile,
      styleDigest: "",
      styleExemplars: [],
      confidence: "high",
      sampledExcerpts: [],
      sourceIds: [],
    },
    confirmedCards: [],
    existing: null,
  });

  assert.equal(foundation.characters[0]?.name, "主角");
});

test("mergeAuthoritativeFoundationCharacters only keeps user-authored实名角色 and ignores ai-only extras", () => {
  const merged = mergeAuthoritativeFoundationCharacters({
    proposed: [
      {
        name: "姜尘",
        role: "protagonist",
        goal: "查清若木残骸下的真相",
        traits: ["主动", "敏感"],
      },
      {
        name: "姜烈",
        role: "supporting",
        goal: "卷入主线冲突",
        traits: ["冷硬"],
      },
    ],
    workshopDraft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "哥哥姜尘",
          role: "protagonist",
          goal: "推动主线完成",
          traits: ["执拗"],
        },
      ],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    existing: null,
  });

  assert.deepEqual(merged, [
    {
      name: "姜尘",
      role: "protagonist",
      goal: "查清若木残骸下的真相",
      traits: ["主动", "敏感"],
      secrets: undefined,
    },
  ]);
});

test("mergeAuthoritativeFoundationCharacters keeps ai-proposed names out of fixed cast when no authoritative base exists", () => {
  const merged = mergeAuthoritativeFoundationCharacters({
    proposed: [
      {
        name: "姜尘",
        role: "protagonist",
        goal: "查清真相",
        traits: ["主动"],
      },
    ],
    workshopDraft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    existing: null,
  });

  assert.deepEqual(merged, []);
});

test("mergeAuthoritativeFoundationCharacters does not resurrect existing characters removed from a non-empty draft", () => {
  const merged = mergeAuthoritativeFoundationCharacters({
    proposed: [
      {
        name: "陆渊",
        role: "protagonist",
        goal: "剥纹、还债、去问白泽",
        traits: ["谨慎", "会伪装"],
      },
    ],
    workshopMessages: [
      { role: "user", content: "把祭司桑岚这个角色删掉，他不再出场。" },
    ],
    workshopDraft: {
      premise: "",
      mainline: "",
      storyHook: "",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "剥纹、还债、去问白泽",
          traits: ["谨慎", "会伪装"],
        },
      ],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "",
      styleProfile: undefined,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    existing: {
      premise: "旧 premise",
      styleCard: "旧风格卡",
      characters: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "旧目标",
          traits: ["谨慎"],
        },
        {
          name: "祭司桑岚",
          role: "antagonist",
          goal: "维持旧山神祭祀",
          traits: ["顽固"],
        },
      ],
      worldview: [],
      relationships: [],
    },
  });

  assert.deepEqual(merged.map((entry) => entry.name), ["陆渊"]);
});

test("deriveFoundationCandidate treats a non-empty draft as the authoritative entity set instead of unioning existing", () => {
  const styleProfile = buildFallbackStyleProfile({
    references: [],
    draft: {
      mainline: "",
      desiredTone: "default",
      storyHook: "",
    },
  });

  const foundation = deriveFoundationCandidate({
    project: {
      genre: "玄幻修仙",
      premise: "这是一个山海经的故事。",
      style: "default",
    },
    workshopDraft: {
      premise: "陆渊为了盗取将死之山的地纹，踏入山海经万灵的世界。",
      mainline: "陆渊在各方追杀中不断盗纹求生。",
      storyHook: "他第一次剥下骨纹时，灵债立刻反噬。",
      desiredTone: "default",
      characterIdeas: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "剥纹、还债、去问白泽",
          traits: ["谨慎", "会伪装"],
        },
      ],
      worldviewIdeas: [
        {
          name: "山海经万灵",
          description: "核心是万灵，不是祭祀山神体系。",
        },
      ],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleSteeringCard: "风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
    },
    workshopMessages: [],
    activeStyle: {
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleCard: "风格卡",
      styleProfile,
      styleDigest: "",
      styleExemplars: [],
      confidence: "high",
      sampledExcerpts: [],
      sourceIds: [],
    },
    confirmedCards: [],
    existing: {
      premise: "旧 premise",
      styleCard: "旧风格卡",
      styleProfile,
      styleSnapshotId: null,
      styleSnapshotVersion: null,
      styleDigest: "",
      styleExemplars: [],
      characters: [
        {
          name: "陆渊",
          role: "protagonist",
          goal: "旧目标",
          traits: ["谨慎"],
        },
        {
          name: "祭司桑岚",
          role: "antagonist",
          goal: "维持旧山神祭祀",
          traits: ["顽固"],
        },
      ],
      worldview: [
        {
          name: "山神体系",
          description: "旧的山神主体系分支。",
        },
        {
          name: "山海经万灵",
          description: "核心是万灵，不是祭祀山神体系。",
        },
      ],
      relationships: [],
    },
  });

  assert.deepEqual(foundation.characters.map((entry) => entry.name), ["陆渊"]);
  assert.deepEqual(foundation.worldview.map((entry) => entry.name), ["山海经万灵"]);
});

test("enrichCandidateFoundationFromProposal pins core facts to the candidate while keeping llm profile enrichment", () => {
  const candidate = {
    premise: "陆渊为了盗取将死之山的地纹，踏入会注视人的山神体系。",
    mainline: "陆渊在各方追杀中不断盗纹求生。",
    storyHook: "他第一次对山神下手时，差点被整座山同化成石头。",
    styleCard: "候选风格卡",
    characters: [
      {
        name: "陆渊",
        role: "protagonist",
        goal: "盗取将死之山的地纹",
        traits: ["谨慎"],
      },
    ],
    worldview: [
      {
        name: "山神体系",
        description: "山川不是兽，而是有位格的存在。",
      },
    ],
    relationships: [
      {
        source: "陆渊",
        target: "山神体系",
        label: "盗纹后被注视",
      },
    ],
  };

  const proposed = {
    premise: "一个被 LLM 改写过的更泛 premise。",
    mainline: "被改写的主线。",
    storyHook: "被改写的钩子。",
    styleCard: "LLM 润色后的风格卡",
    characters: [
      {
        name: "陆渊",
        role: "渎神者",
        goal: "LLM 改写的目标",
        traits: ["谨慎", "嘴硬", "狠得下心"],
        secrets: ["袖中藏着半页骨书"],
      },
      {
        name: "多余角色",
        role: "extra",
        goal: "不该进入正式设定",
        traits: ["多余"],
      },
    ],
    worldview: [
      {
        name: "被改写的世界规则",
        description: "不该覆盖候选稿。",
      },
    ],
    relationships: [
      {
        source: "陆渊",
        target: "白泽",
        label: "求问灵债",
      },
    ],
  };

  const enriched = enrichCandidateFoundationFromProposal({
    candidate,
    proposed,
  });

  assert.equal(enriched.premise, candidate.premise);
  assert.equal(enriched.mainline, candidate.mainline);
  assert.equal(enriched.storyHook, candidate.storyHook);
  assert.deepEqual(enriched.worldview, candidate.worldview);
  assert.equal(enriched.styleCard, "LLM 润色后的风格卡");
  assert.deepEqual(enriched.characters.map((entry) => entry.name), ["陆渊"]);
  assert.equal(enriched.characters[0]?.goal, "盗取将死之山的地纹");
  assert.equal(enriched.characters[0]?.role, "渎神者");
  assert.deepEqual(enriched.characters[0]?.traits, ["谨慎", "嘴硬", "狠得下心"]);
  assert.deepEqual(enriched.characters[0]?.secrets, ["袖中藏着半页骨书"]);
  assert.deepEqual(
    enriched.relationships.map((entry) => entry.label),
    ["盗纹后被注视", "求问灵债"],
  );
});

test("selectFoundationFromCandidate falls back to the candidate when the llm result gets thinner", () => {
  const styleProfile = buildFallbackStyleProfile({
    references: [],
    draft: {
      mainline: "",
      desiredTone: "default",
      storyHook: "",
    },
  });

  const candidate = {
    premise: "陆渊为了盗取将死之山的地纹，踏入会注视人的山神体系。",
    styleCard: "风格卡",
    styleProfile,
    styleSnapshotId: "snapshot-9",
    styleSnapshotVersion: 9,
    styleDigest: "摘要",
    styleExemplars: [],
    characters: [
      {
        name: "陆渊",
        role: "protagonist",
        goal: "盗取将死之山的地纹",
        traits: ["谨慎", "会伪装", "狠"],
      },
    ],
    worldview: [
      {
        name: "山神体系",
        description: "山川不是兽，而是有位格的存在。",
      },
      {
        name: "血食祭祀",
        description: "山神靠血食祭祀维持清醒。",
      },
    ],
    relationships: [],
  };

  const thinner = {
    ...candidate,
    premise: "这是一个山海经的故事。",
    characters: [
      {
        name: "主角",
        role: "protagonist",
        goal: "推动主线完成",
        traits: ["主动"],
      },
    ],
    worldview: [
      {
        name: "世界基调",
        description: "玄幻修仙 类型故事，保持 default 风格",
      },
    ],
  };

  const selected = selectFoundationFromCandidate({
    candidate,
    proposed: thinner,
  });

  assert.deepEqual(selected, candidate);
});
