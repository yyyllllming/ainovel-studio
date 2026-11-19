import {
  buildUniqueCharacterRoleNameMap,
  detectCharacterRoleBuckets,
  isConcreteCharacterName,
  isPlaceholderCharacterName,
} from "../character/character-name-normalization.ts";
import type { CardDraft, CardType, FoundationPayload, ProjectCard } from "../types.ts";

export type FoundationCardSeed = {
  cardType: CardType;
  name: string;
  draft: CardDraft;
};

export type FoundationCardUpgrade = {
  cardId: string;
  name: string;
  draft: CardDraft;
};

type ExistingFoundationCard = Pick<ProjectCard, "cardType" | "name">
  & Partial<Pick<ProjectCard, "id" | "status" | "draft">>;

function normalizeFoundationCardKey(cardType: CardType, name: string) {
  return `${cardType}:${name.trim().toLocaleLowerCase()}`;
}

function getCharacterDraftRole(draft: CardDraft | undefined) {
  if (!draft || !("role" in draft) || typeof draft.role !== "string") {
    return "";
  }
  return draft.role;
}

function buildPlaceholderCardUpgradePlan(
  foundation: FoundationPayload,
  existingCards: ExistingFoundationCard[],
) {
  const roleNames = buildUniqueCharacterRoleNameMap(foundation.characters);
  const concreteExistingNames = new Set(
    existingCards
      .filter((card) => card.cardType === "character" && isConcreteCharacterName(card.name))
      .map((card) => normalizeFoundationCardKey("character", card.name)),
  );
  const placeholderCards = existingCards.filter((card) =>
    card.cardType === "character"
    && card.status === "confirmed"
    && card.id
    && isPlaceholderCharacterName(card.name),
  );
  const placeholdersByBucket = new Map<string, ExistingFoundationCard[]>();

  for (const card of placeholderCards) {
    const buckets = new Set([
      ...detectCharacterRoleBuckets(card.name),
      ...detectCharacterRoleBuckets(getCharacterDraftRole(card.draft)),
    ]);
    for (const bucket of buckets) {
      const current = placeholdersByBucket.get(bucket) ?? [];
      current.push(card);
      placeholdersByBucket.set(bucket, current);
    }
  }

  const usedTargetKeys = new Set<string>();
  const toUpgrade: FoundationCardUpgrade[] = [];

  for (const [bucket, concreteName] of roleNames.entries()) {
    const candidates = placeholdersByBucket.get(bucket) ?? [];
    const targetKey = normalizeFoundationCardKey("character", concreteName);
    if (candidates.length !== 1 || concreteExistingNames.has(targetKey) || usedTargetKeys.has(targetKey)) {
      continue;
    }

    const target = candidates[0]!;
    const foundationCharacter = foundation.characters.find((character) => character.name.trim() === concreteName);
    if (!foundationCharacter) {
      continue;
    }

    toUpgrade.push({
      cardId: target.id!,
      name: concreteName,
      draft: {
        name: concreteName,
        role: foundationCharacter.role,
        goal: foundationCharacter.goal,
        traits: foundationCharacter.traits,
        secrets: foundationCharacter.secrets,
      },
    });
    usedTargetKeys.add(targetKey);
  }

  return toUpgrade;
}

export function buildFoundationCardSeeds(foundation: FoundationPayload): FoundationCardSeed[] {
  return [
    ...foundation.characters.map<FoundationCardSeed>((character) => ({
      cardType: "character",
      name: character.name,
      draft: {
        name: character.name,
        role: character.role,
        goal: character.goal,
        traits: character.traits,
        secrets: character.secrets,
      },
    })),
    ...foundation.worldview.map<FoundationCardSeed>((rule) => ({
      cardType: "world",
      name: rule.name,
      draft: {
        name: rule.name,
        description: rule.description,
      },
    })),
  ];
}

export function planFoundationCardImport(
  foundation: FoundationPayload,
  existingCards: ExistingFoundationCard[],
) {
  const toUpgrade = buildPlaceholderCardUpgradePlan(foundation, existingCards);
  const existingKeys = new Set(
    existingCards.map((card) => normalizeFoundationCardKey(card.cardType, card.name)),
  );
  for (const upgrade of toUpgrade) {
    existingKeys.add(normalizeFoundationCardKey("character", upgrade.name));
  }

  const seenSeeds = new Set<string>();
  const toImport: FoundationCardSeed[] = [];
  let skipped = 0;

  for (const seed of buildFoundationCardSeeds(foundation)) {
    const key = normalizeFoundationCardKey(seed.cardType, seed.name);
    if (seenSeeds.has(key)) {
      skipped += 1;
      continue;
    }
    seenSeeds.add(key);

    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }

    existingKeys.add(key);
    toImport.push(seed);
  }

  return {
    toImport,
    toUpgrade,
    skipped,
  };
}
