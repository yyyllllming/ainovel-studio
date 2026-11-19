import type {
  CanonFact,
  ChapterBlueprint,
  HookDiagnosticItem,
  HookDiagnosticsSnapshot,
  HookPlan,
} from "../types.ts";

const SETUP_MATCH_THRESHOLD = 0.45;
const PAYOFF_CANDIDATE_THRESHOLD = 0.55;
const DUPLICATE_THRESHOLD = 0.56;
const DUPLICATE_CHAPTER_GAP = 3;
const MAX_TRACKED_ITEMS = 12;

type ForeshadowEntry = Record<string, unknown>;

interface HookTextEvidence {
  chapterNo: number;
  text: string;
  kind: HookDiagnosticItem["setupEvidenceKind"] | HookDiagnosticItem["payoffEvidenceKind"];
  similarity: number;
}

function normalizeMatchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function buildBigrams(value: string) {
  const normalized = normalizeMatchText(value);
  if (!normalized) {
    return new Set<string>();
  }
  if (normalized.length < 2) {
    return new Set([normalized]);
  }
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.add(normalized.slice(index, index + 2));
  }
  return grams;
}

export function scoreHookTextSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeMatchText(left);
  const normalizedRight = normalizeMatchText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }
  if (normalizedLeft === normalizedRight) {
    return 1;
  }
  if (
    normalizedLeft.length >= 6
    && normalizedRight.length >= 6
    && (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) {
    return 0.92;
  }

  const leftBigrams = buildBigrams(normalizedLeft);
  const rightBigrams = buildBigrams(normalizedRight);
  if (!leftBigrams.size || !rightBigrams.size) {
    return 0;
  }

  let overlap = 0;
  for (const gram of leftBigrams) {
    if (rightBigrams.has(gram)) {
      overlap += 1;
    }
  }

  return overlap / (leftBigrams.size + rightBigrams.size - overlap);
}

function normalizeHookResolutionStatus(status: unknown) {
  const value = String(status ?? "").trim().toLowerCase();
  if (["resolved", "done", "closed", "fulfilled", "paid_off", "已回收", "已完成", "关闭"].includes(value)) {
    return "resolved" as const;
  }
  if (["abandoned", "dropped", "failed", "cancelled", "canceled", "废弃", "放弃"].includes(value)) {
    return "abandoned" as const;
  }
  return "open" as const;
}

function buildHookAnchors(plan: HookPlan, blueprint?: ChapterBlueprint | null) {
  const anchors = [plan.setupText];
  const binding = blueprint?.hookBindings?.find((item) => item.hookPlanId === plan.id)?.foreshadowText?.trim();
  if (binding && !anchors.includes(binding)) {
    anchors.push(binding);
  }
  return anchors.filter(Boolean);
}

function pickBestEvidence(input: {
  anchors: string[];
  threshold: number;
  candidates: HookTextEvidence[];
}) {
  let best: HookTextEvidence | null = null;
  for (const candidate of input.candidates) {
    const similarity = Math.max(...input.anchors.map((anchor) => scoreHookTextSimilarity(anchor, candidate.text)));
    if (similarity < input.threshold) {
      continue;
    }
    if (!best || similarity > best.similarity || (similarity === best.similarity && candidate.chapterNo > best.chapterNo)) {
      best = {
        ...candidate,
        similarity,
      };
    }
  }
  return best;
}

function buildSetupEvidence(input: {
  plan: HookPlan;
  blueprint?: ChapterBlueprint | null;
  canonFacts: CanonFact[];
  foreshadowEntries: ForeshadowEntry[];
}) {
  const binding = input.blueprint?.hookBindings?.find((item) => item.hookPlanId === input.plan.id);
  if (binding?.foreshadowText?.trim()) {
    return {
      setupState: "bound" as const,
      evidence: {
        chapterNo: input.plan.chapterNo,
        text: binding.foreshadowText.trim(),
        kind: "binding" as const,
        similarity: 1,
      },
    };
  }

  const anchors = buildHookAnchors(input.plan, input.blueprint);
  const factCandidates: HookTextEvidence[] = input.canonFacts
    .filter((fact) => fact.chapterNo === input.plan.chapterNo && fact.type === "foreshadow")
    .map((fact) => ({
      chapterNo: fact.chapterNo,
      text: fact.content,
      kind: "foreshadow_fact" as const,
      similarity: 0,
    }));
  const ledgerCandidates: HookTextEvidence[] = input.foreshadowEntries
    .filter((entry) => Number(entry.chapterNo ?? 0) === input.plan.chapterNo)
    .map((entry) => ({
      chapterNo: Number(entry.chapterNo ?? input.plan.chapterNo),
      text: String(entry.content ?? ""),
      kind: "foreshadow_ledger" as const,
      similarity: 0,
    }));
  const candidates: HookTextEvidence[] = factCandidates.concat(ledgerCandidates);
  const evidence = pickBestEvidence({
    anchors,
    threshold: SETUP_MATCH_THRESHOLD,
    candidates,
  });
  if (evidence) {
    return {
      setupState: "matched" as const,
      evidence,
    };
  }

  return {
    setupState: "missing" as const,
    evidence: null,
  };
}

function buildPayoffEvidence(input: {
  currentChapterNo: number;
  plan: HookPlan;
  blueprint?: ChapterBlueprint | null;
  canonFacts: CanonFact[];
  foreshadowEntries: ForeshadowEntry[];
}) {
  const anchors = buildHookAnchors(input.plan, input.blueprint);
  const resolvedCandidates = input.foreshadowEntries
    .filter((entry) =>
      Number(entry.chapterNo ?? 0) > input.plan.chapterNo
      && Number(entry.chapterNo ?? 0) <= input.currentChapterNo
      && normalizeHookResolutionStatus(entry.status) === "resolved"
    )
    .map((entry) => ({
      chapterNo: Number(entry.chapterNo ?? 0),
      text: String(entry.content ?? ""),
      kind: "resolved_ledger" as const,
      similarity: 0,
    }));
  const resolvedEvidence = pickBestEvidence({
    anchors,
    threshold: PAYOFF_CANDIDATE_THRESHOLD,
    candidates: resolvedCandidates,
  });
  if (resolvedEvidence) {
    return {
      payoffState: "resolved" as const,
      evidence: resolvedEvidence,
    };
  }

  const candidateFacts = input.canonFacts
    .filter((fact) =>
      fact.chapterNo >= input.plan.payoffWindowStartChapter
      && fact.chapterNo <= input.currentChapterNo
      && fact.type !== "foreshadow"
    )
    .map((fact) => ({
      chapterNo: fact.chapterNo,
      text: fact.content,
      kind: "canon_fact" as const,
      similarity: 0,
    }));
  const candidateEvidence = pickBestEvidence({
    anchors,
    threshold: PAYOFF_CANDIDATE_THRESHOLD,
    candidates: candidateFacts,
  });
  if (candidateEvidence) {
    return {
      payoffState: "candidate" as const,
      evidence: candidateEvidence,
    };
  }

  return {
    payoffState: "none" as const,
    evidence: null,
  };
}

function attachDuplicateDiagnostics(items: HookDiagnosticItem[]) {
  const sorted = [...items].sort((left, right) => left.setupChapter - right.setupChapter);
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (!current) {
      continue;
    }
    let bestMatch: { id: string; score: number; text: string } | null = null;
    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previous = sorted[previousIndex];
      if (!previous) {
        continue;
      }
      if (current.setupChapter - previous.setupChapter > DUPLICATE_CHAPTER_GAP) {
        break;
      }
      const score = scoreHookTextSimilarity(current.setupText, previous.setupText);
      if (score < DUPLICATE_THRESHOLD) {
        continue;
      }
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          id: previous.hookPlanId,
          score,
          text: previous.setupText,
        };
      }
    }
    if (bestMatch) {
      current.duplicateOfHookPlanId = bestMatch.id;
      current.duplicateEvidenceText = bestMatch.text;
    }
  }
}

function rankHookDiagnostic(item: HookDiagnosticItem, currentChapterNo: number) {
  if (item.setupState === "missing") {
    return 1000 - item.setupChapter;
  }
  if (item.dead) {
    return 900 - item.setupChapter;
  }
  if (item.overdue) {
    return 800 - item.setupChapter;
  }
  if (item.duplicateOfHookPlanId) {
    return 700 - item.setupChapter;
  }
  if (item.setupChapter === currentChapterNo) {
    return 600;
  }
  return Math.max(0, 100 - (currentChapterNo - item.setupChapter));
}

export function buildHookDiagnosticsSummaryLine(diagnostics: HookDiagnosticsSnapshot | null | undefined) {
  if (!diagnostics || diagnostics.plannedCount <= 0) {
    return "";
  }

  return `Hook诊断：planned=${diagnostics.plannedCount} / bound=${diagnostics.boundCount} / debt=${diagnostics.missingSetupCount} / overdue=${diagnostics.overdueCount} / dead=${diagnostics.deadCount}`;
}

export function buildHookDiagnosticPlannerNotes(input: {
  diagnostics: HookDiagnosticsSnapshot | null | undefined;
  maxItems?: number;
  includePayoffEvidence?: boolean;
}) {
  const diagnostics = input.diagnostics;
  if (!diagnostics || diagnostics.plannedCount <= 0) {
    return [] as string[];
  }

  const maxItems = input.maxItems ?? 4;
  const includePayoffEvidence = input.includePayoffEvidence ?? true;
  const notes: string[] = [];

  for (const item of diagnostics.items) {
    const itemNotes: string[] = [];
    if (item.setupState === "missing") {
      itemNotes.push(`第${item.setupChapter}章的「${item.setupText}」还没有稳定 setup evidence；若仍保留，当前章必须补 setup 或明确取消。`);
    } else {
      if (item.dead) {
        itemNotes.push(`第${item.setupChapter}章的「${item.setupText}」已经超窗且持续悬挂；新蓝图要么尽快回收，要么明确砍掉。`);
      } else if (item.overdue) {
        itemNotes.push(`第${item.setupChapter}章的「${item.setupText}」已超过预计回收窗口；若本章不回收，必须在新规划里解释延后。`);
      }

      if (includePayoffEvidence && item.payoffState === "resolved" && item.payoffEvidenceChapter) {
        itemNotes.push(`第${item.setupChapter}章的「${item.setupText}」已在第${item.payoffEvidenceChapter}章出现回收证据，后续规划不要再把它当新钩子重复铺设。`);
      } else if (includePayoffEvidence && item.payoffState === "candidate" && item.payoffEvidenceChapter) {
        itemNotes.push(`第${item.setupChapter}章的「${item.setupText}」在第${item.payoffEvidenceChapter}章出现疑似回收证据；新蓝图应优先接住而不是继续拖延。`);
      }

      if (item.duplicateOfHookPlanId) {
        itemNotes.push(`第${item.setupChapter}章的「${item.setupText}」与更早 hook 高度相似，避免重复设钩。`);
      }
    }

    for (const note of itemNotes) {
      if (!note || notes.includes(note)) {
        continue;
      }
      notes.push(note);
      if (notes.length >= maxItems) {
        return notes;
      }
    }
  }

  return notes;
}

export function buildHookDiagnosticsSnapshot(input: {
  chapterNo: number;
  hookPlans: HookPlan[];
  blueprints: ChapterBlueprint[];
  canonFacts: CanonFact[];
  foreshadowEntries: ForeshadowEntry[];
}): HookDiagnosticsSnapshot {
  const relevantHookPlans = input.hookPlans
    .filter((plan) =>
      plan.chapterNo > 0
      && plan.chapterNo <= input.chapterNo
      && plan.lifecycleStatus !== "resolved"
      && plan.lifecycleStatus !== "cancelled"
    )
    .sort((left, right) => left.chapterNo - right.chapterNo);
  const blueprintByChapter = new Map(
    input.blueprints
      .filter((blueprint) => blueprint.chapterNo > 0 && blueprint.chapterNo <= input.chapterNo)
      .map((blueprint) => [blueprint.chapterNo, blueprint] as const),
  );

  const items: HookDiagnosticItem[] = relevantHookPlans.map((plan) => {
    const blueprint = blueprintByChapter.get(plan.chapterNo) ?? null;
    const setup = buildSetupEvidence({
      plan,
      blueprint,
      canonFacts: input.canonFacts,
      foreshadowEntries: input.foreshadowEntries,
    });
    const payoff = setup.setupState === "missing"
      ? {
          payoffState: "none" as const,
          evidence: null,
        }
      : buildPayoffEvidence({
          currentChapterNo: input.chapterNo,
          plan,
          blueprint,
          canonFacts: input.canonFacts,
          foreshadowEntries: input.foreshadowEntries,
        });
    const debtWindowEnd = plan.lifecycleStatus === "deferred"
      ? plan.deferredUntilChapter ?? plan.payoffWindowEndChapter
      : plan.payoffWindowEndChapter;
    const overdue = setup.setupState !== "missing"
      && payoff.payoffState === "none"
      && input.chapterNo > debtWindowEnd;
    const dead = overdue && input.chapterNo >= debtWindowEnd + 2;

    return {
      hookPlanId: plan.id,
      setupChapter: plan.chapterNo,
      setupText: plan.setupText,
      priority: plan.priority,
      payoffWindowStartChapter: plan.payoffWindowStartChapter,
      payoffWindowEndChapter: plan.payoffWindowEndChapter,
      setupState: setup.setupState,
      setupEvidenceChapter: setup.evidence?.chapterNo ?? null,
      setupEvidenceText: setup.evidence?.text ?? null,
      setupEvidenceKind: setup.evidence?.kind ?? null,
      payoffState: payoff.payoffState,
      payoffEvidenceChapter: payoff.evidence?.chapterNo ?? null,
      payoffEvidenceText: payoff.evidence?.text ?? null,
      payoffEvidenceKind: payoff.evidence?.kind ?? null,
      duplicateOfHookPlanId: null,
      duplicateEvidenceText: null,
      overdue,
      dead,
    };
  });

  attachDuplicateDiagnostics(items);

  const sortedItems = [...items].sort((left, right) => rankHookDiagnostic(right, input.chapterNo) - rankHookDiagnostic(left, input.chapterNo));
  return {
    chapterNo: input.chapterNo,
    plannedCount: items.length,
    boundCount: items.filter((item) => item.setupState === "bound").length,
    missingSetupCount: items.filter((item) => item.setupState === "missing").length,
    duplicateCount: items.filter((item) => Boolean(item.duplicateOfHookPlanId)).length,
    overdueCount: items.filter((item) => item.overdue).length,
    deadCount: items.filter((item) => item.dead).length,
    items: sortedItems.slice(0, MAX_TRACKED_ITEMS),
  };
}
