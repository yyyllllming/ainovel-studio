import type { ChapterBlueprint, CharacterCard, FoundationPayload } from "../types.ts";
import { normalizeEntityLookupKey } from "./lookup-normalization.ts";

export type CharacterRoleBucket = "protagonist" | "maleLead" | "femaleLead" | "antagonist" | "supporting";

interface RoleBucketConfig {
  bucket: CharacterRoleBucket;
  placeholderNames: string[];
  roleHints: string[];
}

interface NormalizeFoundationOptions {
  workshopCharacters?: CharacterCard[];
}

const ROLE_BUCKETS: RoleBucketConfig[] = [
  {
    bucket: "protagonist",
    placeholderNames: ["主角", "主人公", "主角本人", "protagonist"],
    roleHints: ["主角", "主人公", "protagonist"],
  },
  {
    bucket: "maleLead",
    placeholderNames: ["男主", "男主角", "malelead", "male lead"],
    roleHints: ["男主", "男主角", "malelead", "male lead"],
  },
  {
    bucket: "femaleLead",
    placeholderNames: ["女主", "女主角", "femalelead", "female lead"],
    roleHints: ["女主", "女主角", "femalelead", "female lead"],
  },
  {
    bucket: "antagonist",
    placeholderNames: ["反派", "大反派", "反派boss", "boss", "最终boss", "antagonist"],
    roleHints: ["反派", "大反派", "反派boss", "boss", "最终boss", "antagonist"],
  },
  {
    bucket: "supporting",
    placeholderNames: ["配角", "重要配角", "男配", "女配", "side character", "supporting"],
    roleHints: ["配角", "重要配角", "男配", "女配", "side character", "supporting"],
  },
];

const PLACEHOLDER_NAMES = new Set(
  ROLE_BUCKETS.flatMap((config) => config.placeholderNames.map((name) => normalizeLookupValue(name))),
);

function normalizeLookupValue(value: string) {
  return normalizeEntityLookupKey(value);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isConcreteName(name: string) {
  return Boolean(name.trim()) && !isPlaceholderCharacterName(name);
}

export function isConcreteCharacterName(name: string) {
  return isConcreteName(name);
}

export function detectCharacterRoleBuckets(label: string) {
  const normalized = normalizeLookupValue(label);
  return ROLE_BUCKETS.filter((config) =>
    config.roleHints.some((hint) => normalized.includes(normalizeLookupValue(hint))),
  ).map((config) => config.bucket);
}

export function buildUniqueCharacterRoleNameMap(characters: CharacterCard[]) {
  const candidatesByBucket = new Map<CharacterRoleBucket, Set<string>>();

  for (const character of characters) {
    if (!isConcreteName(character.name)) {
      continue;
    }

    for (const bucket of detectCharacterRoleBuckets(character.role)) {
      const candidates = candidatesByBucket.get(bucket) ?? new Set<string>();
      candidates.add(character.name.trim());
      candidatesByBucket.set(bucket, candidates);
    }
  }

  const byBucket = new Map<CharacterRoleBucket, string>();
  for (const [bucket, candidates] of candidatesByBucket.entries()) {
    if (candidates.size === 1) {
      byBucket.set(bucket, Array.from(candidates)[0]!);
    }
  }

  const protagonistFallbackCandidates = uniqueStrings(
    [byBucket.get("protagonist"), byBucket.get("maleLead"), byBucket.get("femaleLead")].filter(
      (value): value is string => Boolean(value),
    ),
  );
  if (!byBucket.has("protagonist") && protagonistFallbackCandidates.length === 1) {
    byBucket.set("protagonist", protagonistFallbackCandidates[0]);
  }

  return byBucket;
}

function renamePlaceholderCharacters(characters: FoundationPayload["characters"], workshopCharacters: CharacterCard[]) {
  const workshopRoleNames = buildUniqueCharacterRoleNameMap(workshopCharacters);
  const usedNames = new Set(
    characters.filter((character) => isConcreteName(character.name)).map((character) => character.name.trim()),
  );

  return characters.map((character) => {
    const currentName = character.name.trim();
    if (!isPlaceholderCharacterName(currentName)) {
      return {
        ...character,
        name: currentName,
      };
    }

    const buckets = Array.from(
      new Set<CharacterRoleBucket>([
        ...detectCharacterRoleBuckets(currentName),
        ...detectCharacterRoleBuckets(character.role),
      ]),
    );

    for (const bucket of buckets) {
      const candidate = workshopRoleNames.get(bucket);
      if (candidate && !usedNames.has(candidate)) {
        usedNames.add(candidate);
        return {
          ...character,
          name: candidate,
        };
      }
    }

    return {
      ...character,
      name: currentName,
    };
  });
}

function buildPlaceholderReplacementMap(characters: FoundationPayload["characters"]) {
  const byBucket = buildUniqueCharacterRoleNameMap(characters);
  const protagonistFallbackCandidates = uniqueStrings(
    [byBucket.get("protagonist"), byBucket.get("maleLead"), byBucket.get("femaleLead")].filter(
      (value): value is string => Boolean(value),
    ),
  );
  if (!byBucket.has("protagonist") && protagonistFallbackCandidates.length === 1) {
    byBucket.set("protagonist", protagonistFallbackCandidates[0]);
  }

  const replacements = new Map<string, string>();
  for (const config of ROLE_BUCKETS) {
    const replacement = byBucket.get(config.bucket);
    if (!replacement) {
      continue;
    }
    for (const placeholder of config.placeholderNames) {
      replacements.set(placeholder, replacement);
    }
  }

  return replacements;
}

function replaceExactPlaceholder(value: string, replacements: Map<string, string>) {
  const trimmed = value.trim();
  return replacements.get(trimmed) ?? trimmed;
}

function replacePlaceholderTokens(text: string, replacements: Map<string, string>) {
  if (!replacements.size) {
    return text;
  }
  // 单次扫描 + 长占位词优先，避免 "主角" 先命中把 "男主角/女主角" 截断成 "男X/女X"。
  const pattern = new RegExp(
    [...replacements.keys()]
      .sort((left, right) => right.length - left.length)
      .map((placeholder) => escapeRegExp(placeholder))
      .join("|"),
    "gu",
  );
  return text.replace(pattern, (matched) => replacements.get(matched) ?? matched);
}

export function isPlaceholderCharacterName(name: string) {
  return PLACEHOLDER_NAMES.has(normalizeLookupValue(name));
}

export function hasPlaceholderCharacterNames(characters: FoundationPayload["characters"]) {
  return characters.some((character) => isPlaceholderCharacterName(character.name));
}

export function normalizeFoundationCharacterReferences(
  foundation: FoundationPayload,
  options: NormalizeFoundationOptions = {},
): FoundationPayload {
  const normalizedCharacters = renamePlaceholderCharacters(
    foundation.characters,
    options.workshopCharacters ?? [],
  ).map((character) => ({
    ...character,
    name: character.name.trim(),
  }));

  const replacements = buildPlaceholderReplacementMap(normalizedCharacters);

  return {
    ...foundation,
    premise: replacePlaceholderTokens(foundation.premise, replacements),
    characters: normalizedCharacters.map((character) => ({
      ...character,
      goal: replacePlaceholderTokens(character.goal, replacements),
      secrets: character.secrets?.map((secret) => replacePlaceholderTokens(secret, replacements)),
    })),
    worldview: foundation.worldview.map((rule) => ({
      ...rule,
      description: replacePlaceholderTokens(rule.description, replacements),
    })),
    relationships: foundation.relationships.map((relationship) => ({
      ...relationship,
      source: replaceExactPlaceholder(relationship.source, replacements),
      target: replaceExactPlaceholder(relationship.target, replacements),
      label: replacePlaceholderTokens(relationship.label, replacements),
    })),
  };
}

export function normalizeBlueprintCharacterReferences(
  blueprint: ChapterBlueprint,
  foundation: FoundationPayload | null,
): ChapterBlueprint {
  if (!foundation) {
    return blueprint;
  }

  const replacements = buildPlaceholderReplacementMap(foundation.characters);
  if (!replacements.size) {
    return blueprint;
  }

  return {
    ...blueprint,
    sceneGoal: replacePlaceholderTokens(blueprint.sceneGoal, replacements),
    characters: uniqueStrings(
      blueprint.characters.map((name) => replaceExactPlaceholder(name, replacements)),
    ),
    conflicts: blueprint.conflicts.map((item) => replacePlaceholderTokens(item, replacements)),
    foreshadows: blueprint.foreshadows.map((item) => replacePlaceholderTokens(item, replacements)),
  };
}
