import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("canon summary uses the archivist prompt and never injects the writer prompt", async () => {
  const [canonSource, syncSource] = await Promise.all([
    readFile(new URL("./story/canon.ts", import.meta.url), "utf8"),
    readFile(new URL("./commit/chapter-artifact-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(canonSource, /getPrompt\("writer"\)/u);
  assert.match(canonSource, /getPrompt\("archivist"\)/u);
  assert.match(syncSource, /summaryPrompt:\s*context\.prompts\.archivist/u);
});
