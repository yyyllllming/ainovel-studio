import test from "node:test";
import assert from "node:assert/strict";
import { buildLorebookPack, buildDefaultCardMeta, hasMajorProgressionChange } from "./story/story-lorebook.ts";
import type { CardProgression, ChapterBlueprint, ProjectCard } from "./types.ts";

const blueprint: ChapterBlueprint = {
  chapterNo: 6,
  sceneGoal: "林舟在旧港和顾南对质，黑匣子开始失控",
  characters: ["林舟", "顾南"],
  locations: ["旧港"],
  conflicts: ["顾南隐瞒了黑匣子的来源"],
  foreshadows: ["沈遥正在接近旧港"],
  emotionalTone: "紧绷",
  estimatedWords: 3200,
};

function createCard(overrides: Partial<ProjectCard> & Pick<ProjectCard, "id" | "name" | "cardType">): ProjectCard {
  const { id, name, cardType, ...rest } = overrides;
  return {
    id,
    projectId: "project-1",
    cardType,
    name,
    draft:
      cardType === "character"
        ? {
            name,
            role: "角色",
            goal: "推进主线",
            traits: ["冷静"],
          }
        : {
            name,
            description: "世界设定条目",
          },
    meta: buildDefaultCardMeta(name),
    status: "confirmed",
    confirmedAt: "2026-03-20T00:00:00.000Z",
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    ...rest,
  };
}

test("buildLorebookPack includes pinned and directly matched cards and expands one linked layer", () => {
  const cards: ProjectCard[] = [
    createCard({
      id: "card-linzhou",
      cardType: "character",
      name: "林舟",
      meta: {
        ...buildDefaultCardMeta("林舟"),
        aliases: ["林舟", "舟"],
        pinnedScope: "chapter",
        linkedCardIds: ["card-blackbox"],
      },
    }),
    createCard({
      id: "card-blackbox",
      cardType: "world",
      name: "黑匣子",
      meta: {
        ...buildDefaultCardMeta("黑匣子"),
        keywords: ["失控"],
      },
    }),
  ];

  const pack = buildLorebookPack({
    blueprint,
    cards,
    progressions: [],
    summaryTexts: ["林舟曾在第 4 章得到黑匣子。"],
  });

  assert.deepEqual(
    pack.entries.map((entry) => entry.title),
    ["林舟", "黑匣子"],
  );
  assert.equal(pack.entries[0]?.pinned, true);
  assert.equal((pack.entries[1]?.matchedBy.length ?? 0) > 0, true);
});

test("buildLorebookPack renders progression-backed runtime state", () => {
  const card = createCard({
    id: "card-gunan",
    cardType: "character",
    name: "顾南",
    meta: {
      ...buildDefaultCardMeta("顾南"),
      pinnedScope: "chapter",
    },
  });
  const progressions: CardProgression[] = [
    {
      id: "prog-1",
      projectId: "project-1",
      cardId: "card-gunan",
      chapterNo: 5,
      targetPath: "state.location",
      mode: "replace",
      content: "旧港仓库",
      sourceFactIds: ["fact-1"],
      status: "active",
      reviewState: "provisional",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    },
    {
      id: "prog-2",
      projectId: "project-1",
      cardId: "card-gunan",
      chapterNo: 5,
      targetPath: "state.emotion",
      mode: "replace",
      content: "戒备",
      sourceFactIds: ["fact-2"],
      status: "active",
      reviewState: "provisional",
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-20T00:00:00.000Z",
    },
  ];

  const pack = buildLorebookPack({
    blueprint,
    cards: [card],
    progressions,
  });

  assert.match(pack.entries[0]?.content ?? "", /当前位置=旧港仓库/);
  assert.match(pack.entries[0]?.content ?? "", /情绪=戒备/);
  assert.equal(pack.entries[0]?.source, "progression");
});

test("buildLorebookPack appends recent evidence snippets for confirmed anchors", () => {
  const card = createCard({
    id: "card-jianglie",
    cardType: "character",
    name: "姜烈",
    meta: {
      ...buildDefaultCardMeta("姜烈"),
      pinnedScope: "chapter",
      evidence: [
        {
          chapterNo: 12,
          source: "chapter.facts.character_state",
          reason: "章节事实记录角色状态",
          snippet: "姜烈在乱流峡现身，挡在姜尘前面。",
        },
        {
          chapterNo: 13,
          source: "chapter.facts.relationship",
          reason: "章节事实记录关系变化",
          snippet: "姜烈再次阻拦姜尘，逼他回若木旧城。",
        },
      ],
    },
  });

  const pack = buildLorebookPack({
    blueprint: {
      ...blueprint,
      characters: ["姜烈", "姜尘"],
      sceneGoal: "姜烈拦住姜尘，不让他离开旧港。",
    },
    cards: [card],
    progressions: [],
  });

  assert.match(pack.entries[0]?.content ?? "", /最近事实：第13章：姜烈再次阻拦姜尘/);
  assert.match(pack.entries[0]?.content ?? "", /最近事实：第12章：姜烈在乱流峡现身/);
});

test("hasMajorProgressionChange detects state replacements that should force deep review", () => {
  assert.equal(
    hasMajorProgressionChange([
      {
        id: "prog-1",
        projectId: "project-1",
        cardId: "card-1",
        chapterNo: 3,
        targetPath: "state.location",
        mode: "replace",
        content: "旧港",
        sourceFactIds: [],
        status: "active",
        reviewState: "provisional",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ]),
    true,
  );

  assert.equal(
    hasMajorProgressionChange([
      {
        id: "prog-2",
        projectId: "project-1",
        cardId: "card-1",
        chapterNo: 3,
        targetPath: "notes",
        mode: "add",
        content: "补充一条备注",
        sourceFactIds: [],
        status: "active",
        reviewState: "provisional",
        createdAt: "2026-03-20T00:00:00.000Z",
        updatedAt: "2026-03-20T00:00:00.000Z",
      },
    ]),
    false,
  );
});
