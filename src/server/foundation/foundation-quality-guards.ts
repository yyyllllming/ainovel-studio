import type { FoundationPayload } from "../types.ts";
import { hasPlaceholderCharacterNames } from "../character/character-name-normalization.ts";
import { isPlaceholderWorldRuleValue } from "./foundation-summary-sanitizer.ts";

const DRAFT_ARTIFACT_PATTERN = /TODO|待补充|【修订指令】|```/u;

export function containsDraftArtifactText(content: string | null | undefined) {
  return DRAFT_ARTIFACT_PATTERN.test(content ?? "");
}

export function isPlaceholderWorldCardDraft(
  draft: { name?: string | null; description?: string | null } | null | undefined,
) {
  return isPlaceholderWorldRuleValue({
    name: draft?.name ?? "",
    description: draft?.description ?? "",
  });
}

export function hasFoundationPlaceholderResidue(foundation: FoundationPayload | null | undefined) {
  if (!foundation) {
    return false;
  }

  return hasPlaceholderCharacterNames(foundation.characters)
    || foundation.worldview.some((rule) => isPlaceholderWorldRuleValue(rule));
}

export function listFoundationPlaceholderResidueKinds(foundation: FoundationPayload | null | undefined) {
  if (!foundation) {
    return [] as Array<"character_names" | "worldview_rules">;
  }

  const residue: Array<"character_names" | "worldview_rules"> = [];
  if (hasPlaceholderCharacterNames(foundation.characters)) {
    residue.push("character_names");
  }
  if (foundation.worldview.some((rule) => isPlaceholderWorldRuleValue(rule))) {
    residue.push("worldview_rules");
  }
  return residue;
}
