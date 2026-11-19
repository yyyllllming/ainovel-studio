# Codex Prompt — Session 1: 统一上下文注入引擎

## 上下文

AINovel Studio（`platform/`）的写作管线有一个严重的架构缺陷：10+ 种数据源（角色卡、世界规则、关系、事实、伏笔、lorebook、摘要、风格等）各自用不同的硬编码逻辑决定是否注入 Writer prompt，没有统一的优先级排序和 token 预算管理。

当前问题：
- `context-engine.ts:88-98` 的 `pickCharacterCards()` 硬截最多 5 个角色
- `context-engine.ts:100-112` 的 `pickWorldCards()` 用洪荒题材专用正则（`/灵纹|血脉|天赋|反噬|代价|追猎|部族|禁区|兽道/`）匹配核心规则，其他题材匹配不到
- 两个 pick 函数都用 `.slice(0, 5)` 硬截数量，不是 token 预算
- `context-serialization.ts:9-11` 把角色卡序列化为一行（只有 name/role/goal/traits）
- `foundation.relationships` 在整个 `assembleContextPack()` 中从未被读取或注入

需要引入统一的 Context Injection Engine 替代这些散落的逻辑。

## 关键文件和行号

- `src/server/run/context-engine.ts`（476 行）— `assembleContextPack()`, `pickCharacterCards()`, `pickWorldCards()`
- `src/server/services/context-serialization.ts`（46 行）— `serializeContextPackSections()`
- `src/server/run/chapter-draft.ts`（656 行）— `buildContextMessages()` 构建 prompt
- `src/server/story/story-lorebook.ts`（380 行）— 已有的关键词匹配+打分系统（可复用思路）
- `src/server/text-metrics.ts` — `estimateModelTokens()` 用于 token 估算
- `src/server/types/core.ts` — CharacterCard, WorldRule, RelationshipEdge 类型定义
- `src/server/types/story.ts` — FoundationPayload, ContextPack 类型定义

## 任务

### 1. 新建 `src/server/run/context-injection-engine.ts`

定义核心类型和注入算法：

```typescript
import { estimateModelTokens } from "../text-metrics.ts";

export type EntryActivation =
  | { mode: "always" }
  | { mode: "keyword"; keywords: string[] }
  | { mode: "chapter-range"; from: number; to: number };

export type InjectionPosition = "system" | "world-layer" | "structure-layer" | "style-anchor";

export interface InjectableEntry {
  id: string;
  type: "character" | "world" | "relationship" | "fact" | "thread"
      | "summary" | "style" | "lorebook" | "obligation" | "steering";
  content: string;
  priority: number;             // 0-100
  tokenCost: number;
  activation: EntryActivation;
  position: InjectionPosition;
}

export interface InjectionBudget {
  "world-layer": number;
  "structure-layer": number;
  "style-anchor": number;
}

export interface InjectionResult {
  layers: Record<InjectionPosition, string[]>;
  activated: InjectableEntry[];
  dropped: InjectableEntry[];
  debug: {
    totalActivated: number;
    totalDropped: number;
    budgetUsage: Record<string, number>;
  };
}

export function assembleInjections(
  entries: InjectableEntry[],
  scanText: string,
  chapterNo: number,
  budgets: InjectionBudget,
): InjectionResult {
  // 1. 激活过滤
  const activated: InjectableEntry[] = [];
  for (const entry of entries) {
    if (entry.activation.mode === "always") {
      activated.push(entry);
    } else if (entry.activation.mode === "keyword") {
      const hit = entry.activation.keywords.some(kw => scanText.includes(kw));
      if (hit) activated.push(entry);
    } else if (entry.activation.mode === "chapter-range") {
      if (chapterNo >= entry.activation.from && chapterNo <= entry.activation.to) {
        activated.push(entry);
      }
    }
  }

  // 2. 按 priority 降序排序（同 priority 时 type 排序保证稳定性）
  const typeOrder = ["character", "world", "relationship", "fact", "thread",
                     "summary", "style", "lorebook", "obligation", "steering"];
  activated.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
  });

  // 3. 每层独立做 token 预算贪心装箱
  const layers: Record<InjectionPosition, string[]> = {
    system: [], "world-layer": [], "structure-layer": [], "style-anchor": [],
  };
  const usage: Record<string, number> = {
    "world-layer": 0, "structure-layer": 0, "style-anchor": 0,
  };
  const dropped: InjectableEntry[] = [];
  const included: InjectableEntry[] = [];

  for (const entry of activated) {
    const pos = entry.position;
    if (pos === "system") {
      // system 不限预算
      layers.system.push(entry.content);
      included.push(entry);
      continue;
    }
    const budget = budgets[pos] ?? Infinity;
    if (usage[pos] + entry.tokenCost <= budget) {
      layers[pos].push(entry.content);
      usage[pos] += entry.tokenCost;
      included.push(entry);
    } else {
      dropped.push(entry);
    }
  }

  return {
    layers,
    activated: included,
    dropped,
    debug: {
      totalActivated: included.length,
      totalDropped: dropped.length,
      budgetUsage: usage,
    },
  };
}
```

### 2. 新建 `src/server/run/context-entry-collectors.ts`

将 Foundation 数据源转换为 InjectableEntry 数组。

**重要：** 先读 `src/server/types/core.ts` 获取 CharacterCard、WorldRule、RelationshipEdge 的精确类型定义。CharacterCard 当前有 name/role/goal/traits/secrets? 五个字段。后续 Batch 2 会扩展新字段，但本 Session 只用现有字段。

```typescript
import type { ChapterBlueprint, FoundationPayload } from "../types.ts";
import type { ContextPack, LorebookPack } from "../types.ts";
import type { InjectableEntry } from "./context-injection-engine.ts";
import { estimateModelTokens } from "../text-metrics.ts";

// 角色卡 → InjectableEntry[]
export function collectCharacterEntries(
  foundation: FoundationPayload,
  blueprint: ChapterBlueprint,
): InjectableEntry[] {
  return foundation.characters.map(card => {
    const inBlueprint = blueprint.characters.includes(card.name);
    const inConflict = blueprint.conflicts.some(c => c.includes(card.name));
    const inForeshadow = blueprint.foreshadows.some(f => f.includes(card.name));
    const isRelevant = inBlueprint || inConflict || inForeshadow;

    // 多行序列化（比当前的一行丰富得多）
    const lines = [`## ${card.name}（${card.role}）`];
    lines.push(`目标：${card.goal}`);
    lines.push(`特质：${card.traits.join("、")}`);
    if (card.secrets?.length) lines.push(`秘密：${card.secrets.join("；")}`);
    // 未来 Batch 2 扩展的 description/speechPattern 在这里自然加入
    const content = lines.join("\n");

    return {
      id: `char:${card.name}`,
      type: "character" as const,
      content,
      priority: isRelevant ? 80 : 40,
      tokenCost: estimateModelTokens(content),
      activation: isRelevant
        ? { mode: "always" as const }
        : { mode: "keyword" as const, keywords: [card.name, ...(card.triggerKeywords ?? [])] },
      position: "world-layer" as const,
    };
  });
}

// 世界规则 → InjectableEntry[]
export function collectWorldEntries(
  foundation: FoundationPayload,
): InjectableEntry[] {
  return foundation.worldview.map(rule => {
    const isCore = rule.priority === "core";
    const content = `【${rule.name}】${rule.description}`;
    return {
      id: `world:${rule.name}`,
      type: "world" as const,
      content,
      priority: isCore ? 80 : 50,
      tokenCost: estimateModelTokens(content),
      activation: isCore
        ? { mode: "always" as const }
        : { mode: "keyword" as const, keywords: rule.triggerKeywords ?? [rule.name] },
      position: "world-layer" as const,
    };
  });
}

// 关系 → InjectableEntry[]
export function collectRelationshipEntries(
  foundation: FoundationPayload,
  blueprintCharacters: string[],
): InjectableEntry[] {
  if (!foundation.relationships?.length) return [];
  // 把所有关系合并为一个条目
  const relevant = foundation.relationships.filter(r =>
    blueprintCharacters.includes(r.source) || blueprintCharacters.includes(r.target)
  );
  const all = relevant.length >= 2 ? relevant : foundation.relationships;
  const content = "## 角色关系\n" + all
    .map(r => `${r.source} →[${r.label}]→ ${r.target}`)
    .join("\n");
  return [{
    id: "relationships",
    type: "relationship",
    content,
    priority: 75,
    tokenCost: estimateModelTokens(content),
    activation: { mode: "always" },
    position: "world-layer",
  }];
}

// Lorebook → InjectableEntry[]
export function collectLorebookEntries(lorebook: LorebookPack): InjectableEntry[] {
  return lorebook.entries.slice(0, 10).map(entry => ({
    id: `lorebook:${entry.title}`,
    type: "lorebook" as const,
    content: `[${entry.title}] ${entry.content}`,
    priority: Math.min(entry.score, 100),
    tokenCost: estimateModelTokens(entry.content),
    activation: { mode: "always" as const },  // lorebook 已经被自己的匹配逻辑筛过了
    position: "world-layer" as const,
  }));
}

// 风格数据 → InjectableEntry[]（注入到 style-anchor 层，紧贴生成位置）
export function collectStyleEntries(contextPack: ContextPack): InjectableEntry[] {
  const entries: InjectableEntry[] = [];
  // 风格画像
  if (contextPack.styleProfile) {
    const content = formatStyleProfileForStage(contextPack.styleProfile, "writer");
    entries.push({
      id: "style:profile",
      type: "style",
      content,
      priority: 90,
      tokenCost: estimateModelTokens(content),
      activation: { mode: "always" },
      position: "style-anchor",
    });
  }
  // 风格范本
  if (contextPack.projectVoiceSnapshot?.positiveAnchors?.length) {
    const exemplars = contextPack.projectVoiceSnapshot.positiveAnchors.slice(0, 3);
    const content = "## 风格范本\n" + exemplars.map(e => `> ${e.text}`).join("\n\n");
    entries.push({
      id: "style:exemplars",
      type: "style",
      content,
      priority: 85,
      tokenCost: estimateModelTokens(content),
      activation: { mode: "always" },
      position: "style-anchor",
    });
  }
  return entries;
}
```

**注意：** `collectStyleEntries` 中的 `formatStyleProfileForStage` 需要从 `style-steering.ts` import。根据实际代码调整 import 路径和参数。`projectVoiceSnapshot` 的结构需要查看 `types/memory.ts` 中的 `ProjectVoiceSnapshot` 类型定义来确定 positiveAnchors 字段的精确路径。

### 3. 重构 `src/server/run/context-engine.ts`

关键变化：

**删除：**
- `pickCharacterCards()` 函数（第 88-98 行）
- `pickWorldCards()` 函数（第 100-112 行）
- `dedupeByName()` 和 `dedupeWorld()` 辅助函数

**修改 `assembleContextPack()`：**
- 删除 `const requiredCards = pickCharacterCards(foundation, blueprint);`
- 删除 `const worldviewCards = pickWorldCards(foundation, blueprint);`
- ContextPack 中 `requiredCards` 和 `worldviewCards` 保留但改为从 Entry 收集器的激活结果中派生（兼容下游消费者）
- 新增调用注入引擎：

```typescript
import { assembleInjections, type InjectionResult } from "./context-injection-engine.ts";
import { collectCharacterEntries, collectWorldEntries, collectRelationshipEntries, collectLorebookEntries, collectStyleEntries } from "./context-entry-collectors.ts";

// 在 assembleContextPack() 末尾、构建 pack 之前：
const allEntries = [
  ...collectCharacterEntries(foundation, blueprint),
  ...collectWorldEntries(foundation),
  ...collectRelationshipEntries(foundation, blueprint.characters),
  ...collectLorebookEntries(lorebook),
  ...collectStyleEntries(/* 需要传入已构建的部分 contextPack 数据 */),
];
const scanText = [
  blueprint.sceneGoal,
  ...blueprint.conflicts,
  ...blueprint.foreshadows,
  previousChapter?.slice(-3200) ?? "",
].join(" ");

const injectionResult = assembleInjections(allEntries, scanText, chapterNo, {
  "world-layer": Math.round(TOTAL_BUDGET * 0.25),
  "structure-layer": Math.round(TOTAL_BUDGET * 0.25),
  "style-anchor": Math.round(TOTAL_BUDGET * 0.10),
});
```

将 `injectionResult` 添加到 ContextPack 类型中。

**修改 `previousChapterTail`：**
```typescript
previousChapterTail: previousChapter ? previousChapter.slice(-3200).trim() : null,
// 从 -1600 改为 -3200
```

### 4. 重构 `src/server/services/context-serialization.ts`

从注入引擎结果取文本，替代手动序列化：

```typescript
export function serializeContextPackSections(contextPack: ContextPack) {
  const injection = contextPack.injectionResult;

  return {
    // 新：从注入引擎层取
    worldLayerText: injection.layers["world-layer"].join("\n\n"),
    structureLayerText: injection.layers["structure-layer"].join("\n\n"),
    styleAnchorText: injection.layers["style-anchor"].join("\n\n"),

    // 保留：不走注入引擎的数据
    serializedSummaries: [
      ...contextPack.summaryWindow.recentFullChapters,
      ...contextPack.summaryWindow.detailedSummaries,
      ...contextPack.summaryWindow.briefSummaries,
    ].join("\n\n"),
    serializedPreviousChapterTail: contextPack.previousChapterTail?.trim() ?? "",
    serializedFutureContext: contextPack.futureContext,
    serializedPlannerContextSummary: contextPack.plannerContextSummary,
    serializedWriterNotes: contextPack.writerNotes.join("\n"),
  };
}
```

**注意：** 修改此函数的返回类型后，需要更新所有消费者。主要消费者是 `chapter-draft.ts` 的 `buildContextMessages()`。

### 5. 重构 `src/server/run/chapter-draft.ts` 的 `buildContextMessages()`

用注入引擎的分层结果构建 prompt，替代当前的平铺 30 段。

**新的 prompt 结构：**

System message：
```
{writer.md 内容}
项目：{projectId}
叙事人称：{narrativePerson}
```

User message（按层拼接）：
```
--- 世界与角色 ---
{sections.worldLayerText}

--- 结构与进度 ---
蓝图：{JSON.stringify(blueprint)}

{sections.serializedPreviousChapterTail ? "上一章结尾：\n" + sections.serializedPreviousChapterTail : ""}

{sections.serializedSummaries ? "历史摘要：\n" + sections.serializedSummaries : ""}

{sections.serializedFutureContext}

{sections.serializedWriterNotes ? "注意事项：\n" + sections.serializedWriterNotes : ""}

--- 风格锚点 ---
{sections.styleAnchorText}

请输出第{chapterNo}章完整正文，不少于{estimatedWords}字。
```

### 6. 新建测试 `src/server/run/context-injection-engine.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assembleInjections, type InjectableEntry } from "./context-injection-engine.ts";

describe("assembleInjections", () => {
  const makeEntry = (overrides: Partial<InjectableEntry>): InjectableEntry => ({
    id: "test",
    type: "character",
    content: "test content",
    priority: 50,
    tokenCost: 10,
    activation: { mode: "always" },
    position: "world-layer",
    ...overrides,
  });

  it("activates always entries", () => { /* ... */ });
  it("activates keyword entries when keyword found in scanText", () => { /* ... */ });
  it("does not activate keyword entries when keyword not found", () => { /* ... */ });
  it("activates chapter-range entries within range", () => { /* ... */ });
  it("sorts by priority descending", () => { /* ... */ });
  it("drops low priority entries when budget exceeded", () => { /* ... */ });
  it("system position has no budget limit", () => { /* ... */ });
  it("different positions have independent budgets", () => { /* ... */ });
});
```

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
pnpm build

# 确认硬编码已清除
grep -rn "pickCharacterCards\|pickWorldCards" src/server/ --include="*.ts" | grep -v ".test.ts"
# 预期为空

grep -rn "灵纹|血脉|天赋|反噬|代价|追猎|部族|禁区|兽道" src/server/run/ --include="*.ts"
# 预期为空

grep -rn "slice(0, 5)" src/server/run/context-engine.ts
# 预期为空
```

## 约束

- 不改 story-lorebook.ts（它的关键词匹配系统保留，作为 lorebook entries 的前置筛选）
- 不改 prompts/ 目录（Batch 3 负责）
- 不改 style-steering.ts 或 writing-dna.ts（只调用，不修改）
- 不改任何 test 文件（除了新建自己的测试）
- ContextPack 类型变更需要兼容所有下游消费者
- 所有新字段对老数据 optional 兼容
