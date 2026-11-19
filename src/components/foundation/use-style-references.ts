/**
 * useStyleReferences — 管理文风参考选择、搜索与样本输入状态。
 * 从 use-foundation-workshop-controller.tsx 提取。
 */

import { useMemo, useState, type ReactNode } from "react";
import type {
  FoundationDraft,
  StyleReferenceCandidate,
  StyleStreamProgressState,
} from "@/lib/types";
import {
  getStyleReferenceKey,
  getStyleSourceLabel,
  normalizeOptionalDigest,
  parseStyleSamples,
  renderStyleReferenceLabel,
  serializeStyleSamples,
  STYLE_SAMPLE_DELIMITER,
  createStreamingProgressNode,
} from "./use-foundation-workshop-controller-utils";

export interface UseStyleReferencesOptions {
  draft: FoundationDraft | null;
  foundation: { styleDigest?: string } | null;
  styleCandidates: StyleReferenceCandidate[];
  styleSource: "network" | "mixed" | StyleReferenceCandidate["source"] | null;
}

export function useStyleReferences({
  draft,
  foundation,
  styleCandidates,
  styleSource,
}: UseStyleReferencesOptions) {
  const [primaryStyleKeyInput, setPrimaryStyleKeyInput] = useState<string | null>(null);
  const [secondaryStyleKeysInput, setSecondaryStyleKeysInput] = useState<string[] | null>(null);
  const [styleSamplesInput, setStyleSamplesInput] = useState<string | null>(null);
  const [manualGuidanceInput, setManualGuidanceInput] = useState<string | null>(null);
  const [avoidancesInput, setAvoidancesInput] = useState<string | null>(null);
  const [styleProgress, setStyleProgress] = useState<StyleStreamProgressState | null>(null);

  const activeStyleDigest =
    normalizeOptionalDigest((draft as { styleDigest?: string } | null)?.styleDigest)
    || normalizeOptionalDigest(foundation?.styleDigest);

  const referencePool = useMemo(() => {
    const entries = new Map<string, StyleReferenceCandidate>();

    for (const candidate of styleCandidates) {
      const key = getStyleReferenceKey(candidate);
      entries.set(key, { ...candidate, id: key });
    }

    for (const reference of draft?.styleReferences ?? []) {
      const key = getStyleReferenceKey(reference);
      if (!entries.has(key)) {
        entries.set(key, {
          id: key,
          kind: reference.kind,
          label: reference.label,
          author: reference.author,
          source: reference.source,
          hint: reference.relation === "primary" ? "当前主参考" : "当前辅参考",
          origin: reference.relation === "primary" ? "已确认主参考" : "已确认辅参考",
        });
      }
    }

    return Array.from(entries.values());
  }, [draft?.styleReferences, styleCandidates]);

  const referenceMap = useMemo(
    () => new Map(referencePool.map((candidate) => [getStyleReferenceKey(candidate), candidate] as const)),
    [referencePool],
  );

  const draftPrimaryStyleKey = useMemo(() => {
    const primary = draft?.styleReferences?.find((item) => item.relation === "primary");
    return primary ? getStyleReferenceKey(primary) : "";
  }, [draft?.styleReferences]);

  const draftSecondaryStyleKeys = useMemo(
    () => (draft?.styleReferences ?? [])
      .filter((item) => item.relation === "secondary")
      .slice(0, 2)
      .map((item) => getStyleReferenceKey(item)),
    [draft?.styleReferences],
  );

  const primaryStyleKey = primaryStyleKeyInput ?? draftPrimaryStyleKey;
  const secondaryStyleKeys = secondaryStyleKeysInput ?? draftSecondaryStyleKeys;
  const styleSamples = styleSamplesInput ?? serializeStyleSamples(draft?.styleSamples);
  const manualGuidance = manualGuidanceInput ?? draft?.styleManualGuidance ?? "";
  const avoidances = avoidancesInput ?? draft?.styleAvoidances ?? "";
  const isStyleStreaming = Boolean(styleProgress);

  function toggleSecondaryStyle(key: string) {
    setSecondaryStyleKeysInput((current) => {
      const base = current ?? secondaryStyleKeys;
      if (base.includes(key)) {
        return base.filter((item) => item !== key);
      }
      const next = base.filter((item) => item !== primaryStyleKey);
      return [...next, key].slice(0, 2);
    });
  }

  function selectPrimary(key: string) {
    setPrimaryStyleKeyInput(key);
    setSecondaryStyleKeysInput((current) => (current ?? secondaryStyleKeys).filter((item) => item !== key));
  }

  function buildStylePayload() {
    const primary = primaryStyleKey ? referenceMap.get(primaryStyleKey) : null;
    if (!primary) {
      throw new Error("请先选择 1 个主参考。");
    }
    const secondary = secondaryStyleKeys
      .map((key) => referenceMap.get(key))
      .filter((item): item is StyleReferenceCandidate => Boolean(item));

    return {
      references: [
        {
          kind: primary.kind,
          label: primary.label,
          author: primary.author,
          source: primary.source,
          relation: "primary" as const,
        },
        ...secondary.map((item) => ({
          kind: item.kind,
          label: item.label,
          author: item.author,
          source: item.source,
          relation: "secondary" as const,
        })),
      ],
      samples: parseStyleSamples(styleSamples),
      manualGuidance,
      avoidances,
    };
  }

  function resetStyleInputs() {
    setPrimaryStyleKeyInput(null);
    setSecondaryStyleKeysInput(null);
    setStyleSamplesInput(null);
    setManualGuidanceInput(null);
    setAvoidancesInput(null);
    setStyleProgress(null);
  }

  const styleProgressNode: ReactNode = styleProgress ? createStreamingProgressNode({
    title: "文风约束卡实时生成中",
    detail: styleProgress.message,
    progress: styleProgress.progress,
  }) : null;

  const visibleStyleCard = styleProgress?.preview || draft?.styleSteeringCard || "";

  return {
    // 参考池
    referencePool,
    referenceMap,
    primaryStyleKey,
    secondaryStyleKeys,
    activeStyleDigest,
    getReferenceKey: getStyleReferenceKey,
    renderReferenceLabel: renderStyleReferenceLabel,
    styleSourceLabel: styleSource ? getStyleSourceLabel(styleSource) : null,
    // 输入
    styleSamples,
    styleSampleDelimiter: STYLE_SAMPLE_DELIMITER,
    manualGuidance,
    avoidances,
    // setter
    onManualGuidanceChange: setManualGuidanceInput,
    onAvoidancesChange: setAvoidancesInput,
    onStyleSamplesChange: setStyleSamplesInput,
    onSelectPrimary: selectPrimary,
    onToggleSecondary: toggleSecondaryStyle,
    // streaming
    isStyleStreaming,
    styleProgress,
    setStyleProgress,
    styleProgressNode,
    visibleStyleCard,
    // build & reset
    buildStylePayload,
    resetStyleInputs,
  };
}
