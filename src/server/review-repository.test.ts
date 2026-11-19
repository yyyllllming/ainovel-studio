import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { rawDb } from "./db/client.ts";
import { computeChapterContentHash, computeReviewWindowContentHash, ensureProjectLayout, writeFinalChapter } from "./project-files.ts";
import {
  getLatestReview,
  listReviewReports,
  saveReviewReport,
} from "./repositories/review.repository.ts";
import { persistCrossChapterIssues } from "./run/chapter-shared.ts";
import type { QuickAuditVerdict, ReviewLineage, ReviewVerdict } from "./types.ts";
import { listCurrentRecentReviews } from "./services/project.service.ts";
import { listCurrentReviewReports } from "./services/review-content-identity.service.ts";

function buildVerdict(): QuickAuditVerdict {
  return {
    reviewMode: "quick",
    verdict: "pass",
    confidence: 0.91,
    reason: "当前正文通过检查。",
    fixInstructions: "",
    issues: [],
    triggerReasons: [],
    styleChecklistHits: [],
    charterViolations: [],
    storyProgression: {
      risk: "pass",
      score: 91,
      summary: "推进明确。",
      advancements: ["线索前移"],
      stallSignals: [],
      primaryDelta: "information_shift",
      deliveredDeltas: ["information_shift"],
    },
    genreFulfillment: null,
    loopRisk: {
      risk: "pass",
      score: 92,
      summary: "无循环。",
      repetitionAxes: [],
      stuckDimensions: [],
    },
    primaryDeltaDelivered: "information_shift",
    stuckDimensions: [],
  };
}

test("review reports persist exact lineage and become stale for another content hash", () => {
  const projectId = `review-lineage-${Date.now()}`;
  const lineage: ReviewLineage = {
    submissionId: "submission-1",
    versionId: null,
    contentHash: "a".repeat(64),
    reviewerProfileId: "reviewer-profile",
    promptHash: "b".repeat(64),
    reviewSchemaVersion: "author-submission-v1",
    windowContentHash: null,
  };

  try {
    rawDb.prepare(
      `INSERT INTO chapter_submissions (
        id, project_id, chapter_no, title, source, content_path,
        content_hash, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      lineage.submissionId,
      projectId,
      1,
      "第一章",
      "human",
      "author-submissions/chapter-1.md",
      lineage.contentHash,
      "draft",
      "2026-07-12T00:00:00.000Z",
      "2026-07-12T00:00:00.000Z",
    );
    const reportId = saveReviewReport(
      projectId,
      1,
      buildVerdict(),
      "reviews/chapter_001_review.json",
      null,
      lineage,
    );
    assert.equal(typeof reportId, "string");
    assert.ok(reportId.length > 0);

    const current = listReviewReports(projectId, 1, { currentContentHash: lineage.contentHash });
    assert.equal(current.length, 1);
    assert.equal(current[0]?.id, reportId);
    assert.equal(current[0]?.submissionId, lineage.submissionId);
    assert.equal(current[0]?.versionId, null);
    assert.equal(current[0]?.contentHash, lineage.contentHash);
    assert.equal(current[0]?.reviewerProfileId, lineage.reviewerProfileId);
    assert.equal(current[0]?.promptHash, lineage.promptHash);
    assert.equal(current[0]?.reviewSchemaVersion, lineage.reviewSchemaVersion);
    assert.equal(current[0]?.stale, false);

    const changed = listReviewReports(projectId, 1, { currentContentHash: "c".repeat(64) });
    assert.equal(changed[0]?.stale, true);
    assert.equal(getLatestReview(projectId, 1, { currentContentHash: "c".repeat(64) }), null);

    const newerStaleId = saveReviewReport(
      projectId,
      1,
      buildVerdict(),
      "reviews/newer-stale.json",
      null,
      { ...lineage, submissionId: null, contentHash: "c".repeat(64), promptHash: "d".repeat(64) },
    );
    rawDb.prepare("UPDATE review_reports SET created_at = ? WHERE project_id = ?")
      .run("2026-07-12T00:00:00.000Z", projectId);
    const sameMillisecond = listReviewReports(projectId, 1, { currentContentHash: lineage.contentHash });
    assert.equal(sameMillisecond[0]?.id, newerStaleId);
    assert.equal(sameMillisecond[0]?.stale, true);
    assert.equal(getLatestReview(projectId, 1, { currentContentHash: lineage.contentHash })?.id, reportId);
  } finally {
    rawDb.prepare("DELETE FROM review_reports WHERE project_id = ?").run(projectId);
    rawDb.prepare("DELETE FROM chapter_submissions WHERE project_id = ?").run(projectId);
  }
});

test("deep reports become stale when any chapter in the review window changes", async () => {
  const projectId = `deep-window-lineage-${Date.now()}`;
  const chapter1 = "窗口第一章。";
  const chapter2 = "窗口第二章。";
  const deep: ReviewVerdict = {
    ...buildVerdict(),
    reviewMode: "deep",
    verdict: "pass",
    windowStartChapter: 1,
    windowEndChapter: 2,
    earliestAffectedChapter: null,
  };
  try {
    await ensureProjectLayout(projectId);
    await writeFinalChapter(projectId, 1, chapter1);
    await writeFinalChapter(projectId, 2, chapter2);
    saveReviewReport(projectId, 2, deep, "reviews/deep.json", null, {
      submissionId: null,
      versionId: null,
      contentHash: computeChapterContentHash(chapter2),
      reviewerProfileId: "reviewer-profile",
      promptHash: "e".repeat(64),
      reviewSchemaVersion: "deep-review-v1",
      windowContentHash: computeReviewWindowContentHash([
        { chapterNo: 1, content: chapter1 },
        { chapterNo: 2, content: chapter2 },
      ]),
    });

    const current = await listCurrentReviewReports(projectId, 2);
    assert.equal(current[0]?.stale, false);

    await writeFinalChapter(projectId, 1, "被修订的窗口第一章。");
    const changed = await listCurrentReviewReports(projectId, 2);
    assert.equal(changed[0]?.stale, true);
  } finally {
    rawDb.prepare("DELETE FROM review_reports WHERE project_id = ?").run(projectId);
    await rm(`d:/ainote/ainovel-cli/platform/projects/${projectId}`, { recursive: true, force: true });
  }
});

test("project recent reviews exclude stale content identities", async () => {
  const projectId = `project-review-lineage-${Date.now()}`;
  const content = "当前正式正文。";
  try {
    await ensureProjectLayout(projectId);
    await writeFinalChapter(projectId, 1, content);
    saveReviewReport(projectId, 1, buildVerdict(), "reviews/current.json", null, {
      submissionId: null,
      versionId: null,
      contentHash: computeChapterContentHash(content),
      reviewerProfileId: "reviewer-profile",
      promptHash: "b".repeat(64),
      reviewSchemaVersion: "quick-audit-v1",
      windowContentHash: null,
    });
    saveReviewReport(projectId, 1, buildVerdict(), "reviews/stale.json", null, {
      submissionId: null,
      versionId: null,
      contentHash: "c".repeat(64),
      reviewerProfileId: "reviewer-profile",
      promptHash: "d".repeat(64),
      reviewSchemaVersion: "quick-audit-v1",
      windowContentHash: null,
    });

    const recent = await listCurrentRecentReviews(projectId);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.contentHash, computeChapterContentHash(content));
    assert.equal(recent[0]?.stale, false);
  } finally {
    rawDb.prepare("DELETE FROM review_reports WHERE project_id = ?").run(projectId);
    await rm(`d:/ainote/ainovel-cli/platform/projects/${projectId}`, { recursive: true, force: true });
  }
});

test("review reports keep cross-chapter evidence after save and list projection", () => {
  const projectId = `review-evidence-${Date.now()}`;
  const issues = persistCrossChapterIssues([
    {
      type: "character_reentry_without_bridge",
      location: "章首",
      severity: "major",
      evidence: "沈檀 未经出场动作直接进入当前场景",
    },
  ]);
  try {
    saveReviewReport(
      projectId,
      1,
      {
        ...buildVerdict(),
        verdict: "escalate",
        issues,
      },
      "reviews/evidence.json",
      null,
      {
        submissionId: null,
        versionId: null,
        contentHash: "a".repeat(64),
        reviewerProfileId: "reviewer-profile",
        promptHash: "b".repeat(64),
        reviewSchemaVersion: "quick-audit-v1",
        windowContentHash: null,
      },
    );
    const listed = listReviewReports(projectId, 1);
    assert.equal(listed[0]?.issues[0]?.type, "character_reentry_without_bridge");
    assert.equal(listed[0]?.issues[0]?.location, "章首");
    assert.equal(listed[0]?.issues[0]?.evidence, "沈檀 未经出场动作直接进入当前场景");
  } finally {
    rawDb.prepare("DELETE FROM review_reports WHERE project_id = ?").run(projectId);
  }
});
