import "../server-only.ts";

import { rm } from "node:fs/promises";
import { rawDb } from "../db/client.ts";
import { badRequest, notFound } from "../errors.ts";
import { projectDir } from "../paths.ts";
import { canTrashProjectForStage } from "../project-trash.ts";
import { getProject } from "../repositories/project.repository.ts";
import { buildRunProgress } from "../repositories/run.repository.ts";
import { createRunProgressService } from "../run/progress.service.ts";
import { nowIso } from "../utils.ts";

export const PROJECT_RESET_TABLES = [
  "project_card_messages",
  "foundation_workshop_sessions",
  "project_cards",
  "foundation_workshop_states",
  "foundations",
  "style_reference_imports",
  "style_card_snapshots",
  "agent_assignments",
  "chapter_plans",
  "hook_plans",
  "blueprints",
  "context_packs",
  "chapter_versions",
  "review_reports",
  "chapter_review_states",
  "chapter_delta_records",
  "canon_fact_index",
  "canon_fact_search",
  "summary_index",
  "summary_search",
  "conflicts",
  "run_statistics",
  "chapter_commits",
  "artifact_outbox",
  "artifact_manifests",
  "run_sessions",
  "run_states",
  "run_logs",
  "card_progressions",
  "chapter_invalidations",
  "style_delta_notes",
] as const;

function deleteSessionBoundRows(projectId: string) {
  const sessionIds = (
    rawDb.prepare("SELECT session_id FROM run_sessions WHERE project_id = ?").all(projectId) as Array<{ session_id: string }>
  ).map((row) => row.session_id);

  if (!sessionIds.length) {
    return;
  }

  const sessionTables = ["run_checkpoints", "run_events", "run_config_snapshots"] as const;
  for (const table of sessionTables) {
    const statement = rawDb.prepare(`DELETE FROM ${table} WHERE session_id = ?`);
    for (const sessionId of sessionIds) {
      statement.run(sessionId);
    }
  }
}

async function clearProjectDerivedFiles(projectId: string) {
  await rm(projectDir(projectId), { recursive: true, force: true });
}

function resetRunState(projectId: string, totalChapters: number, updatedAt: string) {
  rawDb
    .prepare(`
      INSERT INTO run_states (
        project_id, status, stage, desired_state, run_session_id, heartbeat_at, current_chapter, total_chapters, retry_count, confidence,
        last_error, draft_file, current_position, word_count, stage_details_json, started_at, updated_at
      ) VALUES (?, 'idle', 'idle', 'idle', NULL, NULL, 1, ?, 0, 0, NULL, NULL, 0, 0, '{}', ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        status = excluded.status,
        stage = excluded.stage,
        desired_state = excluded.desired_state,
        run_session_id = excluded.run_session_id,
        heartbeat_at = excluded.heartbeat_at,
        current_chapter = excluded.current_chapter,
        total_chapters = excluded.total_chapters,
        retry_count = excluded.retry_count,
        confidence = excluded.confidence,
        last_error = excluded.last_error,
        draft_file = excluded.draft_file,
        current_position = excluded.current_position,
        word_count = excluded.word_count,
        stage_details_json = excluded.stage_details_json,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at
    `)
    .run(projectId, totalChapters, updatedAt, updatedAt);
}

export async function resetProjectToFoundationWorkshop(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const progress = createRunProgressService().getRunProgressView(projectId);
  if (progress.running || !canTrashProjectForStage(progress.stage)) {
    throw badRequest("自动写作进行中，请先暂停或停止后再重置到设定工坊");
  }

  const updatedAt = nowIso();

  rawDb.transaction(() => {
    deleteSessionBoundRows(projectId);

    for (const table of PROJECT_RESET_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }

    rawDb
      .prepare(`
        UPDATE projects
        SET story_contract_json = '{}',
            steering_notes_json = '[]',
            status = 'ideation',
            updated_at = ?
        WHERE id = ?
      `)
      .run(updatedAt, projectId);

    resetRunState(projectId, project.chapterBudgetTarget, updatedAt);
  })();

  await clearProjectDerivedFiles(projectId);
  return buildRunProgress(projectId);
}
