import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { ensureDatabase } from "./db/init.ts";
import { appPaths, projectDir, withinProject } from "./paths.ts";
import {
  ensureProjectLayout,
  readProjectMeta,
  writeFoundationFiles,
  writeProjectMeta,
  writeStyleReferenceImportFiles,
  writeStyleSnapshotFile,
} from "./project-files.ts";
import { createDefaultStyleProfile } from "./style/style-steering.ts";
import type { StyleExcerpt } from "./types.ts";
import { createProjectRerunCloneService } from "./services/project-rerun-clone.service.ts";

function createMemoryDb() {
  const db = new Database(":memory:");
  ensureDatabase(db);
  return db;
}

async function cleanupProject(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

const styleProfile = createDefaultStyleProfile();
const styleExcerpt: StyleExcerpt = {
  id: "ex-1",
  sourceId: "import-src",
  sourceTitle: "完美世界",
  label: "样例片段",
  tags: ["pressure"],
  content: "样例片段",
  wordCount: 4,
  startOffset: 0,
  endOffset: 4,
  positionRatio: 0,
  dialogueRatio: 0,
};

test("project rerun clone service copies active foundation/style state into a clean rerun project", async () => {
  const db = createMemoryDb();
  const sourceProjectId = "rerun-source-project";
  const targetProjectId = "rerun-clone-project";

  try {
    await ensureProjectLayout(sourceProjectId);

    const now = "2026-04-01T00:00:00.000Z";
    db.prepare(`
      INSERT INTO projects (
        id, title, genre, style, target_chapters, premise,
        series_mode, series_title, series_index, story_length, narrative_person,
        chapter_planning_mode, pace_profile, completion_criteria,
        chapter_budget_min, chapter_budget_target, chapter_budget_max, hard_chapter_cap,
        story_contract_json, steering_notes_json, review_policy_json,
        has_volumes, planned_volumes, source_idea_id, status, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      sourceProjectId,
      "洪荒异兽-完美世界50章实验-2026-03-25",
      "玄幻修仙",
      "default",
      50,
      "这是一个山海经的故事",
      "standalone",
      null,
      null,
      "long",
      "third",
      "fixed",
      "medium",
      "主线闭环",
      50,
      50,
      50,
      50,
      JSON.stringify({ globalArc: "山海异兽主线" }),
      JSON.stringify([{ id: "note-1", instruction: "少解释，多动作", active: true }]),
      JSON.stringify({ cadenceChapters: 2, deepReviewStartChapter: 8 }),
      1,
      2,
      null,
      "foundation_locked",
      now,
      now,
    );

    db.prepare(`
      INSERT INTO agent_assignments (id, project_id, role, profile_id, model, temperature, max_tokens, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("assign-1", sourceProjectId, "writer", "writer-profile", "gpt-5.4", 0.7, 16000, now);

    db.prepare(`
      INSERT INTO run_states (
        project_id, status, stage, desired_state, run_session_id, heartbeat_at, current_chapter,
        total_chapters, retry_count, confidence, last_error, draft_file, current_position,
        word_count, stage_details_json, started_at, updated_at
      ) VALUES (?, 'completed', 'completed', 'idle', NULL, NULL, 9, 50, 0, 0.9, NULL, NULL, 0, 0, '{}', ?, ?)
    `).run(sourceProjectId, now, now);

    db.prepare(`
      INSERT INTO foundations (
        project_id, premise_text, mainline_text, story_hook_text, style_card, style_profile_json, style_snapshot_id, style_snapshot_version,
        style_digest, style_exemplars_json, characters_json, worldview_json, relationships_json, locked_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourceProjectId,
      "这是一个山海经的故事",
      "纪渊沿着古兽残纹追查自己的来处。",
      "开篇纪渊误触残纹，立刻被巡山罴影盯上。",
      "风格卡",
      JSON.stringify(styleProfile),
      "snapshot-src",
      1,
      "围绕完美世界建立的 style digest",
      JSON.stringify([styleExcerpt]),
      JSON.stringify([{ name: "纪渊", role: "主角", goal: "活下去", traits: ["谨慎"] }]),
      JSON.stringify([{ name: "断崖山场", description: "山场" }]),
      JSON.stringify([{ source: "纪渊", target: "巡山罴影", label: "被追猎" }]),
      now,
      now,
    );

    db.prepare(`
      INSERT INTO foundation_workshop_states (project_id, draft_json, ready_to_generate, updated_at)
      VALUES (?, ?, 1, ?)
    `).run(
      sourceProjectId,
      JSON.stringify({
        premise: "这是一个山海经的故事",
        styleSteeringCard: "风格卡",
        styleProfile,
        styleSnapshotId: "snapshot-src",
        styleSnapshotVersion: 1,
        styleDigest: "围绕完美世界建立的 style digest",
        styleExemplars: [styleExcerpt],
        characterIdeas: [],
        worldviewIdeas: [],
        relationshipIdeas: [],
      }),
      now,
    );

    db.prepare(`
      INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run("fwm-1", sourceProjectId, "assistant", "这是基础设定消息", now);

    db.prepare(`
      INSERT INTO style_reference_imports (
        id, project_id, title, author, original_file_name, media_type, source_hash,
        raw_file_path, normalized_file_path, word_count, encoding, confidence, chapter_count, excerpts_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "import-src",
      sourceProjectId,
      "完美世界",
      "辰东",
      "完美世界-辰东.txt",
      "text/plain",
      "source-hash",
      withinProject(sourceProjectId, "references", "raw", "import-src_完美世界-辰东.txt"),
      withinProject(sourceProjectId, "references", "normalized", "import-src_完美世界.txt"),
      123456,
      "utf8",
      "high",
      1200,
      JSON.stringify(["片段一", "片段二"]),
      now,
    );

    db.prepare(`
      INSERT INTO style_card_snapshots (
        id, project_id, mode, source_ids_json, style_card, style_profile_json, style_digest,
        style_exemplars_json, sampled_excerpts_json, confidence, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "snapshot-src",
      sourceProjectId,
      "book",
      JSON.stringify(["import-src"]),
      "风格卡",
      JSON.stringify(styleProfile),
      "围绕完美世界建立的 style digest",
      JSON.stringify([styleExcerpt]),
      JSON.stringify([styleExcerpt]),
      "high",
      1,
      now,
    );

    await writeProjectMeta(sourceProjectId, {
      id: sourceProjectId,
      title: "洪荒异兽-完美世界50章实验-2026-03-25",
      storyContract: { globalArc: "山海异兽主线" },
      updatedAt: now,
    });

    await writeFoundationFiles(sourceProjectId, {
      premise: "这是一个山海经的故事",
      mainline: "纪渊沿着古兽残纹追查自己的来处。",
      storyHook: "开篇纪渊误触残纹，立刻被巡山罴影盯上。",
      styleCard: "风格卡",
      styleProfile,
      styleSnapshotId: "snapshot-src",
      styleSnapshotVersion: 1,
      styleDigest: "围绕完美世界建立的 style digest",
      styleExemplars: [styleExcerpt],
      characters: [{ name: "纪渊", role: "主角", goal: "活下去", traits: ["谨慎"] }],
      worldview: [{ name: "断崖山场", description: "山场" }],
      relationships: [{ source: "纪渊", target: "巡山罴影", label: "被追猎" }],
    });

    await writeStyleReferenceImportFiles({
      projectId: sourceProjectId,
      importId: "import-src",
      originalFileName: "完美世界-辰东.txt",
      title: "完美世界",
      rawBuffer: Buffer.from("完美世界 raw", "utf8"),
      normalizedText: "完美世界 normalized",
    });

    await writeStyleSnapshotFile(sourceProjectId, {
      id: "snapshot-src",
      projectId: sourceProjectId,
      mode: "book",
      sourceIds: ["import-src"],
      styleCard: "风格卡",
      styleProfile,
      styleDigest: "围绕完美世界建立的 style digest",
      styleExemplars: [styleExcerpt],
      sampledExcerpts: [styleExcerpt],
      confidence: "high",
      version: 1,
      createdAt: now,
    });

    await writeFile(
      withinProject(sourceProjectId, "references", "snapshots", "project_voice_snapshot_v001.json"),
      JSON.stringify({ projectId: sourceProjectId, excerptIds: ["sig-1"] }, null, 2),
      "utf8",
    );
    await writeFile(withinProject(sourceProjectId, "config", "prompts", "custom-system.txt"), "custom prompt", "utf8");
    await writeFile(withinProject(sourceProjectId, "chapters", "chapter_001.md"), "旧第一章", "utf8");
    await writeFile(withinProject(sourceProjectId, "reviews", "chapter_001_review.json"), "{\"score\":80}", "utf8");
    await writeFile(withinProject(sourceProjectId, ".lock"), "{\"mirrorOnly\":true}", "utf8");

    const service = createProjectRerunCloneService({
      db,
      now: () => "2026-04-01T12:00:00.000Z",
      nextProjectId: () => targetProjectId,
      nextEntityId: (() => {
        let value = 0;
        return () => `clone-entity-${++value}`;
      })(),
    });

    const result = await service.cloneProjectForRerun({
      sourceProjectId,
      titleSuffix: "-opening-rerun-2026-04-01",
    });

    assert.equal(result.projectId, targetProjectId);
    assert.equal(result.importCount, 1);
    assert.equal(result.snapshotCount, 1);

    const clonedProject = db.prepare("SELECT title, status, story_contract_json, steering_notes_json FROM projects WHERE id = ?")
      .get(targetProjectId) as Record<string, unknown>;
    assert.equal(clonedProject.title, "洪荒异兽-完美世界50章实验-2026-03-25-opening-rerun-2026-04-01");
    assert.equal(clonedProject.status, "foundation_locked");
    assert.deepEqual(JSON.parse(String(clonedProject.story_contract_json)), { globalArc: "山海异兽主线" });
    assert.equal(JSON.parse(String(clonedProject.steering_notes_json)).length, 1);

    const clonedRunState = db.prepare("SELECT status, stage, current_chapter, total_chapters FROM run_states WHERE project_id = ?")
      .get(targetProjectId) as Record<string, unknown>;
    assert.equal(clonedRunState.status, "idle");
    assert.equal(clonedRunState.stage, "idle");
    assert.equal(Number(clonedRunState.current_chapter), 1);
    assert.equal(Number(clonedRunState.total_chapters), 50);

    const clonedFoundation = db.prepare("SELECT style_snapshot_id, style_digest, locked_at FROM foundations WHERE project_id = ?")
      .get(targetProjectId) as Record<string, unknown>;
    assert.equal(String(clonedFoundation.style_digest), "围绕完美世界建立的 style digest");
    assert.equal(Boolean(clonedFoundation.locked_at), true);
    assert.notEqual(String(clonedFoundation.style_snapshot_id), "snapshot-src");

    const clonedImport = db.prepare("SELECT id, raw_file_path, normalized_file_path FROM style_reference_imports WHERE project_id = ?")
      .get(targetProjectId) as Record<string, unknown>;
    assert.equal(Boolean(clonedImport), true);
    assert.equal(String(clonedImport.raw_file_path).includes(targetProjectId), true);
    assert.equal(String(clonedImport.normalized_file_path).includes(targetProjectId), true);
    assert.equal(existsSync(String(clonedImport.raw_file_path)), true);
    assert.equal(existsSync(String(clonedImport.normalized_file_path)), true);

    const clonedSnapshot = db.prepare("SELECT id, source_ids_json FROM style_card_snapshots WHERE project_id = ?")
      .get(targetProjectId) as Record<string, unknown>;
    assert.equal(Boolean(clonedSnapshot), true);
    assert.notEqual(String(clonedSnapshot.id), "snapshot-src");
    assert.deepEqual(JSON.parse(String(clonedSnapshot.source_ids_json)), [String(clonedImport.id)]);

    const clonedMeta = await readProjectMeta(targetProjectId);
    assert.equal(clonedMeta?.id, targetProjectId);
    assert.equal(clonedMeta?.title, "洪荒异兽-完美世界50章实验-2026-03-25-opening-rerun-2026-04-01");

    assert.equal(existsSync(withinProject(targetProjectId, "chapters", "chapter_001.md")), false);
    assert.equal(existsSync(withinProject(targetProjectId, "reviews", "chapter_001_review.json")), false);
    assert.equal(existsSync(withinProject(targetProjectId, ".lock")), false);
    assert.equal(existsSync(withinProject(targetProjectId, "config", "prompts", "custom-system.txt")), true);
    assert.equal(existsSync(withinProject(targetProjectId, "references", "snapshots", "project_voice_snapshot_v001.json")), true);
    assert.equal(existsSync(withinProject(sourceProjectId, "chapters", "chapter_001.md")), true);

    const clonedVoiceSnapshot = JSON.parse(
      await readFile(withinProject(targetProjectId, "references", "snapshots", "project_voice_snapshot_v001.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(clonedVoiceSnapshot.projectId, targetProjectId);
  } finally {
    db.close();
    await cleanupProject(sourceProjectId);
    await cleanupProject(targetProjectId);
  }
});

test("project rerun clone service rejects style import file paths outside the source project", async () => {
  const db = createMemoryDb();
  const sourceProjectId = "rerun-source-escape";
  const targetProjectId = "rerun-clone-escape";

  try {
    await ensureProjectLayout(sourceProjectId);

    const now = "2026-04-01T00:00:00.000Z";
    db.prepare(`
      INSERT INTO projects (
        id, title, genre, style, target_chapters, premise,
        series_mode, series_title, series_index, story_length, narrative_person,
        chapter_planning_mode, pace_profile, completion_criteria,
        chapter_budget_min, chapter_budget_target, chapter_budget_max, hard_chapter_cap,
        story_contract_json, steering_notes_json, review_policy_json,
        has_volumes, planned_volumes, source_idea_id, status, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      sourceProjectId,
      "越界路径项目",
      "玄幻修仙",
      "default",
      50,
      "premise",
      "standalone",
      null,
      null,
      "long",
      "third",
      "fixed",
      "medium",
      "主线闭环",
      null,
      null,
      null,
      null,
      "{}",
      "[]",
      "{}",
      0,
      null,
      null,
      "draft",
      now,
      now,
    );

    // 模拟被污染的 DB 行：raw_file_path 指向项目沙箱外的敏感文件
    db.prepare(`
      INSERT INTO style_reference_imports (
        id, project_id, title, author, original_file_name, media_type, source_hash,
        raw_file_path, normalized_file_path, word_count, encoding, confidence, chapter_count, excerpts_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "import-escape",
      sourceProjectId,
      "越界导入",
      null,
      "escape.txt",
      "text/plain",
      "escape-hash",
      appPaths.profileFile,
      withinProject(sourceProjectId, "references", "normalized", "escape.txt"),
      10,
      "utf8",
      "low",
      1,
      "[]",
      now,
    );

    const service = createProjectRerunCloneService({
      db,
      now: () => now,
      nextProjectId: () => targetProjectId,
    });

    await assert.rejects(
      () => service.cloneProjectForRerun({ sourceProjectId }),
      /项目文件路径不合法/,
    );
  } finally {
    db.close();
    await cleanupProject(sourceProjectId);
    await cleanupProject(targetProjectId);
  }
});
