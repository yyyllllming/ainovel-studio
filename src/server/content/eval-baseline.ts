import { pathToFileURL } from "node:url";

import { listWrittenChapters, readFinalChapter } from "../project-files.ts";
import { loadVoicePack } from "./voice-pack.ts";
import { readProjectVoiceSnapshot } from "./project-voice-snapshot.service.ts";
import type { EvalCorpus, EvalMetricScore, EvalReport, EvalReportEntry } from "./types.ts";
import { scoreVoice } from "./voice-engine.ts";

function splitParagraphs(input: string) {
  return input
    .replace(/\r\n?/gu, "\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitSentences(input: string) {
  return input
    .split(/(?<=[。！？!?…])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function normalizeMetric(score: number, notes: string[]): EvalMetricScore {
  return {
    score: Math.max(0, Math.min(1, score)),
    notes,
  };
}

function evaluateStructureProgression(content: string): EvalMetricScore {
  const hits = (content.match(/改写|拿到|确认|逼得|换了|顺着.+摸到/u)?.length ?? 0)
    + (content.match(/后患|闷响|热痕|禁忌/gu)?.length ?? 0);
  return normalizeMetric(Math.min(1, 0.35 + hits * 0.12), [
    `推进信号=${hits}`,
  ]);
}

function evaluateArenaLoop(content: string): EvalMetricScore {
  const paragraphs = splitParagraphs(content);
  const repeatedParagraphs = new Set<string>();
  for (const paragraph of paragraphs) {
    if (paragraphs.filter((entry) => entry === paragraph).length > 1) {
      repeatedParagraphs.add(paragraph);
    }
  }
  return normalizeMetric(Math.max(0, 1 - repeatedParagraphs.size * 0.25), [
    `重复段数=${repeatedParagraphs.size}`,
  ]);
}

function evaluateReadability(content: string): EvalMetricScore {
  const sentenceLengths = splitSentences(content).map((sentence) => sentence.length);
  const avgLength = average(sentenceLengths);
  const score = avgLength >= 12 && avgLength <= 34 ? 0.82 : avgLength > 0 ? 0.58 : 0;
  return normalizeMetric(score, [
    `平均句长=${avgLength.toFixed(1)}`,
  ]);
}

function evaluateAiSmell(content: string): EvalMetricScore {
  const smells = [
    "总结来说",
    "总之",
    "由此可见",
    "推进主线",
    "情绪价值",
    "不是……而是……",
  ];
  const hitCount = smells.reduce((sum, smell) => sum + (content.includes(smell) ? 1 : 0), 0);
  return normalizeMetric(Math.max(0, 1 - hitCount * 0.2), [
    `模板味命中=${hitCount}`,
  ]);
}

async function evaluateVoiceConsistency(projectId: string, content: string): Promise<EvalMetricScore> {
  const snapshot = await readProjectVoiceSnapshot(projectId);
  if (!snapshot) {
    return normalizeMetric(0.5, ["未找到 project voice snapshot，使用中性基线。"]);
  }
  const voicePack = await loadVoicePack(projectId);
  const score = scoreVoice({
    content,
    voicePack,
  });
  return normalizeMetric(score.score, [
    `voice consistency=${score.consistency}`,
  ]);
}

function aggregateMetric(entries: EvalMetricScore[]) {
  return normalizeMetric(
    entries.length ? entries.reduce((sum, entry) => sum + entry.score, 0) / entries.length : 0,
    entries.flatMap((entry) => entry.notes).slice(0, 6),
  );
}

export async function loadOpeningCorpus(projectId: string): Promise<EvalCorpus> {
  const writtenChapters = await listWrittenChapters(projectId);
  const opening = writtenChapters.filter((chapterNo) => chapterNo <= 6);
  const recoveryStress = writtenChapters.includes(10) ? [10] : [];
  const chapterNos = [...opening, ...recoveryStress];
  const entries = await Promise.all(
    chapterNos.map(async (chapterNo) => ({
      id: `${projectId}-${chapterNo}`,
      chapterNo,
      kind: chapterNo === 10 ? "recovery_stress" as const : "opening" as const,
      content: (await readFinalChapter(projectId, chapterNo)) ?? "",
    })),
  );
  return {
    projectId,
    entries,
  };
}

export async function runBaselineEval(input: {
  projectId: string;
  corpus: EvalCorpus;
}): Promise<EvalReport> {
  const entries: EvalReportEntry[] = [];
  for (const entry of input.corpus.entries) {
    const structureProgression = evaluateStructureProgression(entry.content);
    const arenaOpponentLoop = evaluateArenaLoop(entry.content);
    const proseReadability = evaluateReadability(entry.content);
    const aiSmell = evaluateAiSmell(entry.content);
    const voiceConsistency = await evaluateVoiceConsistency(input.projectId, entry.content);
    entries.push({
      id: entry.id,
      chapterNo: entry.chapterNo,
      kind: entry.kind,
      structureProgression,
      arenaOpponentLoop,
      proseReadability,
      aiSmell,
      voiceConsistency,
    });
  }

  return {
    projectId: input.projectId,
    entries,
    aggregate: {
      structureProgression: aggregateMetric(entries.map((entry) => entry.structureProgression)),
      arenaOpponentLoop: aggregateMetric(entries.map((entry) => entry.arenaOpponentLoop)),
      proseReadability: aggregateMetric(entries.map((entry) => entry.proseReadability)),
      aiSmell: aggregateMetric(entries.map((entry) => entry.aiSmell)),
      voiceConsistency: aggregateMetric(entries.map((entry) => entry.voiceConsistency)),
    },
  };
}

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    throw new Error("缺少 projectId");
  }
  const corpus = await loadOpeningCorpus(projectId);
  const report = await runBaselineEval({
    projectId,
    corpus,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
