export type AgentRole = "coauthor" | "planner" | "writer" | "reviewer";

export type ProfileProtocol = "openai_compatible";

export interface LlmProfile {
  id: string;
  name: string;
  providerId: string;
  protocol: ProfileProtocol;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LlmProfileFile {
  version: number;
  profiles: LlmProfile[];
}

export interface AgentAssignmentInput {
  role: AgentRole;
  profileId: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface CharacterCard {
  name: string;
  role: string;
  goal: string;
  traits: string[];
  secrets?: string[];
}

export interface WorldRule {
  name: string;
  description: string;
}

export interface RelationshipEdge {
  source: string;
  target: string;
  label: string;
}
