import test from "node:test";
import assert from "node:assert/strict";
import { createFoundationGenerateService } from "./services/foundation-generate.service.ts";
import { createBlueprintGenerateService } from "./services/blueprint-generate.service.ts";
import { createChapterVersionGenerateService } from "./services/chapter-version-generate.service.ts";
import { createChapterRangeDeleteService } from "./services/chapter-range-delete.service.ts";
import { createChapterOptimizeService } from "./services/chapter-optimize.service.ts";

test("foundation generate service forwards projectId and preserves the legacy response shape", async () => {
  const calls: string[] = [];
  const foundation = { premise: "seed premise" };
  const service = createFoundationGenerateService({
    async ensureFoundationGenerated(projectId) {
      calls.push(projectId);
      return foundation;
    },
  });

  assert.equal(await service.ensureFoundationGenerated("proj-foundation"), foundation);
  assert.deepEqual(calls, ["proj-foundation"]);
});

test("blueprint generate service forwards chapter coordinates and returns the legacy blueprint", async () => {
  const calls: Array<{ projectId: string; chapterNo: number }> = [];
  const blueprint = { chapterNo: 3, sceneGoal: "push the plot" };
  const service = createBlueprintGenerateService({
    async ensureBlueprintGenerated(projectId, chapterNo) {
      calls.push({ projectId, chapterNo });
      return blueprint;
    },
  });

  assert.equal(await service.ensureBlueprintGenerated("proj-blueprint", 3), blueprint);
  assert.deepEqual(calls, [{ projectId: "proj-blueprint", chapterNo: 3 }]);
});

test("chapter version generate service keeps the multi-version result contract intact", async () => {
  const calls: Array<{ projectId: string; chapterNo: number }> = [];
  const versions = [{ id: "version-1", versionNo: 1 }];
  const service = createChapterVersionGenerateService({
    async generateVersionsForChapter(projectId, chapterNo) {
      calls.push({ projectId, chapterNo });
      return versions;
    },
  });

  assert.equal(await service.generateVersionsForChapter("proj-versions", 5), versions);
  assert.deepEqual(calls, [{ projectId: "proj-versions", chapterNo: 5 }]);
});

test("chapter range delete service forwards the requested deletion window", async () => {
  const calls: Array<{ projectId: string; startChapter: number; endChapter: number }> = [];
  const progress = { currentChapter: 4, stage: "paused" };
  const service = createChapterRangeDeleteService({
    async deleteChapterRange(projectId, input) {
      calls.push({ projectId, ...input });
      return progress;
    },
  });

  assert.equal(
    await service.deleteChapterRange("proj-delete", {
      startChapter: 2,
      endChapter: 4,
    }),
    progress,
  );
  assert.deepEqual(calls, [{ projectId: "proj-delete", startChapter: 2, endChapter: 4 }]);
});

test("chapter optimize service keeps selection payloads intact for the legacy optimizer", async () => {
  const calls: Array<{
    projectId: string;
    chapterNo: number;
    selection: { start: number; end: number };
    action: string;
  }> = [];
  const result = { patchId: "patch-1", preview: "preview text" };
  const service = createChapterOptimizeService({
    async optimizeChapterSelection(input) {
      calls.push(input);
      return result;
    },
  });

  assert.equal(
    await service.optimizeChapterSelection({
      projectId: "proj-optimize",
      chapterNo: 6,
      selection: { start: 12, end: 42 },
      action: "rewrite",
    }),
    result,
  );
  assert.deepEqual(calls, [
    {
      projectId: "proj-optimize",
      chapterNo: 6,
      selection: { start: 12, end: 42 },
      action: "rewrite",
    },
  ]);
});
