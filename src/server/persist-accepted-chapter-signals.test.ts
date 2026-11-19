import test from "node:test";
import assert from "node:assert/strict";

import { projectVoiceSnapshotPath, readProjectVoiceSnapshot } from "./content/project-voice-snapshot.service.ts";
import { ensureProjectLayout, writeFinalChapter } from "./project-files.ts";
import { persistAcceptedChapterSignals } from "./services/manual-review.service.ts";
import { removeProjectFilesForTests } from "./test-helpers.ts";

test("persistAcceptedChapterSignals refreshes project voice snapshot from current accepted chapter text", async () => {
  const projectId = "persist-voice-snapshot";

  await removeProjectFilesForTests(projectId);
  await ensureProjectLayout(projectId);
  await writeFinalChapter(projectId, 1, "姜离先按住伤口，再去听石壁里的回响。\n\n他没急着解释，只把呼吸压得更低。\n");

  await persistAcceptedChapterSignals(projectId, 1);

  const snapshot = await readProjectVoiceSnapshot(projectId);
  assert.equal(projectVoiceSnapshotPath(projectId).endsWith("project_voice_snapshot_v001.json"), true);
  assert.equal(snapshot !== null, true);
  assert.equal((snapshot?.positiveAnchors.length ?? 0) > 0, true);

  await removeProjectFilesForTests(projectId);
});
