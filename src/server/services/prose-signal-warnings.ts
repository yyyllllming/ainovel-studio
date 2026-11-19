import "../server-only.ts";

import { assessProseStyleRisk } from "../writing/prose-normalizer.ts";
import type { WritingCharter } from "../types.ts";

export function renderProseSignalWarnings(chapterContent: string, writingCharter?: WritingCharter | null) {
  const signals = assessProseStyleRisk(chapterContent, writingCharter);
  const notes = [
    `风险等级=${signals.severity}，风格分=${signals.score}`,
    `叙述句数=${signals.sentenceCount}，段落数=${signals.paragraphCount}`,
  ];

  if (signals.pronounLeadCount > 0) {
    notes.push(
      `代词起句=${signals.pronounLeadCount}（占比约 ${(signals.pronounLeadRatio * 100).toFixed(0)}%）`,
    );
  }
  if (signals.simileCount > 0) {
    notes.push(`“像/仿佛”比喻=${signals.simileCount}`);
  }
  if (signals.contrastTemplateCount > 0) {
    notes.push(`“不是……而是……”=${signals.contrastTemplateCount}`);
  }
  if (signals.abruptTurnCount > 0) {
    notes.push(`“忽然”=${signals.abruptTurnCount}`);
  }
  if (signals.repeatedSentenceStarts.length) {
    notes.push(
      `高频句首=${signals.repeatedSentenceStarts
        .map((entry) => `${entry.lead}×${entry.count}`)
        .join("、")}`,
    );
  }

  return {
    warnings: Array.from(new Set([...signals.warnings, ...signals.notes])),
    summary: notes.join("；"),
    severity: signals.severity,
    score: signals.score,
    shouldRetryStylePass: signals.shouldRetryStylePass,
  };
}
