import "../server-only.ts";

import { notFound } from "../errors.ts";
import Database from "better-sqlite3";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { rawDb } from "../db/client.ts";
import { createFoundationCoreEnvelope, parseFoundationCoreEnvelope } from "../foundation/foundation-core-state.ts";
import { normalizeStyleProfile } from "../style/style-steering.ts";
import type { FoundationPayload, StyleCardSnapshot } from "../types.ts";
import { nowIso } from "../utils.ts";
import { ensureProjectLayout, readProjectMeta, writeFoundationFiles, writeProjectMeta, writeStyleReferenceImportFiles, writeStyleSnapshotFile } from "../project-files.ts";
import { resolveProjectFilePath, withinProject } from "../paths.ts";
import { safeParseJson } from "../utils/safe-json.ts";

interface ProjectRow {
  id: string;
  title: string;
  genre: string;
  style: string;
  target_chapters: number;
  premise: string;
  series_mode: string;
  series_title: string | null;
  series_index: number | null;
  story_length: string;
  narrative_person: string;
  chapter_planning_mode: string;
  pace_profile: string;
  completion_criteria: string;
  chapter_budget_min: number | null;
  chapter_budget_target: number | null;
  chapter_budget_max: number | null;
  hard_chapter_cap: number | null;
  story_contract_json: string;
  steering_notes_json: string;
  review_policy_json: string;
  has_volumes: number;
  planned_volumes: number | null;
  source_idea_id: string | null;
}

interface AssignmentRow {
  role: string;
  profile_id: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

interface FoundationRow {
  premise_text: string;
  mainline_text: string;
  story_hook_text: string;
  style_card: string;
  style_profile_json: string;
  style_snapshot_id: string | null;
  style_snapshot_version: number | null;
  style_digest: string;
  style_exemplars_json: string;
  characters_json: string;
  worldview_json: string;
  relationships_json: string;
  locked_at: string | null;
}

interface WorkshopStateRow {
  draft_json: string;
  ready_to_generate: number;
}

interface WorkshopMessageRow {
  role: string;
  content: string;
  created_at: string;
}

interface StyleImportRow {
  id: string;
  title: string;
  author: string | null;
  original_file_name: string;
  media_type: string;
  source_hash: string;
  raw_file_path: string;
  normalized_file_path: string;
  word_count: number;
  encoding: string;
  confidence: string;
  chapter_count: number;
  excerpts_json: string;
  created_at: string;
}

interface StyleSnapshotRow {
  id: string;
  mode: string;
  source_ids_json: string;
  style_card: string;
  style_profile_json: string;
  style_digest: string;
  style_exemplars_json: string;
  sampled_excerpts_json: string;
  confidence: string;
  version: number;
  created_at: string;
}

interface CloneProjectForRerunOptions {
  db?: Database.Database;
  now?: () => string;
  nextProjectId?: () => string;
  nextEntityId?: () => string;
}

export interface CloneProjectForRerunInput {
  sourceProjectId: string;
  titleSuffix?: string;
}

export interface CloneProjectForRerunResult {
  projectId: string;
  title: string;
  importCount: number;
  snapshotCount: number;
}

function listRows<T>(db: Database.Database, sql: string, ...args: unknown[]) {
  return db.prepare(sql).all(...args) as T[];
}

function getRow<T>(db: Database.Database, sql: string, ...args: unknown[]) {
  return db.prepare(sql).get(...args) as T | undefined;
}

async function copyDirectoryIfExists(sourceDir: string, targetDir: string) {
  if (!existsSync(sourceDir)) {
    return;
  }
  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
  });
}

async function listFilesRecursive(dir: string, prefix = ""): Promise<string[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(absolutePath, relativePath));
    } else {
      files.push(relativePath.replace(/\\/g, "/"));
    }
  }
  return files;
}

function shouldCopySupplementalReference(relativePath: string) {
  if (relativePath.startsWith("raw/") || relativePath.startsWith("normalized/")) {
    return false;
  }
  if (/^snapshots\/style_snapshot_v\d+_[^/]+\.json$/u.test(relativePath)) {
    return false;
  }
  return true;
}

async function copySupplementalReferences(sourceProjectId: string, targetProjectId: string) {
  const sourceReferencesDir = withinProject(sourceProjectId, "references");
  const entries = await listFilesRecursive(sourceReferencesDir);
  for (const relativePath of entries.filter(shouldCopySupplementalReference)) {
    const sourcePath = join(sourceReferencesDir, relativePath);
    const targetPath = withinProject(targetProjectId, "references", ...relativePath.split("/"));
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });

    if (relativePath === "snapshots/project_voice_snapshot_v001.json") {
      const parsed = safeParseJson<Record<string, unknown>>(await readFile(targetPath, "utf8"), {}) ?? {};
      await writeFile(targetPath, JSON.stringify({
        ...parsed,
        projectId: targetProjectId,
      }, null, 2), "utf8");
    }
  }
}

function cloneMeta(meta: Record<string, unknown> | null, input: {
  projectId: string;
  title: string;
  updatedAt: string;
}) {
  if (!meta) {
    return {
      id: input.projectId,
      title: input.title,
      updatedAt: input.updatedAt,
    };
  }

  return {
    ...meta,
    id: input.projectId,
    title: input.title,
    updatedAt: input.updatedAt,
  };
}

export function createProjectRerunCloneService(options: CloneProjectForRerunOptions = {}) {
  const db = options.db ?? rawDb;
  const now = options.now ?? nowIso;
  const nextProjectId = options.nextProjectId ?? (() => `rerun-${Date.now().toString(36)}`);
  const nextEntityId = options.nextEntityId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  return {
    async cloneProjectForRerun(input: CloneProjectForRerunInput): Promise<CloneProjectForRerunResult> {
      const sourceProject = getRow<ProjectRow>(db, "SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL", input.sourceProjectId);
      if (!sourceProject) {
        throw notFound("源项目不存在");
      }

      const targetProjectId = nextProjectId();
      const targetTitle = `${sourceProject.title}${input.titleSuffix ?? "-opening-rerun-2026-04-01"}`;
      const timestamp = now();

      const assignments = listRows<AssignmentRow>(
        db,
        "SELECT role, profile_id, model, temperature, max_tokens FROM agent_assignments WHERE project_id = ? ORDER BY role ASC",
        input.sourceProjectId,
      );
      const foundation = getRow<FoundationRow>(db, "SELECT * FROM foundations WHERE project_id = ?", input.sourceProjectId);
      const workshopState = getRow<WorkshopStateRow>(
        db,
        "SELECT draft_json, ready_to_generate FROM foundation_workshop_states WHERE project_id = ?",
        input.sourceProjectId,
      );
      const workshopMessages = listRows<WorkshopMessageRow>(
        db,
        "SELECT role, content, created_at FROM foundation_workshop_messages WHERE project_id = ? ORDER BY created_at ASC",
        input.sourceProjectId,
      );
      const styleImports = listRows<StyleImportRow>(
        db,
        "SELECT * FROM style_reference_imports WHERE project_id = ? ORDER BY created_at ASC",
        input.sourceProjectId,
      );
      const styleSnapshots = listRows<StyleSnapshotRow>(
        db,
        "SELECT * FROM style_card_snapshots WHERE project_id = ? ORDER BY version ASC",
        input.sourceProjectId,
      );

      const sourceMeta = await readProjectMeta(input.sourceProjectId);
      const styleImportIdMap = new Map<string, string>();
      const snapshotIdMap = new Map<string, string>();
      for (const row of styleImports) {
        styleImportIdMap.set(row.id, nextEntityId());
      }
      for (const row of styleSnapshots) {
        snapshotIdMap.set(row.id, nextEntityId());
      }

      await ensureProjectLayout(targetProjectId);
      await copyDirectoryIfExists(withinProject(input.sourceProjectId, "config"), withinProject(targetProjectId, "config"));
      await copyDirectoryIfExists(withinProject(input.sourceProjectId, "bible"), withinProject(targetProjectId, "bible"));

      const clonedImports = await Promise.all(
        styleImports.map(async (row) => {
          const importId = styleImportIdMap.get(row.id)!;
          // DB 中存的是绝对路径，读取前复核仍落在源项目 references/ 内，不无条件信任
          const rawPath = resolveProjectFilePath(input.sourceProjectId, row.raw_file_path, ["references"]);
          const normalizedPath = resolveProjectFilePath(input.sourceProjectId, row.normalized_file_path, ["references"]);
          const rawBuffer = await readFile(rawPath);
          const normalizedText = await readFile(normalizedPath, "utf8");
          const filePaths = await writeStyleReferenceImportFiles({
            projectId: targetProjectId,
            importId,
            originalFileName: row.original_file_name,
            title: row.title,
            rawBuffer,
            normalizedText,
          });

          return {
            ...row,
            id: importId,
            raw_file_path: filePaths.rawPath,
            normalized_file_path: filePaths.normalizedPath,
          };
        }),
      );

      const remapSnapshotId = (snapshotId: string | null) => (snapshotId ? snapshotIdMap.get(snapshotId) ?? null : null);

      const clonedFoundation: FoundationPayload | null = foundation
        ? {
            premise: foundation.premise_text,
            mainline: foundation.mainline_text,
            storyHook: foundation.story_hook_text,
            styleCard: foundation.style_card,
            styleProfile: normalizeStyleProfile(safeParseJson<Partial<FoundationPayload["styleProfile"]>>(foundation.style_profile_json, {})),
            styleSnapshotId: remapSnapshotId(foundation.style_snapshot_id),
            styleSnapshotVersion: foundation.style_snapshot_version,
            styleDigest: foundation.style_digest,
            styleExemplars: safeParseJson<FoundationPayload["styleExemplars"]>(foundation.style_exemplars_json, []) ?? [],
            characters: safeParseJson<FoundationPayload["characters"]>(foundation.characters_json, []) ?? [],
            worldview: safeParseJson<FoundationPayload["worldview"]>(foundation.worldview_json, []) ?? [],
            relationships: safeParseJson<FoundationPayload["relationships"]>(foundation.relationships_json, []) ?? [],
          }
        : null;

      const clonedWorkshopDraft = workshopState
        ? (() => {
          const parsed = parseFoundationCoreEnvelope(workshopState.draft_json);
          return createFoundationCoreEnvelope(
            {
              ...parsed.envelope.draft,
              styleSnapshotId: remapSnapshotId(parsed.envelope.draft.styleSnapshotId ?? null),
            },
            parsed.envelope.syncMeta,
          );
        })()
        : null;

      db.transaction(() => {
        const targetStatus = foundation?.locked_at ? "foundation_locked" : foundation ? "foundation_ready" : "draft";
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
          targetProjectId,
          targetTitle,
          sourceProject.genre,
          sourceProject.style,
          sourceProject.target_chapters,
          sourceProject.premise,
          sourceProject.series_mode,
          sourceProject.series_title,
          sourceProject.series_index,
          sourceProject.story_length,
          sourceProject.narrative_person,
          sourceProject.chapter_planning_mode,
          sourceProject.pace_profile,
          sourceProject.completion_criteria,
          sourceProject.chapter_budget_min,
          sourceProject.chapter_budget_target,
          sourceProject.chapter_budget_max,
          sourceProject.hard_chapter_cap,
          sourceProject.story_contract_json,
          sourceProject.steering_notes_json,
          sourceProject.review_policy_json,
          sourceProject.has_volumes,
          sourceProject.planned_volumes,
          sourceProject.source_idea_id,
          targetStatus,
          timestamp,
          timestamp,
        );

        const insertAssignment = db.prepare(`
          INSERT INTO agent_assignments (id, project_id, role, profile_id, model, temperature, max_tokens, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const assignment of assignments) {
          insertAssignment.run(
            nextEntityId(),
            targetProjectId,
            assignment.role,
            assignment.profile_id,
            assignment.model,
            assignment.temperature,
            assignment.max_tokens,
            timestamp,
          );
        }

        db.prepare(`
          INSERT INTO run_states (
            project_id, status, stage, desired_state, run_session_id, heartbeat_at, current_chapter,
            total_chapters, retry_count, confidence, last_error, draft_file, current_position,
            word_count, stage_details_json, started_at, updated_at
          ) VALUES (?, 'idle', 'idle', 'idle', NULL, NULL, 1, ?, 0, 0, NULL, NULL, 0, 0, '{}', ?, ?)
        `).run(targetProjectId, sourceProject.target_chapters, timestamp, timestamp);

        if (foundation) {
          db.prepare(`
            INSERT INTO foundations (
              project_id, premise_text, mainline_text, story_hook_text, style_card, style_profile_json, style_snapshot_id, style_snapshot_version,
              style_digest, style_exemplars_json, characters_json, worldview_json, relationships_json, locked_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            targetProjectId,
            foundation.premise_text,
            foundation.mainline_text,
            foundation.story_hook_text,
            foundation.style_card,
            foundation.style_profile_json,
            remapSnapshotId(foundation.style_snapshot_id),
            foundation.style_snapshot_version,
            foundation.style_digest,
            foundation.style_exemplars_json,
            foundation.characters_json,
            foundation.worldview_json,
            foundation.relationships_json,
            foundation.locked_at ? timestamp : null,
            timestamp,
          );
        }

        if (workshopState && clonedWorkshopDraft) {
          db.prepare(`
            INSERT INTO foundation_workshop_states (project_id, draft_json, ready_to_generate, updated_at)
            VALUES (?, ?, ?, ?)
          `).run(
            targetProjectId,
            JSON.stringify(clonedWorkshopDraft),
            workshopState.ready_to_generate,
            timestamp,
          );
        }

        const insertWorkshopMessage = db.prepare(`
          INSERT INTO foundation_workshop_messages (id, project_id, role, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const message of workshopMessages) {
          insertWorkshopMessage.run(nextEntityId(), targetProjectId, message.role, message.content, message.created_at);
        }

        const insertImport = db.prepare(`
          INSERT INTO style_reference_imports (
            id, project_id, title, author, original_file_name, media_type, source_hash,
            raw_file_path, normalized_file_path, word_count, encoding, confidence, chapter_count, excerpts_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of clonedImports) {
          insertImport.run(
            row.id,
            targetProjectId,
            row.title,
            row.author,
            row.original_file_name,
            row.media_type,
            row.source_hash,
            row.raw_file_path,
            row.normalized_file_path,
            row.word_count,
            row.encoding,
            row.confidence,
            row.chapter_count,
            row.excerpts_json,
            row.created_at,
          );
        }

        const insertSnapshot = db.prepare(`
          INSERT INTO style_card_snapshots (
            id, project_id, mode, source_ids_json, style_card, style_profile_json,
            style_digest, style_exemplars_json, sampled_excerpts_json, confidence, version, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const row of styleSnapshots) {
          insertSnapshot.run(
            snapshotIdMap.get(row.id)!,
            targetProjectId,
            row.mode,
            JSON.stringify(
              (safeParseJson<string[]>(row.source_ids_json, []) ?? [])
                .map((sourceId) => styleImportIdMap.get(sourceId) ?? sourceId),
            ),
            row.style_card,
            row.style_profile_json,
            row.style_digest,
            row.style_exemplars_json,
            row.sampled_excerpts_json,
            row.confidence,
            row.version,
            row.created_at,
          );
        }
      })();

      if (clonedFoundation) {
        await writeFoundationFiles(targetProjectId, clonedFoundation);
      }

      for (const row of styleSnapshots) {
        const clonedSnapshotId = snapshotIdMap.get(row.id)!;
        await writeStyleSnapshotFile(targetProjectId, {
          id: clonedSnapshotId,
          projectId: targetProjectId,
          mode: row.mode as "book" | "author",
          sourceIds: (safeParseJson<string[]>(row.source_ids_json, []) ?? [])
            .map((sourceId) => styleImportIdMap.get(sourceId) ?? sourceId),
          styleCard: row.style_card,
          styleProfile: normalizeStyleProfile(safeParseJson<Partial<StyleCardSnapshot["styleProfile"]>>(row.style_profile_json, {})),
          styleDigest: row.style_digest,
          styleExemplars: safeParseJson<StyleCardSnapshot["styleExemplars"]>(row.style_exemplars_json, []) ?? [],
          sampledExcerpts: safeParseJson<StyleCardSnapshot["sampledExcerpts"]>(row.sampled_excerpts_json, []) ?? [],
          confidence: row.confidence as "low" | "medium" | "high",
          version: row.version,
          createdAt: row.created_at,
        });
      }

      await copySupplementalReferences(input.sourceProjectId, targetProjectId);
      await writeProjectMeta(targetProjectId, cloneMeta(sourceMeta, {
        projectId: targetProjectId,
        title: targetTitle,
        updatedAt: timestamp,
      }));

      return {
        projectId: targetProjectId,
        title: targetTitle,
        importCount: clonedImports.length,
        snapshotCount: styleSnapshots.length,
      };
    },
  };
}
