export type StyleReferenceKind = "book" | "author";
export type StyleReferenceSource = "network" | "ai_fallback";
export type StyleReferenceRelation = "primary" | "secondary";
export type StyleImportMode = "book" | "author";
export type StyleConfidence = "low" | "medium" | "high";
export type StyleExcerptTag =
  | "narrative"
  | "dialogue"
  | "conflict"
  | "emotion"
  | "mechanism"
  | "hook"
  | "silence"
  | "pressure";

export const WRITING_CHARTER_BUDGET_KEYS = [
  "ending_conclusion_sentence",
  "mechanism_explicit_summary",
  "mechanism_triad_pattern",
  "transition_contrast_template",
  "transition_abrupt_turn",
  "transition_hard_marker",
  "simile_per_chapter",
  "simile_per_paragraph",
  "rhetoric_density",
  "sensory_density",
  "subject_pronoun_lead",
  "subject_dominant_lead",
  "subject_window_repeat",
  "motif_reuse",
] as const;

export type WritingCharterBudgetKey = (typeof WRITING_CHARTER_BUDGET_KEYS)[number];

export const WRITING_CHARTER_BUDGET_LABELS: Record<WritingCharterBudgetKey, string> = {
  ending_conclusion_sentence: "章末策略/结论句",
  mechanism_explicit_summary: "机制露出策略/显性总结句",
  mechanism_triad_pattern: "机制露出策略/解释 -> 验证 -> 总结三段式",
  transition_contrast_template: "转场预算/不是……而是……模板",
  transition_abrupt_turn: "转场预算/忽然类突转",
  transition_hard_marker: "转场预算/硬转词",
  simile_per_chapter: "比喻预算/全章",
  simile_per_paragraph: "比喻预算/单段",
  rhetoric_density: "修辞预算/千字密度",
  sensory_density: "感官预算/千字密度",
  subject_pronoun_lead: "主体起句预算/代词起句",
  subject_dominant_lead: "主体起句预算/单主体句首",
  subject_window_repeat: "主体起句预算/窗口复用",
  motif_reuse: "母题复用预算/同一意象回钉",
};

export interface StyleReferenceCandidate {
  id: string;
  kind: StyleReferenceKind;
  label: string;
  author?: string;
  source: StyleReferenceSource;
  hint: string;
  origin?: string;
}

export interface StyleReferenceSelection {
  kind: StyleReferenceKind;
  label: string;
  author?: string;
  source: StyleReferenceSource;
  relation: StyleReferenceRelation;
}

export interface StyleExcerpt {
  id: string;
  sourceId: string;
  sourceTitle: string;
  label: string;
  tags: StyleExcerptTag[];
  content: string;
  wordCount: number;
  startOffset: number;
  endOffset: number;
  positionRatio: number;
  dialogueRatio: number;
}

export interface StyleReferenceImport {
  id: string;
  projectId: string;
  title: string;
  author?: string;
  originalFileName: string;
  mediaType: string;
  sourceHash: string;
  rawFilePath: string;
  normalizedFilePath: string;
  wordCount: number;
  encoding: string;
  confidence: StyleConfidence;
  chapterCount: number;
  excerpts: StyleExcerpt[];
  createdAt: string;
}

export interface StyleProfile {
  referenceAnchor: {
    primary: string;
    secondary: string[];
  };
  paragraphCadence: {
    narrativeRule: string;
    dialogueRule: string;
    emphasisRule: string;
  };
  sentenceRhythm: {
    pacingRule: string;
    transitionRule: string;
    pauseRule: string;
  };
  narrativeDistance: {
    intimacyRule: string;
    expositionRule: string;
    textureRule: string;
  };
  dialogueStyle: {
    voiceRule: string;
    subtextRule: string;
    distinctionRule: string;
  };
  rhetoricRegister: {
    densityRule: string;
    preferredDevices: string;
    avoidDevices: string[];
  };
  narrativeRhythmDNA: {
    pacingPattern: string;
    tensionRule: string;
    breathingRule: string;
  };
  emotionSpectrum: {
    renderingPreference: string;
    restraintRule: string;
    transitionRule: string;
  };
  deepTexture: {
    perspectiveRule: string;
    temporalRule: string;
    whitespaceRule: string;
    sensoryRule: string;
  };
  imageryRegister: {
    densityRule: string;
    textureRule: string;
    avoid: string[];
  };
  forbiddenLexicon: string[];
  toneGuardrails: string[];
  openingStrategy: string;
  infoRevealRule: string;
  emotionRenderingRule: string;
  chapterClosureRule: string;
  writingCharter?: WritingCharter;
  aiSmellPatterns: string[];
  styleTaboos: string[];
}

export interface WritingCharter {
  chapterLengthRule: string;
  openingMoveRule: string;
  infoRevealRule: string;
  mechanismRevealRule: string;
  mechanismRevealRedlines: string[];
  emotionLandingRule: string;
  chapterClosureRule: string;
  transitionRule: string;
  pauseRule: string;
  endingPolicy: EndingPolicy;
  mechanismRevealPolicy: MechanismRevealPolicy;
  transitionBudget: TransitionBudget;
  simileBudget: SimileBudget;
  rhetoricBudget: RhetoricBudget;
  sensoryBudget: SensoryBudget;
  subjectLeadBudget: SubjectLeadBudget;
  motifReuseBudget: MotifReuseBudget;
  aiFlavorAvoidance: string[];
  tabooReminders: string[];
}

export interface EndingPolicy {
  maxConclusionSentences: number;
  conclusionMarkers: string[];
}

export interface MechanismRevealPolicy {
  maxExplicitSummarySentences: number;
  maxTriadPatterns: number;
  explanationMarkers: string[];
  verificationMarkers: string[];
  summaryMarkers: string[];
  mechanismKeywords: string[];
}

export interface TransitionBudget {
  maxContrastTemplates: number;
  maxAbruptTurns: number;
  maxHardTransitionMarkers: number;
  hardTransitionMarkers: string[];
}

export interface SimileBudget {
  maxPerChapter: number;
  maxPerParagraph: number;
}

export interface RhetoricBudget {
  simileDensityPerThousand: number;
  personificationDensityPerThousand: number;
  rhetoricalQuestionPerChapter: number;
  dominantDevice: string;
}

export interface SensoryBudget {
  sensoryDetailTargetPerThousand: number;
  primaryChannels: string[];
}

export interface SubjectLeadBudget {
  maxPronounLeads: number;
  maxDominantLeadCount: number;
  maxSameLeadInWindow: number;
  windowSize: number;
}

export interface MotifReuseBudget {
  maxPerMotif: number;
  minParagraphSpan: number;
  minMotifLength: number;
  stopwords: string[];
}

export type MotifReuseSeverity = "lexical" | "structural";

export interface WritingCharterBudgetViolation {
  key: WritingCharterBudgetKey;
  scope: "ending" | "mechanism" | "transition" | "simile" | "rhetoric" | "sensory" | "subject_lead" | "motif_reuse";
  label: string;
  actual: number;
  limit: number;
  detail: string;
  evidence: string[];
  severity: "minor" | "major";
  reuseSeverity?: MotifReuseSeverity | null;
}

export interface StyleReferenceInterpretation {
  narrativeDistance: string;
  infoDelivery: string;
  paragraphRhythm: string;
  dialogueBreathing: string;
  emotionRendering: string;
  chapterClosure: string;
  forbiddenPatterns: string[];
  signature: string;
}

export interface StyleCardSnapshot {
  id: string;
  projectId: string;
  mode: StyleImportMode;
  sourceIds: string[];
  styleCard: string;
  styleProfile: StyleProfile;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  sampledExcerpts: StyleExcerpt[];
  confidence: StyleConfidence;
  version: number;
  createdAt: string;
}

export interface ActiveStylePackage {
  styleSnapshotId: string | null;
  styleSnapshotVersion: number | null;
  styleCard: string;
  styleProfile: StyleProfile;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  confidence: StyleConfidence | null;
  sampledExcerpts: StyleExcerpt[];
  sourceIds: string[];
}

export interface WritingDnaProfile {
  sourceTags: string[];
  planningRules: string[];
  sceneRules: string[];
  voiceRules: string[];
  antiAiRules: string[];
  reviewChecklist: string[];
}
