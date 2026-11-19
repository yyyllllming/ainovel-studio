import type { SceneCard, SceneRescueResult } from "./types.ts";

function normalizeKey(input: string) {
  return input.replace(/\s+/gu, "").trim();
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export function rewriteSceneStructure(input: {
  chapterContent?: string | null;
  sceneCards: SceneCard[];
}): SceneRescueResult {
  const appliedFixes: string[] = [];
  const rewriteInstructions: string[] = [];
  const chapterContent = input.chapterContent?.trim() ?? "";
  const merged = new Map<string, SceneCard>();

  for (const sceneCard of input.sceneCards) {
    const key = `${normalizeKey(sceneCard.obstacle)}::${sceneCard.requiredAnchors.join("|")}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...sceneCard });
      continue;
    }

    merged.set(key, {
      ...existing,
      objective: `${existing.objective}；合并后改成只保留一次更有效的推进。`,
      irreversibleChange: existing.irreversibleChange.includes("不可逆")
        ? existing.irreversibleChange
        : `不可逆变化：${existing.irreversibleChange}`,
      requiredAnchors: uniqueNonEmpty([...existing.requiredAnchors, ...sceneCard.requiredAnchors]),
    });
    appliedFixes.push("merge_repeated_scene");
  }

  const rescuedCards = [...merged.values()].map((card, index) => {
    const objective = index === 0 && (/^复述/u.test(card.objective) || /上一章/u.test(chapterContent))
      ? "删掉 recap 开头，直接从当前动作和即时压力切入。"
      : card.objective;
    if (objective !== card.objective) {
      appliedFixes.push("compress_recap_opening");
    }
    return {
      ...card,
      objective,
    };
  });

  if (rescuedCards.length > 0) {
    const last = rescuedCards[rescuedCards.length - 1]!;
    if (last.hookType === "emotional_close" || last.hookType === "explicit_summary") {
      last.hookType = "new_risk";
      last.irreversibleChange = last.irreversibleChange.includes("因果")
        ? last.irreversibleChange
        : `${last.irreversibleChange}，并补上一处因果转折，让章末明确压出新的风险。`;
      appliedFixes.push("strengthen_hook");
    }
  }

  rewriteInstructions.push("结构返修：先删/压 recap 开头，再把重复场景合并成一次更硬的推进。");
  rewriteInstructions.push("结构返修：调整场景顺序时优先让动作结果先于解释出现。");
  rewriteInstructions.push("结构返修：补一处因果转折，让章末只留一个更硬的钩子。");

  return {
    sceneCards: rescuedCards,
    appliedFixes: uniqueNonEmpty(appliedFixes),
    rewriteInstructions,
  };
}
