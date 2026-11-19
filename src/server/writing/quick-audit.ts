import { assessProseStyleRisk } from "./prose-normalizer.ts";
import { evaluateWritingCharterGate } from "./prose-rescue.ts";
import {
  buildGenreFulfillmentAssessment,
  buildLoopRiskAssessment,
  buildStoryProgressionAssessment,
} from "../story/story-progression.ts";
import { containsDraftArtifactText } from "../foundation/foundation-quality-guards.ts";
import type {
  ChapterBlueprint,
  ChapterDeltaRecord,
  QuickAuditVerdict,
  StoryContract,
  WritingCharter,
} from "../types.ts";

export function buildDeterministicQuickAudit(input: {
  chapterContent: string;
  blueprint: ChapterBlueprint;
  hasHardConflict: boolean;
  writingCharter?: WritingCharter | null;
  storyContract?: StoryContract | null;
  recentDeltaRecords?: ChapterDeltaRecord[];
}) {
  const issues: QuickAuditVerdict["issues"] = [];
  const triggerReasons: QuickAuditVerdict["triggerReasons"] = [];
  const fixHints: string[] = [];
  const styleChecklistHits: QuickAuditVerdict["styleChecklistHits"] = [];
  const charterViolations: QuickAuditVerdict["charterViolations"] = [];
  let confidence = 0.84;
  const loopRisk = buildLoopRiskAssessment({
    blueprint: input.blueprint,
    recentDeltaRecords: input.recentDeltaRecords ?? [],
  });
  const storyProgression = buildStoryProgressionAssessment({
    blueprint: input.blueprint,
    loopRisk,
  });
  const genreFulfillment = buildGenreFulfillmentAssessment({
    blueprint: input.blueprint,
    activations: input.storyContract?.genreObligationPacks ?? [],
  });

  if (input.hasHardConflict) {
    issues.push({
      type: "hard_conflict",
      location: "上下文预检",
      severity: "major",
    });
    triggerReasons.push("hard_conflict");
    confidence = Math.min(confidence, 0.25);
  }

  const trimmed = input.chapterContent.trim();
  if (trimmed.length < 300) {
    issues.push({
      type: "structure_break",
      location: "全文",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.35);
  }

  if (containsDraftArtifactText(input.chapterContent)) {
    issues.push({
      type: "draft_artifact",
      location: "全文",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.4);
  }

  const missingCharacters = input.blueprint.characters.filter((name) => !input.chapterContent.includes(name));
  if (missingCharacters.length === input.blueprint.characters.length && missingCharacters.length > 0) {
    issues.push({
      type: "blueprint_drift",
      location: "全文",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.48);
  }

  const paragraphs = input.chapterContent
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const shortNarrativeParagraphs = paragraphs.filter((paragraph) =>
    !/^[""「『‘—-]/u.test(paragraph)
    && (paragraph.match(/[。！？!?…]+/gu)?.length ?? 0) <= 1
    && paragraph.length <= 36
  );
  if (paragraphs.length >= 4 && shortNarrativeParagraphs.length >= Math.ceil(paragraphs.length * 0.45)) {
    issues.push({
      type: "structure_break",
      location: "段落组织",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.42);
    triggerReasons.push("low_confidence");
  }

  if (/推进主线|信息投放|升级危机|情绪价值|爽点|名场面/u.test(input.chapterContent)) {
    issues.push({
      type: "draft_artifact",
      location: "正文用语",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.4);
    triggerReasons.push("low_confidence");
  }

  const proseRisk = assessProseStyleRisk(input.chapterContent, input.writingCharter);
  const charterGate = evaluateWritingCharterGate({
    chapterContent: input.chapterContent,
    proseRisk,
    writingCharter: input.writingCharter,
  });
  const hasStructuralCharterViolation = charterGate.budgetViolations.some((entry) =>
    entry.key !== "motif_reuse" || entry.reuseSeverity === "structural"
  );
  styleChecklistHits.push(...charterGate.styleChecklistHits);
  charterViolations.push(...charterGate.budgetViolations);

  if (proseRisk.severity === "fail") {
    issues.push({
      type: "style_drift",
      location: "正文文笔",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.46);
    triggerReasons.push("low_confidence");
    if (proseRisk.notes.length) {
      fixHints.push(`重点压 AI 腔：${proseRisk.notes.join("；")}`);
    }
  } else if (proseRisk.severity === "warn") {
    // warn + 结构性 charter 违规 → 联合升级为 major；纯 lexical motif_reuse 不升级
    const warnSeverity = hasStructuralCharterViolation ? "major" as const : "minor" as const;
    issues.push({
      type: "style_drift",
      location: "正文文笔",
      severity: warnSeverity,
    });
    confidence = Math.min(confidence, warnSeverity === "major" ? 0.46 : 0.64);
    triggerReasons.push("low_confidence");
    if (proseRisk.notes.length) {
      fixHints.push(`补修正文风稳定性：${proseRisk.notes.join("；")}`);
    }
  }

  if (charterGate.shouldBlock) {
    issues.push({
      type: "style_drift",
      location: "作者习惯卡",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.46);
    triggerReasons.push("low_confidence");
    if (charterGate.notes.length) {
      fixHints.push(`作者习惯卡未达标：${charterGate.notes.join("；")}`);
    }
  }

  if (storyProgression.risk === "risk") {
    issues.push({
      type: "story_progression",
      location: "章节蓝图",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.42);
    triggerReasons.push("major_progression");
    fixHints.push(`主推进未达标：${storyProgression.summary}${storyProgression.stallSignals.length ? `（${storyProgression.stallSignals.join("；")}）` : ""}`);
  } else if (storyProgression.risk === "watch") {
    issues.push({
      type: "story_progression",
      location: "章节蓝图",
      severity: "minor",
    });
    confidence = Math.min(confidence, 0.62);
    triggerReasons.push("major_progression");
    fixHints.push(`剧情推进开始走弱：${storyProgression.summary}`);
  }

  if (loopRisk.stuckDimensions.includes("combat_loop")) {
    issues.push({
      type: "story_progression",
      location: "循环轴检测",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.38);
    triggerReasons.push("major_progression");
    fixHints.push("检测到 combat_loop：连续在同地进行 combat/pursuit + power_shift 循环，必须改线。");
  }
  if (loopRisk.stuckDimensions.includes("antagonist_loop")) {
    issues.push({
      type: "story_progression",
      location: "循环轴检测",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.40);
    fixHints.push("检测到 antagonist_loop：连续 3 章同一对手且无实质推进。");
  }
  if (loopRisk.stuckDimensions.includes("action_loop")) {
    issues.push({
      type: "story_progression",
      location: "循环轴检测",
      severity: "minor",
    });
    confidence = Math.min(confidence, 0.55);
    fixHints.push("检测到 action_loop：行动模式连续重复。");
  }
  if (loopRisk.stuckDimensions.includes("ending_summary_loop")) {
    issues.push({
      type: "story_progression",
      location: "循环轴检测",
      severity: "minor",
    });
    confidence = Math.min(confidence, 0.58);
    fixHints.push("检测到 ending_summary_loop：章末收束连续使用总结/情感收尾。");
  }
  if (loopRisk.stuckDimensions.includes("mechanism_summary_loop")) {
    issues.push({
      type: "story_progression",
      location: "循环轴检测",
      severity: "minor",
    });
    confidence = Math.min(confidence, 0.58);
    fixHints.push("检测到 mechanism_summary_loop：机制揭示连续使用总结模式。");
  }

  if (genreFulfillment?.risk === "risk") {
    issues.push({
      type: "genre_fulfillment",
      location: "题材履约",
      severity: "major",
    });
    confidence = Math.min(confidence, 0.44);
    triggerReasons.push("major_progression");
    fixHints.push(`题材履约未达标：${genreFulfillment.summary}${genreFulfillment.missing.length ? `（${genreFulfillment.missing.join("；")}）` : ""}`);
  } else if (genreFulfillment?.risk === "watch") {
    issues.push({
      type: "genre_fulfillment",
      location: "题材履约",
      severity: "minor",
    });
    confidence = Math.min(confidence, 0.64);
    triggerReasons.push("major_progression");
    fixHints.push(`题材履约偏弱：${genreFulfillment.summary}`);
  }

  const verdict: QuickAuditVerdict["verdict"] = issues.some((issue) => issue.severity === "major") ? "escalate" : "pass";
  const reason = verdict === "pass"
    ? "极简检查通过"
    : charterGate.shouldBlock
      ? "极简检查发现作者习惯卡预算违规，需升级深审。"
      : proseRisk.severity === "fail"
        ? "极简检查发现明显 AI 腔与结构风险，需升级深审。"
        : "极简检查发现需要升级深审的风险";
  const fixInstructions = verdict === "pass"
    ? "无需额外修改"
    : fixHints.length
      ? `${fixHints.join("；")}；并在深审阶段继续检查蓝图跑偏、结构破损和硬连续性风险。`
      : "请在深审阶段重点检查蓝图跑偏、结构破损和硬连续性风险。";

  return {
    reviewMode: "quick" as const,
    verdict,
    confidence,
    reason,
    fixInstructions,
    issues,
    triggerReasons,
    styleChecklistHits,
    charterViolations,
    storyProgression,
    genreFulfillment,
    loopRisk,
    primaryDeltaDelivered: storyProgression.primaryDelta,
    stuckDimensions: loopRisk.stuckDimensions,
  } satisfies QuickAuditVerdict;
}
