export const PROJECT_AGENT_ROLES = ["coauthor", "planner", "writer", "reviewer"] as const;

export type ProjectAgentRole = (typeof PROJECT_AGENT_ROLES)[number];

export interface AgentAssignmentValue {
  role: ProjectAgentRole;
  profileId: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface AgentProfileOption {
  id: string;
  defaultModel: string;
}

export interface EnabledProfileOption {
  id: string;
  enabled: boolean;
}

const ROLE_DEFAULTS: Record<ProjectAgentRole, Pick<AgentAssignmentValue, "temperature" | "maxTokens">> = {
  coauthor: {
    temperature: 0.7,
    maxTokens: 4096,
  },
  planner: {
    temperature: 0.7,
    maxTokens: 4096,
  },
  writer: {
    temperature: 0.9,
    maxTokens: 8192,
  },
  reviewer: {
    temperature: 0.2,
    maxTokens: 4096,
  },
};

function cloneAssignment(role: ProjectAgentRole, assignment: AgentAssignmentValue): AgentAssignmentValue {
  return {
    ...assignment,
    role,
  };
}

export function createDefaultAssignments(profiles: AgentProfileOption[]) {
  const profile = profiles[0];
  if (!profile) {
    return [] as AgentAssignmentValue[];
  }

  return PROJECT_AGENT_ROLES.map((role) => ({
    role,
    profileId: profile.id,
    model: profile.defaultModel,
    temperature: ROLE_DEFAULTS[role].temperature,
    maxTokens: ROLE_DEFAULTS[role].maxTokens,
  }));
}

export function normalizeProjectAssignments(assignments: AgentAssignmentValue[]) {
  const byRole = new Map<ProjectAgentRole, AgentAssignmentValue>();

  for (const assignment of assignments) {
    byRole.set(assignment.role, assignment);
  }

  const planner = byRole.get("planner");
  if (planner && !byRole.has("coauthor")) {
    byRole.set("coauthor", cloneAssignment("coauthor", planner));
  }

  return PROJECT_AGENT_ROLES.flatMap((role) => {
    const assignment = byRole.get(role);
    return assignment ? [assignment] : [];
  });
}

export function normalizeAssignments(assignments: AgentAssignmentValue[], profiles: AgentProfileOption[]) {
  const defaults = createDefaultAssignments(profiles);
  if (!defaults.length) {
    return normalizeProjectAssignments(assignments);
  }

  const normalized = normalizeProjectAssignments(assignments);
  const byRole = new Map<ProjectAgentRole, AgentAssignmentValue>(
    normalized.map((assignment) => [assignment.role, assignment]),
  );

  return PROJECT_AGENT_ROLES.map((role) => byRole.get(role) ?? defaults.find((item) => item.role === role)!).filter(
    Boolean,
  );
}

export function buildResolvedAgentMap<TProfile extends EnabledProfileOption>(
  assignments: AgentAssignmentValue[],
  profiles: TProfile[],
) {
  const normalized = normalizeProjectAssignments(assignments);
  const agents = {} as Record<ProjectAgentRole, { assignment: AgentAssignmentValue; profile: TProfile }>;

  for (const role of PROJECT_AGENT_ROLES) {
    const assignment = normalized.find((item) => item.role === role);
    if (!assignment) {
      throw new Error(`项目缺少 ${role} 模型配置`);
    }
    const profile = profiles.find((item) => item.id === assignment.profileId && item.enabled);
    if (!profile) {
      throw new Error(`${role} 绑定的 LLM Profile 不存在或未启用`);
    }
    agents[role] = { assignment, profile };
  }

  return agents;
}
