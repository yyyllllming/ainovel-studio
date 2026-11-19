import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";

import { ensureProjectLayout, writeReviewFile } from "./project-files.ts";
import type { LocalFlavorSignals, PlannerQualitySummary, QuickAuditVerdict } from "./types.ts";

test("writeReviewFile writes a top-level review artifact with plannerQuality and localFlavorSignals", async () => {
  const projectId = `review-artifact-${Date.now()}`;
  try {
    await ensureProjectLayout(projectId);

    const localFlavorSignals: LocalFlavorSignals = {
      severity: "warn",
      score: 3,
      notes: ["解释补句偏直"],
      warnings: ["“不是……而是……”开始重复（2 处）"],
      momentMarkerCount: 2,
      explanationLeadCount: 1,
      judgmentLeadCount: 1,
      phraseReuseHits: [{ phrase: "偏偏", count: 3 }],
      pronounLeadCount: 2,
      pronounLeadRatio: 0.12,
      simileCount: 1,
      contrastTemplateCount: 2,
      abruptTurnCount: 1,
      repeatedSentenceStarts: [{ lead: "纪渊", count: 3 }],
      dominantLead: { lead: "纪渊", count: 3 },
      sentenceCount: 16,
    };
    const plannerQuality: PlannerQualitySummary = {
      candidateAttempts: 3,
      selectedScore: 5,
      selectedReason: "candidate=2 / score=5",
      repairUsed: false,
      fallbackUsed: false,
      failureReasons: ["sceneGoal 太泛"],
    };
    const review: QuickAuditVerdict = {
      reviewMode: "quick",
      verdict: "escalate",
      confidence: 0.61,
      reason: "极简检查发现明显 AI 腔与结构风险，需升级深审。",
      fixInstructions: "请继续压 prose 模板味。",
      issues: [{ type: "style_drift", location: "正文文笔", severity: "major" }],
      triggerReasons: ["low_confidence"],
      styleChecklistHits: [],
      charterViolations: [],
      storyProgression: {
        risk: "watch",
        score: 62,
        summary: "推进存在但仍偏弱。",
        advancements: ["进入新地带"],
        stallSignals: [],
        primaryDelta: "situation_shift",
        deliveredDeltas: ["situation_shift"],
      },
      genreFulfillment: null,
      loopRisk: {
        risk: "watch",
        score: 57,
        summary: "同一目标轴仍有回钉。",
        repetitionAxes: ["same_objective"],
        stuckDimensions: ["objective_loop"],
      },
      primaryDeltaDelivered: "situation_shift",
      stuckDimensions: ["objective_loop"],
      localFlavorSignals,
    };

    const lineage = {
      submissionId: "submission-1",
      versionId: null,
      contentHash: "a".repeat(64),
      reviewerProfileId: "reviewer-profile",
      promptHash: "b".repeat(64),
      reviewSchemaVersion: "author-submission-v1",
      windowContentHash: null,
    };
    const originalNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    let filePath: string;
    let secondFilePath: string;
    try {
      filePath = await writeReviewFile({
        projectId,
        chapterNo: 1,
        review,
        plannerQuality,
        plannerTracePath: `D:/ainote/ainovel-cli/platform/projects/${projectId}/blueprints/traces/chapter_001_planner_trace.json`,
        lineage,
      });
      secondFilePath = await writeReviewFile({
        projectId,
        chapterNo: 1,
        review,
        plannerQuality,
        lineage: { ...lineage, promptHash: "c".repeat(64) },
      });
    } finally {
      Date.now = originalNow;
    }
    assert.notEqual(filePath, secondFilePath);

    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(saved.reviewMode, "quick");
    assert.equal(saved.plannerQuality.selectedScore, 5);
    assert.equal(saved.plannerTracePath.includes("chapter_001_planner_trace.json"), true);
    assert.equal(saved.localFlavorSignals.severity, "warn");
    assert.equal(saved.localFlavorSignals.contrastTemplateCount, 2);
    assert.equal(saved.submissionId, "submission-1");
    assert.equal(saved.versionId, null);
    assert.equal(saved.contentHash, "a".repeat(64));
    assert.equal(saved.reviewerProfileId, "reviewer-profile");
    assert.equal(saved.promptHash, "b".repeat(64));
    assert.equal(saved.reviewSchemaVersion, "author-submission-v1");
    assert.equal(saved.windowContentHash, null);
    assert.ok(saved.recordedAt);
  } finally {
    await rm(`d:/ainote/ainovel-cli/platform/projects/${projectId}`, { recursive: true, force: true });
  }
});
