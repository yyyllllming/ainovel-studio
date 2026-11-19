# 前置质量升级执行计划 — 平台级上下文注入引擎

> 2026-04-03 · 5 批次 · 预计 16 个 Task
> 前置依赖：健壮性加固计划已完成

## 背景

首稿质量差的根因不在后处理，而在前置上下文：
1. 没有统一的上下文注入层——角色、世界规则、关系、事实、lorebook 等 10+ 数据源各自为政
2. Foundation 数据模型太薄——CharacterCard 5 字段、WorldRule 2 字段
3. Writer prompt 被约束淹没——"不要做什么"占 60%+，"做什么"被挤压
4. Planner prompt 11 行，蓝图质量直接决定首稿质量
5. 角色关系（relationships）从未注入 Writer prompt

---

## Batch 1 — 统一上下文注入引擎（核心架构）

### Task 1.1 — 定义 InjectableEntry 类型 + ContextInjectionEngine

**新建文件：** `src/server/run/context-injection-engine.ts`

核心类型：
```typescript
export type EntryActivation =
  | { mode: "always" }
  | { mode: "keyword"; keywords: string[] }
  | { mode: "chapter-range"; from: number; to: number };

export type InjectionPosition =
  | "system"           // system prompt 尾部
  | "world-layer"      // user prompt 第一层：世界+角色
  | "structure-layer"  // user prompt 第二层：蓝图+摘要
  | "style-anchor";    // user prompt 第三层：紧贴生成位置

export interface InjectableEntry {
  id: string;
  type: "character" | "world" | "relationship" | "fact" | "thread"
      | "summary" | "style" | "lorebook" | "obligation" | "steering";
  content: string;
  priority: number;           // 0-100, 越高越优先
  tokenCost: number;          // estimateModelTokens(content) 的结果
  activation: EntryActivation;
  position: InjectionPosition;
  sticky?: number;            // 激活后保持 N 章（预留，暂不实现）
}

export interface InjectionBudget {
  "world-layer": number;      // token 上限
  "structure-layer": number;
  "style-anchor": number;
}

export interface InjectionResult {
  layers: Record<InjectionPosition, string[]>;
  activated: InjectableEntry[];
  dropped: InjectableEntry[];   // 超预算被丢弃的
  debug: { totalActivated: number; totalDropped: number; budgetUsage: Record<string, number> };
}
```

核心函数：
```typescript
export function assembleInjections(
  entries: InjectableEntry[],
  scanText: string,           // 蓝图文本 + 上一章结尾，用于关键词扫描
  chapterNo: number,
  budgets: InjectionBudget,
): InjectionResult {
  // 1. 激活：always → 直通；keyword → scanText.includes(kw)；chapter-range → 范围检查
  // 2. 按 priority 降序排序（同 priority 按 type 排序：character > world > relationship > ...）
  // 3. 每个 position 独立做 token 预算贪心装箱
  // 4. 返回每层的有序文本 + debug 信息
}
```

### Task 1.2 — 创建 Entry 收集器

**新建文件：** `src/server/run/context-entry-collectors.ts`

将现有的数据源转换为 InjectableEntry：

```typescript
// 从 Foundation 角色卡 → InjectableEntry[]
export function collectCharacterEntries(
  foundation: FoundationPayload,
  blueprint: ChapterBlueprint,
  chapterNo: number,
): InjectableEntry[];

// 从 Foundation 世界规则 → InjectableEntry[]
export function collectWorldEntries(
  foundation: FoundationPayload,
): InjectableEntry[];

// 从 Foundation 关系 → InjectableEntry[]
export function collectRelationshipEntries(
  foundation: FoundationPayload,
  blueprintCharacters: string[],
): InjectableEntry[];

// 从 Lorebook（已有 buildLorebookPack 结果）→ InjectableEntry[]
export function collectLorebookEntries(
  lorebook: LorebookPack,
): InjectableEntry[];

// 从各种 memory 数据 → InjectableEntry[]
export function collectMemoryEntries(
  contextPack: ContextPack,
): InjectableEntry[];

// 从风格数据 → InjectableEntry[]
export function collectStyleEntries(
  contextPack: ContextPack,
): InjectableEntry[];
```

角色 entry 的关键：
- 蓝图中 characters[] 点名的 → priority 80, activation always
- foundation 中 priority="core" 的角色 → priority 70, activation always
- 其他角色 → priority 40, activation keyword（用 card.name + card.triggerKeywords）
- 序列化为多行格式（name/role/goal/traits/description/speechPattern/secrets）

世界规则 entry 的关键：
- rule.priority === "core" → priority 80, activation always
- 其他 → priority 50, activation keyword（用 rule.triggerKeywords）
- 不再有洪荒正则

### Task 1.3 — 重构 context-engine.ts 和 context-serialization.ts

**修改文件：** `src/server/run/context-engine.ts`, `src/server/services/context-serialization.ts`

关键变化：
- `assembleContextPack()` 中删除 `pickCharacterCards()` 和 `pickWorldCards()` 调用
- ContextPack 新增 `injectionResult: InjectionResult` 字段
- `assembleContextPack()` 末尾调用收集器 + `assembleInjections()`
- `serializeContextPackSections()` 改为从 `injectionResult.layers` 中取各层文本

`previousChapterTail` 从 1600 → 3200 字符。

### Task 1.4 — 重构 chapter-draft.ts 的 buildContextMessages

**修改文件：** `src/server/run/chapter-draft.ts`

`buildContextMessages()` 从当前的"平铺 30 段"变为分层注入：

```
System message:
  writer.md（精简版，≤15行）
  + injectionResult.layers["system"]（如有）

User message layer 1（world-layer）:
  injectionResult.layers["world-layer"]
  → 角色卡（加厚版）+ 世界规则（按激活） + 关系网

User message layer 2（structure-layer）:
  蓝图 JSON + 上一章结尾 + 历史摘要 + 未回收线程 + 动态事实
  + injectionResult.layers["structure-layer"]

User message layer 3（style-anchor）:
  风格画像 + 风格范本片段 + Author's Note
  + injectionResult.layers["style-anchor"]
  + "请输出完整章节正文..."
```

### Task 1.5 — 测试

**新建文件：** `src/server/run/context-injection-engine.test.ts`

测试用例：
- always 条目始终激活
- keyword 条目关键词命中时激活、不命中时不激活
- chapter-range 条目范围内激活
- priority 排序正确
- token 预算超限时低优先级被丢弃
- 多个 position 层独立装箱

### 完成标准

- [ ] pickCharacterCards() 和 pickWorldCards() 已删除
- [ ] 洪荒硬编码正则已删除
- [ ] `.slice(0, 5)` 硬截已删除
- [ ] pnpm test 通过
- [ ] pnpm typecheck 通过

---

## Batch 2 — Foundation 数据模型升级

### Task 2.1 — 扩展 CharacterCard 和 WorldRule 类型

**修改文件：** `src/server/types/core.ts`

```typescript
export interface CharacterCard {
  name: string;
  role: string;
  goal: string;
  traits: string[];
  secrets?: string[];
  // 新增
  description?: string;        // 外貌+背景概述
  speechPattern?: string;      // 说话习惯
  triggerKeywords?: string[];   // 注入引擎激活词（自动生成）
}

export interface WorldRule {
  name: string;
  description: string;
  // 新增
  priority?: "core" | "situational";
  triggerKeywords?: string[];
}
```

### Task 2.2 — 更新 foundationSchema + 数据库迁移

**修改文件：** `src/server/services/foundation-generate.service.ts`

foundationSchema 的 characters 和 worldview 增加新字段（全部 optional，兼容老数据）：

```typescript
characters: z.array(z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  goal: z.string().min(1),
  traits: z.array(z.string()).min(1),
  secrets: z.array(z.string()).optional(),
  description: z.string().optional(),
  speechPattern: z.string().optional(),
  triggerKeywords: z.array(z.string()).optional(),
})),
worldview: z.array(z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["core", "situational"]).optional(),
  triggerKeywords: z.array(z.string()).optional(),
})),
```

不需要 DB 迁移——Foundation 数据存为 JSON 列，新字段 optional 自动兼容。

### Task 2.3 — 升级 Foundation 生成 prompt

**修改文件：** `src/server/services/foundation-generate.service.ts` 中 generateFoundation 的 LLM prompt

在"你负责把作者与设定助手已经共创过的草案整理成正式小说项目设定"后追加角色和世界规则的结构要求：

```
对每个角色，必须提供：
- name, role, goal, traits（必填）
- description：2-3 句外貌和关键背景信息
- speechPattern：这个角色独特的说话方式（句式、用词、口头禅）
- secrets：至少 1 个隐藏信息（如果角色有的话）
- triggerKeywords：3-5 个会在文本中触发该角色信息注入的关键词

对每条世界规则，必须提供：
- name, description（必填）
- priority："core" 表示每章都相关的基础规则，"situational" 表示场景性规则
- triggerKeywords：3-5 个触发词
```

### Task 2.4 — 清理 foundation-enrichment.ts 的硬编码

**修改文件：** `src/server/foundation/foundation-enrichment.ts`

删除 `assessFoundationCoverage` 中的洪荒关键词检测：
```typescript
// 删除这一段
缺少核心机制关键词（灵纹/血脉/天赋/反噬/代价）→ +1
缺少开篇区域锚点（山/林/谷/部族/村等）→ +1
```

改为通用检查：`characters 中没有 triggerKeywords 的角色过多 → +1`

删除 `buildFallbackFoundationExpansion` 中的洪荒预设池（灵纹偷学、偷学代价、气息追猎等），改为通用逻辑。

### 完成标准

- [ ] CharacterCard 新字段在 generateFoundation 时被 LLM 填充
- [ ] WorldRule 新字段在 generateFoundation 时被 LLM 填充
- [ ] 洪荒硬编码在 foundation-enrichment.ts 中已清除
- [ ] 老项目数据兼容（新字段都是 optional）
- [ ] pnpm test 通过
- [ ] pnpm typecheck 通过

---

## Batch 3 — Writer Prompt 瘦身 + Planner Prompt 升级

### Task 3.1 — 精简 writer.md

**修改文件：** `prompts/writer.md`

从 52 行砍到 ~15 行。保留第 1-9 行核心写作规则，删除第 10-12 行句法约束和第 17-49 行全部"禁写句式与 AI 味负面样例"。

新版 writer.md：
```markdown
你是小说主笔 Writer。

要求：
1. 严格遵循当前章节蓝图和上下文包写作。
2. 优先保证角色人设、关系、地点和时间线一致。
3. 必须严格保持项目指定的人称，不要在人称之间漂移。
4. 文风要接近提供的风格范本，正文要像真正的小说。
5. 避免总结式旁白，通过场景、动作、细节和对话推进。
6. 段落按中文小说习惯自然组织。
7. 不要把策划/评论口吻直接写进正文。
8. 对话要像人说话，避免所有角色一个腔调。
9. 如果上一章结尾仍处在进行中的场景，本章开头必须先承接。

输出：
- 仅输出章节正文，不要加标题解释，不要加 Markdown 围栏。
```

### Task 3.2 — 约束分流：WritingCharter/proseDirectives/antiAiDirectives 从 Writer prompt 移出

**修改文件：** `src/server/run/chapter-draft.ts`

在 `buildContextMessages()` 和 `buildDraftMessages()` 中：
- 删除 WritingCharter 预算表注入
- 删除 antiAiDirectives 注入
- proseDirectives 从 30+ 条缩减为最关键的 5 条（保留在 style-anchor 层）
- writingDna 从 10 条缩减为 3 条核心（保留在 style-anchor 层）

WritingCharter 仍在 `chapter-style-pass.ts` 和 `chapter-audit.ts` 中用于生成后检查，不删。

### Task 3.3 — 升级 planner.md

**修改文件：** `prompts/planner.md`

从 11 行扩充为结构化模板（~40 行），题材无关：

```markdown
你是章节规划师 Planner。

你的任务：基于项目设定和当前进度，为下一章设计详细的场景蓝图。

## 蓝图必须包含

### 场景设计
- sceneGoal：本章要完成的核心叙事动作（具体事件，不是"推进主线"这类抽象描述）
- entryState：章节开始时主要角色的物理位置和状态（承接上一章）
- exitState：章节结束时角色到达的位置和状态

### 角色动机（对每个出场角色）
- motivation：这个角色在本场景中想要什么
- obstacle：什么阻碍了他/她
- action：他/她会采取什么行动

### 信息控制
- readerKnows：读者已知的关键信息
- characterKnows：各角色知道/不知道的信息差
- reveal：本章向读者或角色揭示的新信息

### 情感弧线
- emotionalArc：从什么情绪到什么情绪（具体情绪词）

### 结构要素（已有字段）
- characters, locations, conflicts, foreshadows, emotionalTone, estimatedWords

## 禁止
- 不要输出空泛的场景目标（如"主角变强""推进剧情"）
- 每个冲突必须涉及具体角色和具体利益碰撞
```

### Task 3.4 — Bootstrap 温度调整

**修改文件：** `src/server/run/chapter-draft.ts`

Bootstrap 模式温度上限从 0.38 提到 0.65：
```typescript
temperature: useBootstrapSelection
  ? Math.min(context.agents.writer.assignment.temperature, 0.65)
  : context.agents.writer.assignment.temperature,
```

### 完成标准

- [ ] writer.md ≤ 15 行
- [ ] Writer prompt 中不再有 WritingCharter/antiAiDirectives
- [ ] planner.md ~40 行，包含场景设计+角色动机+信息控制+情感弧线
- [ ] Bootstrap 温度 ≤ 0.65
- [ ] pnpm test 通过
- [ ] pnpm typecheck 通过
- [ ] pnpm build 通过

---

## Batch 4 — 升级 Foundation Coach + 蓝图 Schema

### Task 4.1 — 升级 foundation-coach.md

**修改文件：** `prompts/foundation-coach.md`

在"优先帮助作者明确"中新增引导方向：
- 角色的说话习惯和外貌特征
- 世界规则的核心/场景性分类

在 draft 输出结构的 characterIdeas 中要求：
- 除 name/role/goal/traits 外，尝试引导作者描述角色的说话方式和外貌
- worldviewIdeas 尝试引导区分哪些是核心规则

### Task 4.2 — 升级蓝图 schema（角色动机+信息差）

**修改文件：** 蓝图相关的 Zod schema + type

ChapterBlueprint 新增可选字段：
```typescript
characterMotivations?: Array<{
  name: string;
  motivation: string;
  obstacle: string;
  action: string;
}>;
informationControl?: {
  readerKnows?: string[];
  reveals?: string[];
};
emotionalArc?: string;  // "紧张 → 绝望 → 一线生机"
entryState?: string;
exitState?: string;
```

这些字段全部 optional，老蓝图兼容。Planner 升级后的新蓝图会填充。

### Task 4.3 — 注入引擎利用蓝图新字段

**修改文件：** `src/server/run/context-entry-collectors.ts`

如果蓝图有 characterMotivations，为每个有动机的角色的 InjectableEntry 追加动机信息。

如果蓝图有 informationControl，作为 structure-layer 注入。

### 完成标准

- [ ] Foundation Coach 引导更丰富的角色/世界描述
- [ ] 蓝图新字段可选、老数据兼容
- [ ] pnpm test 通过
- [ ] pnpm typecheck 通过

---

## Batch 5 — 全链路验证 + 集成测试

### Task 5.1 — 全量回归

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Task 5.2 — 上下文组装集成测试

**新建文件：** `src/server/run/context-injection-engine.test.ts`（如 Task 1.5 未覆盖则补充）

- 模拟一个科幻项目的 Foundation，验证注入引擎正确激活科幻世界规则
- 模拟一个言情项目的 Foundation，验证注入引擎正确激活言情世界规则
- 验证洪荒项目在新引擎下行为正确（回归）

### Task 5.3 — 健康度检查

```bash
# 洪荒正则已清除
grep -rn "灵纹|血脉|天赋|反噬|代价|追猎|部族|禁区|兽道" src/server/ --include="*.ts" | grep -v ".test.ts" | grep -v "prompts/"
# 预期输出为空

# pickCharacterCards / pickWorldCards 已删除
grep -rn "pickCharacterCards\|pickWorldCards" src/server/ --include="*.ts"
# 预期输出为空

# .slice(0, 5) 硬截已删除（在 context-engine 相关文件中）
grep -rn "slice(0, 5)" src/server/run/context-engine.ts
# 预期输出为空
```

---

## 执行顺序与依赖

```
Batch 1（注入引擎）→ Batch 2（数据模型）→ Batch 3（Prompt 重构）→ Batch 4（Coach+蓝图）→ Batch 5（验证）
```

Batch 1 是核心基础，必须先完成。
Batch 2 和 Batch 3 可以并行（无文件冲突）。
Batch 4 依赖 Batch 2 的新字段。

## Codex 分批建议

- **Session 1:** Batch 1（5 task）— 最关键，注入引擎架构
- **Session 2:** Batch 2（4 task）+ Batch 3（4 task）— 可并行
- **Session 3:** Batch 4（3 task）+ Batch 5（3 task）— 收尾
