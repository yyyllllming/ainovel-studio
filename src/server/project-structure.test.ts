import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProjectStructureInput } from "./domain/project-structure.ts";

test("normalizeProjectStructureInput keeps legacy chapter-only payloads in fixed mode", () => {
  const normalized = normalizeProjectStructureInput({
    seriesMode: "standalone",
    storyLength: "long",
    targetChapters: 12,
  });

  assert.equal(normalized.narrativePerson, "third");
  assert.equal(normalized.chapterPlanningMode, "fixed");
  assert.equal(normalized.targetChapters, 12);
  assert.equal(normalized.chapterBudgetMin, 12);
  assert.equal(normalized.chapterBudgetTarget, 12);
  assert.equal(normalized.chapterBudgetMax, 12);
  assert.equal(normalized.hardChapterCap, 12);
});

test("normalizeProjectStructureInput derives dynamic chapter budgets from volumes and pace", () => {
  const normalized = normalizeProjectStructureInput({
    seriesMode: "standalone",
    storyLength: "long",
    chapterPlanningMode: "dynamic",
    plannedVolumes: 2,
    paceProfile: "slow",
    completionCriteria: "主线闭环、关键伏笔回收、男女主关系落点明确",
  });

  assert.equal(normalized.chapterPlanningMode, "dynamic");
  assert.equal(normalized.plannedVolumes, 2);
  assert.equal(normalized.chapterBudgetMin, 18);
  assert.equal(normalized.chapterBudgetTarget, 26);
  assert.equal(normalized.chapterBudgetMax, 36);
  assert.equal(normalized.hardChapterCap, 36);
  assert.equal(normalized.targetChapters, 36);
});

test("normalizeProjectStructureInput clamps dynamic targets to explicit hard caps", () => {
  const normalized = normalizeProjectStructureInput({
    seriesMode: "standalone",
    storyLength: "medium",
    chapterPlanningMode: "dynamic",
    plannedVolumes: 2,
    paceProfile: "medium",
    hardChapterCap: 10,
    completionCriteria: "主线结束",
  });

  assert.equal(normalized.chapterPlanningMode, "dynamic");
  assert.equal(normalized.chapterBudgetMin, 8);
  assert.equal(normalized.chapterBudgetTarget, 10);
  assert.equal(normalized.chapterBudgetMax, 10);
  assert.equal(normalized.hardChapterCap, 10);
  assert.equal(normalized.targetChapters, 10);
});

test("normalizeProjectStructureInput keeps short stories in single-unit compatibility mode", () => {
  const normalized = normalizeProjectStructureInput({
    seriesMode: "standalone",
    storyLength: "short",
    narrativePerson: "first",
    chapterPlanningMode: "dynamic",
    plannedVolumes: 3,
    paceProfile: "slow",
    completionCriteria: "短篇冲突一次闭环",
  });

  assert.equal(normalized.narrativePerson, "first");
  assert.equal(normalized.chapterPlanningMode, "fixed");
  assert.equal(normalized.targetChapters, 1);
  assert.equal(normalized.chapterBudgetTarget, 1);
  assert.equal(normalized.hardChapterCap, 1);
});
