import test from "node:test";
import assert from "node:assert/strict";
import { prepareChapterPrerequisites } from "./chapter-prerequisites.ts";

test("prepareChapterPrerequisites enforces artifact -> blueprint -> context ordering", async () => {
  const calls: string[] = [];
  const context = { conflicts: [] };
  const result = await prepareChapterPrerequisites(
    {
      projectId: "project-1",
      chapterNo: 12,
      blueprintReason: undefined,
      sessionId: "session-1",
    },
    {
      ensurePreviousArtifacts: async (_projectId, chapterNo) => {
        calls.push(`artifacts:${chapterNo}`);
      },
      ensureBlueprint: async (_projectId, chapterNo) => {
        calls.push(`blueprint:${chapterNo}`);
      },
      regenerateBlueprint: async () => {
        throw new Error("unexpected regenerate");
      },
      assembleContext: async (_projectId, chapterNo) => {
        calls.push(`context:${chapterNo}`);
        return context as never;
      },
    },
  );

  assert.deepEqual(calls, ["artifacts:11", "blueprint:12", "context:12"]);
  assert.equal(result, context);
});

test("prepareChapterPrerequisites keeps the barrier before blueprint regeneration", async () => {
  const calls: string[] = [];
  await prepareChapterPrerequisites(
    {
      projectId: "project-1",
      chapterNo: 12,
      blueprintReason: "review repair",
      sessionId: "session-1",
    },
    {
      ensurePreviousArtifacts: async () => { calls.push("artifacts"); },
      ensureBlueprint: async () => { throw new Error("unexpected ensure"); },
      regenerateBlueprint: async () => { calls.push("regenerate"); },
      assembleContext: async () => {
        calls.push("context");
        return {} as never;
      },
    },
  );
  assert.deepEqual(calls, ["artifacts", "regenerate", "context"]);
});
