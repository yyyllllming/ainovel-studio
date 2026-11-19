# Codex Prompt — Session C: chapter-runner.ts 拆分

## 上下文

AINovel Studio（`platform/`）的写作引擎核心文件 `src/server/run/chapter-runner.ts` 有 2625 行，包含从蓝图生成到审稿修复的完整流程。需要按职责拆为 5 个独立模块，主循环 `runSingleChapter` + 入口 `executeRun` 保留在 chapter-runner.ts 中作为编排器。

**重要约束：**
- 这是纯提取重构，不改任何逻辑、不改函数签名、不改行为
- 新文件不能 import chapter-runner.ts（禁止循环依赖）
- 新文件需要的共享类型/辅助函数如果在 chapter-runner.ts 的私有作用域中，搬到新文件或提取到 `run/chapter-shared.ts`
- 所有 359+ 测试必须通过

## 当前文件结构

`src/server/run/chapter-runner.ts` 中的顶层函数及行号：

```
170: function uniqueNonEmpty(...)
187: function buildAuthorHabitDirectives(...)
205: function buildWriterBudgetSteeringLines(...)
220: function mergeCharterViolations(...)
238: function getRecentDeltaRecords(...)
242: function buildRuntimeReviewAssessments(...)
266: async function resolveActiveStoryContract(...)
432: function getProseRiskWeight(...)
445: function isBetterProseCandidate(...)
452: function countRecentAutoWindowRepairs(...)
460: function buildContextMessages(...)
525: async function ensureFoundationCoverage(...)
628: function buildHeuristicContinuationDecision(...)
681: async function planStoryContinuation(...)
764: async function writeDraftFromContext(...)
979: function buildDraftMessages(...)
1042: function persistProseSteeringNotes(...)
1076: function persistReviewSteeringNotes(...)
1115: async function runStylePass(...)
1284: async function quickAuditChapter(...)
1455: async function loadDeepReviewWindow(...)
1480: async function deepReviewChapter(...)
1651: async function rewriteChapterFromReview(...)
1741: async function finalizeAcceptedChapter(...)
1830: async function runSingleChapter(...)
2451: export async function executeRun(...)
```

## 拆分计划

### 1. 新建 `src/server/run/chapter-draft.ts`

搬入以下函数（保持原始行顺序）：
- `buildContextMessages` (~line 460)
- `ensureFoundationCoverage` (~line 525)
- `buildHeuristicContinuationDecision` (~line 628)
- `planStoryContinuation` (~line 681)
- `writeDraftFromContext` (~line 764)
- `buildDraftMessages` (~line 979)

这些函数共同负责"蓝图上下文 → 草拟"阶段。

搬入时需要带上它们的 import 依赖。在 chapter-runner.ts 中删除这些函数体，改为：
```typescript
export { buildContextMessages, ensureFoundationCoverage, ... } from "./chapter-draft.ts";
// 或者在 chapter-runner.ts 中直接 import 使用
```

### 2. 新建 `src/server/run/chapter-style-pass.ts`

搬入：
- `persistProseSteeringNotes` (~line 1042)
- `persistReviewSteeringNotes` (~line 1076)
- `runStylePass` (~line 1115)

这些函数负责"风格检测 → 降 AI 味修正"阶段。

### 3. 新建 `src/server/run/chapter-audit.ts`

搬入：
- `quickAuditChapter` (~line 1284)

负责"快速审计"阶段。

### 4. 新建 `src/server/run/chapter-review.ts`

搬入：
- `loadDeepReviewWindow` (~line 1455)
- `deepReviewChapter` (~line 1480)
- `rewriteChapterFromReview` (~line 1651)

负责"深度审稿 + 重写"阶段。

### 5. 新建 `src/server/run/chapter-finalize.ts`

搬入：
- `finalizeAcceptedChapter` (~line 1741)

负责"验收 + 提交"阶段。

### 6. （如需）新建 `src/server/run/chapter-shared.ts`

如果多个新文件需要共享某些辅助函数（如 `uniqueNonEmpty`, `buildAuthorHabitDirectives`, `buildWriterBudgetSteeringLines`, `mergeCharterViolations` 等），将这些搬到此文件。

### 7. 清理 chapter-runner.ts

chapter-runner.ts 保留：
- 所有 import（更新为从新模块导入）
- `resolveActiveStoryContract` — 合约解析（只被 runSingleChapter 和 executeRun 用）
- `buildRuntimeReviewAssessments` — 运行时审稿评估（只被 runSingleChapter 用）
- `getProseRiskWeight`, `isBetterProseCandidate`, `countRecentAutoWindowRepairs` — 小辅助
- `getRecentDeltaRecords` — 小辅助
- `runSingleChapter` — 主循环编排器（~622 行）
- `executeRun` — 入口（~175 行）

**预期 chapter-runner.ts 最终 ≤ 950 行。**

## 操作步骤

1. 先读 chapter-runner.ts 全文，理解每个函数的依赖关系
2. 按上述分组，逐个创建新文件，将函数体+所需 import 搬入
3. 所有搬出的函数加 `export`
4. 在 chapter-runner.ts 中删除已搬走的函数，添加 `import { ... } from "./chapter-xxx.ts"`
5. 确保没有循环依赖：新文件 → 不 import chapter-runner.ts
6. 如果某个搬出函数被 chapter-runner.ts 之外的文件引用（检查 grep），更新那些引用

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
pnpm build
# 检查行数
wc -l src/server/run/chapter-runner.ts  # 应 ≤ 950
wc -l src/server/run/chapter-draft.ts src/server/run/chapter-style-pass.ts src/server/run/chapter-audit.ts src/server/run/chapter-review.ts src/server/run/chapter-finalize.ts
```

## 约束

- **纯提取，零逻辑变更** — 不改函数实现、不优化代码、不重命名变量
- 不改任何 test 文件
- 不改 run/ 目录下其他现有文件（除非需要更新 import 路径）
- 不添加注释、不添加日志
- 确保无循环依赖
