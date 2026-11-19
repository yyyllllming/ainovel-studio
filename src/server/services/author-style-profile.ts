import type { StyleFingerprint } from "../style-fingerprint.ts";
import type { AuthorBookCardRecord, StyleProfile } from "../types.ts";

export interface AuthorStyleProfileSummary {
  profileMode: "single-book inferred" | "multi-book stable";
  authorProfileSummary: string;
  stableTraits: string[];
  bookSpecificTraits: Array<{ title: string; traits: string[] }>;
  coverageReport: {
    bookCount: number;
    withStyleProfileCount: number;
    withFingerprintCount: number;
  };
}

type StyleFacet = {
  label: string;
  read: (profile: StyleProfile) => string | string[];
};

const STYLE_FACETS: StyleFacet[] = [
  { label: "叙述锚点", read: (profile) => profile.referenceAnchor.primary },
  { label: "叙述段推进", read: (profile) => profile.paragraphCadence.narrativeRule },
  { label: "句子节奏", read: (profile) => profile.sentenceRhythm.pacingRule },
  { label: "叙事贴近度", read: (profile) => profile.narrativeDistance.intimacyRule },
  { label: "对白声线", read: (profile) => profile.dialogueStyle.voiceRule },
  { label: "开篇策略", read: (profile) => profile.openingStrategy },
  { label: "信息露出", read: (profile) => profile.infoRevealRule },
  { label: "情绪落点", read: (profile) => profile.emotionRenderingRule },
  { label: "章末收束", read: (profile) => profile.chapterClosureRule },
];

function normalizeTraitValue(value: string) {
  return value
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/[。；;！!]+$/gu, "");
}

function formatTrait(label: string, value: string) {
  return `${label}：${value}`;
}

function median(values: number[]) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function hasFingerprint(fingerprint: StyleFingerprint | null | undefined) {
  return Boolean(fingerprint && Object.keys(fingerprint).length);
}

function summarizeFingerprint(cards: AuthorBookCardRecord[]) {
  const fingerprints = cards
    .map((card) => card.fingerprint)
    .filter((fingerprint): fingerprint is StyleFingerprint => hasFingerprint(fingerprint));

  if (!fingerprints.length) {
    return "";
  }

  const sentenceMedian = median(fingerprints.map((fingerprint) => fingerprint.sentenceLength.median));
  const dialogueRatio = median(fingerprints.map((fingerprint) => fingerprint.dialogue.overallRatio));
  const chapterAverage = median(fingerprints.map((fingerprint) => fingerprint.chapter.averageWords));

  return `数值侧大致表现为句长中位 ${Math.round(sentenceMedian)} 字、对白占比约 ${Math.round(dialogueRatio * 100)}%、章均约 ${Math.round(chapterAverage)} 字。`;
}

function buildStableTraitSet(cards: AuthorBookCardRecord[]) {
  const withProfile = cards.filter((card) => Boolean(card.styleProfile));
  const threshold = Math.max(2, Math.ceil(withProfile.length / 2));
  const stableTraits: string[] = [];
  const stableByLabel = new Map<string, string>();

  for (const facet of STYLE_FACETS) {
    const counts = new Map<string, number>();
    for (const card of withProfile) {
      const rawValue = facet.read(card.styleProfile);
      const normalized = Array.isArray(rawValue)
        ? normalizeTraitValue(rawValue.join("、"))
        : normalizeTraitValue(rawValue);
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    const winner = [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
    if (!winner || winner[1] < threshold) {
      continue;
    }

    stableTraits.push(formatTrait(facet.label, winner[0]));
    stableByLabel.set(facet.label, winner[0]);
  }

  return {
    stableTraits,
    stableByLabel,
  };
}

function buildBookSpecificTraits(cards: AuthorBookCardRecord[], stableByLabel: Map<string, string>) {
  return cards.map((card) => {
    const traits = STYLE_FACETS
      .map((facet) => {
        const rawValue = facet.read(card.styleProfile);
        const normalized = Array.isArray(rawValue)
          ? normalizeTraitValue(rawValue.join("、"))
          : normalizeTraitValue(rawValue);
        if (!normalized) {
          return "";
        }
        if (stableByLabel.get(facet.label) === normalized) {
          return "";
        }
        return formatTrait(facet.label, normalized);
      })
      .filter(Boolean)
      .slice(0, 4);

    return {
      title: card.title,
      traits,
    };
  });
}

export function buildAuthorStyleProfile(bookCards: AuthorBookCardRecord[]): AuthorStyleProfileSummary | null {
  if (!bookCards.length) {
    return null;
  }

  const coverageReport = {
    bookCount: bookCards.length,
    withStyleProfileCount: bookCards.filter((card) => Boolean(card.styleProfile)).length,
    withFingerprintCount: bookCards.filter((card) => hasFingerprint(card.fingerprint)).length,
  };
  const multiBook = bookCards.length >= 2;
  const { stableTraits, stableByLabel } = buildStableTraitSet(bookCards);
  const bookSpecificTraits = buildBookSpecificTraits(bookCards, stableByLabel);
  const fingerprintSummary = summarizeFingerprint(bookCards);

  if (!multiBook) {
    const singleTraits = bookSpecificTraits[0]?.traits.slice(0, 3) ?? [];
    return {
      profileMode: "single-book inferred",
      authorProfileSummary: [
        "当前只有 1 本书卡，作者画像仍属于单书推断。",
        singleTraits.length ? `暂时最明显的特征是 ${singleTraits.join("；")}。` : "",
        fingerprintSummary,
      ].filter(Boolean).join(" "),
      stableTraits: [],
      bookSpecificTraits,
      coverageReport,
    };
  }

  return {
    profileMode: "multi-book stable",
    authorProfileSummary: [
      `基于 ${bookCards.length} 本书卡整理作者稳定画像。`,
      stableTraits.length ? `稳定特征主要是 ${stableTraits.slice(0, 4).join("；")}。` : "当前还没有足够一致的稳定文本特征，先以书卡差异为主。", 
      fingerprintSummary,
    ].filter(Boolean).join(" "),
    stableTraits,
    bookSpecificTraits,
    coverageReport,
  };
}
