import test from "node:test";
import assert from "node:assert/strict";

import { rewriteSceneStructure } from "./content/scene-rescue.ts";

test("scene rescue merges repeated scenes and strengthens ending hook without changing anchors", () => {
  const result = rewriteSceneStructure({
    chapterContent: "上一章里姜离如何逃命。\n\n姜离继续在断骨山谷里逃。\n\n姜离继续在断骨山谷里逃。",
    sceneCards: [
      {
        id: "scene-1",
        label: "Scene 1",
        objective: "复述上一章逃亡。",
        obstacle: "旧追迹者继续追。",
        irreversibleChange: "姜离还在原地。",
        hookType: "emotional_close",
        requiredAnchors: ["断骨山谷", "姜离"],
      },
      {
        id: "scene-2",
        label: "Scene 2",
        objective: "继续在断骨山谷里逃。",
        obstacle: "旧追迹者继续追。",
        irreversibleChange: "仍旧没有新变化。",
        hookType: "emotional_close",
        requiredAnchors: ["断骨山谷", "姜离"],
      },
    ],
  });

  assert.equal(result.sceneCards.length, 1);
  assert.equal(result.appliedFixes.includes("compress_recap_opening"), true);
  assert.equal(result.appliedFixes.includes("merge_repeated_scene"), true);
  assert.equal(result.sceneCards[0]?.hookType, "new_risk");
  assert.equal(result.sceneCards[0]?.requiredAnchors.includes("断骨山谷"), true);
  assert.match(result.rewriteInstructions.join("\n"), /因果转折/);
});
