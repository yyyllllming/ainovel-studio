# Codex Execution Prompt — run-manager.ts 真实提取

你是一个自主执行代理，负责把 `run-manager.ts` 中的 7 个函数及其依赖的 helper 真实搬到独立 service 文件中。

## 核心目标

**把 run-manager.ts 从 5819 行降到 ~4600 行。** 不是加包装层，是把函数体搬走。

---

## 执行计划

读取 `platform/docs/superpowers/plans/run-manager-extraction-tasks.md`，按 E0→E7 顺序逐个执行。

## 关键规则

1. **搬代码，不重写**：把函数体原样剪切到目标文件，只改 import 路径
2. **先搬共享 helper（E0）**：`getProjectExecutionContext` + `deriveChapterWordTarget` 先搬，后续 Task 从新位置 import
3. **run-manager.ts 主循环不动**：`runDetachedExecution` 函数内部的流程不改
4. **模块级变量用 DI 替代**：`runningTasks` 不能被新 service 直接 import，改用函数参数传入
5. **每个 Task 结束后验证**：
   ```bash
   cd platform && pnpm typecheck
   node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/*.test.ts
   ```
6. **每个 Task 一个 commit**：格式 `refactor: E{N} - {简要描述}`

## 关键路径速查

```
已存在的薄委托（要改成真实实现）：
  src/server/services/blueprint-generate.service.ts      → ensureBlueprintGenerated
  src/server/services/foundation-generate.service.ts     → ensureFoundationGenerated
  src/server/services/chapter-version-generate.service.ts → generateVersionsForChapter
  src/server/services/chapter-range-delete.service.ts    → deleteChapterRange
  src/server/services/chapter-optimize.service.ts        → optimizeChapterSelection

已存在的真实实现（不用动）：
  src/server/commit/apply-stored-patch.service.ts        → applyStoredPatch
  src/server/commit/rollback-version.service.ts          → rollbackVersion

新建：
  src/server/services/project-execution-context.ts       → E0 的共享 helper

run-manager.ts 中的目标函数行号：
  getProjectExecutionContext    L280-354  (75行)
  deriveChapterWordTarget       L372-407  (36行)
  resetStoryContractAfterDeletion L644-720 (77行)
  buildRuntimeStyleSections     L722-752  (31行)
  releaseLock                   L1259-1271 (13行)
  serializeContextPackSections  L1293-1332 (40行)
  generateFoundation            L2036-2164 (129行)
  generateBlueprint             L2506-2790 (285行)
  requestEditorPatch            L3643-3708 (66行)
  generateVersions              L3805-3893 (89行)
  ensureFoundationGenerated     L5529-5531 (3行)
  ensureBlueprintGenerated      L5536-5550 (15行)
  deleteChapterRange            L5555-5642 (88行)
  generateVersionsForChapter    L5647-5708 (62行)
  optimizeChapterSelection      L5713-5780 (68行)
  applyStoredPatch              L5785-5798 (14行)
  rollbackVersion               L5803-5811 (9行)

模块级变量（提取障碍）：
  runningTasks  L972  Map<string, RunningTask>  → 仅 deleteChapterRange 依赖
```

## 降级策略

- 如果某个 helper 的依赖链过深（超过 5 层），允许在新 service 中对深层调用保持 dynamic import run-manager，但必须在注释中标注 `// TODO: 待后续提取`
- 如果 run-manager.ts 主循环也调用了被搬走的函数，用 re-export 保持兼容：`export { generateBlueprint } from "./services/blueprint-generate.service.ts"`
- 如果 typecheck 报错超过 5 个且都是被搬函数的类型推断问题，允许添加显式类型注解修复

## 完成标准

```
✅ run-manager.ts 行数 < 4700
✅ 6 个薄委托 service 变成真实实现（不再 dynamic import run-manager 获取主逻辑）
✅ pnpm typecheck 通过
✅ 现有测试全部通过
✅ 共享 helper 在公共位置，不重复
```

## 现在开始

读取计划文件，从 E0 开始。不要问问题，直接做。
