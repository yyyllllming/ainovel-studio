import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { validateCharacterName } from "../src/lib/character-name-policy.ts";
import { recalculateAutoRecurringCharacterCards } from "../src/server/character/auto-character-discovery-runtime.ts";
import { rawDb } from "../src/server/db/client.ts";
import { withinProject } from "../src/server/paths.ts";
import { readProjectMeta, writeProjectMeta } from "../src/server/project-files.ts";
import {
  sanitizeFoundationPayload,
  sanitizeFoundationWorkshopDraft,
  sanitizeProjectPremise,
} from "../src/server/foundation/foundation-summary-sanitizer.ts";
import { saveFoundation } from "../src/server/repositories/foundation.repository.ts";
import { deleteCard, listCards, syncConfirmedCardsFromFoundation } from "../src/server/repositories/card.repository.ts";
import { listProjects } from "../src/server/repositories/project.repository.ts";

type SnapshotPayload = {
  projectId: string;
  capturedAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  projectMeta: Record<string, unknown> | null;
};

function nowIso() {
  return new Date().toISOString();
}

function usageAndExit(code = 1) {
  console.log("用法：pnpm entity:audit --full");
  console.log("用法：pnpm entity:audit --restore <snapshotDir>");
  process.exit(code);
}

async function snapshotProject(projectId: string): Promise<SnapshotPayload> {
  const tables = {
    projects: rawDb.prepare("SELECT * FROM projects WHERE id = ?").all(projectId) as Array<Record<string, unknown>>,
    foundation_workshop_states: rawDb.prepare("SELECT * FROM foundation_workshop_states WHERE project_id = ?").all(projectId) as Array<Record<string, unknown>>,
    foundations: rawDb.prepare("SELECT * FROM foundations WHERE project_id = ?").all(projectId) as Array<Record<string, unknown>>,
    project_cards: rawDb.prepare("SELECT * FROM project_cards WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as Array<Record<string, unknown>>,
    project_card_messages: rawDb.prepare("SELECT * FROM project_card_messages WHERE project_id = ? ORDER BY created_at ASC").all(projectId) as Array<Record<string, unknown>>,
    card_progressions: rawDb.prepare("SELECT * FROM card_progressions WHERE project_id = ? ORDER BY chapter_no ASC, created_at ASC").all(projectId) as Array<Record<string, unknown>>,
  };

  return {
    projectId,
    capturedAt: nowIso(),
    tables,
    projectMeta: await readProjectMeta(projectId),
  };
}

function insertRows(table: string, rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const columns = Object.keys(row);
    if (!columns.length) {
      continue;
    }
    const placeholders = columns.map(() => "?").join(", ");
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
    rawDb.prepare(sql).run(...columns.map((column) => row[column]));
  }
}

function normalizeProjectMetaForAudit(meta: Record<string, unknown> | null | undefined, sanitizedPremise: string) {
  if (!meta) {
    return null;
  }

  const nextMeta = structuredClone(meta);
  if (typeof nextMeta.premise === "string") {
    nextMeta.premise = sanitizedPremise || sanitizeProjectPremise(nextMeta.premise);
  }

  if (
    nextMeta.sourceIdeaSnapshot
    && typeof nextMeta.sourceIdeaSnapshot === "object"
    && !Array.isArray(nextMeta.sourceIdeaSnapshot)
  ) {
    const snapshot = nextMeta.sourceIdeaSnapshot as Record<string, unknown>;
    if (snapshot.draft && typeof snapshot.draft === "object" && !Array.isArray(snapshot.draft)) {
      const draft = snapshot.draft as Record<string, unknown>;
      if (typeof draft.premise === "string") {
        draft.premise = sanitizeProjectPremise(draft.premise);
      }
    }
  }

  return nextMeta;
}

function resolveAuditProjectPremise(input: {
  projectPremise: string;
  foundationPremise?: string | null;
  workshopPremise?: string | null;
}) {
  const stableProjectPremise = sanitizeProjectPremise(input.projectPremise).trim();
  if (stableProjectPremise) {
    return stableProjectPremise;
  }

  const authoritativePremise = (input.foundationPremise ?? "").trim();
  if (authoritativePremise) {
    return authoritativePremise;
  }

  const workshopPremise = sanitizeProjectPremise(input.workshopPremise).trim();
  return workshopPremise;
}

async function computePollutionMetrics(projectId: string) {
  const projectRow = rawDb.prepare("SELECT premise FROM projects WHERE id = ?").get(projectId) as
    | Record<string, unknown>
    | undefined;
  const foundationRow = rawDb.prepare("SELECT characters_json FROM foundations WHERE project_id = ?").get(projectId) as
    | Record<string, unknown>
    | undefined;
  const foundationPremiseRow = rawDb.prepare("SELECT premise_text, worldview_json FROM foundations WHERE project_id = ?").get(projectId) as
    | Record<string, unknown>
    | undefined;
  const workshopRow = rawDb.prepare("SELECT draft_json FROM foundation_workshop_states WHERE project_id = ?").get(projectId) as
    | Record<string, unknown>
    | undefined;
  const projectMeta = await readProjectMeta(projectId);
  const foundationCharacters = foundationRow
    ? JSON.parse(String(foundationRow.characters_json ?? "[]")) as Array<{ name?: string }>
    : [];
  const characterCards = listCards(projectId).filter((card) => card.cardType === "character");
  const workshopDraft = workshopRow
    ? JSON.parse(String(workshopRow.draft_json ?? "{}")) as Record<string, unknown>
    : null;
  const sanitizedWorkshopDraft = sanitizeFoundationWorkshopDraft(workshopDraft as never);
  const sanitizedProjectPremise = sanitizeProjectPremise(String(projectRow?.premise ?? ""));
  const normalizedMeta = normalizeProjectMetaForAudit(projectMeta, sanitizedProjectPremise);

  const invalidFoundation = foundationCharacters.filter((character) => !validateCharacterName(String(character.name ?? "")).accepted).length;
  const invalidCards = characterCards.filter((card) => !validateCharacterName(card.name).accepted).length;
  const total = foundationCharacters.length + characterCards.length;
  const numerator = invalidFoundation + invalidCards;

  return {
    invalidFoundation,
    invalidCards,
    pollutedProjectPremise:
      typeof projectRow?.premise === "string" && sanitizedProjectPremise !== String(projectRow.premise) ? 1 : 0,
    pollutedFoundationPremise:
      typeof foundationPremiseRow?.premise_text === "string"
      && sanitizeProjectPremise(String(foundationPremiseRow.premise_text)) !== String(foundationPremiseRow.premise_text)
        ? 1
        : 0,
    pollutedWorkshopDraft:
      workshopDraft && JSON.stringify(workshopDraft) !== JSON.stringify(sanitizedWorkshopDraft) ? 1 : 0,
    pollutedProjectMeta:
      projectMeta && JSON.stringify(projectMeta) !== JSON.stringify(normalizedMeta) ? 1 : 0,
    total,
    pollutionRate: total > 0 ? numerator / total : 0,
  };
}

async function runFullAudit() {
  const timestamp = nowIso().replace(/[:.]/g, "-");
  const rootDir = resolve(process.cwd(), "data", "entity-audit", timestamp);
  const projectsDir = join(rootDir, "projects");
  await mkdir(projectsDir, { recursive: true });

  const report = {
    generatedAt: nowIso(),
    projects: [] as Array<Record<string, unknown>>,
    totals: {
      cleanedInvalidCharacters: 0,
      recurringDraftsCreatedOrRefreshed: 0,
      sanitizedProjectPremises: 0,
      sanitizedWorkshopDrafts: 0,
      sanitizedProjectMetas: 0,
      pollutionRate: 0,
    },
  };

  for (const project of listProjects()) {
    const beforeSnapshot = await snapshotProject(project.id);
    const beforeMetrics = await computePollutionMetrics(project.id);
    await writeFile(
      join(projectsDir, `${project.id}.before.json`),
      JSON.stringify(beforeSnapshot, null, 2),
      "utf8",
    );

    let cleanedInvalidCharacters = 0;
    for (const card of listCards(project.id)) {
      if (card.cardType !== "character") {
        continue;
      }
      if (validateCharacterName(card.name).accepted) {
        continue;
      }
      deleteCard(card.id);
      cleanedInvalidCharacters += 1;
    }

    const foundation = rawDb.prepare("SELECT 1 FROM foundations WHERE project_id = ?").get(project.id);
    let foundationSync = { imported: 0, upgraded: 0, skipped: 0 };
    let sanitizedWorkshopDrafts = 0;
    let sanitizedProjectPremises = 0;
    let sanitizedProjectMetas = 0;
    let authoritativePremise = "";
    let workshopPremise = "";
    if (foundation) {
      const currentFoundation = rawDb.prepare("SELECT * FROM foundations WHERE project_id = ?").get(project.id) as Record<string, unknown>;
      const parsedFoundation = sanitizeFoundationPayload({
        premise: String(currentFoundation.premise_text ?? ""),
        styleCard: String(currentFoundation.style_card ?? ""),
        styleProfile: JSON.parse(String(currentFoundation.style_profile_json ?? "{}")),
        styleSnapshotId: currentFoundation.style_snapshot_id ? String(currentFoundation.style_snapshot_id) : null,
        styleSnapshotVersion: typeof currentFoundation.style_snapshot_version === "number"
          ? Number(currentFoundation.style_snapshot_version)
          : null,
        styleDigest: String(currentFoundation.style_digest ?? ""),
        styleExemplars: JSON.parse(String(currentFoundation.style_exemplars_json ?? "[]")),
        characters: JSON.parse(String(currentFoundation.characters_json ?? "[]")),
        worldview: JSON.parse(String(currentFoundation.worldview_json ?? "[]")),
        relationships: JSON.parse(String(currentFoundation.relationships_json ?? "[]")),
      })!;
      authoritativePremise = parsedFoundation.premise;
      saveFoundation(project.id, parsedFoundation);
      foundationSync = syncConfirmedCardsFromFoundation(project.id);
    }

    const workshopStateRow = rawDb.prepare("SELECT * FROM foundation_workshop_states WHERE project_id = ?").get(project.id) as
      | Record<string, unknown>
      | undefined;
    if (workshopStateRow) {
      const parsedDraft = JSON.parse(String(workshopStateRow.draft_json ?? "{}")) as Record<string, unknown>;
      const sanitizedDraft = sanitizeFoundationWorkshopDraft(parsedDraft as never);
      workshopPremise = sanitizedDraft?.premise ?? "";
      if (JSON.stringify(parsedDraft) !== JSON.stringify(sanitizedDraft)) {
        rawDb
          .prepare("UPDATE foundation_workshop_states SET draft_json = ?, updated_at = ? WHERE project_id = ?")
          .run(JSON.stringify(sanitizedDraft), nowIso(), project.id);
        sanitizedWorkshopDrafts += 1;
      }
    }

    const cleanProjectPremise = resolveAuditProjectPremise({
      projectPremise: project.premise,
      foundationPremise: authoritativePremise,
      workshopPremise,
    });
    if (cleanProjectPremise !== String(project.premise ?? "")) {
      rawDb
        .prepare("UPDATE projects SET premise = ?, updated_at = ? WHERE id = ?")
        .run(cleanProjectPremise, nowIso(), project.id);
      sanitizedProjectPremises += 1;
    }

    const projectMeta = await readProjectMeta(project.id);
    const normalizedMeta = normalizeProjectMetaForAudit(projectMeta, cleanProjectPremise);
    if (projectMeta && JSON.stringify(projectMeta) !== JSON.stringify(normalizedMeta)) {
      await writeProjectMeta(project.id, normalizedMeta ?? {});
      sanitizedProjectMetas += 1;
    }

    const recurring = recalculateAutoRecurringCharacterCards(project.id);
    const afterMetrics = await computePollutionMetrics(project.id);
    const afterSnapshot = await snapshotProject(project.id);
    await writeFile(
      join(projectsDir, `${project.id}.after.json`),
      JSON.stringify(afterSnapshot, null, 2),
      "utf8",
    );

    cleanedInvalidCharacters += beforeMetrics.invalidFoundation;
    report.projects.push({
      projectId: project.id,
      title: project.title,
      cleanedInvalidCharacters,
      foundationImported: foundationSync.imported,
      foundationUpgraded: foundationSync.upgraded,
      recurringDraftsCreated: recurring.created,
      recurringDraftsRefreshed: recurring.updated,
      recurringDraftsDeleted: recurring.deleted,
      sanitizedProjectPremises,
      sanitizedWorkshopDrafts,
      sanitizedProjectMetas,
      pollutedProjectPremise: afterMetrics.pollutedProjectPremise,
      pollutedFoundationPremise: afterMetrics.pollutedFoundationPremise,
      pollutedWorkshopDraft: afterMetrics.pollutedWorkshopDraft,
      pollutedProjectMeta: afterMetrics.pollutedProjectMeta,
      pollutionRate: afterMetrics.pollutionRate,
    });

    report.totals.cleanedInvalidCharacters += cleanedInvalidCharacters;
    report.totals.recurringDraftsCreatedOrRefreshed += recurring.created + recurring.updated;
    report.totals.sanitizedProjectPremises += sanitizedProjectPremises;
    report.totals.sanitizedWorkshopDrafts += sanitizedWorkshopDrafts;
    report.totals.sanitizedProjectMetas += sanitizedProjectMetas;
  }

  const totalProjects = report.projects.length;
  report.totals.pollutionRate = totalProjects
    ? report.projects.reduce((sum, project) => sum + Number(project.pollutionRate ?? 0), 0) / totalProjects
    : 0;

  await writeFile(join(rootDir, "report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log(`已清理 ${report.totals.cleanedInvalidCharacters} 个非法角色`);
  console.log(`新建/刷新 ${report.totals.recurringDraftsCreatedOrRefreshed} 个 recurring draft`);
  console.log(`已净化 ${report.totals.sanitizedProjectPremises} 个项目 premise`);
  console.log(`已净化 ${report.totals.sanitizedWorkshopDrafts} 个 workshop draft`);
  console.log(`已净化 ${report.totals.sanitizedProjectMetas} 个 project meta`);
  console.log(`当前污染率为 ${(report.totals.pollutionRate * 100).toFixed(2)}%`);
  console.log(`审计快照目录：${rootDir}`);
}

async function restoreFromSnapshot(snapshotDir: string) {
  const projectsDir = join(resolve(process.cwd(), snapshotDir), "projects");
  const files = (await readdir(projectsDir)).filter((file) => file.endsWith(".before.json"));

  rawDb.transaction(() => {
    for (const file of files) {
      const projectId = basename(file, ".before.json");
      rawDb.prepare("DELETE FROM project_card_messages WHERE project_id = ?").run(projectId);
      rawDb.prepare("DELETE FROM card_progressions WHERE project_id = ?").run(projectId);
      rawDb.prepare("DELETE FROM project_cards WHERE project_id = ?").run(projectId);
      rawDb.prepare("DELETE FROM foundations WHERE project_id = ?").run(projectId);
      rawDb.prepare("DELETE FROM foundation_workshop_states WHERE project_id = ?").run(projectId);
    }
  })();

  for (const file of files) {
    const payload = JSON.parse(await readFile(join(projectsDir, file), "utf8")) as SnapshotPayload;
    rawDb.transaction(() => {
      const projectRow = payload.tables.projects?.[0];
      if (projectRow) {
        const columns = Object.keys(projectRow).filter((column) => column !== "id");
        if (columns.length) {
          const assignments = columns.map((column) => `${column} = ?`).join(", ");
          rawDb.prepare(`UPDATE projects SET ${assignments} WHERE id = ?`).run(
            ...columns.map((column) => projectRow[column]),
            projectRow.id,
          );
        }
      }
      insertRows("foundation_workshop_states", payload.tables.foundation_workshop_states ?? []);
      insertRows("foundations", payload.tables.foundations ?? []);
      insertRows("project_cards", payload.tables.project_cards ?? []);
      insertRows("project_card_messages", payload.tables.project_card_messages ?? []);
      insertRows("card_progressions", payload.tables.card_progressions ?? []);
    })();

    if (payload.projectMeta) {
      await writeProjectMeta(payload.projectId, payload.projectMeta);
    } else {
      const projectMetaPath = withinProject(payload.projectId, "project.yaml");
      if (existsSync(projectMetaPath)) {
        await unlink(projectMetaPath);
      }
    }
  }

  console.log(`已从 ${snapshotDir} 恢复 project/foundation/workshop/cards 快照`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--full")) {
    await runFullAudit();
    return;
  }
  const restoreIndex = args.indexOf("--restore");
  if (restoreIndex >= 0) {
    const target = args[restoreIndex + 1];
    if (!target) {
      usageAndExit();
    }
    await restoreFromSnapshot(target);
    return;
  }
  usageAndExit();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
