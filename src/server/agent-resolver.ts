import "./server-only.ts";

import { buildResolvedAgentMap, type ProjectAgentRole } from "./domain/agent-assignments.ts";
import { snapshotProfiles } from "./profiles.ts";
import { getAssignments } from "./repositories/project.repository.ts";
import type { AgentAssignmentInput, LlmProfile } from "./types.ts";

export interface ResolvedAgent {
  profile: LlmProfile;
  assignment: AgentAssignmentInput;
}

export async function resolveProjectAgents(projectId: string) {
  const profiles = await snapshotProfiles();
  const assignments = getAssignments(projectId);
  const agents = buildResolvedAgentMap(assignments, profiles);

  return Object.fromEntries(
    Object.entries(agents).map(([role, value]) => [
      role,
      {
        profile: value.profile as LlmProfile,
        assignment: value.assignment as AgentAssignmentInput,
      } satisfies ResolvedAgent,
    ]),
  ) as Record<ProjectAgentRole, ResolvedAgent>;
}
