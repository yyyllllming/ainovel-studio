import type { StyleExcerpt, StyleProfile, WritingCharter } from "../types.ts";

export type ObligationCardType =
  | "continuity"
  | "foreshadow"
  | "relationship"
  | "mechanic"
  | "mythic";

export interface ObligationCard {
  id: string;
  type: ObligationCardType;
  mustHold: string;
  canHint: string;
  doNotRepeat: string;
  expiryChapter: number | null;
}

export type SceneHookType =
  | "new_risk"
  | "new_discovery"
  | "position_shift"
  | "relation_shift"
  | "emotional_close"
  | "explicit_summary";

export interface SceneCard {
  id: string;
  label: string;
  objective: string;
  obstacle: string;
  irreversibleChange: string;
  hookType: SceneHookType;
  requiredAnchors: string[];
}

export interface StructurePlan {
  storyBrief: string;
  structureBrief: string;
  sceneCards: SceneCard[];
  obligationCards: ObligationCard[];
  riskFlags: string[];
}

export interface StructureScore {
  score: number;
  risk: "pass" | "watch" | "risk";
  flags: string[];
}

export interface ProjectVoiceSnapshot {
  id: string;
  version: number;
  updatedAt: string;
  sourceChapterNos: number[];
  digest: string;
  positiveAnchors: string[];
  antiPatterns: string[];
  exemplars: StyleExcerpt[];
}

export interface VoicePack {
  projectId: string;
  projectVoiceSnapshot: ProjectVoiceSnapshot | null;
  styleProfile: StyleProfile;
  writingCharter: WritingCharter | null;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  positiveAnchors: string[];
  antiPatterns: string[];
  externalAnchors: string[];
}

export interface VoiceBrief {
  summary: string;
  positiveAnchors: string[];
  antiPatterns: string[];
  exemplarSource: "project_voice_snapshot" | "style_snapshot" | "fallback";
  preferredExemplars: StyleExcerpt[];
  polishPlan: string[];
}

export interface VoiceScore {
  score: number;
  consistency: "strong" | "mixed" | "weak";
  matchedAnchors: string[];
  missingAnchors: string[];
}

export interface SceneRescueResult {
  sceneCards: SceneCard[];
  appliedFixes: string[];
  rewriteInstructions: string[];
}

export interface EvalCorpusEntry {
  id: string;
  chapterNo: number;
  kind: "opening" | "recovery_stress";
  content: string;
}

export interface EvalCorpus {
  projectId: string;
  entries: EvalCorpusEntry[];
}

export interface EvalMetricScore {
  score: number;
  notes: string[];
}

export interface EvalReportEntry {
  id: string;
  chapterNo: number;
  kind: EvalCorpusEntry["kind"];
  structureProgression: EvalMetricScore;
  arenaOpponentLoop: EvalMetricScore;
  proseReadability: EvalMetricScore;
  aiSmell: EvalMetricScore;
  voiceConsistency: EvalMetricScore;
}

export interface EvalReport {
  projectId: string;
  entries: EvalReportEntry[];
  aggregate: {
    structureProgression: EvalMetricScore;
    arenaOpponentLoop: EvalMetricScore;
    proseReadability: EvalMetricScore;
    aiSmell: EvalMetricScore;
    voiceConsistency: EvalMetricScore;
  };
}
