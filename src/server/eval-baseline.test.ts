import test from "node:test";
import assert from "node:assert/strict";

import { loadOpeningCorpus, runBaselineEval } from "./content/eval-baseline.ts";
import { ensureProjectLayout, writeFinalChapter } from "./project-files.ts";
import { removeProjectFilesForTests } from "./test-helpers.ts";

test("eval baseline loads opening corpus and reports metrics without a voice snapshot", async () => {
  const projectId = "proj-eval-baseline";

  await removeProjectFilesForTests(projectId);
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 1, "姜离先按住伤口，再往裂缝里探。\n\n石壁回响让他知道这里不只是逃命。\n");
  await writeFinalChapter(projectId, 2, "他摸到新的热痕，知道路线已经被改写。\n\n章末只留下更深处的闷响。\n");
  await writeFinalChapter(projectId, 10, "恢复压力样本：蓝图卡住后重新接上。\n\n新的异响逼着他改路。\n");

  const corpus = await loadOpeningCorpus(projectId);
  assert.equal(corpus.entries.length >= 2, true);
  assert.equal(corpus.entries.some((entry) => entry.kind === "recovery_stress"), true);

  const report = await runBaselineEval({
    projectId,
    corpus,
  });

  assert.equal(report.entries.length, corpus.entries.length);
  assert.equal(typeof report.aggregate.structureProgression.score, "number");
  assert.equal(typeof report.aggregate.aiSmell.score, "number");

  await removeProjectFilesForTests(projectId);
});
