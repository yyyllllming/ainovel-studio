import test from "node:test";
import assert from "node:assert/strict";

import { buildContextMessages } from "./run/chapter-draft.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import type { ContextPack } from "./types.ts";
import { createDefaultWritingDna } from "./writing/writing-dna.ts";

function createContextPack(): ContextPack {
  return {
    totalTokens: 128000,
    breakdown: {
      systemRules: 6400,
      styleCard: 12800,
      characterCards: 19200,
      dynamicFacts: 12800,
      historySummaries: 25600,
      currentDraft: 38400,
      outputReserve: 12800,
    },
    blueprint: {
      chapterNo: 6,
      sceneGoal: "林舟必须在旧港摸到黑匣子的真正来历。",
      characters: ["林舟", "顾南"],
      locations: ["旧港"],
      conflicts: ["林舟必须避开巡逻队，再逼近黑匣子主人留下的线索。"],
      foreshadows: ["黑匣子的真正主人已经开始收网。"],
      emotionalTone: "压抑、紧绷",
      estimatedWords: 3200,
      requiredProgressDelta: "information_shift",
    },
    styleCard: "冷峻、克制",
    styleProfile: buildFallbackStyleProfile({ references: [] }),
    writingDna: createDefaultWritingDna(),
    projectPremise: "调查员沿着黑匣子线索追查雾灾来源。",
    previousChapterTail: null,
    storyContractSummary: "不应整块注入 Writer 的 story contract prose。",
    currentVolumeGoal: "让旧港调查线真正碰到黑匣子主人。",
    completionProgress: "42%",
    activeSteeringNotes: [],
    requiredCards: [],
    worldviewCards: [],
    summaryWindow: {
      recentFullChapters: [],
      detailedSummaries: [],
      briefSummaries: [],
    },
    memory: {
      characterStates: [],
      activeThreads: [],
      sceneSteeringNotes: [],
      relationshipDeltas: [],
      timeMarker: "",
      unresolvedPromises: [],
      pendingConsequences: [],
      hookDiagnostics: null,
    },
    lorebook: {
      entries: [],
      renderedCards: [],
      debug: {
        matchedCardIds: [],
        triggeredBy: [],
        progressionCount: 0,
      },
    },
    facts: [],
    conflicts: [],
    writerNotes: [
      "软冲突提醒：蓝图比当前段落计划更激进，写作时要给出过渡。",
      "当前里程碑：拿到黑匣子主人的第一条铁证。",
      "当前段落意图：让林舟先摸到会改写调查方向的新线索。",
      "下一扣钩子：黑匣子主人已经开始反向收网。",
    ],
    plannerContextSummary: "",
    futureContext: "",
  };
}

test("buildContextMessages keeps writer injection as a minimal execution pack", () => {
  const messages = buildContextMessages("project-1", createContextPack(), 6, []);

  assert.match(messages.user, /软冲突提醒：蓝图比当前段落计划更激进/);
  assert.match(messages.user, /当前里程碑：拿到黑匣子主人的第一条铁证/);
  assert.match(messages.user, /当前段落意图：让林舟先摸到会改写调查方向的新线索/);
  assert.match(messages.user, /下一扣钩子：黑匣子主人已经开始反向收网/);
  assert.doesNotMatch(messages.user, /story contract prose/u);
  assert.doesNotMatch(messages.user, /让旧港调查线真正碰到黑匣子主人/u);
  assert.doesNotMatch(messages.user, /42%/u);
});
