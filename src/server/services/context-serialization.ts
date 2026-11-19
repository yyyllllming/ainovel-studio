import "../server-only.ts";

import { formatStyleProfileForStage } from "../style/style-steering.ts";
import { estimateModelTokens } from "../text-metrics.ts";
import type { ContextPack, ContextUsage } from "../types.ts";
import { formatWritingDnaForPrompt } from "../writing/writing-dna.ts";

export function serializeContextPackSections(contextPack: ContextPack) {
  const serializedFacts = contextPack.facts.map((fact) => `- [${fact.type}] ${fact.content}`).join("\n");
  const serializedCharacters = contextPack.requiredCards
    .map((card) => `- ${card.name}: ${card.role} / 目标=${card.goal} / 特质=${card.traits.join("、")}`)
    .join("\n");
  const serializedWorld = contextPack.worldviewCards
    .map((card) => `- ${card.name}: ${card.description}`)
    .join("\n");
  const serializedSummaries = [
    ...contextPack.summaryWindow.recentFullChapters,
    ...contextPack.summaryWindow.detailedSummaries,
    ...contextPack.summaryWindow.briefSummaries,
  ].join("\n\n");
  const serializedCharacterStates = contextPack.memory.characterStates
    .map((entry) => `- ${entry.name}: ${entry.summary}`)
    .join("\n");
  const serializedThreads = contextPack.memory.activeThreads
    .map((thread) => `- [${thread.priority}] 第${thread.openedChapter}章起：${thread.content}`)
    .join("\n");
  const serializedHookDiagnostics = contextPack.memory.hookDiagnostics
    ? [
        `- summary: planned=${contextPack.memory.hookDiagnostics.plannedCount} / bound=${contextPack.memory.hookDiagnostics.boundCount} / debt=${contextPack.memory.hookDiagnostics.missingSetupCount} / overdue=${contextPack.memory.hookDiagnostics.overdueCount} / dead=${contextPack.memory.hookDiagnostics.deadCount}`,
        ...contextPack.memory.hookDiagnostics.items
          .filter((item) => item.setupState === "missing" || item.overdue || item.dead || item.duplicateOfHookPlanId)
          .slice(0, 4)
          .map((item) => {
            if (item.setupState === "missing") {
              return `- debt: 第${item.setupChapter}章「${item.setupText}」没有稳定 setup evidence`;
            }
            if (item.dead) {
              return `- dead: 第${item.setupChapter}章「${item.setupText}」已超窗且持续悬挂`;
            }
            if (item.overdue) {
              return `- overdue: 第${item.setupChapter}章「${item.setupText}」超过预计回收窗口`;
            }
            if (item.duplicateOfHookPlanId) {
              return `- duplicate: 第${item.setupChapter}章「${item.setupText}」与更早 hook 高度相似`;
            }
            return "";
          })
          .filter(Boolean),
      ].join("\n")
    : "";
  const serializedLorebook = contextPack.lorebook.entries
    .map((entry) => `- ${entry.title}: ${entry.content}`)
    .join("\n");

  return {
    serializedFacts,
    serializedCharacters,
    serializedWorld,
    serializedSummaries,
    serializedStyleProfile: formatStyleProfileForStage(contextPack.styleProfile, "writer"),
    serializedWritingDna: formatWritingDnaForPrompt(contextPack.writingDna),
    serializedCharacterStates,
    serializedThreads,
    serializedHookDiagnostics,
    serializedLorebook,
    serializedPreviousChapterTail: contextPack.previousChapterTail?.trim() ?? "",
    serializedSteeringNotes: contextPack.memory.sceneSteeringNotes.join("\n"),
    serializedWriterNotes: contextPack.writerNotes.join("\n"),
    serializedFutureContext: contextPack.futureContext,
    serializedPlannerContextSummary: contextPack.plannerContextSummary,
  };
}

export function measureReviewMessages(
  messages: Array<{ role: string; content: string }>,
  budgetTokens: number,
): ContextUsage {
  const payload = JSON.stringify(messages);
  const sectionUsage: ContextUsage["sectionUsage"] = {};
  let contentChars = 0;
  messages.forEach((message, index) => {
    const serializedChars = message.content.length;
    contentChars += serializedChars;
    sectionUsage[`${index}:${message.role}`] = {
      estimatedTokens: estimateModelTokens(message.content),
      serializedChars,
    };
  });
  const overheadChars = Math.max(0, payload.length - contentChars);
  sectionUsage.payloadOverhead = {
    estimatedTokens: Math.max(0, estimateModelTokens(payload) - Object.values(sectionUsage).reduce(
      (sum, section) => sum + section.estimatedTokens,
      0,
    )),
    serializedChars: overheadChars,
  };
  return {
    budgetTokens,
    estimatedInputTokens: estimateModelTokens(payload),
    serializedChars: payload.length,
    sectionUsage,
  };
}
