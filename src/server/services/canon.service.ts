import "../server-only.ts";

import { readCanonFacts } from "../project-files.ts";
import { listConflicts } from "../repositories/review.repository.ts";

export async function listCanonFactsForProject(input: {
  projectId: string;
  chapterNo?: number | null;
  type?: string | null;
  keyword?: string | null;
}) {
  let facts = await readCanonFacts(input.projectId);

  if (typeof input.chapterNo === "number" && Number.isFinite(input.chapterNo)) {
    facts = facts.filter((fact) => fact.chapterNo === input.chapterNo);
  }
  if (input.type) {
    facts = facts.filter((fact) => fact.type === input.type);
  }
  if (input.keyword) {
    facts = facts.filter(
      (fact) =>
        fact.content.includes(input.keyword!)
        || fact.keywords.some((item) => item.includes(input.keyword!)),
    );
  }

  return facts;
}

export function listCanonConflictsForProject(projectId: string) {
  return listConflicts(projectId);
}
