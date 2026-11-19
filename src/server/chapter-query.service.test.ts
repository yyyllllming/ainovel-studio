import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { rawDb } from "./db/client.ts";
import { computeChapterContentHash, ensureProjectLayout, writeFinalChapter } from "./project-files.ts";
import { saveReviewReport } from "./repositories/review.repository.ts";
import { listProjectChapterReviews } from "./services/chapter-query.service.ts";
import type { QuickAuditVerdict } from "./types.ts";

const verdict: QuickAuditVerdict = {
  reviewMode: "quick",
  verdict: "pass",
  confidence: 0.9,
  reason: "当前正文通过。",
  fixInstructions: "",
  issues: [],
  triggerReasons: [],
  styleChecklistHits: [],
  charterViolations: [],
  storyProgression: {
    risk: "pass",
    score: 90,
    summary: "推进明确。",
    advancements: ["线索前移"],
    stallSignals: [],
    primaryDelta: "information_shift",
    deliveredDeltas: ["information_shift"],
  },
  genreFulfillment: null,
  loopRisk: {
    risk: "pass",
    score: 90,
    summary: "无循环。",
    repetitionAxes: [],
    stuckDimensions: [],
  },
  primaryDeltaDelivered: "information_shift",
  stuckDimensions: [],
};

test("chapter review query marks reports stale when the persisted chapter changes", async () => {
  const projectId = `chapter-query-lineage-${Date.now()}`;
  const content = "第一版正文。\n";
  try {
    await ensureProjectLayout(projectId);
    await writeFinalChapter(projectId, 1, content);
    saveReviewReport(projectId, 1, verdict, "reviews/chapter_001_review.json", null, {
      submissionId: null,
      versionId: null,
      contentHash: computeChapterContentHash(content.trimEnd()),
      reviewerProfileId: "reviewer-profile",
      promptHash: "b".repeat(64),
      reviewSchemaVersion: "quick-audit-v1",
      windowContentHash: null,
    });

    const current = await listProjectChapterReviews(projectId, 1);
    assert.equal(current[0]?.stale, false);

    await writeFinalChapter(projectId, 1, "第二版正文。\n");
    const changed = await listProjectChapterReviews(projectId, 1);
    assert.equal(changed[0]?.stale, true);
  } finally {
    rawDb.prepare("DELETE FROM review_reports WHERE project_id = ?").run(projectId);
    await rm(`d:/ainote/ainovel-cli/platform/projects/${projectId}`, { recursive: true, force: true });
  }
});
