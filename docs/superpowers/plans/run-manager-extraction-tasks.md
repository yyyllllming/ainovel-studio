# run-manager.ts 真实提取 — Codex 执行任务列表

> 目标：把 6 个薄委托 service 改成真实实现，让 run-manager.ts 从 5819 行降到 ~4500 行
> 前提：这些 service 文件已存在，route 已经 import 它们，只需要把函数体搬过来

---

## 提取策略

run-manager.ts 中的 7 个目标函数不是孤立的——它们依赖一批内部 helper。
提取顺序按依赖深度由浅到深排列，先搬独立的，再搬有共享 helper 的。

### 共享 helper 依赖图

```
getProjectExecutionContext (75行, L280-354)
  └─ deriveChapterWordTarget (36行, L372-407)

被以下目标函数依赖：
  - ensureBlueprintGenerated → getProjectExecutionContext → generateBlueprint
  - generateVersionsForChapter → getProjectExecutionContext → generateVersions
  - optimizeChapterSelection → getProjectExecutionContext → requestEditorPatch

serializeContextPackSections (40行, L1293-1332)
  被 generateVersions 和 requestEditorPatch 间接使用

buildRuntimeStyleSections (31行, L722-752)
  被 generateVersions 和 generateBlueprint 间接使用

resetStoryContractAfterDeletion (77行, L644-720)
  仅被 deleteChapterRange 使用

requestEditorPatch (~66行, L3643-3708)
  仅被 optimizeChapterSelection 使用

generateFoundation (129行, L2036-2164)
  仅被 ensureFoundationGenerated 使用

generateBlueprint (285行, L2506-2790)
  仅被 ensureBlueprintGenerated 使用

generateVersions (89行, L3805-3893)
  仅被 generateVersionsForChapter 使用
```

关键发现：`getProjectExecutionContext` 是共享热点，被 3 个目标函数（间接）依赖。**先搬它。**

---

## Task E0 — 提取共享 helper：getProjectExecutionContext

**优先级**：最先做，其他 Task 依赖它
**从 run-manager.ts 搬出的代码量**：~111 行

**要搬的函数：**
- `getProjectExecutionContext` (L280-354, 75行)
- `deriveChapterWordTarget` (L372-407, 36行)

**搬到哪：**
`src/server/services/project-execution-context.ts`（新建）

**为什么单独搬：**
这两个函数被 3 个目标函数共享。先搬出来，后续 Task 直接 import 新位置即可。

**实现步骤：**
1. 读取 run-manager.ts L280-407，把两个函数完整复制到新文件
2. 把它们的 import 依赖也带过去（resolveProjectAgents, getPrompt, getFoundation, getFoundationWorkshopSnapshot, getActiveStylePackage, getStyleCard, buildFallbackStyleProfile, normalizeStyleProfile, getStyleReferenceImportsByIds, clamp）
3. 在 run-manager.ts 中删除这两个函数的实现，改为从新文件 import
4. 确认 run-manager.ts 内部其他调用点（runDetachedExecution 主循环中也用 getProjectExecutionContext）仍然正常

**搬完后 run-manager.ts 的变化：**
- 删除 ~111 行函数体
- 新增 1 行 import

**验收标准：**
- [ ] 新文件 export getProjectExecutionContext 和 deriveChapterWordTarget
- [ ] run-manager.ts 中不再有这两个函数的实现
- [ ] pnpm typecheck 通过
- [ ] 现有测试通过

---

## Task E1 — 真实提取 applyStoredPatch 和 rollbackVersion

**优先级**：最简单，先做
**从 run-manager.ts 搬出的代码量**：~23 行

**现状：**
- `applyStoredPatch` (L5785-5798, 14行) — 已经几乎是纯委托，调用 `commit/apply-stored-patch.service.ts`
- `rollbackVersion` (L5803-5811, 9行) — 同上，调用 `commit/rollback-version.service.ts`
- 两者都依赖 `invalidateFutureTimelineAfterChapterChange` (L1194, 是 run-manager 的 export 函数)
- 两者都调用 `createChapterSessionGuard().assertNoOpenSession()`

**commit/ 下的两个 service 已经是真实实现**，包含了完整的 patch 应用/版本回滚逻辑。run-manager 中的函数只是在前面加了 session guard + DI 注入。

**要做的事：**

1. 修改 `services/chapter-optimize.service.ts`（复用文件名不变，或改用现有的 commit/ service）

   不对——这两个函数的真正实现已经在 `commit/apply-stored-patch.service.ts` 和 `commit/rollback-version.service.ts` 中。当前薄委托 service 不需要改（它们在 `services/` 下不存在对应文件——route 直接调 commit/ 下的 service）。

   实际路径：
   - route → `services/xxx.service.ts`（薄委托）→ dynamic import run-manager → run-manager 中的 applyStoredPatch → commit/apply-stored-patch.service.ts
   
   正确做法：让薄委托直接调 commit/ 下的 service，跳过 run-manager。

2. 修改 `commit/apply-stored-patch.service.ts`：
   - 把 `invalidateFutureTimelineAfterChapterChange` 的 dynamic import 从 run-manager 改为从新位置 import（需要先把这个函数也搬出 run-manager，或者保持 dynamic import 但加注释说明这是临时方案）
   - 把 `createChapterSessionGuard().assertNoOpenSession()` 的调用加到 service 的入口处（目前在 run-manager 里做的）

3. 修改 `commit/rollback-version.service.ts`：同上

4. 删除 run-manager.ts 中的 `applyStoredPatch` 和 `rollbackVersion` 函数体
   - 保留 export shim 委托到 commit/ service（或直接删，让 compat 层处理）

**搬完后 run-manager.ts 的变化：**
- 删除 ~23 行函数体

**验收标准：**
- [ ] route → service → commit/xxx.service.ts 的调用链不经过 run-manager
- [ ] commit/ service 自己做 session guard 检查
- [ ] pnpm typecheck 通过

---

## Task E2 — 真实提取 ensureFoundationGenerated

**从 run-manager.ts 搬出的代码量**：~132 行（3行入口 + 129行 generateFoundation）

**现状：**
- `ensureFoundationGenerated` (L5529-5531, 3行) — 只调用内部的 `generateFoundation`
- `generateFoundation` (L2036-2164, 129行) — 真正的逻辑
- 依赖 `getProjectExecutionContext`（Task E0 已搬出）

**要做的事：**
1. 把 `generateFoundation` 搬到 `services/foundation-generate.service.ts`
2. 带走它的 import 依赖：getProject, getFoundation, isFoundationLocked, getFoundationWorkshopSnapshot, listCards, canGenerateFormalFoundation, buildProjectPromptSummary, getStyleCard, chatJson, saveFoundation, writeFoundationFiles, appendRunLog
3. 还需要搬两个小 helper：
   - `buildProjectWritingDnaPrompt` (~15行)
   - `ensureConcreteFoundationCharacterNames` (~55行)
4. `getProjectExecutionContext` 从 Task E0 的新位置 import
5. 删除 run-manager.ts 中的 generateFoundation + ensureFoundationGenerated 实现
6. 保留 run-manager.ts 中的 export shim（因为主循环也调用 generateFoundation）

**验收标准：**
- [ ] foundation-generate.service.ts 包含完整的 generateFoundation 逻辑
- [ ] run-manager.ts 中的 generateFoundation 改为从新 service import
- [ ] pnpm typecheck 通过

---

## Task E3 — 真实提取 ensureBlueprintGenerated

**从 run-manager.ts 搬出的代码量**：~300 行（15行入口 + 285行 generateBlueprint）

**现状：**
- `ensureBlueprintGenerated` (L5536-5550, 15行)
- `generateBlueprint` (L2506-2790, 285行) — **最大的单体函数**
- 依赖 `getProjectExecutionContext`（Task E0 已搬出）
- 依赖 `buildRuntimeStyleSections` (31行, L722-752)

**这是最难的提取之一，因为 generateBlueprint 依赖 20+ 个外部函数。**

**要做的事：**
1. 把 `generateBlueprint` + `buildRuntimeStyleSections` 搬到 `services/blueprint-generate.service.ts`
2. 带走所有 import 依赖（主要是 repository 函数和 prompt 构建函数）
3. `getProjectExecutionContext` 从 Task E0 的新位置 import
4. 删除 run-manager.ts 中的实现
5. 主循环中对 generateBlueprint 的调用改为 import 新 service

**注意：**
- generateBlueprint 内部可能还调用了 `ensureSegmentPlans` 等内部函数，需要在提取时确认完整依赖链
- 如果依赖链太深，可以先提取 generateBlueprint 本体，内部的深层调用暂时保持 dynamic import run-manager

**验收标准：**
- [ ] blueprint-generate.service.ts 包含完整的 generateBlueprint 逻辑
- [ ] run-manager.ts 删除了 ~300 行
- [ ] 蓝图生成功能正常

---

## Task E4 — 真实提取 generateVersionsForChapter

**从 run-manager.ts 搬出的代码量**：~230 行（62行入口 + 89行 generateVersions + ~40行 serializeContextPackSections + ~38行 renderProseSignalWarnings）

**现状：**
- `generateVersionsForChapter` (L5647-5708, 62行)
- `generateVersions` (L3805-3893, 89行)
- `serializeContextPackSections` (L1293-1332, 40行) — 也被 requestEditorPatch 使用
- `renderProseSignalWarnings` (~38行) — 也被主循环使用
- 依赖 `getProjectExecutionContext`（Task E0 已搬出）
- 依赖 `buildRuntimeStyleSections`（Task E3 已搬出）

**要做的事：**
1. 把 `generateVersions` + `generateVersionsForChapter` 搬到 `services/chapter-version-generate.service.ts`
2. `serializeContextPackSections` 搬到公共位置（比如 `services/context-serialization.ts`），因为它被多个函数共享
3. `renderProseSignalWarnings` 同理，搬到公共位置
4. 带走所有 import 依赖
5. 删除 run-manager.ts 中的实现

**验收标准：**
- [ ] chapter-version-generate.service.ts 包含完整逻辑
- [ ] 共享 helper 在公共位置可被多个 service import
- [ ] pnpm typecheck 通过

---

## Task E5 — 真实提取 optimizeChapterSelection

**从 run-manager.ts 搬出的代码量**：~134 行（68行入口 + 66行 requestEditorPatch）

**现状：**
- `optimizeChapterSelection` (L5713-5780, 68行)
- `requestEditorPatch` (L3643-3708, ~66行)
- 依赖 `getProjectExecutionContext`（Task E0 已搬出）
- 依赖 `serializeContextPackSections`（Task E4 已搬出到公共位置）

**要做的事：**
1. 把 `requestEditorPatch` + `optimizeChapterSelection` 搬到 `services/chapter-optimize.service.ts`
2. 从公共位置 import 共享 helper
3. 删除 run-manager.ts 中的实现

**验收标准：**
- [ ] chapter-optimize.service.ts 包含完整逻辑
- [ ] pnpm typecheck 通过

---

## Task E6 — 真实提取 deleteChapterRange

**从 run-manager.ts 搬出的代码量**：~178 行（88行入口 + 77行 resetStoryContractAfterDeletion + 13行 releaseLock）

**这是最复杂的提取**，因为 deleteChapterRange 依赖模块级变量 `runningTasks`。

**现状：**
- `deleteChapterRange` (L5555-5642, 88行)
- `resetStoryContractAfterDeletion` (L644-720, 77行) — 仅被 deleteChapterRange 使用
- `releaseLock` (L1259-1271, 13行) — 依赖 `runningTasks` 模块级变量
- `runningTasks` (L972) — `Map<string, RunningTask>`

**要做的事：**
1. 把 `deleteChapterRange` + `resetStoryContractAfterDeletion` 搬到 `services/chapter-range-delete.service.ts`
2. 对 `runningTasks` 和 `releaseLock` 的依赖，改为依赖注入：
   - service 接收 `isRunning: (projectId: string) => boolean` 参数
   - service 接收 `releaseLock: (projectId: string) => void` 参数
   - run-manager 在调用时传入这些函数
3. 也可以换一种方式：把 `runningTasks.has(projectId)` 的检查改为查 DB 的 run_sessions 表（更正确的做法，但改动更大）
4. 删除 run-manager.ts 中的实现

**验收标准：**
- [ ] chapter-range-delete.service.ts 包含完整逻辑
- [ ] 不直接依赖 run-manager.ts 的模块级变量
- [ ] pnpm typecheck 通过

---

## Task E7 — 清理 run-manager.ts 的废弃 export shim

**依赖**：E0-E6 全部完成

**要做的事：**
1. 检查 run-manager.ts 中所有标记 `@deprecated` 的 export shim
2. 确认主循环（runDetachedExecution）是否还直接调用已搬出的函数
   - 如果是：改为 import 新 service
   - 如果不是：直接删除 shim
3. 更新 compat/legacy-run-manager.ts，移除不再需要的 re-export
4. 统计最终行数

**验收标准：**
- [ ] run-manager.ts 行数降到 ~4500 行以下
- [ ] 没有 "函数在 run-manager 里定义但实际逻辑在 service 里" 的情况
- [ ] pnpm typecheck 通过
- [ ] 所有现有测试通过

---

## 依赖顺序和预期行数削减

```
E0 (共享 helper)     → -111 行
E1 (patch/rollback)  → -23 行
E2 (foundation)      → -132 行
E3 (blueprint)       → -300 行  ← 最大
E4 (versions)        → -230 行
E5 (optimize)        → -134 行
E6 (deleteRange)     → -178 行
E7 (清理 shim)       → -50~100 行
─────────────────────────────────
预期总削减：~1158-1208 行
预期最终行数：~4611-4661 行
```

执行顺序：**E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7**

E0 必须最先做（共享依赖）。E1 最简单可以紧跟着。E2-E6 顺序可调但建议按列出顺序（从小到大）。E7 必须最后。

---

## 给 Codex 的关键约束

1. **搬函数体，不是重写**：把代码原样搬到新文件，只改 import 路径，不改逻辑
2. **run-manager.ts 主循环不动**：runDetachedExecution 内部的流程不在此次范围
3. **共享 helper 放公共位置**：被多个 service 使用的 helper 不要复制到每个 service 里
4. **模块级变量用依赖注入替代**：不要在新 service 里 import run-manager 的变量
5. **每个 Task 完成后 pnpm typecheck 必须通过**
6. **旧 export 可以保留为 re-export**：`export { ensureBlueprintGenerated } from "./services/blueprint-generate.service.ts"` 这种 re-export 是可以的
