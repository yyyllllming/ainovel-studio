# 第三轮架构整治 — 收尾巩固

> 目标：server/ 根目录收拢 + run-manager 第三轮瘦身 + lint warning 清零 + 前端错误隔离完善
> 共 4 个 Phase，18 个 Task

---

## Phase A — server/ 根目录文件归组（遗留补完）

> 上一轮 Phase E 创建了子目录但 13 个业务文件没搬进去
> 纯文件移动 + import 路径更新，不改逻辑

### Task A1 — run/ 子目录补齐

**移动到 `src/server/run/`：**
- `run-decisions.ts` (170行) — 运行决策逻辑
- `run-state.ts` (129行) — 运行状态读写
- `run-control.ts` (58行) — 运行控制
- `run-heartbeat.ts` (35行) — 心跳逻辑
- `manual-review.ts` (66行) — 人工审稿工具函数
- `review-policy.ts` (163行) — 审稿策略

**步骤：**
1. `git mv` 移动每个文件
2. 全局搜索替换所有 import 路径（`@/server/run-decisions` → `@/server/run/run-decisions`，以此类推）
3. 确认 run-manager.ts 和其他消费者的 import 已更新

**完成标准：**
- [ ] 6 个文件都在 run/ 下
- [ ] pnpm typecheck 通过
- [ ] pnpm lint 通过

---

### Task A2 — story/ 子目录补齐

**移动到 `src/server/story/`：**
- `blueprint-planner.ts` (555行) — 蓝图规划验证
- `chapter-draft-plan.ts` (549行) — 章节草稿规划
- `chapter-steering.ts` (298行) — 章节引导
- `canon.ts` (333行) — 正典管理

**完成标准：**
- [ ] 4 个文件都在 story/ 下
- [ ] pnpm typecheck 通过

---

### Task A3 — foundation/ 和 files/ 补齐

**移动到 `src/server/foundation/`：**
- `idea-workshop.ts` (283行) — 点子工坊

**移动到 `src/server/files/`：**
- `novel-export.ts` (245行) — 小说导出

**完成标准：**
- [ ] 文件已移动
- [ ] pnpm typecheck 通过

---

### Task A4 — context-engine 归位

**移动到 `src/server/run/`：**
- `context-engine.ts` (476行) — 上下文组装（run 阶段核心依赖）

**完成标准：**
- [ ] pnpm typecheck 通过
- [ ] server/ 根目录非测试 .ts 文件 ≤ 20

---

## Phase B — run-manager.ts 第三轮提取（4560 → ~2500 行）

> 目标：把 4 个巨型函数搬出 run-manager，彻底解除 service 对 run-manager 的 dynamic import
> 这是整个项目最大的改造项

### 依赖分析

run-manager 中的 25 个 export function 可分为三类：

**主循环核心（不搬）：**
- `runDetachedExecution` (135行) — 主编排循环
- `startRun` (6行) — 入口
- `softInvalidateAndRestart` (15行) — 重启入口

**控制面（不搬，已较薄）：**
- `pauseRun` / `resumeRun` / `stopRun` / `getRunProgress` — 合计 92 行
- `finalizeProjectCompletion` — 4 行

**可提取函数（搬）：**

| 函数 | 行数 | 搬到 |
|------|------|------|
| ensureStoryContract | 1214 | story/story-contract-engine.ts（新建） |
| syncCommittedChapterArtifacts | 897 | commit/chapter-artifact-sync.ts（新建） |
| planChapterBlueprint | 601 | story/blueprint-plan-engine.ts（新建） |
| syncAcceptedChapterStoryProgressState | 320 | story/story-progression-sync.ts（新建） |
| syncChapterArtifacts | 203 | commit/chapter-artifact-sync.ts（合并） |
| invalidateFutureTimelineAfterChapterChange | 100 | story/timeline-invalidation.ts（新建） |
| commitChapterState + persistAcceptedChapterSignals | 95 | commit/chapter-commit-engine.ts（新建） |
| resolveManualReview + autoPickVersionForManualReview + requireActiveManualReview | 192 | run/manual-review-engine.ts（新建） |
| ensureSegmentPlans | 86 | story/segment-plan-engine.ts（新建） |
| ensureRunSessionActive | 82 | run/session-activation.ts（新建） |
| buildStaticPlannerExemplars + buildDynamicPlannerExemplars | 94 | story/planner-exemplars.ts（新建） |
| readLegacyRunControlSnapshot | 47 | run/（已有合适位置） |
| softInvalidateChapterRange | 11 | 和 invalidateFutureTimeline 一起搬 |

合计可搬 ~3942 行。搬完后 run-manager.ts 预计 ~600 行（主循环 + 控制面 + re-export shim）。

### 提取顺序（按依赖深度）

```
B1: 搬私有 helper 群（lock 管理 + heartbeat + pause-wait）→ run/run-internals.ts
B2: ensureRunSessionActive → run/session-activation.ts
B3: invalidateFutureTimeline + softInvalidateChapterRange → story/timeline-invalidation.ts
B4: ensureSegmentPlans → story/segment-plan-engine.ts
B5: buildStaticPlannerExemplars + buildDynamicPlannerExemplars → story/planner-exemplars.ts
B6: planChapterBlueprint → story/blueprint-plan-engine.ts（依赖 B4+B5）
B7: ensureStoryContract → story/story-contract-engine.ts（依赖 B6）
B8: syncAcceptedChapterStoryProgressState → story/story-progression-sync.ts
B9: commitChapterState + persistAcceptedChapterSignals → commit/chapter-commit-engine.ts
B10: resolveManualReview + autoPickVersionForManualReview + requireActiveManualReview → run/manual-review-engine.ts（依赖 B9）
B11: syncChapterArtifacts + syncCommittedChapterArtifacts → commit/chapter-artifact-sync.ts（依赖 B9, B3）
B12: 清理 run-manager.ts — 删除废弃 shim，更新 compat 层
```

---

### Task B1 — 提取私有 helper 群到 run/run-internals.ts

**从 run-manager.ts 搬出的私有函数（~350行）：**
- `getLockFile`, `readLockState`, `writeLockState`, `updateLockState` — lock 文件管理
- `createLock`, `releaseLock` — 锁生命周期
- `isProcessAlive` — 进程检查
- `touchRunHeartbeat` — 心跳
- `waitIfPaused` — 暂停等待
- `getRunControlSnapshots`, `readLegacyRunControlSnapshot` — 状态快照读取
- `buildSuspendedRunStatePatch` — 暂停状态构建
- `runningTasks` Map 及其类型 `RunningTask`

**搬到：** `src/server/run/run-internals.ts`（新建）

**为什么先搬这些：**
所有主循环函数和控制面函数都依赖这些私有 helper。先搬出来，后续 Task 的提取函数可以从新位置 import。

**run-manager.ts 变化：**
- 删除 ~350 行私有函数
- 从 run-internals.ts import

**完成标准：**
- [ ] 新文件 export 所有上述函数
- [ ] run-manager.ts 中不再有这些函数的实现
- [ ] pnpm typecheck 通过

---

### Task B2 — 提取 ensureRunSessionActive

**从 run-manager.ts 搬出：** ~82 行
**搬到：** `src/server/run/session-activation.ts`（新建）

**依赖：** run-internals.ts 的 lock 函数，DB 操作

**完成标准：**
- [ ] blueprint-generate.service.ts 不再通过 dynamic import run-manager 获取 ensureRunSessionActive
- [ ] pnpm typecheck 通过

---

### Task B3 — 提取 invalidateFutureTimelineAfterChapterChange + softInvalidateChapterRange

**从 run-manager.ts 搬出：** ~111 行
**搬到：** `src/server/story/timeline-invalidation.ts`（新建）

**完成标准：**
- [ ] apply-stored-patch.service 和 rollback-version.service 不再 dynamic import run-manager
- [ ] pnpm typecheck 通过

---

### Task B4 — 提取 ensureSegmentPlans

**从 run-manager.ts 搬出：** ~86 行
**搬到：** `src/server/story/segment-plan-engine.ts`（新建）

**需要一起搬的私有函数：**
- `nextSegmentStartChapter` (~5行)

**完成标准：**
- [ ] blueprint-generate.service 不再通过 dynamic import 获取 ensureSegmentPlans
- [ ] pnpm typecheck 通过

---

### Task B5 — 提取 planner exemplars

**从 run-manager.ts 搬出：** ~94 行
- `buildStaticPlannerExemplars`
- `buildDynamicPlannerExemplars`

**搬到：** `src/server/story/planner-exemplars.ts`（新建）

**完成标准：**
- [ ] blueprint-generate.service 不再通过 dynamic import 获取这两个函数
- [ ] pnpm typecheck 通过

---

### Task B6 — 提取 planChapterBlueprint

**从 run-manager.ts 搬出：** ~601 行（**最大单函数之一**）
**搬到：** `src/server/story/blueprint-plan-engine.ts`（新建）

**需要一起搬的私有函数：**
- `rankBlueprintAttempt` (~30行)
- 以及 L1106-1707 之间的所有相关 helper

**依赖：** B4 的 ensureSegmentPlans、B5 的 planner exemplars、B1 的 run-internals

**完成标准：**
- [ ] blueprint-generate.service 不再通过 dynamic import 获取 planChapterBlueprint
- [ ] pnpm typecheck 通过

---

### Task B7 — 提取 ensureStoryContract

**从 run-manager.ts 搬出：** ~1214 行（**最大函数**）
**搬到：** `src/server/story/story-contract-engine.ts`（新建）

**需要一起搬的私有函数（L1707-2920之间）：**
- `buildHeuristicContinuationDecision` (~53行)
- `planStoryContinuation` (~83行)
- `writeDraftFromContext` (~215行)
- `buildDraftMessages` (~63行)
- `persistProseSteeringNotes` (~34行)
- `persistReviewSteeringNotes` (~39行)
- `runStylePass` (~169行)
- `quickAuditChapter` (~171行)
- `ensureFoundationCoverage` (~103行)
- `loadDeepReviewWindow` (~25行)
- `deepReviewChapter` (~171行)
- `rewriteChapterFromReview` (~192行)
- `getProseRiskWeight` (~13行)
- `isBetterProseCandidate` (~7行)
- `countRecentAutoWindowRepairs` (~8行)
- `buildContextMessages` (~65行)

**依赖：** B6 的 planChapterBlueprint、B1 的 run-internals、services/project-execution-context

**注意：这是单个最大的提取。如果依赖链过深导致无法干净提取，允许将 writeDraftFromContext + 审稿相关函数先搬到单独的 `story/draft-write-engine.ts`，分两步完成。**

**完成标准：**
- [ ] blueprint-generate.service 不再通过 dynamic import 获取 ensureStoryContract
- [ ] run-manager.ts 删除了 1200+ 行
- [ ] pnpm typecheck 通过

---

### Task B8 — 提取 syncAcceptedChapterStoryProgressState

**从 run-manager.ts 搬出：** ~320 行
**搬到：** `src/server/story/story-progression-sync.ts`（新建）

**需要一起搬的私有函数：**
- `resolveActiveStoryContract` (~37行)
- 其他 L452-771 之间的 helper

**完成标准：**
- [ ] manual-review.service 不再通过 dynamic import 获取此函数
- [ ] pnpm typecheck 通过

---

### Task B9 — 提取 commitChapterState + persistAcceptedChapterSignals

**从 run-manager.ts 搬出：** ~95 行
**搬到：** `src/server/commit/chapter-commit-engine.ts`（新建）

**完成标准：**
- [ ] manual-review.service 不再 dynamic import run-manager
- [ ] pnpm typecheck 通过

---

### Task B10 — 提取 manual review 函数群

**从 run-manager.ts 搬出：** ~192 行
- `resolveManualReview` (70行)
- `autoPickVersionForManualReview` (108行)
- `requireActiveManualReview` (14行)

**搬到：** `src/server/run/manual-review-engine.ts`（新建）

**依赖：** B9 的 commitChapterState

**完成标准：**
- [ ] 所有 manual review 路由不再需要 dynamic import run-manager
- [ ] pnpm typecheck 通过

---

### Task B11 — 提取 syncChapterArtifacts + syncCommittedChapterArtifacts

**从 run-manager.ts 搬出：** ~1100 行
- `syncChapterArtifacts` (203行)
- `syncCommittedChapterArtifacts` (897行)
- `artifactSyncKey` + `hasChapterArtifactsSynced` + `queueChapterArtifactSync` (~30行)

**搬到：** `src/server/commit/chapter-artifact-sync.ts`（新建）

**依赖：** B1 的 run-internals（waitIfPaused, touchRunHeartbeat）、B3 的 timeline-invalidation、B9 的 chapter-commit-engine

**注意：syncCommittedChapterArtifacts 是 897 行的超级函数，内部调用了 writeDraftFromContext / deepReviewChapter / rewriteChapterFromReview 等（应在 B7 中已搬走）。如果 B7 正确完成，这里只需要从新位置 import。**

**完成标准：**
- [ ] sync-committed-artifacts.service 不再 dynamic import run-manager
- [ ] pnpm typecheck 通过

---

### Task B12 — 清理 run-manager.ts + 更新 compat 层

**依赖：** B1-B11 全部完成

**步骤：**
1. 删除 run-manager.ts 中所有已搬走但保留的 re-export shim
2. 更新 compat/legacy-run-manager.ts — 移除不再需要的条目
3. 确认主循环 `runDetachedExecution` 从新位置 import 所有依赖
4. 确认 pauseRun/stopRun/resumeRun 从 run-internals import lock 操作
5. 统计最终行数

**完成标准：**
- [ ] run-manager.ts 行数 < 700
- [ ] 无任何 service 通过 dynamic import 拉取 run-manager
- [ ] compat/legacy-run-manager.ts 为空或只含 runDetachedExecution 的 re-export
- [ ] pnpm typecheck 通过
- [ ] pnpm test 通过

---

## Phase C — lint warning 清零 + 死代码清理

> 目标：43 个 no-unused-vars warning → 0

### Task C1 — 清理 run-manager.ts 的废弃 re-export

**来源：** run-manager.ts 提取后留下的 re-export 被 lint 标记为 unused

**步骤：**
1. 对每个 lint warning，确认该 symbol 确实无消费者（grep 全局搜索）
2. 无消费者则删除 re-export 行
3. 有消费者则更新消费者的 import 路径指向新位置

**完成标准：**
- [ ] run-manager.ts 相关的 lint warning 清零

---

### Task C2 — 清理其余文件的 unused vars

**涉及文件（从 lint 输出）：**
- `validation.ts` — blueprintBatchSchema 未使用
- `blueprint-planner.ts` — previousChapter, previousReview, maxPlannedChapters, fallbackBlueprint 未使用
- `story-progression.ts` — _pattern, _antagonist, _axes 未使用（解构残留）
- `providers.tsx` — ToastProvider 未使用
- `project-detail-client.tsx` — RoleAssignmentEditor 未使用
- `chapter-steering.ts` — buildStructuredAvoidanceList 未使用
- 其他零散的 unused import

**步骤：**
1. 逐个检查每个 warning，确认是死代码还是误报
2. 死代码直接删除
3. 解构残留（`_xxx`）如果确实不用则从解构中移除

**完成标准：**
- [ ] pnpm lint 0 error, 0 warning

---

## Phase D — 前端错误隔离增强

### Task D1 — 添加嵌套路由 error.tsx

**新建文件：**
- `src/app/projects/[projectId]/error.tsx` — 项目详情级错误边界
- `src/app/settings/error.tsx` — 设置页错误边界

**内容：**
- 与 root error.tsx 类似但保留 layout（侧边栏不消失）
- "返回首页" + "重试" 两个操作

**完成标准：**
- [ ] 项目详情页崩溃不影响全局导航
- [ ] pnpm build 通过

---

### Task D2 — pauseRun/stopRun 统一走状态机（可选，视时间）

**当前问题：** pauseRun/stopRun 直接写 lock file + runState，绕过 session-state-machine.ts。

**修改文件：**
- `src/server/run-manager.ts`（或提取后的 run/run-internals.ts）

**步骤：**
1. pauseRun 改为先调用 session.service.pauseRun（走状态机），再同步写 lock file（兼容层）
2. stopRun 同理
3. 后续可逐步废弃 lock file，全部走 DB session 状态

**完成标准：**
- [ ] 状态机和 lock file 不再脑裂
- [ ] 现有暂停/停止功能不受影响

---

## 依赖关系与执行顺序

```
Phase A (目录补完)      ← 最先做，纯移动
  A1-A4 按顺序（先移 run/ 相关，因为 B 阶段要在 run/ 下新建文件）

Phase B (run-manager 瘦身)  ← A 之后做
  B1 必须最先（共享 helper）
  B2-B5 可按顺序快速做（都是小函数）
  B6 依赖 B4+B5
  B7 依赖 B6（最大提取）
  B8 独立
  B9 独立
  B10 依赖 B9
  B11 依赖 B7+B9（第二大提取）
  B12 依赖 B1-B11 全部完成

Phase C (lint 清零)     ← B 之后做（B 的 re-export 清理可能消除部分 warning）
  C1 → C2

Phase D (前端增强)      ← 独立，可和 B 并行
  D1 独立
  D2 依赖 B1（run-internals 提取后再改比较干净）
```

---

## 验证门禁

每个 Task 完成后必须通过：

```bash
pnpm typecheck
pnpm lint
pnpm test       # node test runner, 354+ tests
pnpm build      # Phase D 的前端改动
```

---

## 预期最终状态

| 指标 | 当前 | 目标 |
|------|------|------|
| run-manager.ts 行数 | 4560 | <700 |
| server/ 根目录非测试文件 | 34 | ≤20 |
| lint warning | 43 | 0 |
| dynamic import run-manager 的 service | 7 | 0 |
| 嵌套 error.tsx | 0 | 2 |
| pauseRun/stopRun 走状态机 | 否 | 是 |

---

## 降级策略

- **B7（ensureStoryContract 1214行）太大无法一次搬**：拆成两步，先搬 draft-write-engine（writeDraftFromContext + 审稿链），再搬 contract 主体
- **B11（syncCommittedChapterArtifacts 897行）依赖 B7 的搬出结果**：如果 B7 没完全完成，B11 允许对 B7 未搬出的函数保持 dynamic import 但标注 `// TODO`
- **D2（状态机统一）改动风险大**：如果测试不过可跳过，标注 `[deferred]`
- **pnpm build 超时**：记录后跳过，继续
- **typecheck 不过且超过 10 个不相关错误**：记录后继续

---

## Codex 分批建议

鉴于 Codex 单会话容量限制：

**Session 1：Phase A（4 task）+ Phase B 的 B1-B6（6 task）= 10 task**
**Session 2：Phase B 的 B7-B12（6 task）= 6 task**（B7 和 B11 是大任务）
**Session 3：Phase C（2 task）+ Phase D（2 task）= 4 task**
