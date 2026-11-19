import test from "node:test";
import assert from "node:assert/strict";
import type {
  CharacterSnapshot,
  ChapterBlueprint,
  ConflictRecord,
  FoundationPayload,
} from "./types.ts";
import {
  buildActiveThreadEntries,
  buildCharacterStateEntries,
  buildSceneSteeringNotes,
} from "./story/story-memory.ts";

const blueprint: ChapterBlueprint = {
  chapterNo: 12,
  sceneGoal: "林舟潜入旧港，确认黑匣子的来历",
  characters: ["林舟", "顾南"],
  locations: ["旧港"],
  conflicts: ["林舟必须避开巡逻队", "顾南担心黑匣子失控"],
  foreshadows: ["黑匣子的真正主人"],
  emotionalTone: "压抑、紧绷",
  estimatedWords: 3200,
};

const foundation: FoundationPayload = {
  premise: "赛博悬疑长篇",
  styleCard: "冷峻、克制",
  characters: [
    {
      name: "林舟",
      role: "调查员",
      goal: "查清旧港事故真相",
      traits: ["冷静", "执拗"],
    },
    {
      name: "顾南",
      role: "同伴",
      goal: "保护林舟并销毁危险样本",
      traits: ["谨慎", "敏锐"],
    },
    {
      name: "沈遥",
      role: "对手",
      goal: "夺回黑匣子",
      traits: ["强势"],
    },
  ],
  worldview: [
    {
      name: "旧港",
      description: "废弃港区，被军警封锁",
    },
  ],
  relationships: [],
};

test("buildCharacterStateEntries prefers the latest snapshot and falls back to the locked foundation card", () => {
  const snapshots: CharacterSnapshot[] = [
    {
      chapterNo: 5,
      characters: {
        林舟: {
          location: "下城诊所",
          emotion: "疲惫",
          notes: ["怀疑顾南有所隐瞒"],
        },
      },
    },
    {
      chapterNo: 9,
      characters: {
        林舟: {
          location: "旧港入口",
          emotion: "戒备",
          items: ["黑匣子"],
          notes: ["得知沈遥还活着"],
        },
      },
    },
  ];

  const entries = buildCharacterStateEntries({
    blueprint,
    foundation,
    snapshots,
    currentChapter: 12,
  });

  assert.equal(entries[0]?.name, "林舟");
  assert.equal(entries[0]?.source, "snapshot");
  assert.match(entries[0]?.summary ?? "", /旧港入口/);
  assert.match(entries[0]?.summary ?? "", /黑匣子/);

  const fallback = entries.find((entry) => entry.name === "顾南");
  assert.equal(fallback?.source, "foundation");
  assert.match(fallback?.summary ?? "", /保护林舟并销毁危险样本/);
});

test("buildActiveThreadEntries keeps unresolved threads in play and prioritizes direct blueprint matches", () => {
  const entries = buildActiveThreadEntries({
    blueprint,
    currentChapter: 12,
    foreshadows: [
      {
        id: "thread-1",
        chapterNo: 3,
        content: "黑匣子的真正主人",
        status: "active",
      },
      {
        id: "thread-2",
        chapterNo: 1,
        content: "失踪的信标坐标",
        status: "active",
      },
      {
        id: "thread-3",
        chapterNo: 8,
        content: "旧港封锁令来源",
        status: "resolved",
      },
    ],
  });

  assert.equal(entries[0]?.content, "黑匣子的真正主人");
  assert.equal(entries[0]?.priority, "critical");

  const overdue = entries.find((entry) => entry.content === "失踪的信标坐标");
  assert.equal(overdue?.priority, "high");
  assert.equal(overdue?.age, 11);

  assert.equal(entries.some((entry) => entry.content === "旧港封锁令来源"), false);
});

test("buildSceneSteeringNotes surfaces overdue threads, stale states, and review conflicts", () => {
  const conflicts: ConflictRecord[] = [
    {
      id: "conflict-1",
      type: "timeline_marker",
      severity: "soft",
      message: "检测到时间线可能倒流，请检查章节顺序和时间标记",
    },
  ];

  const notes = buildSceneSteeringNotes({
    currentChapter: 12,
    characterStates: [
      {
        name: "林舟",
        source: "snapshot",
        lastUpdatedChapter: 2,
        stale: true,
        summary: "第 2 章停留在下城诊所，情绪偏冷。",
      },
    ],
    activeThreads: [
      {
        id: "thread-1",
        content: "黑匣子的真正主人",
        openedChapter: 1,
        lastUpdatedChapter: 1,
        age: 11,
        status: "active",
        priority: "critical",
        score: 99,
      },
    ],
    conflicts,
  });

  assert.equal(notes.some((note) => note.includes("黑匣子的真正主人")), true);
  assert.equal(notes.some((note) => note.includes("林舟")), true);
  assert.equal(notes.some((note) => note.includes("时间线可能倒流")), true);
});
