# Codex Execution Prompt — 第三轮收尾巩固

你是一个自主执行代理，负责按照 `platform/docs/superpowers/plans/2026-04-03-consolidation-plan.md` 逐 Task 实施 AINovel-CLI 平台的第三轮架构整治。

---

## 核心目标

1. **server/ 根目录非测试文件从 34 个降到 ≤20 个**
2. **run-manager.ts 从 4560 行降到 <700 行**
3. **所有 service 对 run-manager.ts 的 dynamic import 降到 0**
4. **lint warning 从 43 个降到 0**
5. **新增 2 个嵌套 error.tsx**

---

## 执行协议

### 总流程

1. 读取计划文件 `platform/docs/superpowers/plans/2026-04-03-consolidation-plan.md`
2. 按 Phase A → B → C → D 的顺序执行
3. 每完成一个 Task 执行验证门禁，通过后提交 git commit，然后立即开始下一个 Task
4. Phase 之间不可跳跃：A 全部完成才能开始 B，以此类推
5. 全部 18 个 Task 完成后输出最终报告

### 单个 Task 执行步骤

```
1. 读计划中该 Task 的全部内容
2. 读取 Task 涉及的所有现有文件
3. 实现 Task 的 checkbox 清单
4. 验证：
   - pnpm typecheck
   - pnpm lint
   - pnpm test（node test runner）
   - Phase D 的前端改动额外跑 pnpm build
5. 修复失败项（最多重试 3 次）
6. 提交：improve(phaseX): Task XN - <简要描述>
7. 立即开始下一个 Task
```

---

## 关键约束

### Phase A — 目录归组补完

- **纯文件移动 + import 路径更新**，不改逻辑，不改导出
- 用 `git mv` 移动文件
- 全局搜索替换 import 路径：`@/server/xxx` → `@/server/子目录/xxx`
- **run-manager.ts 中的 import 也要同步更新**
- 移动后确保 TypeScript path alias `@/server/*` 仍然正确解析
- 测试文件（*.test.ts）不用移动，但如果测试文件 import 了被移动的文件，也要更新 import

### Phase B — run-manager.ts 瘦身

- **搬函数体，不重写**：把函数体原样剪切到新文件，只改 import 路径
- **先搬 B1（私有 helper 群）**，后续所有 Task 从 run/run-internals.ts import
- **run-manager.ts 主循环 `runDetachedExecution` 不搬**：它留在 run-manager.ts
- **模块级变量 `runningTasks` 搬到 run-internals.ts** 并 export
- **私有函数不需要在 run-manager.ts 留 re-export**：只有 export function 需要留 re-export shim（临时兼容）
- **每搬完一个函数，如果有 service 通过 dynamic import 获取它，立即修改该 service 改为 static import 新位置**
- **B7 是 1214 行的超级提取**：允许拆成两步。先搬 writeDraftFromContext + 审稿链（deepReviewChapter, rewriteChapterFromReview, runStylePass, quickAuditChapter）到 `story/draft-write-engine.ts`，再搬 ensureStoryContract 主体
- **B11 是 897 行的第二大提取**：syncCommittedChapterArtifacts 内部调用 writeDraftFromContext 等函数，B7 搬完后这些调用应改为从 story/draft-write-engine.ts import
- **B12 是最终清理**：删除所有 re-export shim，确认 run-manager.ts 只剩主循环 + 控制面

### Phase C — lint warning 清零

- 对每个 unused warning，先 grep 确认确实无消费者再删
- 解构残留 `_xxx` 如果确实不用则从解构中移除
- `_` 前缀的变量如果是有意忽略（如 catch error）则用 eslint-disable 注释而非删除

### Phase D — 前端增强

- error.tsx 必须是 Client Component（`"use client"`）
- 嵌套 error.tsx 应保留父 layout（侧边栏）
- D2（状态机统一）改动风险大，如果测试不过可跳过

---

## 项目路径速查

```
platform/
├── src/
│   ├── server/
│   │   ├── run-manager.ts                # Phase B 的提取目标 (4560行)
│   │   ├── run/                          # Phase A/B 的归组/新建目标
│   │   │   ├── session.service.ts        # 已有状态机服务
│   │   │   ├── session-state-machine.ts  # 已有表驱动状态机
│   │   │   ├── control.service.ts
│   │   │   ├── session-reconciler.ts
│   │   │   ├── runner-orchestrator.ts
│   │   │   ├── manual-review-route.service.ts
│   │   │   ├── restart-run.service.ts
│   │   │   ├── progress.service.ts
│   │   │   ├── run-internals.ts          # B1 新建
│   │   │   ├── session-activation.ts     # B2 新建
│   │   │   └── manual-review-engine.ts   # B10 新建
│   │   ├── story/                        # Phase A/B 的归组/新建目标
│   │   │   ├── story-progression.ts      # 已有
│   │   │   ├── story-contract.ts         # 已有
│   │   │   ├── story-memory.ts           # 已有
│   │   │   ├── story-lorebook.ts         # 已有
│   │   │   ├── story-seed-patch.ts       # 已有
│   │   │   ├── timeline-invalidation.ts  # B3 新建
│   │   │   ├── segment-plan-engine.ts    # B4 新建
│   │   │   ├── planner-exemplars.ts      # B5 新建
│   │   │   ├── blueprint-plan-engine.ts  # B6 新建
│   │   │   ├── story-contract-engine.ts  # B7 新建
│   │   │   ├── draft-write-engine.ts     # B7 拆分时新建
│   │   │   └── story-progression-sync.ts # B8 新建
│   │   ├── commit/                       # Phase B 新建
│   │   │   ├── chapter-commit-engine.ts  # B9 新建
│   │   │   └── chapter-artifact-sync.ts  # B11 新建
│   │   ├── services/                     # B 完成后这些 service 不再 dynamic import run-manager
│   │   │   ├── blueprint-generate.service.ts   # 当前 dynamic import 6 个函数
│   │   │   ├── manual-review.service.ts        # 当前 dynamic import 2 个函数
│   │   │   └── ...
│   │   ├── compat/
│   │   │   └── legacy-run-manager.ts     # B12 清理目标
│   │   ├── foundation/
│   │   ├── character/
│   │   ├── writing/
│   │   ├── style/
│   │   ├── content/
│   │   ├── files/
│   │   ├── repositories/
│   │   ├── db/
│   │   └── types/
│   ├── app/
│   │   ├── error.tsx                      # 已有
│   │   ├── global-error.tsx               # 已有
│   │   ├── projects/[projectId]/
│   │   │   └── error.tsx                  # D1 新建
│   │   └── settings/
│   │       └── error.tsx                  # D1 新建
│   └── components/
└── eslint.config.mjs
```

---

## run-manager.ts 当前函数布局

提取时参考这个行号表（可能因 Phase A 的 import 变化而偏移几行）：

```
L366   ensureSegmentPlans (86行)           → B4 搬到 story/segment-plan-engine.ts
L452   syncAcceptedChapterStoryProgressState (320行) → B8 搬到 story/story-progression-sync.ts
L706-  私有 helper 群 (~350行)             → B1 搬到 run/run-internals.ts
L819   ensureRunSessionActive (82行)       → B2 搬到 run/session-activation.ts
L901   softInvalidateChapterRange (11行)   → B3 搬到 story/timeline-invalidation.ts
L912   invalidateFutureTimelineAfterChapterChange (100行) → B3
L1012  buildStaticPlannerExemplars (37行)  → B5 搬到 story/planner-exemplars.ts
L1049  buildDynamicPlannerExemplars (57行) → B5
L1106  planChapterBlueprint (601行)        → B6 搬到 story/blueprint-plan-engine.ts
L1707  ensureStoryContract (1214行)        → B7 搬到 story/story-contract-engine.ts
L2921  syncChapterArtifacts (203行)        → B11 搬到 commit/chapter-artifact-sync.ts
L3124  syncCommittedChapterArtifacts (897行) → B11
L4021  startRun (6行)                      → 留在 run-manager.ts
L4027  runDetachedExecution (135行)         → 留在 run-manager.ts（主循环）
L4162  softInvalidateAndRestart (15行)      → 留在 run-manager.ts
L4177  pauseRun (15行)                     → 留在 run-manager.ts
L4192  resumeRun (33行)                    → 留在 run-manager.ts
L4225  stopRun (30行)                      → 留在 run-manager.ts
L4255  getRunProgress (14行)               → 留在 run-manager.ts
L4269  finalizeProjectCompletion (4行)     → 留在 run-manager.ts
L4273  requireActiveManualReview (14行)    → B10 搬到 run/manual-review-engine.ts
L4287  autoPickVersionForManualReview (108行) → B10
L4395  commitChapterState (91行)           → B9 搬到 commit/chapter-commit-engine.ts
L4486  persistAcceptedChapterSignals (4行) → B9
L4490  resolveManualReview (70行)          → B10
```

预计留在 run-manager.ts 的函数：
- startRun (6行)
- runDetachedExecution (135行) — 主循环
- softInvalidateAndRestart (15行)
- pauseRun / resumeRun / stopRun (78行)
- getRunProgress (14行)
- finalizeProjectCompletion (4行)
- 加上 import 语句、类型、常量 ≈ ~200 行
- **预计总计 ~450-650 行**

---

## 测试运行方式

```bash
# 后端测试
pnpm test
# 等价于: node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/*.test.ts

# 类型检查
pnpm typecheck

# Lint
pnpm lint

# Next.js 构建（前端改动时）
pnpm build

# 前端测试
pnpm test:ui
```

---

## 阻塞与降级策略

- **B7 的 ensureStoryContract（1214行）依赖链过深**：允许拆成两个子 commit，先搬审稿/写稿链，再搬 contract 主体
- **B11 的 syncCommittedChapterArtifacts（897行）如果 B7 未完全搬出**：允许对 B7 未搬出的函数保持 dynamic import，标注 `// TODO: 待 B7 完成后改为 static import`
- **Phase A 的 import 路径更新量大**：如果某个文件移动导致 50+ 个 import 要改，可以在旧位置留一个 re-export 文件，commit message 标注 `[re-export-compat]`
- **D2（状态机统一）改动风险大**：如果 pnpm test 不过可跳过，标注 `[deferred]`
- **pnpm build 超时或 OOM**：记录后跳过 build 验证，继续执行
- **typecheck 报错超过 10 个不相关错误**：记录后继续

---

## 输出要求

每完成一个 Task：
```
✅ Task XN 完成 — <一句话总结>
   文件变更: +X 新建, ~Y 修改, -Z 删除
   提交: <commit hash 前 7 位>
```

阻塞时：
```
⚠️ Task XN 阻塞 — <原因>
   跳过，继续 Task XM
```

全部完成后：
```
## 收尾巩固执行报告
- 完成: Task A1, A2, ...
- 跳过: Task X (原因: ...)
- run-manager.ts 行数: N
- server/ 根目录非测试文件数: N
- lint warning 数: N
- dynamic import run-manager 的 service 数: N
- 总提交数: N
```

---

## 现在开始

读取 `platform/docs/superpowers/plans/2026-04-03-consolidation-plan.md`，从 Task A1 开始执行。不要问问题，直接做。
