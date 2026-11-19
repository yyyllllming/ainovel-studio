import type { PublicLlmProfile } from "@/server/types/settings";

export function isUsablePublicLlmProfile(
  profile: Pick<PublicLlmProfile, "enabled" | "hasApiKey" | "defaultModel">,
) {
  return profile.enabled && profile.hasApiKey && profile.defaultModel.trim().length > 0;
}

export function getUsablePublicLlmProfiles(profiles: PublicLlmProfile[]) {
  return profiles.filter((profile) => isUsablePublicLlmProfile(profile));
}

export function getEffectivePublicLlmProfileId(
  selectedProfileId: string,
  usableProfiles: Array<Pick<PublicLlmProfile, "id">>,
) {
  if (!usableProfiles.length) {
    return "";
  }

  if (usableProfiles.some((profile) => profile.id === selectedProfileId)) {
    return selectedProfileId;
  }

  return usableProfiles[0]?.id ?? "";
}
