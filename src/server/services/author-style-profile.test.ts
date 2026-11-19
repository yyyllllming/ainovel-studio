import test from "node:test";
import assert from "node:assert/strict";

import { buildFallbackStyleProfile } from "../style/style-steering.ts";
import { buildAuthorStyleProfile } from "./author-style-profile.ts";
import type { AuthorBookCardRecord } from "../types.ts";

function makeBookCard(input: {
  id: string;
  title: string;
  primary: string;
  voiceRule: string;
  openingStrategy: string;
  sentenceMedian: number;
  dialogueRatio: number;
}): AuthorBookCardRecord {
  const profile = buildFallbackStyleProfile({
    references: [],
    manualGuidance: "叙述压紧，动作带情绪。",
    avoidances: "不要解释腔。",
  });

  profile.referenceAnchor.primary = input.primary;
  profile.dialogueStyle.voiceRule = input.voiceRule;
  profile.openingStrategy = input.openingStrategy;

  return {
    id: input.id,
    authorCardId: "author-1",
    title: input.title,
    authorName: "测试作者",
    styleCard: `${input.title} 风格卡`,
    styleProfile: profile,
    styleDigest: `${input.title} 摘要`,
    styleExemplars: [],
    sampledExcerpts: [],
    confidence: "high",
    fingerprint: {
      sentenceLength: {
        mean: input.sentenceMedian + 3,
        median: input.sentenceMedian,
        stddev: 6,
        shortRatio: 0.2,
        mediumRatio: 0.6,
        longRatio: 0.2,
      },
      paragraphLength: {
        mean: 80,
        median: 75,
        singleSentenceRatio: 0.15,
      },
      dialogue: {
        overallRatio: input.dialogueRatio,
        averageLength: 18,
        averageSurroundingAction: 30,
      },
      punctuation: {
        comma: 14,
        period: 8,
        exclamation: 1,
        question: 1,
        ellipsis: 0.4,
        dash: 0.2,
        semicolon: 0.1,
      },
      chapter: {
        count: 20,
        averageWords: 2600,
        minWords: 2100,
        maxWords: 3200,
      },
      openingPattern: {
        sceneRatio: 0.3,
        dialogueRatio: 0.2,
        actionRatio: 0.3,
        introspectionRatio: 0.2,
      },
      vocabulary: {
        uniqueRatio: 0.4,
        topBigrams: ["灯影", "石阶"],
      },
      rhetoric: {
        simileCount: 5,
        simileDensity: 1.2,
        personificationCount: 1,
        synesthesiaCount: 0,
        contrastCount: 2,
        contrastIronyCount: 2,
        rhetoricalQuestionCount: 0,
        dominantDevice: "simile",
      },
      narrativeRhythm: {
        sceneChangeFrequency: 1.1,
        tensionCurveShape: "rising",
        shortBurstRatio: 0.18,
        longFlowRatio: 0.12,
        rhythmVariance: 0.46,
        paragraphBreathingPattern: "mixed",
      },
      emotionRendering: {
        actionBasedRatio: 0.34,
        environmentBasedRatio: 0.29,
        introspectionRatio: 0.17,
        dialogueSubtextRatio: 0.2,
        sensoryDetailDensity: 4.8,
        restraintScore: 0.78,
      },
      deepTexture: {
        perspectiveShiftCount: 1,
        temporalDeviceCount: 2,
        whitespaceRatio: 0.22,
        informationDensity: 0.64,
        imageClusterCount: 3,
        sensoryDetailDensity: 4.8,
        sensoryChannelDistribution: {
          visual: 0.36,
          auditory: 0.19,
          olfactory: 0.08,
          gustatory: 0.05,
          tactile: 0.22,
          kinesthetic: 0.1,
        },
      },
    },
    wordCount: 52000,
    chapterCount: 20,
    sourceFileName: `${input.title}.txt`,
    createdAt: "2026-04-09T00:00:00.000Z",
  };
}

test("buildAuthorStyleProfile returns single-book inferred mode for one book", () => {
  const profile = buildAuthorStyleProfile([
    makeBookCard({
      id: "book-1",
      title: "长夜潮声",
      primary: "雨夜潜行",
      voiceRule: "对白克制但带刺，不直接说透结论。",
      openingStrategy: "从动作和场景直接切入，不用总结式开场。",
      sentenceMedian: 22,
      dialogueRatio: 0.18,
    }),
  ]);

  assert.equal(profile?.profileMode, "single-book inferred");
  assert.equal(profile?.stableTraits.length, 0);
  assert.match(profile?.authorProfileSummary ?? "", /单书推断/);
});

test("buildAuthorStyleProfile extracts stable traits and per-book differences across multiple books", () => {
  const profile = buildAuthorStyleProfile([
    makeBookCard({
      id: "book-1",
      title: "长夜潮声",
      primary: "雨夜潜行",
      voiceRule: "对白克制但带刺，不直接说透结论。",
      openingStrategy: "从动作和场景直接切入，不用总结式开场。",
      sentenceMedian: 22,
      dialogueRatio: 0.18,
    }),
    makeBookCard({
      id: "book-2",
      title: "雾中山门",
      primary: "雨夜潜行",
      voiceRule: "对白克制但带刺，不直接说透结论。",
      openingStrategy: "从动作和场景直接切入，不用总结式开场。",
      sentenceMedian: 24,
      dialogueRatio: 0.21,
    }),
    makeBookCard({
      id: "book-3",
      title: "荒城回灯",
      primary: "雨夜潜行",
      voiceRule: "对白带更重的压迫感，冲突贴着呼吸推进。",
      openingStrategy: "从动作和场景直接切入，不用总结式开场。",
      sentenceMedian: 26,
      dialogueRatio: 0.24,
    }),
  ]);

  assert.equal(profile?.profileMode, "multi-book stable");
  assert.equal(profile?.coverageReport.bookCount, 3);
  assert.equal(profile?.stableTraits.some((trait) => trait.includes("叙述锚点：雨夜潜行")), true);
  assert.equal(profile?.stableTraits.some((trait) => trait.includes("开篇策略：从动作和场景直接切入")), true);
  assert.equal(
    profile?.bookSpecificTraits.find((entry) => entry.title === "荒城回灯")?.traits.some((trait) => trait.includes("对白声线")),
    true,
  );
});
