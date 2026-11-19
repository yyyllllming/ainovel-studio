import { z } from "zod";
import { CUSTOM_PROVIDER_ID } from "../../lib/model-provider-presets.ts";
import {
  deleteProfile,
  fetchProfileModelsFromInput as fetchProfileModelsFromStorageInput,
  getProfiles,
  testProfileConnectionFromInput as testProfileConnectionFromStorageInput,
  upsertProfile,
} from "../profiles.ts";
import type { LlmProfile } from "../types.ts";
import type { PublicLlmProfile } from "../types/settings.ts";

const saveProfileInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().optional(),
  providerId: z.string().default(CUSTOM_PROVIDER_ID),
  protocol: z.literal("openai_compatible").default("openai_compatible"),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().optional(),
  defaultModel: z.string().trim().default(""),
  enabled: z.boolean().default(true),
});

const profileActionLookupInputSchema = z.object({
  profileId: z.string().trim().optional(),
  profile: z.unknown().optional(),
});

const profileConnectionTestInputSchema = profileActionLookupInputSchema.extend({
  model: z.string().trim().optional(),
});

function maskApiKey(apiKey: string) {
  if (!apiKey) {
    return null;
  }

  if (apiKey.length <= 10) {
    return `${apiKey.slice(0, 3)}...${apiKey.slice(-2)}`;
  }

  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

export function toPublicProfile(profile: LlmProfile): PublicLlmProfile {
  return {
    id: profile.id,
    name: profile.name,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    defaultModel: profile.defaultModel,
    enabled: profile.enabled,
    hasApiKey: profile.apiKey.trim().length > 0,
    maskedApiKey: maskApiKey(profile.apiKey),
  };
}

export async function listPublicProfiles() {
  const profiles = await getProfiles();
  return profiles.map(toPublicProfile);
}

export async function saveProfileAndReturnPublicView(input: unknown) {
  const parsed = saveProfileInputSchema.parse(input);
  const profile = await upsertProfile({
    id: parsed.id,
    name: parsed.name,
    providerId: parsed.providerId,
    protocol: parsed.protocol,
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey?.trim() ?? "",
    defaultModel: parsed.defaultModel,
    enabled: parsed.enabled,
  });
  return toPublicProfile(profile);
}

export async function deleteProfileAndReturnAck(input: { profileId: string }) {
  const profileId = input.profileId?.trim();
  if (!profileId) {
    throw new Error("缺少 profileId");
  }

  return deleteProfile(profileId);
}

export async function fetchProfileModelsFromInput(input: unknown, options?: { signal?: AbortSignal }) {
  const parsed = profileActionLookupInputSchema.parse(input);
  return fetchProfileModelsFromStorageInput(parsed, options);
}

export async function testProfileConnectionFromInput(input: unknown, options?: { signal?: AbortSignal }) {
  const parsed = profileConnectionTestInputSchema.parse(input);
  return testProfileConnectionFromStorageInput(parsed, options);
}
