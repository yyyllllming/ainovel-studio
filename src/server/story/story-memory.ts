import type {
  CharacterSnapshot,
  ChapterBlueprint,
  ConflictRecord,
  FoundationPayload,
  CharacterStateMemoryEntry,
  StoryThreadMemoryEntry,
} from "../types.ts";
import { unique } from "../utils.ts";

const MEMORY_SPLIT_REGEX = /[^\p{L}\p{N}_]+/u;
const STALE_CHAPTER_GAP = 6;
const OVERDUE_THREAD_GAP = 8;

function matchFragment(content: string, fragment: string) {
  const normalizedContent = content.trim();
  const normalizedFragment = fragment.trim();
  if (!normalizedContent || !normalizedFragment) {
    return false;
  }
  return normalizedContent.includes(normalizedFragment) || normalizedFragment.includes(normalizedContent);
}

function collectFocusCharacterNames(blueprint: ChapterBlueprint, foundation: FoundationPayload) {
  const referencedByText = foundation.characters
    .map((character) => character.name)
    .filter((name) =>
      [blueprint.sceneGoal, ...blueprint.conflicts, ...blueprint.foreshadows, ...blueprint.locations].some((entry) =>
        entry.includes(name),
      ),
    );

  return unique([...blueprint.characters, ...referencedByText]);
}

function formatRelationshipSummary(relationships: Record<string, string> | undefined) {
  if (!relationships) {
    return "";
  }
  const items = Object.entries(relationships)
    .slice(0, 3)
    .map(([target, status]) => `${target}=${status}`);
  return items.length ? `关系=${items.join("，")}` : "";
}

function buildSnapshotSummary(snapshot: CharacterSnapshot, name: string) {
  const state = snapshot.characters[name];
  if (!state) {
    return "";
  }

  const parts = [`第 ${snapshot.chapterNo} 章记录`];
  if (state.location) {
    parts.push(`地点=${state.location}`);
  }
  if (state.emotion) {
    parts.push(`情绪=${state.emotion}`);
  }
  if (state.items?.length) {
    parts.push(`持有=${state.items.slice(0, 4).join("、")}`);
  }
  if (state.currentGoal) {
    parts.push(`目标=${state.currentGoal}`);
  }
  if (state.currentPressure) {
    parts.push(`压力=${state.currentPressure}`);
  }
  if (state.hiddenIntent) {
    parts.push(`暗线=${state.hiddenIntent}`);
  }
  if (state.injuries?.length) {
    parts.push(`伤势=${state.injuries.slice(0, 3).join("、")}`);
  }
  const relationshipSummary = formatRelationshipSummary(state.relationships);
  if (relationshipSummary) {
    parts.push(relationshipSummary);
  }
  if (state.notes?.length) {
    parts.push(`备注=${state.notes.slice(0, 2).join("；")}`);
  }
  return parts.join("；");
}

function buildFoundationFallbackSummary(
  foundation: FoundationPayload,
  name: string,
) {
  const base = foundation.characters.find((character) => character.name === name);
  if (!base) {
    return "";
  }

  const parts = [
    "基础设定",
    base.role ? `身份=${base.role}` : "",
    base.goal ? `目标=${base.goal}` : "",
    base.traits.length ? `特质=${base.traits.join("、")}` : "",
  ].filter(Boolean);

  return parts.join("；");
}

function normalizeThreadStatus(value: unknown): StoryThreadMemoryEntry["status"] {
  const normalized = String(value ?? "active").trim().toLowerCase();
  if (normalized === "resolved" || normalized === "closed" || normalized === "done") {
    return "resolved";
  }
  if (normalized === "dormant" || normalized === "paused") {
    return "dormant";
  }
  return "active";
}

function normalizeThreadKey(content: string) {
  return content.trim().toLowerCase();
}

function collectBlueprintNeedles(blueprint: ChapterBlueprint) {
  return unique(
    [
      blueprint.sceneGoal,
      ...blueprint.characters,
      ...blueprint.locations,
      ...blueprint.conflicts,
      ...blueprint.foreshadows,
    ]
      .flatMap((entry) => entry.split(MEMORY_SPLIT_REGEX))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 2),
  );
}

export function buildCharacterStateEntries(input: {
  blueprint: ChapterBlueprint;
  foundation: FoundationPayload;
  snapshots: CharacterSnapshot[];
  currentChapter: number;
  limit?: number;
}): CharacterStateMemoryEntry[] {
  const limit = input.limit ?? 6;
  const focusNames = collectFocusCharacterNames(input.blueprint, input.foundation).slice(0, limit);
  const snapshots = [...input.snapshots].sort((left, right) => right.chapterNo - left.chapterNo);
  const entries: CharacterStateMemoryEntry[] = [];

  for (const name of focusNames) {
    const latestSnapshot = snapshots.find((snapshot) => snapshot.characters[name]);
    if (latestSnapshot) {
      entries.push({
        name,
        source: "snapshot",
        lastUpdatedChapter: latestSnapshot.chapterNo,
        stale: input.currentChapter - latestSnapshot.chapterNo >= STALE_CHAPTER_GAP,
        summary: buildSnapshotSummary(latestSnapshot, name),
      });
      continue;
    }

    const fallbackSummary = buildFoundationFallbackSummary(input.foundation, name);
    if (!fallbackSummary) {
      continue;
    }

    entries.push({
      name,
      source: "foundation",
      lastUpdatedChapter: null,
      stale: false,
      summary: fallbackSummary,
    });
  }

  return entries;
}

export function buildActiveThreadEntries(input: {
  blueprint: ChapterBlueprint;
  foreshadows: Array<Record<string, unknown>>;
  currentChapter: number;
  limit?: number;
}): StoryThreadMemoryEntry[] {
  const limit = input.limit ?? 6;
  const needles = collectBlueprintNeedles(input.blueprint);
  const latestByContent = new Map<string, Record<string, unknown>>();

  const sortedSource = [...input.foreshadows].sort((left, right) => {
    const chapterDelta = Number(right.chapterNo ?? 0) - Number(left.chapterNo ?? 0);
    if (chapterDelta !== 0) {
      return chapterDelta;
    }
    return String(right.timestamp ?? "").localeCompare(String(left.timestamp ?? ""));
  });

  for (const entry of sortedSource) {
    const content = String(entry.content ?? "").trim();
    if (!content) {
      continue;
    }
    const key = normalizeThreadKey(content);
    if (!latestByContent.has(key)) {
      latestByContent.set(key, entry);
    }
  }

  const entries: StoryThreadMemoryEntry[] = [];

  for (const entry of latestByContent.values()) {
    const content = String(entry.content ?? "").trim();
    const status = normalizeThreadStatus(entry.status);
    if (!content || status === "resolved") {
      continue;
    }

    const openedChapter = Math.max(0, Number(entry.chapterNo ?? 0));
    const age = openedChapter > 0 ? Math.max(0, input.currentChapter - openedChapter) : 0;
    const directForeshadowMatch = input.blueprint.foreshadows.some((item) => matchFragment(content, item));
    const overlap = needles.filter((needle) => matchFragment(content, needle)).length;
    const priority = directForeshadowMatch
      ? "critical"
      : overlap > 0 || age >= OVERDUE_THREAD_GAP
        ? "high"
        : "normal";
    const score =
      (directForeshadowMatch ? 40 : 0) +
      overlap * 8 +
      Math.min(age, 12) +
      (status === "active" ? 4 : 1);

    entries.push({
      id: String(entry.id ?? normalizeThreadKey(content)),
      content,
      openedChapter,
      lastUpdatedChapter: openedChapter,
      age,
      status,
      priority,
      score,
    });
  }

  return entries
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.age !== left.age) {
        return right.age - left.age;
      }
      return left.content.localeCompare(right.content, "zh-CN");
    })
    .slice(0, limit);
}

export function buildSceneSteeringNotes(input: {
  currentChapter: number;
  characterStates: CharacterStateMemoryEntry[];
  activeThreads: StoryThreadMemoryEntry[];
  conflicts: ConflictRecord[];
}) {
  const notes: string[] = [];

  const criticalThreads = input.activeThreads
    .filter((thread) => thread.priority === "critical")
    .slice(0, 2);
  if (criticalThreads.length) {
    notes.push(`本章优先推进这些主线线程：${criticalThreads.map((thread) => thread.content).join("；")}`);
  }

  const overdueThreads = input.activeThreads
    .filter((thread) => thread.age >= OVERDUE_THREAD_GAP && thread.priority !== "critical")
    .slice(0, 2);
  if (overdueThreads.length) {
    notes.push(
      `这些未回收线程已经悬挂较久，除非刻意压后，否则最好给出推进或解释：${overdueThreads
        .map((thread) => `${thread.content}（${thread.age}章）`)
        .join("；")}`,
    );
  }

  const staleStates = input.characterStates.filter((entry) => entry.stale).slice(0, 2);
  if (staleStates.length) {
    notes.push(
      `以下角色状态超过 ${STALE_CHAPTER_GAP} 章未更新，落笔前先核对：${staleStates
        .map((entry) => `${entry.name}${entry.lastUpdatedChapter ? `（上次在第 ${entry.lastUpdatedChapter} 章）` : ""}`)
        .join("；")}`,
    );
  }

  const blockingConflicts = input.conflicts
    .filter((conflict) => conflict.severity === "hard" || conflict.severity === "soft")
    .slice(0, 2);
  if (blockingConflicts.length) {
    notes.push(...blockingConflicts.map((conflict) => `一致性提醒：${conflict.message}`));
  }

  return unique(notes);
}
