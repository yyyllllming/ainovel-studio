import { getActiveStylePackage } from "../repositories/style.repository.ts";
import type { ActiveStylePackage } from "../types.ts";
import { readProjectVoiceSnapshot } from "./project-voice-snapshot.service.ts";
import type { ProjectVoiceSnapshot, VoicePack } from "./types.ts";

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

function deriveExternalAnchors(activeStyle: ActiveStylePackage) {
  return uniqueNonEmpty([
    activeStyle.styleProfile.referenceAnchor.primary,
    ...activeStyle.styleProfile.referenceAnchor.secondary,
    activeStyle.styleProfile.paragraphCadence.narrativeRule,
    activeStyle.styleProfile.sentenceRhythm.pacingRule,
    activeStyle.styleProfile.narrativeDistance.intimacyRule,
  ]);
}

export function buildVoicePack(input: {
  projectId: string;
  activeStyle: ActiveStylePackage;
  projectVoiceSnapshot?: ProjectVoiceSnapshot | null;
}): VoicePack {
  const externalAnchors = deriveExternalAnchors(input.activeStyle);
  return {
    projectId: input.projectId,
    projectVoiceSnapshot: input.projectVoiceSnapshot ?? null,
    styleProfile: input.activeStyle.styleProfile,
    writingCharter: input.activeStyle.styleProfile.writingCharter ?? null,
    styleDigest: input.activeStyle.styleDigest.trim(),
    styleExemplars: input.activeStyle.styleExemplars,
    positiveAnchors: uniqueNonEmpty([
      ...(input.projectVoiceSnapshot?.positiveAnchors ?? []),
      ...externalAnchors,
    ]),
    antiPatterns: uniqueNonEmpty([
      ...(input.projectVoiceSnapshot?.antiPatterns ?? []),
      ...input.activeStyle.styleProfile.aiSmellPatterns,
      ...input.activeStyle.styleProfile.styleTaboos,
    ]),
    externalAnchors,
  };
}

export async function loadVoicePack(projectId: string): Promise<VoicePack> {
  const activeStyle = getActiveStylePackage(projectId);
  const snapshot = await readProjectVoiceSnapshot(projectId);
  return buildVoicePack({
    projectId,
    activeStyle,
    projectVoiceSnapshot: snapshot,
  });
}
