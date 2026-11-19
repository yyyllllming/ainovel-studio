import "../server-only.ts";

import type { ChapterBlueprint } from "../types.ts";
import { listWrittenChapters, readFinalChapter, readPlannerTraceFile } from "../project-files.ts";
import { getLatestCurrentReview } from "../services/review-content-identity.service.ts";

export function buildStaticPlannerExemplars(input: {
  activePackIds: string[];
  requiredDelta: string;
}) {
  const examples: string[] = [
    [
      "静态 exemplar（core-only）",
      "sceneGoal：让主角在新场域里拿到会改写下一步的新线索，并立刻承担代价。",
      "conflicts：必须先确认新线索如何改变当前目标；一旦伸手，旧压力会立刻转成新阻力。",
      "foreshadows：章末只留下一个下一章必须接住的新后患。",
      `requiredProgressDelta：${input.requiredDelta}`,
    ].join("\n"),
  ];

  if (input.activePackIds.includes("mythic_beastiary")) {
    examples.push([
      "静态 exemplar（mythic_beastiary）",
      "sceneGoal：让主角闯进会回应血气的怪地，并确认新的禁忌生态如何改写局势。",
      "conflicts：必须先判断怪地/异兽的怪规则；一旦误触，旧追迹者会顺着回响逼近。",
      "foreshadows：只留下更深层山海异谱或古禁的单一后患。",
      "requiredProgressDelta：world_shift",
    ].join("\n"));
  }

  if (input.activePackIds.includes("romance")) {
    examples.push([
      "静态 exemplar（romance）",
      "sceneGoal：让两人关系状态在本章内发生实质变化，并直接改写下一步选择。",
      "conflicts：必须让信任/立场/欲望冲突在场，不允许只做情绪复读。",
      "foreshadows：章末只钉一个下一章必须回应的关系后果。",
      "requiredProgressDelta：relationship_shift",
    ].join("\n"));
  }

  return examples;
}

export async function buildDynamicPlannerExemplars(projectId: string, chapterNo: number) {
  if (chapterNo < 4) {
    return [] as string[];
  }

  const writtenChapters = (await listWrittenChapters(projectId))
    .filter((value) => value < chapterNo)
    .sort((left, right) => right - left);
  const qualified: Array<{ chapterNo: number; blueprint: ChapterBlueprint }> = [];

  for (const writtenChapter of writtenChapters) {
    const content = await readFinalChapter(projectId, writtenChapter);
    const review = await getLatestCurrentReview(projectId, writtenChapter, content);
    if (review?.verdict !== "pass") {
      continue;
    }
    const trace = await readPlannerTraceFile(projectId, writtenChapter);
    if (!trace?.finalBlueprint || trace.fallbackUsed) {
      continue;
    }
    qualified.push({
      chapterNo: writtenChapter,
      blueprint: trace.finalBlueprint,
    });
    if (qualified.length >= 3) {
      break;
    }
  }

  if (qualified.length < 3) {
    return [] as string[];
  }

  return qualified.slice(0, 2).map((entry) => [
    `动态 exemplar（第 ${entry.chapterNo} 章）`,
    `sceneGoal：${entry.blueprint.sceneGoal}`,
    `conflicts：${entry.blueprint.conflicts.slice(0, 2).join("；")}`,
    `foreshadows：${entry.blueprint.foreshadows.slice(0, 1).join("；") || "无"}`,
    `requiredProgressDelta：${entry.blueprint.requiredProgressDelta ?? "无"}`,
  ].join("\n"));
}
