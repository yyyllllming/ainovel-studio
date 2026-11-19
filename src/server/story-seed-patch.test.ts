import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

import { projectDir } from "./paths.ts";
import {
  buildPlannerAvoidanceDirectives,
  readProjectSeedPatchFile,
  resolveSegmentRuntimeMetadata,
  writeProjectSeedPatchFile,
} from "./story/story-seed-patch.ts";
import type { ProjectStorySeedPatch, SegmentPlanItem, StoryContract, StoryProgressState } from "./types.ts";

const projectId = "test-story-patch-project";

const patch: ProjectStorySeedPatch = {
  arenaClusters: [
    { id: "rim_hunt", label: "外沿猎场", summary: "断崖外沿与猎迹压迫层", hints: ["断崖外围", "断崖边缘", "崖坪外口"] },
    { id: "living_rule", label: "活山规则层", summary: "会主动收纹、改道、吞响的活山层", hints: ["收纹风廊", "活山根潮廊", "听骨风井"] },
  ],
  opponentClusters: [
    { id: "hunters", label: "追猎者", summary: "沿痕追压的活物或猎手", hints: ["巡山罴影", "攫光妖鹫"] },
    { id: "rules", label: "规则本身", summary: "古禁与环境规则直接施压", hints: ["旧门规则", "活山禁则"] },
  ],
  rewardTypes: [
    { id: "clue", label: "线索", description: "拿到会改写下一步的新认知" },
    { id: "access", label: "通行权", description: "获得通路、位置或门槛上的松动" },
  ],
  relationshipProgressions: [
    { id: "jy-bear-1", relationshipKey: "纪渊-巡山罴影", label: "从纯敌对转到被规则暂时捆绑", description: "先承认彼此都被旧门机制牵住。" },
  ],
  badPatterns: [
    { id: "same-escape-shell", kind: "scene", label: "同一追逃空壳", examples: ["被追 -> 硬扛 -> 再往深处钻"] },
  ],
  explicitMappings: {
    arenaHints: {
      "断崖深处的骨壁通道": "living_rule",
      "断崖外围": "rim_hunt",
    },
    antagonists: {
      "巡山罴影": "hunters",
    },
    rewardSignals: {
      "拿到线索": "clue",
      "松开门槛": "access",
    },
  },
};

test.after(async () => {
  if (existsSync(projectDir(projectId))) {
    await rm(projectDir(projectId), { recursive: true, force: true });
  }
});

test("project seed patch persists and reloads explicit mappings", async () => {
  await writeProjectSeedPatchFile(projectId, patch);

  const loaded = await readProjectSeedPatchFile(projectId);

  assert.ok(loaded);
  assert.equal(loaded?.arenaClusters[0]?.id, "rim_hunt");
  assert.equal(loaded?.explicitMappings?.arenaHints["断崖深处的骨壁通道"], "living_rule");
});

test("resolveSegmentRuntimeMetadata prefers project patch mappings over legacy hint inference", () => {
  const item = {
    id: "segment-item-14",
    chapterNo: 14,
    title: "旧推进位",
    intent: "让纪渊拿到线索并继续往里压。",
    requiredProgressDeltas: ["information_shift"],
    requiredObligations: [],
    focusCharacters: ["纪渊"],
    arenaHints: ["断崖深处的骨壁通道"],
    suggestedActionPattern: "investigation",
    antagonistHint: "巡山罴影",
    forbiddenRecentAxes: [],
  } satisfies SegmentPlanItem;

  const resolved = resolveSegmentRuntimeMetadata({
    item,
    patch,
    storyContract: {
      arenaClusters: [],
      opponentClusters: [],
      rewardTypes: [],
      relationshipProgressions: [],
    } as unknown as StoryContract,
  });

  assert.equal(resolved.arenaClusterId, "living_rule");
  assert.equal(resolved.opponentClusterId, "hunters");
  assert.equal(resolved.rewardType, "clue");
});

test("buildPlannerAvoidanceDirectives emits hard and soft avoidance using patched cluster labels", () => {
  const progressState: StoryProgressState = {
    latestChapter: 16,
    recentPrimaryDeltas: ["information_shift", "objective_shift"],
    recentArenaKeys: ["断崖深处的骨壁通道", "断崖深处的骨壁通道"],
    recentObjectiveKeys: ["保命脱困", "保命脱困"],
    stuckDimensions: ["arena_loop", "objective_loop", "antagonist_loop"],
    mustAdvance: ["world_shift", "information_shift", "objective_shift"],
    recentAntagonistKeys: ["巡山罴影", "巡山罴影"],
    recentActionPatterns: ["pursuit", "pursuit"],
    recentEndingMoves: [],
    recentMechanismRevealModes: [],
    recentMotifWindows: [["骨壁", "残印"], ["骨壁", "残印"]],
    consumedFutureBeats: [],
    updatedAt: "2026-03-26T00:00:00.000Z",
  };

  const directives = buildPlannerAvoidanceDirectives({
    progressState,
    patch,
    recentDeltaRecords: [],
  });

  assert.equal(directives.hardAvoid.some((line) => line.includes("活山规则层")), true);
  assert.equal(directives.hardAvoid.some((line) => line.includes("追猎者")), true);
  assert.equal(directives.softAvoid.some((line) => line.includes("骨壁")), true);
});
