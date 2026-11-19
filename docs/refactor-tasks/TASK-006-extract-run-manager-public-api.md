# TASK-006: 从 run-manager 抽走 route 直调的 5 个用例

## 优先级：P1 边界

## 前置依赖：TASK-005（import 禁令已建立）

## 目标
把 `run-manager.ts` 尾部的 5 个被 route 直接 import 的函数抽到独立 application service 中。`run-manager.ts` 保留导出但内部委托到新模块。

## 涉及文件

| 文件 | 操作 |
|---|---|
| `platform/src/server/application/blueprints.service.ts` | 新建 |
| `platform/src/server/application/chapters.service.ts` | 新建 |
| `platform/src/server/run-manager.ts` | 函数体移走，保留 re-export（过渡期） |
| 5 个 route 文件 | 改为 import 新 service |

## 要抽的 5 个函数

从 `run-manager.ts` 第 5677-5945 行：

1. `ensureBlueprintGenerated(projectId, chapterNo)` → `application/blueprints.service.ts`
2. `deleteChapterRange(projectId, input)` → `application/chapters.service.ts`
3. `generateVersionsForChapter(projectId, chapterNo)` → `application/chapters.service.ts`
4. `optimizeChapterSelection(input)` → `application/chapters.service.ts`
5. `applyStoredPatch(input)` → `application/chapters.service.ts`

## 具体操作

### 1. 新建 `platform/src/server/application/blueprints.service.ts`

```typescript
import "../server-only.ts";
// 把 ensureBlueprintGenerated 的完整函数体从 run-manager.ts 移过来
// 包括它内部依赖的 import（blueprint-planner、repository 等）
```

### 2. 新建 `platform/src/server/application/chapters.service.ts`

```typescript
import "../server-only.ts";
// 把 deleteChapterRange、generateVersionsForChapter、
// optimizeChapterSelection、applyStoredPatch 的完整函数体移过来
```

### 3. 修改 `run-manager.ts`

在文件尾部，把原函数体替换为委托：

```typescript
// ---- 过渡期 re-export，后续 TASK 完成后删除 ----
export { ensureBlueprintGenerated } from "./application/blueprints.service.ts";
export { deleteChapterRange, generateVersionsForChapter, optimizeChapterSelection, applyStoredPatch } from "./application/chapters.service.ts";
```

如果这些函数内部依赖了 `run-manager.ts` 中的私有函数/变量，需要：
- 把被依赖的私有函数也一起移走，或
- 把它们提取为共享的 domain 工具函数

### 4. 修改 route 文件

| route | 旧 import | 新 import |
|---|---|---|
| `blueprints/generate/route.ts` | `@/server/run-manager` | `@/server/application/blueprints.service` |
| `chapters/delete-range/route.ts` | `@/server/run-manager` | `@/server/application/chapters.service` |
| `chapters/[chapterNo]/apply-patch/route.ts` | `@/server/run-manager` | `@/server/application/chapters.service` |
| `chapters/[chapterNo]/generate-versions/route.ts` | `@/server/run-manager` | `@/server/application/chapters.service` |
| `chapters/[chapterNo]/optimize/route.ts` | `@/server/run-manager` | `@/server/application/chapters.service` |

## 验证方式

```bash
# 1. 所有现有测试通过
cd platform && npx vitest run

# 2. import 检查脚本不再报这 5 个 route 的违规
pnpm lint:routes

# 3. 手动验证蓝图生成功能
curl -X POST http://localhost:3000/api/projects/{testProjectId}/blueprints/generate \
  -H "Content-Type: application/json" -d '{"chapterNo":1}'

# 4. run-manager.ts 行数显著减少（应减少约 250-300 行函数体）
wc -l src/server/run-manager.ts
```

## 关键风险

这 5 个函数可能依赖 `run-manager.ts` 内部的：
- 私有辅助函数
- 闭包变量（如全局 runner state）
- 其他同文件的导出函数

**抽取前必须先读函数体，确认依赖图。** 如果依赖了内部状态，需要通过参数注入或提取为共享模块来解耦。

## 完成标准

- 5 个函数从 `run-manager.ts` 物理移走
- 5 个 route 不再 import `@/server/run-manager`
- `run-manager.ts` 的 re-export 只作为过渡，标记 `@deprecated`
- 所有现有测试通过
- `run-manager.ts` 净减少 200+ 行
