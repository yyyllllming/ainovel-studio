import type { AgentStage } from "../style/style-steering.ts";
import { formatStyleProfileForStage } from "../style/style-steering.ts";
import type { ActiveStylePackage, StyleExcerpt } from "../types.ts";

const MAX_DIGEST_CHARS = 1_800;
const MIN_EXEMPLARS = 2;
const MAX_EXEMPLARS = 4;
const MIN_EXEMPLAR_CHARS = 120;
const MAX_EXEMPLAR_CHARS = 320;

export interface StylePromptBundle {
  stage: AgentStage;
  formattedStyleProfile: string;
  styleDigest: string;
  styleExemplars: StyleExcerpt[];
  sections: string[];
}

function normalizeBlock(input: string) {
  return input.replace(/\s+/gu, " ").trim();
}

function exemplarText(exemplar: StyleExcerpt) {
  return exemplar.content.trim();
}

export function assertNoRawBookText(input: {
  stage: AgentStage;
  activeStyle: ActiveStylePackage;
  formattedStyleProfile: string;
  styleDigest?: string;
  styleExemplars?: StyleExcerpt[];
  extraSections?: string[];
}) {
  const formattedStyleProfile = input.formattedStyleProfile.trim();
  const styleDigest = input.styleDigest?.trim() ?? "";
  const styleExemplars = input.styleExemplars ?? [];

  if (!formattedStyleProfile) {
    throw new Error(`style prompt guard: ${input.stage} 缺少风格画像`);
  }

  if (input.activeStyle.styleSnapshotId) {
    if (!styleDigest || styleDigest.length > MAX_DIGEST_CHARS) {
      throw new Error(`style prompt guard: ${input.stage} 的 styleDigest 不合法`);
    }
    if (styleExemplars.length < MIN_EXEMPLARS || styleExemplars.length > MAX_EXEMPLARS) {
      throw new Error(`style prompt guard: ${input.stage} 的 styleExemplars 数量不合法`);
    }
    if (styleExemplars.some((entry) => exemplarText(entry).length < MIN_EXEMPLAR_CHARS || exemplarText(entry).length > MAX_EXEMPLAR_CHARS)) {
      throw new Error(`style prompt guard: ${input.stage} 的 exemplar 长度越界`);
    }
  }

  const injectedSections = [
    formattedStyleProfile,
    styleDigest,
    ...styleExemplars.map(exemplarText),
    ...(input.extraSections ?? []),
  ]
    .map(normalizeBlock)
    .filter(Boolean);
  const allowedSections = new Set([
    normalizeBlock(formattedStyleProfile),
    normalizeBlock(styleDigest),
    ...styleExemplars.map((entry) => normalizeBlock(exemplarText(entry))),
  ].filter(Boolean));
  const allowedExemplarSections = styleExemplars
    .map((entry) => normalizeBlock(exemplarText(entry)))
    .filter(Boolean);
  const blockedSections = [
    input.activeStyle.styleCard,
    ...input.activeStyle.sampledExcerpts.map((entry) => entry.content),
  ]
    .map(normalizeBlock)
    .filter((entry) =>
      entry.length >= 80
      && !allowedSections.has(entry)
      && !allowedExemplarSections.some((allowed) => allowed.includes(entry)),
    );

  for (const blocked of blockedSections) {
    if (injectedSections.some((section) => section.includes(blocked))) {
      throw new Error(`style prompt guard: ${input.stage} 混入了原始导入正文`);
    }
  }
}

export function buildStylePromptBundle(stage: AgentStage, activeStyle: ActiveStylePackage): StylePromptBundle {
  const formattedStyleProfile = formatStyleProfileForStage(activeStyle.styleProfile, stage);
  const styleDigest = activeStyle.styleDigest.trim();
  const styleExemplars = activeStyle.styleExemplars.slice(0, MAX_EXEMPLARS);
  const sections = [
    `风格画像：\n${formattedStyleProfile}`,
    styleDigest ? `风格摘要：\n${styleDigest}` : "",
    styleExemplars.length
      ? `风格示例（只借节奏与组织，不复刻原句）：\n${styleExemplars.map((entry, index) => `${index + 1}. ${entry.content.trim()}`).join("\n\n")}`
      : "",
  ].filter(Boolean);

  assertNoRawBookText({
    stage,
    activeStyle,
    formattedStyleProfile,
    styleDigest,
    styleExemplars,
    extraSections: sections,
  });

  return {
    stage,
    formattedStyleProfile,
    styleDigest,
    styleExemplars,
    sections,
  };
}
