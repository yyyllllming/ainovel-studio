# 健壮性加固执行计划

> 2026-04-03 · 6 批次 · 预计 19 个 Task

## 背景

体检发现 6 个薄弱点（按优先级排序）：
1. **P0** — 裸 JSON.parse（37 处）在文件/LLM 返回路径无防护
2. **P0** — DB 与文件系统写操作无一致性保证
3. **P1** — chapter-runner.ts 2625 行单文件，职责过重
4. **P2** — legacy-bootstrap.ts 双源 schema 与 drizzle 迁移并行
5. **P2** — 前端 600+ 行大组件拆分
6. **低** — LLM 超时硬编码（已有 options 传入，风险可控，暂不动）

> 注：SQLite busy_timeout 已在 client.ts:30 和 init.ts:15 各设 5000ms，WAL 已开启。此项已达标，不需额外操作。

---

## Batch 1 — safeParseJson 工具函数 + 全量替换（P0）

### 目标

消灭服务端所有裸 `JSON.parse` 调用。提供带 fallback 的 `safeParseJson<T>()` + 带 Zod 校验的 `safeParseJsonSchema<T>()`，在解析失败时返回 `null | fallback` 而非 crash。

### Task 1.1 — 新建 safe-json.ts 工具模块

**新建文件：** `src/server/utils/safe-json.ts`

```typescript
/**
 * 安全 JSON 解析 — 解析失败返回 fallback 而非 throw。
 * 用于文件读取、DB JSON 列、LLM 返回等不可信数据源。
 */
import { z } from "zod";

export function safeParseJson<T = unknown>(
  raw: string,
  fallback: T | null = null,
): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function safeParseJsonSchema<T>(
  raw: string,
  schema: z.ZodSchema<T>,
): T | null {
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
```

### Task 1.2 — 替换文件系统路径上的 JSON.parse

**涉及文件（10 处）：**
- `src/server/files/canon-files.ts` — 5 处（readCanonFacts, readForeshadowEntries, readCharacterSnapshot, readLatestLogicStateSnapshot, readConflictNote 等 JSON.parse(line) / JSON.parse(await readTextFile(...))）
- `src/server/files/novel-export.ts` — 1 处（readNovelExportRecord）
- `src/server/content/project-voice-snapshot.service.ts` — 1 处（readProjectVoiceSnapshot）
- `src/server/commit/chapter-commit.service.ts` — 1 处（parseManifest）
- `src/server/commit/commit-reconciler.ts` — 1 处（parseManifest）
- `src/server/commit/commit-reconciler-main.ts` — 1 处（payload JSON.parse）

**规则：**
- 对于读文件路径：替换为 `safeParseJson(raw, fallbackValue)` — fallback 取决于调用方期望（数组 → `[]`，对象 → `null` 然后上层判空）
- 对于 JSONL 逐行解析（canon-files）：`.map(line => safeParseJson(line)).filter(Boolean)`
- parseManifest 这类内部数据：用 `safeParseJsonSchema` + Zod schema，解析失败直接 throw 明确错误（"commit manifest 损坏"）

### Task 1.3 — 替换 DB JSON 列读取路径上的 JSON.parse

**涉及文件（搜索 repository/ 和 service/ 中的 JSON.parse）：**
- 所有从 DB 读取 `*_json` 列后做 `JSON.parse` 的地方
- 替换为 `safeParseJson(row.xxxJson, defaultValue)`

### Task 1.4 — 替换 LLM 返回路径上的 JSON.parse

**涉及文件：**
- `src/server/llm.ts:115` — `requestJson` 中 `schema.parse(JSON.parse(text))` — 这里已有 try/catch + 重试，**保留不动**
- `src/server/llm.ts:255` — `chatJsonWithTrace` 中 `JSON.parse(extractJsonBlock(content))` — 已有 try/catch + 3 次重试，**保留不动**
- `src/server/llm.ts:355` — `streamChatCompletion` 中 SSE 行解析 — 已有 try/catch 忽略 malformed，**保留不动**

LLM 路径已经有完善的错误处理，不需要改。

### Task 1.5 — 补测试

**修改文件：** `src/server/utils/safe-json.test.ts`（新建）

测试用例：
- safeParseJson 正常解析
- safeParseJson 非法 JSON 返回 fallback
- safeParseJson 空字符串返回 fallback
- safeParseJsonSchema 匹配 schema
- safeParseJsonSchema 不匹配 schema 返回 null

### 完成标准

- [ ] `grep -rn "JSON.parse" src/server/ | grep -v ".test.ts" | grep -v "llm.ts"` 输出为空或仅剩 llm.ts 内已有防护的调用
- [ ] pnpm test 通过
- [ ] pnpm typecheck 通过

---

## Batch 2 — DB/文件系统写操作一致性（P0）

### 目标

对"先写文件再写 DB"或"先写 DB 再写文件"的关键路径，引入简单的补偿模式：文件写入失败时回滚 DB 操作，或 DB 写入失败时清理已写的文件。

### Task 2.1 — 新建 safe-write.ts 辅助

**新建文件：** `src/server/utils/safe-write.ts`

```typescript
/**
 * 先写文件、再写 DB 的安全包装。
 * 如果 DB 写入失败，自动删除已写的文件（补偿）。
 * 如果文件写入失败，直接 throw，不碰 DB。
 */
export async function writeFileThenDb(
  fileOps: () => Promise<string[]>,   // 返回已写文件路径列表
  dbOp: () => void | Promise<void>,   // DB 操作
): Promise<void>;
```

### Task 2.2 — 加固 commit 路径

**修改文件：** `src/server/commit/chapter-commit.service.ts`

commit 流程写文件（版本文件、蓝图文件）后写 DB（chapterVersions 表、reviewReports 表）。
- 用 `writeFileThenDb` 包装 `commitChapter` 的核心写入段

### Task 2.3 — 加固 author card 导入路径

**修改文件：** `src/server/services/author-card.service.ts`

`importTextToAuthorCard` 先写文件到 `library/author-cards/{id}/imports/` 再写 DB。
- 用 `writeFileThenDb` 包装

### Task 2.4 — 加固 foundation 写入路径

**修改文件：** `src/server/project-files.ts` 中 `writeFoundationFiles` + `writeVersionFile`

这两个写文件后，上层会写 DB。在上层调用点加 try/catch 补偿。

### 完成标准

- [ ] 关键写路径有文件/DB 一致性保护
- [ ] pnpm test 通过
- [ ] pnpm typecheck 通过

---

## Batch 3 — chapter-runner.ts 拆分（P1）

### 目标

将 2625 行的 chapter-runner.ts 按职责拆为 5 个模块，runSingleChapter 主循环保留在 chapter-runner.ts 中作为编排器，各阶段逻辑搬到独立文件。

### 拆分方案

| 新文件 | 搬入函数 | 行数估 |
|--------|---------|--------|
| `run/chapter-draft.ts` | `writeDraftFromContext`, `buildDraftMessages`, `buildContextMessages`, `ensureFoundationCoverage`, `planStoryContinuation`, `buildHeuristicContinuationDecision` | ~500 |
| `run/chapter-style-pass.ts` | `runStylePass`, `persistProseSteeringNotes`, `persistReviewSteeringNotes` | ~250 |
| `run/chapter-audit.ts` | `quickAuditChapter` | ~170 |
| `run/chapter-review.ts` | `deepReviewChapter`, `loadDeepReviewWindow`, `rewriteChapterFromReview` | ~260 |
| `run/chapter-finalize.ts` | `finalizeAcceptedChapter` | ~110 |

**chapter-runner.ts 保留：**
- `runSingleChapter`（622 行主循环 — 纯编排，调用上述模块）
- `executeRun`（175 行入口）
- 小型辅助函数（`uniqueNonEmpty`, `getProseRiskWeight`, `isBetterProseCandidate`, `mergeCharterViolations`, `countRecentAutoWindowRepairs` 等 ~100 行）

**预期：** chapter-runner.ts 从 2625 → ~900 行

### Task 3.1 — 提取 chapter-draft.ts

**新建文件：** `src/server/run/chapter-draft.ts`

搬入：
- `buildContextMessages` (line 460-524)
- `ensureFoundationCoverage` (line 525-627)
- `buildHeuristicContinuationDecision` (line 628-680)
- `planStoryContinuation` (line 681-763)
- `writeDraftFromContext` (line 764-978)
- `buildDraftMessages` (line 979-1041)

**关键：**
- 这些函数的 import 依赖全部搬到新文件
- chapter-runner.ts 改为从 `./chapter-draft.ts` import
- 函数签名不变，只移动位置

### Task 3.2 — 提取 chapter-style-pass.ts

**新建文件：** `src/server/run/chapter-style-pass.ts`

搬入：
- `runStylePass` (line 1115-1283)
- `persistProseSteeringNotes` (line 1042-1075)
- `persistReviewSteeringNotes` (line 1076-1114)

### Task 3.3 — 提取 chapter-audit.ts

**新建文件：** `src/server/run/chapter-audit.ts`

搬入：
- `quickAuditChapter` (line 1284-1454)

### Task 3.4 — 提取 chapter-review.ts

**新建文件：** `src/server/run/chapter-review.ts`

搬入：
- `loadDeepReviewWindow` (line 1455-1479)
- `deepReviewChapter` (line 1480-1650)
- `rewriteChapterFromReview` (line 1651-1740)

### Task 3.5 — 提取 chapter-finalize.ts

**新建文件：** `src/server/run/chapter-finalize.ts`

搬入：
- `finalizeAcceptedChapter` (line 1741-1829)

### Task 3.6 — 清理 chapter-runner.ts

- 移除所有已搬走的函数体
- 整理 import（从新模块 re-import）
- 确保 `runSingleChapter` 和 `executeRun` 调用链不变

### 完成标准

- [ ] chapter-runner.ts ≤ 950 行
- [ ] 5 个新文件各 ≤ 500 行
- [ ] 无循环依赖（新文件不 import chapter-runner）
- [ ] pnpm test 全量通过（359+ 测试）
- [ ] pnpm typecheck 通过
- [ ] pnpm build 通过

---

## Batch 4 — 废弃 legacy-bootstrap.ts（P2）

### 目标

将 legacy-bootstrap.ts（1044 行原始 SQL）转换为 drizzle 迁移，消灭 schema 双源。

### Task 4.1 — 生成基线迁移 0000_baseline.sql

**步骤：**
1. 将 legacy-bootstrap.ts 中的全部 CREATE TABLE / CREATE INDEX 语句提取为一个 `0000_baseline.sql`
2. 每条语句加 `IF NOT EXISTS`（幂等）
3. 放入 `migrations/` 目录
4. 在 `migrations/meta/_journal.json` 中注册这个迁移（排在 0001 之前）

### Task 4.2 — 修改 init.ts 去掉 legacy-bootstrap 调用

**修改文件：** `src/server/db/init.ts`

```typescript
// 新逻辑：
export function ensureDatabase(db) {
  applyPragmas(db);
  migrate(drizzle(db), { migrationsFolder: MIGRATIONS_FOLDER });
  // 不再调用 ensureLegacyDatabaseSchema()
  // 不再调用 markExistingMigrationsApplied()
}
```

**但要兼容已有数据库：**
- 已有 DB 中 `__drizzle_migrations` 表已登记了 0001，但没有 0000
- 需要在 `markExistingMigrationsApplied` 中补登记 0000（一次性）
- 或者更简单：0000_baseline.sql 全部用 `CREATE TABLE IF NOT EXISTS`，已有表跳过

### Task 4.3 — 删除 legacy-bootstrap.ts

**删除文件：** `src/server/db/legacy-bootstrap.ts`（1044 行）

**同步清理：**
- init.ts 中的 `import { ensureLegacyDatabaseSchema }`
- init.ts 中的 `hasLegacySchema` / `LEGACY_TABLES` 逻辑

### Task 4.4 — 验证

```bash
# 全新数据库（删除 data/app.db 后重新启动）
rm data/app.db && pnpm dev  # 确认表全部从迁移创建

# 已有数据库（直接启动）
pnpm dev  # 确认不报错，0000 幂等跳过

pnpm test
pnpm typecheck
pnpm build
```

### 完成标准

- [ ] legacy-bootstrap.ts 已删除
- [ ] 全新 DB 和已有 DB 均可正常初始化
- [ ] pnpm test 通过
- [ ] pnpm build 通过

---

## Batch 5 — 前端大组件拆分（P2）

### 目标

将 3 个 600+ 行的前端组件拆为可维护的子组件。

### Task 5.1 — 拆分 foundation-workshop-client.tsx（707 行）

**修改文件：** `src/components/foundation-workshop-client.tsx`

**提取子组件：**
- `src/components/foundation/workshop-header.tsx` — 顶部操作栏（锁定/解锁/生成按钮）
- `src/components/foundation/workshop-editor.tsx` — 设定编辑区域
- `src/components/foundation/style-reference-selector.tsx` — 已存在（289 行），保留

**提取自定义 Hook：**
- `src/components/foundation/use-foundation-queries.ts` — 所有 useQuery/useMutation 集中管理

### Task 5.2 — 拆分 idea-detail-client.tsx（703 行）

**修改文件：** `src/components/idea-detail-client.tsx`

**提取子组件：**
- `src/components/idea/idea-header.tsx` — 标题 + 操作按钮
- `src/components/idea/idea-cocreation.tsx` — 共创对话区域
- `src/components/idea/idea-development.tsx` — 发展面板

**提取自定义 Hook：**
- `src/components/idea/use-idea-queries.ts` — query/mutation 集中

### Task 5.3 — 拆分 project-detail-client.tsx（683 行）

**修改文件：** `src/components/project-detail-client.tsx`

**提取子组件：**
- `src/components/project/project-header.tsx` — 项目信息头
- `src/components/project/project-run-control.tsx` — 运行控制面板
- `src/components/project/project-chapter-list.tsx` — 章节列表

**提取自定义 Hook：**
- `src/components/project/use-project-queries.ts` — query/mutation 集中

### 完成标准

- [ ] 3 个主文件各 ≤ 300 行
- [ ] 子组件各 ≤ 250 行
- [ ] pnpm lint 通过
- [ ] pnpm typecheck 通过
- [ ] pnpm build 通过
- [ ] pnpm test:ui 通过（如有前端测试）

---

## Batch 6 — 全链路验证

### Task 6.1 — 全量回归

```bash
pnpm lint
pnpm typecheck
pnpm test          # 359+ tests
pnpm build
```

### Task 6.2 — 手动冒烟

- 新建空项目 → 创建设定 → 锁定 → 确认 UI 正常
- 打开已有项目 → 确认章节列表、运行控制正常
- 作者卡页 → 导入 TXT → 生成 book 卡 → 确认正常

---

## 执行顺序与依赖

```
Batch 1 (safeParseJson) → Batch 2 (写一致性) → Batch 3 (chapter-runner 拆分)
                                                        ↓
                                              Batch 4 (废弃 legacy-bootstrap)
                                                        ↓
                                              Batch 5 (前端拆分)
                                                        ↓
                                              Batch 6 (全链路验证)
```

Batch 1 和 Batch 2 可以并行（无文件冲突）。
Batch 3 和 Batch 4 可以并行（无文件冲突）。
Batch 5 独立于后端，可与 Batch 3/4 并行。

## Codex 分批建议

- **Session A:** Batch 1（5 task） — 纯工具函数 + 文本替换，改动面广但模式统一
- **Session B:** Batch 2（4 task） — 需要理解写入链路上下文
- **Session C:** Batch 3（6 task） — 纯提取重构，最大批次
- **Session D:** Batch 4（4 task） — DB 迁移，需谨慎
- **Session E:** Batch 5（3 task） — 前端拆分
- **Session F:** Batch 6（2 task） — 验证
