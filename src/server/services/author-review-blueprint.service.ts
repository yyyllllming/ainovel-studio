import "../server-only.ts";

import { writeBlueprintFile } from "../project-files.ts";
import {
  getBlueprint,
  getFoundation,
  saveBlueprint,
} from "../repositories/foundation.repository.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import type { ChapterBlueprint, FoundationPayload } from "../types.ts";

export interface AuthorReviewBlueprintInput {
  chapterNo: number;
  title: string;
  content: string;
}

export interface AuthorReviewBlueprintDependencies {
  getBlueprint(projectId: string, chapterNo: number): ChapterBlueprint | null;
  getFoundation(projectId: string): FoundationPayload | null;
  saveBlueprint(projectId: string, blueprint: ChapterBlueprint): ChapterBlueprint;
  writeBlueprintFile(projectId: string, blueprint: ChapterBlueprint): Promise<unknown>;
  appendRunLog(projectId: string, level: "info", message: string): unknown;
}

const LOCATION_NAME_PATTERN = /(?:处|街|城|港|站|楼|室|馆|院|桥|巷|路|码头|广场|仓库|办公室|车站)$/u;

function compact(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

function narrativeLength(content: string) {
  return Array.from(content.replace(/\s/gu, "")).length;
}

export function buildAuthorReviewBlueprint(
  foundation: FoundationPayload,
  input: AuthorReviewBlueprintInput,
): ChapterBlueprint {
  const mentionedCharacters = foundation.characters
    .filter((character) => input.content.includes(character.name))
    .map((character) => character.name);
  const fallbackCharacter = foundation.characters.find((character) => character.role === "protagonist")
    ?? foundation.characters[0];
  const characters = mentionedCharacters.length > 0
    ? mentionedCharacters
    : fallbackCharacter
      ? [fallbackCharacter.name]
      : [];
  const locations = foundation.worldview
    .filter((rule) => LOCATION_NAME_PATTERN.test(rule.name) && input.content.includes(rule.name))
    .map((rule) => rule.name);
  const activeRules = foundation.worldview
    .filter((rule) => !LOCATION_NAME_PATTERN.test(rule.name) && input.content.includes(rule.name))
    .map((rule) => `${rule.name}：${compact(rule.description, 90)}`);
  const mainline = foundation.mainline?.trim() || foundation.premise?.trim() || "核验本章对既有故事约束的推进";
  const storyHook = foundation.storyHook?.trim() ?? "";
  const conflicts = activeRules.length > 0
    ? activeRules
    : [`主线约束：${compact(mainline, 120)}`];
  const actualLength = narrativeLength(input.content);

  return {
    chapterNo: input.chapterNo,
    sceneGoal: `完成作者稿“${compact(input.title, 80)}”的核心行动，并形成可由审查器核验的主线推进。`,
    characters,
    locations,
    conflicts,
    foreshadows: input.chapterNo === 1 && storyHook
      ? [compact(storyHook, 120)]
      : [],
    hookGuidanceMode: "unguided",
    emotionalTone: compact(foundation.styleCard, 100) || "克制、具体、保持叙事压力",
    estimatedWords: Math.max(800, Math.min(8_000, actualLength)),
    requiredProgressDelta: "information_shift",
    actionPattern: "investigation",
    sourcePlanGenerationId: null,
  };
}

export function createAuthorReviewBlueprintService(
  input?: Partial<AuthorReviewBlueprintDependencies>,
) {
  const deps: AuthorReviewBlueprintDependencies = {
    getBlueprint,
    getFoundation,
    saveBlueprint,
    writeBlueprintFile,
    appendRunLog,
    ...input,
  };

  return {
    async ensure(projectId: string, blueprintInput: AuthorReviewBlueprintInput) {
      const existing = deps.getBlueprint(projectId, blueprintInput.chapterNo);
      if (existing) return existing;
      const foundation = deps.getFoundation(projectId);
      if (!foundation) throw new Error("设定尚未生成，无法建立作者稿审查基线");
      const saved = deps.saveBlueprint(
        projectId,
        buildAuthorReviewBlueprint(foundation, blueprintInput),
      );
      await deps.writeBlueprintFile(projectId, saved);
      deps.appendRunLog(projectId, "info", `已建立第 ${blueprintInput.chapterNo} 章作者稿确定性审查基线`);
      return saved;
    },
  };
}

export async function ensureAuthorReviewBlueprint(
  projectId: string,
  input: AuthorReviewBlueprintInput,
) {
  return createAuthorReviewBlueprintService().ensure(projectId, input);
}
