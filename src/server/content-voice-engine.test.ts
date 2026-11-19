import test from "node:test";
import assert from "node:assert/strict";

import { buildVoicePack } from "./content/voice-pack.ts";
import { buildVoiceBrief, polishVoice, scoreVoice } from "./content/voice-engine.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";
import type { ActiveStylePackage, StyleExcerpt } from "./types.ts";

function createExcerpt(id: string, content: string): StyleExcerpt {
  return {
    id,
    sourceId: `${id}-source`,
    sourceTitle: "source",
    label: id,
    tags: ["narrative"],
    content,
    wordCount: content.length,
    startOffset: 0,
    endOffset: content.length,
    positionRatio: 0.1,
    dialogueRatio: 0.1,
  };
}

function createActiveStyle(): ActiveStylePackage {
  return {
    styleSnapshotId: "style-snapshot-1",
    styleSnapshotVersion: 1,
    styleCard: "低饱和压迫、动作贴身、章末留钩。",
    styleProfile: createDefaultStyleProfile(),
    styleDigest: "外部风格摘要：动作贴身，压住解释，章末只留一个钩子。",
    styleExemplars: [createExcerpt("style-ex-1", "他贴着石壁换气，先听风里有没有第二道脚步。")],
    confidence: "high",
    sampledExcerpts: [],
    sourceIds: ["style-source-1"],
  };
}

test("voice engine prioritizes project voice snapshot over external anchors", () => {
  const voicePack = buildVoicePack({
    projectId: "proj-voice",
    activeStyle: createActiveStyle(),
    projectVoiceSnapshot: {
      id: "project-voice-v001",
      version: 1,
      updatedAt: "2026-04-01T00:00:00.000Z",
      sourceChapterNos: [1, 2, 3],
      digest: "本书声线：先落身体反馈，再压出风险，句子短中交替。",
      positiveAnchors: ["身体反馈先行", "风险压住解释", "章末只留一个后患"],
      antiPatterns: ["不要先总结再动作"],
      exemplars: [createExcerpt("project-ex-1", "姜离先听见石壁里那一下闷响，才敢把手背贴上去。")],
    },
  });

  const brief = buildVoiceBrief({
    voicePack,
    chapterNo: 4,
    sceneCards: [
      {
        id: "scene-1",
        label: "Scene 1",
        objective: "贴近石壁回响摸线索。",
        obstacle: "一伸手就会暴露。",
        irreversibleChange: "留下新的热痕。",
        hookType: "new_risk",
        requiredAnchors: ["石壁回响"],
      },
    ],
  });

  assert.equal(brief.positiveAnchors[0], "身体反馈先行");
  assert.equal(brief.exemplarSource, "project_voice_snapshot");
  assert.match(brief.summary, /本书声线/);
});

test("voice engine scores content and applies targeted polish", () => {
  const voicePack = buildVoicePack({
    projectId: "proj-voice",
    activeStyle: createActiveStyle(),
    projectVoiceSnapshot: {
      id: "project-voice-v001",
      version: 1,
      updatedAt: "2026-04-01T00:00:00.000Z",
      sourceChapterNos: [1],
      digest: "本书声线：身体反馈先行，风险压住解释。",
      positiveAnchors: ["身体反馈先行", "风险压住解释"],
      antiPatterns: ["不要先总结再动作"],
      exemplars: [createExcerpt("project-ex-1", "他先按住伤口，才去辨认风里那点热意。")],
    },
  });

  const score = scoreVoice({
    content: "姜离先按住伤口，再去听石壁里的热响，没急着解释那是什么。",
    voicePack,
  });
  assert.equal(score.score > 0.65, true);
  assert.equal(score.consistency !== "weak", true);

  const polished = polishVoice({
    content: "总结来说，他立刻明白了那是什么，然后才伸手。",
    voiceBrief: buildVoiceBrief({ voicePack, chapterNo: 4, sceneCards: [] }),
    issues: ["summary_first"],
  });
  assert.doesNotMatch(polished.content, /总结来说/);
  assert.equal(polished.appliedFixes.includes("summary_first"), true);
});
