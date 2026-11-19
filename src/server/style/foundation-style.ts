import "../server-only.ts";

import { notFound } from "../errors.ts";

import { nanoid } from "nanoid";
import type { ChatMessage } from "../llm.ts";
import { WORKFLOW_TOKEN_CAPS, capByAssignment } from "../llm-token-policy.ts";
import {
  writeFoundationFiles,
  writeStyleReferenceImportFiles,
  writeStyleSnapshotFile,
} from "../project-files.ts";
import {
  prepareStyleReferenceImport,
  toStyleReferenceImportRecord,
} from "./style-reference-import.ts";
import { generateStyleCardSnapshot } from "./style-snapshot.ts";
import { nowIso } from "../utils.ts";
import { getProject } from "../repositories/project.repository.ts";
import { getFoundationWorkshopState } from "../repositories/foundation.repository.ts";
import {
  applyStyleCardSnapshot,
  getNextStyleSnapshotVersion,
  getStyleCardSnapshot,
  getStyleReferenceImportsByIds,
  listStyleCardSnapshots,
  listStyleReferenceImports,
  saveStyleCardSnapshot,
  saveStyleReferenceImport,
} from "../repositories/style.repository.ts";
import { sanitizeProjectPremise } from "../foundation/foundation-summary-sanitizer.ts";

function buildWorkshopWorldContext(projectId: string) {
  const draft = getFoundationWorkshopState(projectId)?.draft;
  if (!draft) {
    return "";
  }
  return [
    ...draft.worldviewIdeas.map((entry) => `${entry.name}:${entry.description}`),
    ...draft.relationshipIdeas.map((entry) => `${entry.source}-${entry.label}-${entry.target}`),
  ].join("；");
}

function buildWorkshopContext(projectId: string) {
  const draft = getFoundationWorkshopState(projectId)?.draft;
  return draft?.unresolvedQuestions?.join("；") ?? "";
}

/** @deprecated 项目级风格参考导入仅保留兼容用途；新的 TXT 导入入口应使用作者卡库。 */
export async function importFoundationStyleReference(projectId: string, input: {
  fileName: string;
  mediaType?: string;
  title?: string;
  author?: string;
  buffer: Buffer;
}) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const prepared = prepareStyleReferenceImport({
    buffer: input.buffer,
    fileName: input.fileName,
    mediaType: input.mediaType,
    title: input.title,
    author: input.author,
  });
  const importId = nanoid();
  const createdAt = nowIso();
  const paths = await writeStyleReferenceImportFiles({
    projectId,
    importId,
    originalFileName: prepared.originalFileName,
    title: prepared.title,
    rawBuffer: input.buffer,
    normalizedText: prepared.normalizedText,
  });

  return saveStyleReferenceImport(
    projectId,
    toStyleReferenceImportRecord(projectId, {
      ...prepared,
      id: importId,
      rawFilePath: paths.rawPath,
      normalizedFilePath: paths.normalizedPath,
      createdAt,
    }),
  );
}

export function listFoundationStyleImports(projectId: string) {
  return listStyleReferenceImports(projectId);
}

/** @deprecated 项目级深度分析仅保留兼容用途；新的书级 / 作者级生成入口应使用作者卡库。 */
export async function createFoundationStyleSnapshot(
  projectId: string,
  input: { mode: "book" | "author"; sourceIds: string[] },
  options?: { llmCall?: (messages: ChatMessage[]) => Promise<string> },
) {
  const project = getProject(projectId);
  const workshop = getFoundationWorkshopState(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const imports = getStyleReferenceImportsByIds(projectId, input.sourceIds);
  if (imports.length !== input.sourceIds.length) {
    throw new Error("存在未找到的导入源，无法生成 snapshot");
  }

  const version = getNextStyleSnapshotVersion(projectId);
  const llmCall = options?.llmCall ?? (async (messages: ChatMessage[]) => {
    const [{ resolveProjectAgents }, { chatCompletion }] = await Promise.all([
      import("../agent-resolver.ts"),
      import("../llm.ts"),
    ]);
    const { planner } = await resolveProjectAgents(projectId);
    return chatCompletion(
      planner.profile,
      planner.assignment.model,
      messages,
      {
        temperature: Math.min(planner.assignment.temperature + 0.1, 0.75),
        maxTokens: capByAssignment(planner.assignment.maxTokens, WORKFLOW_TOKEN_CAPS.foundationStyle.snapshotGeneration),
      },
    );
  });

  const snapshot = await generateStyleCardSnapshot({
    id: nanoid(),
    projectId,
    mode: input.mode,
    imports,
    version,
    genre: project.genre,
    premise: sanitizeProjectPremise(project.premise) || workshop?.draft.premise || "未填写",
    draft: workshop?.draft ?? null,
    references: workshop?.draft.styleReferences ?? [],
    samples: workshop?.draft.styleSamples ?? [],
    manualGuidance: workshop?.draft.styleManualGuidance,
    avoidances: workshop?.draft.styleAvoidances,
    worldContext: buildWorkshopWorldContext(projectId),
    workshopContext: buildWorkshopContext(projectId),
    llmCall,
  });

  const saved = saveStyleCardSnapshot(snapshot);
  if (!saved) {
    throw new Error("style snapshot 保存失败");
  }
  await writeStyleSnapshotFile(projectId, saved);
  return saved;
}

export function listFoundationStyleSnapshots(projectId: string) {
  return listStyleCardSnapshots(projectId);
}

export async function applyFoundationStyleSnapshot(projectId: string, snapshotId: string) {
  const applied = applyStyleCardSnapshot(projectId, snapshotId);
  if (!applied.foundation || !applied.workshopState) {
    throw new Error("style snapshot apply 失败");
  }

  await Promise.all([
    writeFoundationFiles(projectId, applied.foundation),
    writeStyleSnapshotFile(projectId, applied.snapshot),
  ]);

  return {
    snapshot: getStyleCardSnapshot(projectId, snapshotId) ?? applied.snapshot,
    foundation: applied.foundation,
    workshopState: applied.workshopState,
  };
}
