import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthorReviewBlueprint,
  createAuthorReviewBlueprintService,
} from "./services/author-review-blueprint.service.ts";
import type { ChapterBlueprint, FoundationPayload } from "./types.ts";

const foundation: FoundationPayload = {
  premise: "林砚在雾港失物招领处追查被城市删除的失踪者。",
  mainline: "林砚必须终止四点十七分修正，并让姐姐回到公共记录。",
  storyHook: "一把无人认领的红伞传出失踪七年的姐姐的声音。",
  styleCard: "第三人称限知；具体动作承载悬疑信息。",
  characters: [
    { name: "林砚", role: "protagonist", goal: "终止修正", traits: ["谨慎"], secrets: [] },
    { name: "周既明", role: "ally", goal: "守住档案", traits: ["克制"], secrets: [] },
  ],
  worldview: [
    { name: "雾港失物招领处", description: "接收全城无人认领物。" },
    { name: "四点十七分修正", description: "公共记录每天自动改写一次。" },
  ],
  relationships: [],
};

test("author review baseline derives a concrete blueprint from human-authored content without a model", () => {
  const blueprint = buildAuthorReviewBlueprint(foundation, {
    chapterNo: 1,
    title: "红伞里的声音",
    content: "林砚在雾港失物招领处打开红伞。周既明守在门口，四点十七分修正已经开始。",
  });

  assert.equal(blueprint.chapterNo, 1);
  assert.deepEqual(blueprint.characters, ["林砚", "周既明"]);
  assert.deepEqual(blueprint.locations, ["雾港失物招领处"]);
  assert.match(blueprint.sceneGoal, /红伞里的声音/u);
  assert.match(blueprint.conflicts.join("\n"), /四点十七分修正/u);
  assert.equal(blueprint.sourcePlanGenerationId, null);
});

test("author review baseline remains compatible with legacy foundations without mainline or story hook", () => {
  const blueprint = buildAuthorReviewBlueprint(
    { ...foundation, mainline: undefined, storyHook: undefined },
    { chapterNo: 1, title: "旧项目章节", content: "林砚翻开档案。" },
  );
  assert.match(blueprint.conflicts[0] ?? "", /雾港失物招领处/u);
  assert.deepEqual(blueprint.foreshadows, []);
});

test("author review baseline keeps an existing blueprint and persists a missing one exactly once", async () => {
  const existing: ChapterBlueprint = {
    chapterNo: 2,
    sceneGoal: "既有目标",
    characters: ["林砚"],
    locations: [],
    conflicts: ["既有冲突"],
    foreshadows: [],
    emotionalTone: "克制",
    estimatedWords: 2200,
  };
  const calls: string[] = [];
  let stored: ChapterBlueprint | null = existing;
  const service = createAuthorReviewBlueprintService({
    getBlueprint: () => stored,
    getFoundation: () => foundation,
    saveBlueprint: (_projectId, blueprint) => {
      calls.push("save");
      stored = blueprint;
      return blueprint;
    },
    writeBlueprintFile: async () => {
      calls.push("write");
    },
    appendRunLog: () => calls.push("log"),
  });

  assert.equal(await service.ensure("project-a", { chapterNo: 2, title: "第二章", content: "林砚继续追查。" }), existing);
  assert.deepEqual(calls, []);

  stored = null;
  const created = await service.ensure("project-a", { chapterNo: 3, title: "第三章", content: "林砚回到雾港失物招领处。" });
  assert.equal(created.chapterNo, 3);
  assert.deepEqual(calls, ["save", "write", "log"]);
});
