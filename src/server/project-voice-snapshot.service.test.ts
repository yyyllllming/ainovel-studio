import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import {
  projectVoiceSnapshotPath,
  readProjectVoiceSnapshot,
  updateProjectVoiceSnapshot,
} from "./content/project-voice-snapshot.service.ts";
import { ensureProjectLayout, writeFinalChapter } from "./project-files.ts";
import { removeProjectFilesForTests } from "./test-helpers.ts";

test("project voice snapshot service writes and reads snapshot files from accepted chapters", async () => {
  const projectId = "proj-voice-snapshot";

  await removeProjectFilesForTests(projectId);
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 1, "姜离先按住手背的血，再去贴石壁。\n\n风一停，他才敢换气。\n");
  await writeFinalChapter(projectId, 2, "他没急着解释，只先听石壁里那一下闷响。\n\n热意顺着指骨往里咬。\n");

  const snapshot = await updateProjectVoiceSnapshot(projectId, {
    chapterNos: [1, 2],
  });

  assert.equal(existsSync(projectVoiceSnapshotPath(projectId)), true);
  assert.equal(snapshot.sourceChapterNos.length, 2);
  assert.equal(snapshot.exemplars.length > 0, true);
  assert.equal(snapshot.positiveAnchors.length > 0, true);

  const reloaded = await readProjectVoiceSnapshot(projectId);
  assert.equal(reloaded?.id, snapshot.id);

  await removeProjectFilesForTests(projectId);
});
