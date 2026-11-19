import test from "node:test";
import assert from "node:assert/strict";

import { buildVoiceBrief } from "./content/voice-engine.ts";
import { buildReviewRepairPlan, deriveVoicePolishIssues } from "./content/review-repair.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";
import type { SceneCard, VoicePack } from "./content/types.ts";
import type { DeepReviewVerdict } from "./types.ts";

function createSceneCards(): SceneCard[] {
  return [
    {
      id: "scene-1",
      label: "Scene 1",
      objective: "上一章结束后主角又开始重复回顾局势。",
      obstacle: "同一批追兵反复出现。",
      irreversibleChange: "站位改变。",
      hookType: "position_shift",
      requiredAnchors: ["追兵", "山道"],
    },
    {
      id: "scene-2",
      label: "Scene 2",
      objective: "继续围绕同一批追兵逃窜。",
      obstacle: "同一批追兵反复出现。",
      irreversibleChange: "情绪收束。",
      hookType: "explicit_summary",
      requiredAnchors: ["追兵", "山道"],
    },
  ];
}

function createVoicePack(): VoicePack {
  const styleProfile = createDefaultStyleProfile();
  styleProfile.referenceAnchor.primary = "贴身动作";
  styleProfile.paragraphCadence.narrativeRule = "段落短中交替。";
  styleProfile.sentenceRhythm.pacingRule = "快处更短，转折时留停顿。";
  styleProfile.narrativeDistance.intimacyRule = "贴着身体反馈。";
  return {
    projectId: "proj-review",
    projectVoiceSnapshot: null,
    styleProfile,
    writingCharter: null,
    styleDigest: "本章声线：身体反馈先行、风险压住解释。",
    styleExemplars: [],
    positiveAnchors: ["身体反馈先行", "风险压住解释"],
    antiPatterns: ["不要先总结再动作"],
    externalAnchors: ["贴身动作"],
  };
}

function createReview(overrides?: Partial<DeepReviewVerdict>): DeepReviewVerdict {
  return {
    reviewMode: "deep",
    verdict: "rewrite_current",
    confidence: 0.72,
    reason: "需要返修。",
    fixInstructions: "先解决 reviewer 指出的核心问题。",
    issues: [],
    triggerReasons: ["cadence"],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: {
      score: 0.8,
      risk: "pass",
      summary: "推进正常。",
      advancements: [],
      stallSignals: [],
      primaryDelta: null,
      deliveredDeltas: [],
    },
    genreFulfillment: null,
    loopRisk: {
      score: 0.8,
      risk: "pass",
      summary: "循环风险可控。",
      repetitionAxes: [],
      stuckDimensions: [],
    },
    primaryDeltaDelivered: null,
    stuckDimensions: [],
    windowStartChapter: 1,
    windowEndChapter: 1,
    earliestAffectedChapter: 1,
    ...overrides,
  };
}

test("buildReviewRepairPlan routes structure failures into scene rescue instructions", () => {
  const voiceBrief = buildVoiceBrief({
    voicePack: createVoicePack(),
    chapterNo: 4,
    sceneCards: createSceneCards(),
  });

  const repair = buildReviewRepairPlan({
    chapterContent: "上一章里他已经逃过一次，这一章又从回顾开始。",
    review: createReview({
      issues: [{ type: "structure_break", location: "opening", severity: "major" }],
    }),
    sceneCards: createSceneCards(),
    voiceBrief,
  });

  assert.equal(repair.repairPath, "scene_rescue");
  assert.match(repair.fixInstructions, /删\/压 recap 开头/);
  assert.match(repair.fixInstructions, /补一处因果转折/);
});

test("buildReviewRepairPlan routes prose-only fixes into voice polish instructions", () => {
  const voiceBrief = buildVoiceBrief({
    voicePack: createVoicePack(),
    chapterNo: 4,
    sceneCards: createSceneCards(),
  });

  const repair = buildReviewRepairPlan({
    chapterContent: "总结来说，他先说明局势，然后再去动手。",
    review: createReview({
      styleChecklistHits: [{ dimension: "opening", description: "总结先行", severity: "major" }],
    }),
    sceneCards: createSceneCards(),
    voiceBrief,
  });

  assert.equal(repair.repairPath, "voice_polish");
  assert.equal(repair.voicePolishIssues.includes("summary_first"), true);
  assert.match(repair.fixInstructions, /身体反馈/);
});

test("deriveVoicePolishIssues detects summary-first and explanation-heavy openings", () => {
  const issues = deriveVoicePolishIssues("总结来说，他先解释局势，这意味着所有人都慢了一步。");
  assert.deepEqual(issues, ["summary_first", "explanation_heavy"]);
});
