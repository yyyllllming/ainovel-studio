import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { createProject } from "./repositories/project.repository.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { rawDb } from "./db/client.ts";
import { projectDir } from "./paths.ts";
import { createChapterPlanRepository } from "./repositories/chapter-plan.repository.ts";
import { upsertFoundationWorkshopState } from "./repositories/foundation.repository.ts";
import { writePlannerTraceFile } from "./project-files.ts";
import { listProjectDegradedArtifacts } from "./services/degradation-diagnostics.service.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

test("listProjectDegradedArtifacts reports degraded chapter plans, recovery blueprints, and ai fallback style references", async () => {
  const project = createProject({
    title: "Degradation Diagnostics",
    genre: "玄幻",
    style: "default",
    seriesMode: "standalone",
    storyLength: "long",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 12,
    premise: "一名背债修士在万灵世界里求生。",
    assignments: [
      { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
      { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
      { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
      { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
    ],
  });

  const projectId = project?.id;
  assert.equal(Boolean(projectId), true);

  try {
    createChapterPlanRepository().upsertReady({
      projectId: projectId!,
      chapterNo: 3,
      purpose: "用降级骨架先托住主线。",
      plotSummary: "本章仍在使用降级骨架推进主线。",
      requiredBeats: ["承接旧线索", "推一格主线", "留下单钩子"],
      keyEvents: ["遭遇阻力", "代价升级"],
      characterFocus: ["陆渊"],
      relationshipShift: "",
      worldRuleUsage: ["山海经万灵"],
      continuationAnchor: "陆渊带着新债继续上路。",
      nextHook: "白泽的名字第一次被提起。",
      hookSlots: [{
        setupText: "白泽的名字第一次被提起。",
        payoffWindow: [4, 6],
        priority: "medium",
        planIntent: "active",
      }],
      payoffTargets: ["后续兑现白泽线索"],
      riskFlags: ["hook_debt"],
      riskComment: "后续应升级成完整 ChapterPlan。",
      status: "ready",
      source: "degraded_backfill",
      foundationDigest: "foundation-digest",
      storyContractDigest: "story-digest",
      inputDigest: "input-digest",
      generationId: 1,
      generationState: "ready",
      generationToken: null,
      generationStartedAt: null,
      usedSegmentSummaryFallback: true,
      segmentId: "segment-1",
      segmentItemId: "segment-item-3",
    });

    await writePlannerTraceFile(projectId!, 3, {
      chapterNo: 3,
      plannerContextSummary: "summary",
      futureContext: "future",
      promptSummaries: ["attempt=1"],
      candidateAttempts: [],
      selectedCandidateIndex: null,
      selectedReason: "recovery blueprint",
      selectedScore: 3,
      repairUsed: false,
      repairRawContent: null,
      repairCandidate: null,
      repairVerification: null,
      repairError: null,
      fallbackUsed: true,
      fallbackReason: "planner failed verification",
      usedRecoveryBlueprint: true,
      recoveryShifts: ["consume:segment-item-4"],
      finalBlueprint: null,
      plannerQuality: null,
      recordedAt: "2026-04-12T00:00:00.000Z",
    });

    upsertFoundationWorkshopState(projectId!, {
      premise: "一名背债修士在万灵世界里求生。",
      mainline: "陆渊剥纹还债，试图问白泽。",
      storyHook: "灵债在第一章立刻反噬。",
      desiredTone: "default",
      characterIdeas: [],
      worldviewIdeas: [],
      relationshipIdeas: [],
      unresolvedQuestions: [],
      styleReferences: [{
        kind: "book",
        label: "风格参考 A",
        author: "匿名",
        source: "ai_fallback",
        relation: "primary",
      }],
      styleSamples: [],
      styleManualGuidance: "",
      styleAvoidances: "",
      styleSteeringCard: "",
      styleProfile: buildFallbackStyleProfile({
        references: [],
        draft: {
          mainline: "陆渊剥纹还债，试图问白泽。",
          desiredTone: "default",
          storyHook: "灵债在第一章立刻反噬。",
        },
      }),
      styleDigest: "",
      styleExemplars: [],
      styleSnapshotId: null,
      styleSnapshotVersion: null,
    }, false);

    const artifacts = await listProjectDegradedArtifacts(projectId!);
    assert.deepEqual(
      artifacts.map((item) => item.kind).sort(),
      ["chapter_plan_degraded_backfill", "blueprint_recovery", "foundation_style_ai_fallback"].sort(),
    );
    assert.equal(artifacts.find((item) => item.kind === "chapter_plan_degraded_backfill")?.chapterNo, 3);
    assert.equal(artifacts.find((item) => item.kind === "blueprint_recovery")?.source, "recovery_blueprint");
    assert.match(artifacts.find((item) => item.kind === "foundation_style_ai_fallback")?.message ?? "", /AI fallback 风格参考/);
  } finally {
    cleanupProject(projectId!);
    await rm(projectDir(projectId!), { recursive: true, force: true });
  }
});
