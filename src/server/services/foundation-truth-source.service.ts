import "../server-only.ts";

import { notFound } from "../errors.ts";
import { buildFoundationCoreFactsHash, createFoundationCoreEnvelope } from "../foundation/foundation-core-state.ts";
import {
  buildDerivedFoundationMeta,
  deriveDraftCoreSummaries,
  deriveFoundationCandidate,
} from "../foundation/foundation-candidate.ts";
import {
  sanitizeFoundationPayload,
  sanitizeFoundationWorkshopDraft,
  sanitizeProjectPremise,
} from "../foundation/foundation-summary-sanitizer.ts";
import { listFoundationPlaceholderResidueKinds } from "../foundation/foundation-quality-guards.ts";
import { getFoundation, getFoundationWorkshopEnvelopeState, listFoundationWorkshopMessages, saveFoundation, upsertFoundationWorkshopEnvelopeState } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import type {
  ActiveStylePackage,
  FoundationCoreEnvelope,
  FoundationDriftReport,
  FoundationPayload,
  FoundationWorkshopDraft,
} from "../types.ts";
import { buildFallbackStyleProfile } from "../style/style-steering.ts";

function toDraftFromFoundation(foundation: FoundationPayload | null): FoundationWorkshopDraft {
  return {
    premise: foundation?.premise ?? "",
    mainline: foundation?.mainline ?? "",
    storyHook: foundation?.storyHook ?? "",
    desiredTone: "default",
    characterIdeas: foundation?.characters ?? [],
    worldviewIdeas: foundation?.worldview ?? [],
    relationshipIdeas: foundation?.relationships ?? [],
    unresolvedQuestions: [],
    styleReferences: [],
    styleSamples: [],
    styleManualGuidance: "",
    styleAvoidances: "",
    styleSteeringCard: foundation?.styleCard ?? "",
    styleProfile: foundation?.styleProfile,
    styleSnapshotId: foundation?.styleSnapshotId ?? null,
    styleSnapshotVersion: foundation?.styleSnapshotVersion ?? null,
    styleDigest: foundation?.styleDigest ?? "",
    styleExemplars: foundation?.styleExemplars ?? [],
  };
}

function buildCanonicalStylePackage(
  project: NonNullable<ReturnType<typeof getProject>>,
  workshopDraft: FoundationWorkshopDraft | undefined,
  existing: FoundationPayload | null,
): ActiveStylePackage {
  const styleProfile = workshopDraft?.styleProfile
    ?? existing?.styleProfile
    ?? buildFallbackStyleProfile({
      references: [],
      worldContext: sanitizeProjectPremise(project.premise),
      draft: {
        mainline: workshopDraft?.mainline ?? existing?.mainline ?? "",
        desiredTone: workshopDraft?.desiredTone ?? project.style,
        storyHook: workshopDraft?.storyHook ?? existing?.storyHook ?? "",
      },
    });

  return {
    styleSnapshotId: workshopDraft?.styleSnapshotId ?? existing?.styleSnapshotId ?? null,
    styleSnapshotVersion: workshopDraft?.styleSnapshotVersion ?? existing?.styleSnapshotVersion ?? null,
    styleCard: workshopDraft?.styleSteeringCard ?? existing?.styleCard ?? "",
    styleProfile,
    styleDigest: workshopDraft?.styleDigest ?? existing?.styleDigest ?? "",
    styleExemplars: workshopDraft?.styleExemplars ?? existing?.styleExemplars ?? [],
    confidence: "high",
    sampledExcerpts: [],
    sourceIds: [],
  };
}

function pruneDeprecatedWorldviews(
  draft: FoundationWorkshopDraft,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  const transcript = messages.map((message) => message.content).join("\n");
  let worldviewIdeas = draft.worldviewIdeas;

  if (/山神不是主要体系|山神不再是主要体系|山只是有灵/u.test(transcript) && /山海经万灵/u.test(transcript)) {
    worldviewIdeas = worldviewIdeas.filter((entry) => !/山神体系/u.test(entry.name));
  }

  return {
    ...draft,
    worldviewIdeas,
  };
}

function buildFoundationCoreDraftFromCanonical(projectId: string) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const workshopState = getFoundationWorkshopEnvelopeState(projectId);
  const existing = getFoundation(projectId);
  const draft = sanitizeFoundationWorkshopDraft(workshopState?.envelope.draft)
    ?? sanitizeFoundationWorkshopDraft(toDraftFromFoundation(existing))
    ?? toDraftFromFoundation(existing);
  const messages = listFoundationWorkshopMessages(projectId).map((message) => ({
    role: message.role,
    content: message.content,
  })) as Array<{ role: "user" | "assistant"; content: string }>;
  const draftWithoutDeprecatedWorldviews = pruneDeprecatedWorldviews(draft, messages);
  const shouldRecomposeCoreFacts =
    messages.length > 0
    || !draft.premise
    || !draft.mainline
    || !draft.storyHook;
  const summarizedDraft = shouldRecomposeCoreFacts
    ? {
      ...draftWithoutDeprecatedWorldviews,
      ...deriveDraftCoreSummaries({
        project,
        draft: draftWithoutDeprecatedWorldviews,
        messages,
      }),
    }
    : draftWithoutDeprecatedWorldviews;

  return {
    project,
    messages,
    existing,
    draft: summarizedDraft,
    workshopState,
  };
}

function buildFoundationCoreFactsFromPayload(foundation: FoundationPayload | null) {
  return buildFoundationCoreFactsHash(toDraftFromFoundation(sanitizeFoundationPayload(foundation) ?? foundation));
}

function normalizeGoalFacts(foundation: FoundationPayload | null) {
  return (foundation?.characters ?? [])
    .map((item) => ({
      name: item.name.trim(),
      goal: item.goal.trim(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function normalizeWorldviewFacts(foundation: FoundationPayload | null) {
  return (foundation?.worldview ?? [])
    .map((item) => ({
      name: item.name.trim(),
      description: item.description.trim(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function compareCoreFacts(workshopTruth: FoundationPayload, foundation: FoundationPayload | null) {
  const normalizedWorkshopTruth = sanitizeFoundationPayload(workshopTruth) ?? workshopTruth;
  const normalizedFoundation = sanitizeFoundationPayload(foundation) ?? foundation;
  const workshopHash = buildFoundationCoreFactsHash(toDraftFromFoundation(normalizedWorkshopTruth));
  const foundationHash = buildFoundationCoreFactsFromPayload(normalizedFoundation);
  const differences: string[] = [];

  if ((normalizedFoundation?.premise ?? "") !== normalizedWorkshopTruth.premise) {
    differences.push("premise");
  }
  if ((normalizedFoundation?.mainline ?? "") !== (normalizedWorkshopTruth.mainline ?? "")) {
    differences.push("mainline");
  }
  if ((normalizedFoundation?.storyHook ?? "") !== (normalizedWorkshopTruth.storyHook ?? "")) {
    differences.push("storyHook");
  }

  const foundationGoals = JSON.stringify(normalizeGoalFacts(normalizedFoundation));
  const workshopGoals = JSON.stringify(normalizeGoalFacts(normalizedWorkshopTruth));
  if (foundationGoals !== workshopGoals) {
    differences.push("characterGoals");
  }

  const foundationWorldview = JSON.stringify(normalizeWorldviewFacts(normalizedFoundation));
  const workshopWorldview = JSON.stringify(normalizeWorldviewFacts(normalizedWorkshopTruth));
  if (foundationWorldview !== workshopWorldview) {
    differences.push("worldview");
  }

  return {
    workshopHash,
    foundationHash,
    differences,
  };
}

export function getFoundationDriftReport(projectId: string): FoundationDriftReport {
  const { project, draft, existing, messages } = buildFoundationCoreDraftFromCanonical(projectId);
  const canonicalFoundation = buildCanonicalFoundationPayload({
    project,
    draft,
    existing,
    messages,
  });
  const comparison = compareCoreFacts(canonicalFoundation, existing);
  const coreDrift = comparison.differences.length > 0;

  return {
    coreDrift,
    blockingReason: coreDrift
      ? "检测到设定工坊中的核心事实尚未整理为正式设定，请先整理正式设定后再开始自动写作。"
      : null,
    workshopCoreFactsHash: comparison.workshopHash,
    formalCoreFactsHash: comparison.foundationHash,
    differences: comparison.differences,
  };
}

export function diagnoseFoundationTruthSource(projectId: string) {
  const { project, draft, existing, messages, workshopState } = buildFoundationCoreDraftFromCanonical(projectId);
  const canonicalFoundation = buildCanonicalFoundationPayload({
    project,
    draft,
    existing,
    messages,
  });
  const drift = getFoundationDriftReport(projectId);
  const persistedWorldviewNames = new Set((existing?.worldview ?? []).map((item) => item.name));
  const workshopWorldviewNames = new Set((canonicalFoundation.worldview ?? []).map((item) => item.name));
  const deprecatedWorldviewResidue = [...persistedWorldviewNames].filter((name) => !workshopWorldviewNames.has(name));

  const handoffConflict = false;

  return {
    legacyBareDraft: Boolean(workshopState?.legacyBareDraftJson),
    workshopFormalCoreDrift: drift.coreDrift,
    canonicalPlaceholderResidue: listFoundationPlaceholderResidueKinds(canonicalFoundation),
    formalPlaceholderResidue: listFoundationPlaceholderResidueKinds(existing),
    deprecatedWorldviewResidue,
    handoffConflict,
    drift,
  };
}

function buildCanonicalFoundationPayload(input: {
  project: NonNullable<ReturnType<typeof getProject>>;
  draft: FoundationWorkshopDraft;
  existing: FoundationPayload | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const candidate = deriveFoundationCandidate({
    project: input.project,
    workshopDraft: input.draft,
    workshopMessages: input.messages,
    activeStyle: buildCanonicalStylePackage(input.project, input.draft, input.existing),
    existing: input.existing,
  });

  const foundation = {
    ...candidate,
    premise: input.draft.premise,
    mainline: input.draft.mainline,
    storyHook: input.draft.storyHook,
    characters: input.draft.characterIdeas.length ? input.draft.characterIdeas : candidate.characters,
    worldview: input.draft.worldviewIdeas.length ? input.draft.worldviewIdeas : candidate.worldview,
    relationships: input.draft.relationshipIdeas.length ? input.draft.relationshipIdeas : candidate.relationships,
  } satisfies FoundationPayload;

  return sanitizeFoundationPayload(foundation) ?? foundation;
}

export async function repairFoundationTruthSource(projectId: string) {
  const diagnosisBefore = diagnoseFoundationTruthSource(projectId);
  const { project, draft, existing, messages, workshopState } = buildFoundationCoreDraftFromCanonical(projectId);
  const nextEnvelope: FoundationCoreEnvelope = createFoundationCoreEnvelope(draft, {
    revision: (workshopState?.envelope.syncMeta.revision ?? 0) + 1,
    lastAppliedAt: new Date().toISOString(),
  });

  upsertFoundationWorkshopEnvelopeState(projectId, nextEnvelope, workshopState?.readyToGenerate ?? false);
  const foundation = buildCanonicalFoundationPayload({
    project,
    draft,
    existing,
    messages,
  });
  saveFoundation(projectId, foundation);
  const diagnosisAfter = diagnoseFoundationTruthSource(projectId);

  return {
    repaired: true,
    diagnosisBefore,
    diagnosisAfter,
  };
}

export function buildDerivedFoundationDriftMeta(projectId: string, draft: FoundationWorkshopDraft | undefined, derivedFoundation: FoundationPayload | null) {
  const report = getFoundationDriftReport(projectId);
  const persistedFoundation = getFoundation(projectId);
  const meta = buildDerivedFoundationMeta({
    draft,
    derivedFoundation,
    persistedFoundation,
  });
  if (!meta) {
    return null;
  }
  return {
    ...meta,
    coreDrift: report.coreDrift,
    blockingReason: report.blockingReason,
  };
}
