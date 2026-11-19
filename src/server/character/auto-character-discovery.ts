import {
  canonicalizeCharacterName,
  isValidCharacterName,
} from "../../lib/character-name-policy.ts";
import type {
  CanonFact,
  CardDraft,
  CardEvidence,
  CardMeta,
  CharacterCardDraft,
  FoundationPayload,
  ProjectCard,
} from "../types.ts";

export interface AutoRecurringSummaryEntry {
  chapterNo: number;
  level: string;
  content: string;
  keywords?: string[];
}

export interface AutoRecurringCharacterCreatePlan {
  name: string;
  draft: CharacterCardDraft;
  meta: Partial<CardMeta>;
  status: "draft";
}

export interface AutoRecurringCharacterUpdatePlan {
  cardId: string;
  draft: CardDraft;
  meta: Partial<CardMeta>;
}

export interface AutoRecurringCharacterPlan {
  creates: AutoRecurringCharacterCreatePlan[];
  updates: AutoRecurringCharacterUpdatePlan[];
  deletes: string[];
}

interface CandidateEvidenceWindow {
  validRecurring: boolean;
  latestEvidence: CardEvidence[];
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function normalizeSnippet(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 140);
}

function normalizeEvidence(evidence: CardEvidence[]) {
  const seen = new Set<string>();
  const next: CardEvidence[] = [];
  for (const item of evidence) {
    const normalized: CardEvidence = {
      chapterNo: Number(item.chapterNo),
      source: item.source,
      reason: item.reason.trim(),
      snippet: normalizeSnippet(item.snippet),
    };
    if (!Number.isFinite(normalized.chapterNo) || normalized.chapterNo <= 0 || !normalized.reason || !normalized.snippet) {
      continue;
    }
    const key = `${normalized.chapterNo}:${normalized.source}:${normalized.snippet}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(normalized);
  }
  return next.sort((left, right) => left.chapterNo - right.chapterNo || left.snippet.localeCompare(right.snippet, "zh-CN"));
}

function isContiguousChapters(chapters: number[]) {
  if (chapters.length < 4) {
    return false;
  }
  for (let index = 1; index < chapters.length; index += 1) {
    if (chapters[index] !== chapters[index - 1]! + 1) {
      return false;
    }
  }
  return true;
}

function resolveEvidenceWindow(evidence: CardEvidence[]): CandidateEvidenceWindow {
  const normalized = normalizeEvidence(evidence);
  const latestEvidence = normalized.slice(-12);
  const chapters = unique(latestEvidence.map((item) => item.chapterNo));
  return {
    latestEvidence,
    validRecurring: latestEvidence.length >= 5 && isContiguousChapters(chapters),
  };
}

function inferCandidateNamesFromFact(fact: CanonFact) {
  const results = new Set<string>();
  if (fact.type === "character_state") {
    const direct = canonicalizeCharacterName(String(fact.metadata.character ?? ""));
    if (direct) {
      results.add(direct);
    }
  }
  if (fact.type === "relationship") {
    const source = canonicalizeCharacterName(String(fact.metadata.source ?? ""));
    const target = canonicalizeCharacterName(String(fact.metadata.target ?? ""));
    if (source) {
      results.add(source);
    }
    if (target) {
      results.add(target);
    }
  }
  for (const keyword of fact.keywords ?? []) {
    const normalized = canonicalizeCharacterName(keyword);
    if (normalized) {
      results.add(normalized);
    }
  }
  return [...results];
}

function factEvidenceSource(fact: CanonFact): CardEvidence["source"] {
  return fact.type === "relationship" ? "chapter.facts.relationship" : "chapter.facts.character_state";
}

function factEvidenceReason(fact: CanonFact) {
  return fact.type === "relationship" ? "accepted 章节关系事实命中该角色" : "accepted 章节角色状态事实命中该角色";
}

function buildEvidenceIndex(input: {
  foundation: FoundationPayload | null;
  existingCards: ProjectCard[];
  facts: CanonFact[];
  summaries: AutoRecurringSummaryEntry[];
}) {
  const evidenceByName = new Map<string, CardEvidence[]>();
  const knownNames = new Set<string>();

  for (const character of input.foundation?.characters ?? []) {
    const canonical = canonicalizeCharacterName(character.name);
    if (canonical) {
      knownNames.add(canonical);
    }
  }
  for (const card of input.existingCards) {
    if (card.cardType !== "character") {
      continue;
    }
    const canonical = canonicalizeCharacterName(card.name);
    if (canonical) {
      knownNames.add(canonical);
    }
  }

  for (const fact of input.facts) {
    if (fact.type !== "character_state" && fact.type !== "relationship") {
      continue;
    }
    const names = inferCandidateNamesFromFact(fact);
    for (const name of names) {
      knownNames.add(name);
      const bucket = evidenceByName.get(name) ?? [];
      bucket.push({
        chapterNo: fact.chapterNo,
        source: factEvidenceSource(fact),
        reason: factEvidenceReason(fact),
        snippet: fact.content,
      });
      evidenceByName.set(name, bucket);
    }
  }

  for (const summary of input.summaries) {
    if (summary.level !== "full") {
      continue;
    }
    const snippet = normalizeSnippet(summary.content);
    if (!snippet) {
      continue;
    }
    for (const name of knownNames) {
      if (!summary.content.includes(name)) {
        continue;
      }
      const bucket = evidenceByName.get(name) ?? [];
      bucket.push({
        chapterNo: summary.chapterNo,
        source: "chapter.summary.full",
        reason: "accepted 章节全文摘要继续锚定该角色",
        snippet,
      });
      evidenceByName.set(name, bucket);
    }
  }

  return evidenceByName;
}

function mergeAutoDraft(existing: CardDraft, name: string, evidence: CardEvidence[]) {
  const current = (existing ?? {}) as CharacterCardDraft;
  const noteLines = evidence
    .slice(-4)
    .map((item) => `第 ${item.chapterNo} 章：${item.snippet}`);
  return {
    name,
    role: current.role?.trim() || "持续出现角色候选",
    goal: current.goal?.trim() || "近几章持续出现，待人工确认后补齐正式目标",
    traits: current.traits?.length ? current.traits : ["持续出现", "待确认"],
    notes: noteLines.join("\n"),
  } satisfies CharacterCardDraft;
}

function buildAutoRecurringMeta(name: string, evidence: CardEvidence[], existing?: CardMeta): Partial<CardMeta> {
  return {
    aliases: unique([name, ...(existing?.aliases ?? [])]),
    keywords: unique([...(existing?.keywords ?? []), ...evidence.flatMap((item) => item.snippet.includes(name) ? [name] : [])]),
    origin: "auto_recurring",
    discoveryStage: "recurring_candidate",
    priority: Math.max(existing?.priority ?? 50, 60),
    evidence,
  };
}

export function buildAutoRecurringCharacterPlan(input: {
  foundation: FoundationPayload | null;
  existingCards: ProjectCard[];
  facts: CanonFact[];
  summaries: AutoRecurringSummaryEntry[];
}): AutoRecurringCharacterPlan {
  const evidenceByName = buildEvidenceIndex(input);
  const creates: AutoRecurringCharacterCreatePlan[] = [];
  const updates: AutoRecurringCharacterUpdatePlan[] = [];
  const deletes: string[] = [];
  const characterCards = input.existingCards.filter((card) => card.cardType === "character");
  const existingByName = new Map(
    characterCards
      .map((card) => {
        const canonical = canonicalizeCharacterName(card.name);
        return canonical ? ([canonical, card] as const) : null;
      })
      .filter((entry): entry is readonly [string, ProjectCard] => Boolean(entry)),
  );
  const authoritativeFoundationNames = new Set(
    (input.foundation?.characters ?? [])
      .map((character) => canonicalizeCharacterName(character.name))
      .filter((value): value is string => Boolean(value)),
  );

  const managedAutoCards = characterCards.filter((card) => card.meta.origin === "auto_recurring");

  for (const [name, evidence] of evidenceByName.entries()) {
    if (!isValidCharacterName(name)) {
      continue;
    }
    const current = existingByName.get(name);
    const window = resolveEvidenceWindow(evidence);
    const metaWithEvidence: Partial<CardMeta> = {
      evidence: window.latestEvidence,
      aliases: unique([name, ...(current?.meta.aliases ?? [])]),
      keywords: unique([...(current?.meta.keywords ?? []), name]),
    };

    if (current && current.meta.origin !== "auto_recurring") {
      if (current.status !== "confirmed") {
        continue;
      }
      const currentEvidence = normalizeEvidence(current.meta.evidence ?? []);
      const nextEvidence = normalizeEvidence(window.latestEvidence);
      if (JSON.stringify(currentEvidence) !== JSON.stringify(nextEvidence)) {
        updates.push({
          cardId: current.id,
          draft: current.draft,
          meta: metaWithEvidence,
        });
      }
      continue;
    }

    if (!window.validRecurring) {
      if (current?.meta.origin === "auto_recurring") {
        deletes.push(current.id);
      }
      continue;
    }

    if (!current) {
      if (authoritativeFoundationNames.has(name)) {
        continue;
      }
      creates.push({
        name,
        status: "draft",
        draft: mergeAutoDraft({} as CardDraft, name, window.latestEvidence),
        meta: buildAutoRecurringMeta(name, window.latestEvidence),
      });
      continue;
    }

    updates.push({
      cardId: current.id,
      draft: mergeAutoDraft(current.draft, name, window.latestEvidence),
      meta: buildAutoRecurringMeta(name, window.latestEvidence, current.meta),
    });
  }

  for (const card of managedAutoCards) {
    const canonical = canonicalizeCharacterName(card.name);
    if (!canonical) {
      deletes.push(card.id);
      continue;
    }
    if (!evidenceByName.has(canonical)) {
      deletes.push(card.id);
    }
  }

  return {
    creates,
    updates,
    deletes: unique(deletes),
  };
}
