import { classifyReviewRepairPath } from "../run/run-decisions.ts";
import type { QuickAuditVerdict, ReviewVerdict } from "../types.ts";
import { rewriteSceneStructure } from "./scene-rescue.ts";
import type { SceneCard, VoiceBrief } from "./types.ts";

type RepairReview = Pick<
  ReviewVerdict | QuickAuditVerdict,
  "issues" | "fixInstructions" | "reason" | "styleChecklistHits" | "charterViolations" | "loopRisk" | "storyProgression"
>;

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export function deriveVoicePolishIssues(chapterContent: string) {
  const issues: string[] = [];
  if (/总结来说|总之|由此可见/u.test(chapterContent)) {
    issues.push("summary_first");
  }
  if (/先解释|先说明|这意味着/u.test(chapterContent)) {
    issues.push("explanation_heavy");
  }
  return issues;
}

export function buildReviewRepairPlan(input: {
  chapterContent: string;
  review: RepairReview;
  sceneCards: SceneCard[];
  voiceBrief: VoiceBrief;
}) {
  const repairPath = classifyReviewRepairPath({
    review: input.review,
  });

  if (repairPath === "scene_rescue") {
    const rescue = rewriteSceneStructure({
      chapterContent: input.chapterContent,
      sceneCards: input.sceneCards,
    });
    return {
      repairPath,
      rewriteInstructions: rescue.rewriteInstructions,
      fixInstructions: uniqueNonEmpty([
        input.review.fixInstructions,
        ...rescue.rewriteInstructions,
      ]).join("\n"),
      voicePolishIssues: [] as string[],
    };
  }

  return {
    repairPath,
    rewriteInstructions: input.voiceBrief.polishPlan,
    fixInstructions: uniqueNonEmpty([
      input.review.fixInstructions,
      ...input.voiceBrief.polishPlan,
    ]).join("\n"),
    voicePolishIssues: deriveVoicePolishIssues(input.chapterContent),
  };
}
