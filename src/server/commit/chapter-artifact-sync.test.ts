import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { rawDb } from "../db/client.ts";
import {
  ensureProjectLayout,
  replaceCanonFactEntriesForChapter,
  saveSummaryFiles,
  writeCharacterSnapshot,
  writeLogicStateSnapshot,
} from "../project-files.ts";
import { projectDir, withinProject } from "../paths.ts";
import {
  ensureChapterArtifactsReady,
  hasChapterArtifactsSynced,
  invalidateDurableCanonArtifacts,
} from "./chapter-artifact-sync.ts";

function createProjectId() {
  return `artifact-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function seedActiveSyncJob(projectId: string, chapterNo: number) {
  const commitId = `commit-${projectId}-${chapterNo}`;
  rawDb.prepare(`
    INSERT INTO chapter_commits (
      commit_id, project_id, chapter_no, session_id, source_kind, accepted_version_id,
      idempotency_key, state, manifest_json, stage_dir, content_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'run', ?, ?, 'committed', '{}', ?, ?, ?, ?)
  `).run(
    commitId,
    projectId,
    chapterNo,
    null,
    `version-${chapterNo}`,
    `${projectId}:${chapterNo}:version-${chapterNo}:run`,
    `.staging/commits/${commitId}`,
    `hash-${chapterNo}`,
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
  rawDb.prepare(`
    INSERT INTO artifact_outbox (
      job_id, commit_id, project_id, chapter_no, job_type, state, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'chapter_artifact_sync', 'pending', '{}', ?, ?)
  `).run(
    `job-${projectId}-${chapterNo}`,
    commitId,
    projectId,
    chapterNo,
    "2026-04-01T00:00:00.000Z",
    "2026-04-01T00:00:00.000Z",
  );
}

async function cleanup(projectId: string) {
  rawDb.prepare("DELETE FROM artifact_outbox WHERE project_id = ?").run(projectId);
  rawDb.prepare("DELETE FROM chapter_commits WHERE project_id = ?").run(projectId);
  await rm(projectDir(projectId), { recursive: true, force: true });
}

async function seedCompleteArtifacts(projectId: string, chapterNo: number) {
  await saveSummaryFiles(projectId, chapterNo, {
    brief: "brief summary",
    detailed: "detailed summary",
    full: "full summary",
  });
  await writeCharacterSnapshot(projectId, chapterNo, { chapterNo, characters: {} });
  await replaceCanonFactEntriesForChapter(projectId, chapterNo, []);
  await writeLogicStateSnapshot(projectId, chapterNo, {
    chapterNo,
    relationshipDeltas: [],
    timeMarker: "",
    unresolvedPromises: [],
    pendingConsequences: [],
    hookDiagnostics: null,
  });
  await writeFile(
    withinProject(projectId, "canon", `artifact_status_${String(chapterNo).padStart(3, "0")}.json`),
    JSON.stringify({
      usedFallback: false,
      aggregateStatus: "success",
      components: { summaries: "success", facts: "success", snapshot: "success" },
      factCount: 0,
      snapshotCharacterCount: 0,
      missingCategories: [],
    }),
    "utf8",
  );
}

test("artifact invalidation preserves partial component state but removes fully successful state", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  const partialPath = withinProject(projectId, "canon", "artifact_status_001.json");
  const successPath = withinProject(projectId, "canon", "artifact_status_002.json");

  try {
    await writeFile(partialPath, JSON.stringify({ aggregateStatus: "partial_success" }), "utf8");
    await writeFile(successPath, JSON.stringify({ aggregateStatus: "success" }), "utf8");

    await invalidateDurableCanonArtifacts(projectId, 1);
    await invalidateDurableCanonArtifacts(projectId, 2);

    assert.equal(JSON.parse(await readFile(partialPath, "utf8")).aggregateStatus, "partial_success");
    await assert.rejects(() => readFile(successPath, "utf8"), { code: "ENOENT" });
  } finally {
    await cleanup(projectId);
  }
});

test("ensureChapterArtifactsReady waits for an in-flight outbox sync job instead of racing it", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    seedActiveSyncJob(projectId, 2);

    // 模拟 reconciler 进程在约 120ms 后完成该章的 sync job。
    const markDoneTimer = setTimeout(() => {
      void seedCompleteArtifacts(projectId, 2).then(() => {
        rawDb.prepare("UPDATE artifact_outbox SET state = 'done' WHERE project_id = ?").run(projectId);
      });
    }, 120);

    const startedAt = Date.now();
    await ensureChapterArtifactsReady(projectId, 2, undefined, { pollIntervalMs: 15, maxWaitMs: 5_000 });
    const elapsed = Date.now() - startedAt;
    clearTimeout(markDoneTimer);

    assert.ok(elapsed >= 100, `should wait for the active outbox job (elapsed=${elapsed}ms)`);
    assert.ok(elapsed < 4_000, `should resume promptly once the job settles (elapsed=${elapsed}ms)`);
  } finally {
    await cleanup(projectId);
  }
});

test("ensureChapterArtifactsReady stops waiting once the outbox wait deadline passes", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);

  try {
    seedActiveSyncJob(projectId, 3);

    const startedAt = Date.now();
    await assert.rejects(
      ensureChapterArtifactsReady(projectId, 3, undefined, { pollIntervalMs: 15, maxWaitMs: 150 }),
      /正式正文不存在|产物屏障/,
    );
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed >= 130, `should poll until the deadline (elapsed=${elapsed}ms)`);
    assert.ok(elapsed < 3_000, `should not hang past the deadline (elapsed=${elapsed}ms)`);
  } finally {
    await cleanup(projectId);
  }
});

test("artifact readiness requires exact brief/detailed/full summaries, snapshot, facts, and logic state", async () => {
  const projectId = createProjectId();
  await ensureProjectLayout(projectId);
  try {
    await saveSummaryFiles(projectId, 4, {
      brief: "brief summary",
      detailed: "detailed summary",
      full: "full summary",
    });
    await writeCharacterSnapshot(projectId, 4, { chapterNo: 4, characters: {} });
    await replaceCanonFactEntriesForChapter(projectId, 4, []);
    await writeFile(
      withinProject(projectId, "canon", "artifact_status_004.json"),
      JSON.stringify({
        usedFallback: false,
        aggregateStatus: "success",
        components: { summaries: "success", facts: "success", snapshot: "success" },
        factCount: 0,
        snapshotCharacterCount: 0,
        missingCategories: [],
      }),
      "utf8",
    );
    assert.equal(await hasChapterArtifactsSynced(projectId, 4), false, "缺少 exact-chapter Logic State 时不得就绪");

    await writeLogicStateSnapshot(projectId, 3, {
      chapterNo: 3,
      relationshipDeltas: [],
      timeMarker: "",
      unresolvedPromises: [],
      pendingConsequences: [],
      hookDiagnostics: null,
    });
    assert.equal(await hasChapterArtifactsSynced(projectId, 4), false, "上一章 Logic State 不得冒充当前章");

    await writeLogicStateSnapshot(projectId, 4, {
      chapterNo: 4,
      relationshipDeltas: [],
      timeMarker: "",
      unresolvedPromises: [],
      pendingConsequences: [],
      hookDiagnostics: null,
    });
    assert.equal(await hasChapterArtifactsSynced(projectId, 4), true);
  } finally {
    await cleanup(projectId);
  }
});
