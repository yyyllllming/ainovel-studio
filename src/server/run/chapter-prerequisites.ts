import { ensureChapterArtifactsReady } from "../commit/chapter-artifact-sync.ts";
import { ensureBlueprintGenerated, generateBlueprint } from "../services/blueprint-generate.service.ts";
import type { ProjectExecutionContext } from "../services/project-execution-context.ts";
import type { ContextPack } from "../types.ts";
import { assembleContextPack } from "./context-engine.ts";

export interface ChapterPrerequisiteInput {
  projectId: string;
  chapterNo: number;
  blueprintReason?: string;
  sessionId?: string;
  executionContext?: ProjectExecutionContext;
}

export interface ChapterPrerequisiteDependencies {
  ensurePreviousArtifacts: typeof ensureChapterArtifactsReady;
  ensureBlueprint: (projectId: string, chapterNo: number) => Promise<unknown>;
  regenerateBlueprint: (
    projectId: string,
    chapterNo: number,
    reason?: string,
    sessionId?: string,
    executionContext?: ProjectExecutionContext,
  ) => Promise<unknown>;
  assembleContext: (projectId: string, chapterNo: number) => Promise<ContextPack>;
}

const defaultDependencies: ChapterPrerequisiteDependencies = {
  ensurePreviousArtifacts: ensureChapterArtifactsReady,
  ensureBlueprint: ensureBlueprintGenerated,
  regenerateBlueprint: generateBlueprint,
  assembleContext: assembleContextPack,
};

export async function prepareChapterPrerequisites(
  input: ChapterPrerequisiteInput,
  dependencies: ChapterPrerequisiteDependencies = defaultDependencies,
) {
  await dependencies.ensurePreviousArtifacts(
    input.projectId,
    input.chapterNo - 1,
    input.executionContext,
  );

  if (input.blueprintReason) {
    await dependencies.regenerateBlueprint(
      input.projectId,
      input.chapterNo,
      input.blueprintReason,
      input.sessionId,
      input.executionContext,
    );
  } else {
    await dependencies.ensureBlueprint(input.projectId, input.chapterNo);
  }

  return dependencies.assembleContext(input.projectId, input.chapterNo);
}
