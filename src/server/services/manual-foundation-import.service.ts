import "../server-only.ts";

import { writeFoundationFiles } from "../project-files.ts";
import { saveFoundation } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import { syncConfirmedCardsFromProjectFoundation } from "./card.service.ts";
import { assertCanonicalFoundationOutput } from "./foundation-generate.service.ts";
import type { FoundationPayload } from "../types.ts";

export interface ManualFoundationImportDependencies {
  getProject(projectId: string): unknown | null;
  saveFoundation(projectId: string, foundation: FoundationPayload): FoundationPayload;
  syncConfirmedCards(projectId: string): unknown;
  writeFoundationFiles(projectId: string, foundation: FoundationPayload): Promise<unknown>;
  appendRunLog(projectId: string, level: "info", message: string): unknown;
}

export function createManualFoundationImportService(
  input?: Partial<ManualFoundationImportDependencies>,
) {
  const deps: ManualFoundationImportDependencies = {
    getProject,
    saveFoundation,
    syncConfirmedCards: syncConfirmedCardsFromProjectFoundation,
    writeFoundationFiles,
    appendRunLog,
    ...input,
  };

  return {
    async importFoundation(projectId: string, foundation: FoundationPayload) {
      if (!deps.getProject(projectId)) {
        throw new Error("项目不存在");
      }
      const canonicalFoundation = assertCanonicalFoundationOutput(foundation);
      const saved = deps.saveFoundation(projectId, canonicalFoundation);
      deps.syncConfirmedCards(projectId);
      await deps.writeFoundationFiles(projectId, saved);
      deps.appendRunLog(projectId, "info", "人工设定导入完成");
      return saved;
    },
  };
}

export async function importManualFoundation(projectId: string, foundation: FoundationPayload) {
  return createManualFoundationImportService().importFoundation(projectId, foundation);
}
