# 全局架构改进执行计划

> 目标：消除 route 直连、拆分巨石文件、补全前端基础设施
> 共 7 个 Phase，28 个 Task，按 ROI 排序

---

## Phase A — 消除 route 层 14 处跨层直连

> 目标：ESLint 豁免清零，所有 route/page 只通过 service 访问业务逻辑
> 预计：2-3 天

### 直连清单（按被禁模块分组）

**@/server/repository（13 处）**
大部分 route 只是 import 几个 repository 函数做简单查询。策略：按领域归入现有或新建 service。

**@/server/project-files（4 处）**
读取章节正文、正典事实、草稿快照。策略：归入现有 file-access.service 或新建领域 service。

**@/server/run-manager（4 处）**
全部 import 的是 `getRunProgress`。策略：归入现有 run/progress.service。

**@/server/idea-workshop（1 处）**
策略：新建 idea-workshop.service 或扩展 idea.service。

**@/server/auto-character-discovery-runtime（1 处）**
策略：归入 blueprint service 或新建 character-discovery.service。

**@/server/profiles（1 处）**
在 page.tsx 中直接调用。策略：改为调用 settings.service.listPublicProfiles()。

---

### Task A1 — 新建 card.service.ts，消除 6 个 card route 的 repository 直连

**文件：**
- 创建：`src/server/services/card.service.ts`
- 修改（6 个 route）：
  - `app/api/projects/[projectId]/cards/route.ts` — import { createCard, ensureCardsFromFoundation, listCards }
  - `app/api/projects/[projectId]/cards/[cardId]/confirm/route.ts` — import { confirmCard, getCard, unconfirmCard }
  - `app/api/projects/[projectId]/cards/[cardId]/progressions/route.ts` — import { getCard, listCardProgressions }
  - `app/api/projects/[projectId]/cards/[cardId]/route.ts` — import { deleteCard, getCard, updateCardDraft, listCardMessages }
  - 还有 `cards/[cardId]/workshop/route.ts` 如果也直连的话

**service 内容：**
把上述 repository 函数封装为 card.service 的方法。从 `repositories/card.repository.ts` 直接 import，不走 barrel。

**完成标准：**
- [ ] 6 个 card route 不再 import @/server/repository
- [ ] card.service.ts 从具体 repository 文件 import

---

### Task A2 — 新建 chapter-query.service.ts，消除 chapter route 的直连

**文件：**
- 创建：`src/server/services/chapter-query.service.ts`
- 修改：
  - `app/api/projects/[projectId]/chapters/[chapterNo]/route.ts` — import { readDraftSnapshot, readFinalChapter } from project-files + { getBlueprint, getChapterReviewState, getProject, listChapterInvalidations, listChapterVersions, listReviewReports } from repository + { getRunProgress } from run-manager
  - `app/api/projects/[projectId]/chapters/[chapterNo]/versions/route.ts` — import { listChapterVersions }
  - `app/api/projects/[projectId]/chapters/[chapterNo]/review/route.ts` — import { listReviewReports }

**service 内容：**
- `getChapterDetail(projectId, chapterNo)` — 聚合章节信息（蓝图 + 正文 + 草稿 + 审稿 + 版本 + 进度）
- `listChapterVersions(projectId, chapterNo)`
- `listChapterReviews(projectId, chapterNo)`
- run progress 部分从 `run/progress.service.ts` import

**完成标准：**
- [ ] 3 个 chapter route 不再 import repository/project-files/run-manager

---

### Task A3 — 新建 canon.service.ts，消除 canon/facts 和 canon/conflicts 的直连

**文件：**
- 创建：`src/server/services/canon.service.ts`
- 修改：
  - `app/api/projects/[projectId]/canon/facts/route.ts` — import { readCanonFacts } from project-files
  - `app/api/projects/[projectId]/canon/conflicts/route.ts` — import { listConflicts } from repository

**完成标准：**
- [ ] 2 个 canon route 不再直连被禁模块

---

### Task A4 — 扩展 blueprint-generate.service.ts，消除 blueprint route 的直连

**文件：**
- 修改：`src/server/services/blueprint-generate.service.ts`（新增查询方法）
- 修改：`app/api/projects/[projectId]/blueprints/[chapterNo]/route.ts` — import { getBlueprint, saveBlueprint } from repository + { syncAutoCharacterCardsFromBlueprint } from auto-character-discovery-runtime

**service 新增：**
- `getBlueprintForChapter(projectId, chapterNo)`
- `saveBlueprintAndSyncCards(projectId, blueprint)` — 内部调用 saveBlueprint + syncAutoCharacterCardsFromBlueprint

**完成标准：**
- [ ] blueprint route 不再 import repository 和 auto-character-discovery-runtime

---

### Task A5 — 扩展 idea.service.ts，消除 idea workshop 的直连

**文件：**
- 修改：`src/server/services/idea.service.ts`
- 修改：`app/api/ideas/[ideaId]/workshop/route.ts` — import { getIdeaWorkshopSnapshot, sendIdeaWorkshopMessage } from idea-workshop

**service 新增：**
- `getWorkshopSnapshot(ideaId)`
- `sendWorkshopMessage(ideaId, input)`

**完成标准：**
- [ ] idea workshop route 不再 import @/server/idea-workshop

---

### Task A6 — 消除 foundation/lock 和 steering-notes 的直连

**文件：**
- 修改或新建 service（可归入 project.service.ts 或独立）
- 修改：
  - `app/api/projects/[projectId]/foundation/lock/route.ts` — import { getFoundation, lockFoundation } from repository
  - `app/api/projects/[projectId]/steering-notes/route.ts` — import { addSteeringNote, listActiveSteeringNotes } from repository + { getRunProgress } from run-manager

**完成标准：**
- [ ] 2 个 route 不再直连被禁模块

---

### Task A7 — 消除 2 个 page.tsx 的直连

**文件：**
- 修改：`app/projects/[projectId]/page.tsx` — import { listCards } from repository + { getRunProgress } from run-manager + { getProfiles } from profiles
- 修改：`app/projects/[projectId]/chapters/[chapterNo]/page.tsx` — 10+ 个直连 import

**策略：**
page.tsx 是 Server Component，可以调用 service。把所有 import 改为调用已有 service（project.service、chapter-query.service、run/progress.service、settings.service）。

**完成标准：**
- [ ] 2 个 page.tsx 不再直连 repository/run-manager/profiles/project-files

---

### Task A8 — 从 ESLint 配置中删除所有 legacyBoundaryBridgeFiles 豁免

**文件：**
- 修改：`platform/eslint.config.mjs`
- 删除 `legacyBoundaryBridgeFiles` 数组和所有对它的引用

**前置条件：** Task A1-A7 全部完成

**验证：**
```bash
pnpm lint  # 0 errors, 0 warnings（或只有不相关的旧 warning）
```

**完成标准：**
- [ ] eslint.config.mjs 中无任何 boundary 豁免
- [ ] pnpm lint 通过

---

## Phase B — 拆分 project-files.ts（938 行 → 5 个领域文件）

> 目标：消除第二个"上帝文件"
> 预计：2 天

### Task B1 — 拆出 chapter-files.ts

**从 project-files.ts 搬出的函数（~350 行）：**
- draftFilePath, checkpointFilePath, createDraftFile, appendDraftChunk, writeCheckpoint
- finalizeDraft, replaceDraftWithFinalContent, validateDraft, readDraftSnapshot, recoverDraft
- writeFinalChapter, readFinalChapter, archiveInvalidatedChapter, listWrittenChapters
- saveSummaryFiles, deleteChapterArtifactsInRange

**搬到：** `src/server/files/chapter-files.ts`（新建）

**project-files.ts 保留 re-export** 以避免破坏现有消费者。

---

### Task B2 — 拆出 canon-files.ts

**从 project-files.ts 搬出的函数（~120 行）：**
- appendCanonFacts, replaceCanonFacts, readCanonFacts
- appendForeshadowEntries, replaceForeshadowEntries, replaceForeshadowEntriesForChapter, readForeshadowEntries
- writeCharacterSnapshot, readCharacterSnapshot, listCharacterSnapshots
- writeLogicStateSnapshot, readLatestLogicStateSnapshot
- writeConflictNote

**搬到：** `src/server/files/canon-files.ts`

---

### Task B3 — 拆出 style-files.ts

**从 project-files.ts 搬出的函数（~60 行）：**
- styleImportRawPath, styleImportNormalizedPath, styleSnapshotPath
- writeStyleReferenceImportFiles, writeStyleSnapshotFile

**搬到：** `src/server/files/style-files.ts`

---

### Task B4 — 拆出 commit-stage-files.ts

**从 project-files.ts 搬出的函数（~120 行）：**
- classifyArtifactManifestFamily, commitStageDir, computeContentHash
- writeCommitStage, promoteCommitStage, inspectCommitStage, cleanupCommitStage, scanCommitStageResidues
- 类型导出：CommitStageManifestFile, CommitStageManifest, ArtifactManifestFamily

**搬到：** `src/server/files/commit-stage-files.ts`

---

### Task B5 — 拆出 export-files.ts + 清理 project-files.ts

**从 project-files.ts 搬出的函数（~80 行）：**
- writeNovelExport, readNovelExport, clearNovelExport, writeNovelExportFailure

**搬到：** `src/server/files/export-files.ts`

**project-files.ts 最终状态：**
- 保留：ensureProjectLayout, writeProjectMeta, readProjectMeta, writeFoundationFiles, writeBlueprintFile, plannerTracePath, writePlannerTraceFile, readPlannerTraceFile, writeReviewFile, writePatchFile, writeVersionFile, readVersionFile, copyVersionToChapter, getFileWindow, deleteLockFile
- 加上所有领域文件的 re-export（兼容层）
- 预期行数：~250 行（含 re-export）

---

## Phase C — 前端巨石组件拆分

> 目标：最大组件从 1,391 行降到 <800 行
> 预计：3-4 天

### Task C1 — 提取前端公共类型到 lib/types/

**新建文件：**
- `src/lib/types/card.ts` — ProjectCard, CardDraft, CardProgression, CardMessage
- `src/lib/types/chapter.ts` — ChapterVersion, ChapterReviewState, ReviewReport 等
- `src/lib/types/project.ts` — ProjectSummary, ProjectDetail 等
- `src/lib/types/foundation.ts` — FoundationPayload, WorkshopMessage 等
- `src/lib/types/index.ts` — barrel export

**从以下组件中提取内联 interface：**
- card-library-client.tsx（20+ 个 interface）
- project-detail-client.tsx
- dashboard-client.tsx
- chapter-workshop-client.tsx

**完成标准：**
- [ ] 组件不再有超过 3 个内联 interface
- [ ] 所有共享类型在 lib/types/ 中

---

### Task C2 — 拆分 project-detail-client.tsx

**从主文件提取 5 个子组件：**
- `src/components/project/run-control-panel.tsx` — 运行控制和日志（~300 行）
- `src/components/project/chapter-cleanup-panel.tsx` — 章节整理（~60 行）
- `src/components/project/steering-notes-panel.tsx` — 追加指令（~50 行）
- `src/components/project/model-assignment-section.tsx` — 模型分配和深审策略（~100 行）
- `src/components/project/chapter-outline-grid.tsx` — 章节网格（~50 行）

**project-detail-client.tsx 最终行数：** ~700-800 行

---

### Task C3 — 拆分 card-library-client.tsx

**从主文件提取 3 个子组件：**
- `src/components/cards/card-list-sidebar.tsx` — 左侧卡片列表（~60 行）
- `src/components/cards/card-detail-panel.tsx` — 右侧详情和编辑（~400 行）
- `src/components/cards/card-editor-utils.ts` — normalizeText, autoMetaLabel, toCardEditorState, buildCardDraft 等工具函数（~100 行）

**card-library-client.tsx 最终行数：** ~500-600 行

---

### Task C4 — 拆分 foundation-workshop-client.tsx

**从主文件提取 3 个子组件：**
- `src/components/foundation/style-reference-selector.tsx` — 文风参考选择面板（~200 行）
- `src/components/foundation/workshop-conversation.tsx` — 设定对话区（~150 行）
- `src/components/foundation/foundation-preview.tsx` — 正式设定展示（~100 行）

**foundation-workshop-client.tsx 最终行数：** ~600-700 行

---

### Task C5 — 拆分 dashboard-client.tsx

**从主文件提取 1 个子组件：**
- `src/components/dashboard/project-creation-form.tsx` — 新建项目表单（~300 行）

**dashboard-client.tsx 最终行数：** ~550 行

---

## Phase D — 前端基础设施补全

> 预计：1 天

### Task D1 — 添加 Error Boundary

**新建文件：**
- `src/app/error.tsx` — 路由级 error boundary
- `src/app/global-error.tsx` — 全局 error boundary（捕获 root layout 错误）

**内容：**
- 显示友好的错误提示 + "重试"按钮
- 调用 `reset()` 重试渲染
- 在开发模式下显示错误堆栈

**完成标准：**
- [ ] 任何子页面的运行时错误不会白屏全站
- [ ] 错误页面有"重试"操作

---

### Task D2 — React Query 全局错误处理

**修改文件：**
- `src/app/providers.tsx`

**内容：**
在 QueryClient 配置中添加 `onError` 全局回调，对未处理的 query/mutation 错误显示 toast。

```typescript
const client = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 300_000,
      gcTime: 1_800_000,
    },
    mutations: {
      onError: (error) => {
        // 全局 toast 提示
      },
    },
  },
});
```

---

## Phase E — server/ 根目录文件按领域归组

> 目标：60 个平铺文件 → 按领域子目录组织
> 预计：1 天
> **纯文件移动 + import 路径更新，不改逻辑**

### Task E1 — 创建 writing/ 子目录

**移动以下文件到 `src/server/writing/`：**
- prose-rescue.ts (933行)
- prose-normalizer.ts (769行)
- draft-quality.ts (155行)
- writing-dna.ts (183行)
- quick-audit.ts (279行)
- style-pass.ts (93行)
- style-prompt-guard.ts (117行)

**更新所有引用这些文件的 import 路径。**

---

### Task E2 — 创建 style/ 子目录

**移动以下文件到 `src/server/style/`：**
- style-steering.ts (820行)
- style-snapshot.ts (428行)
- style-reference-import.ts (679行)
- foundation-style.ts (171行)

---

### Task E3 — 创建 foundation/ 子目录

**移动以下文件到 `src/server/foundation/`：**
- foundation-workshop.ts (1006行)
- foundation-enrichment.ts (301行)
- foundation-workshop-rules.ts (54行)
- foundation-workshop-copy.ts (57行)
- foundation-card-sync.ts (69行)
- foundation-file-sync.ts (30行)

---

### Task E4 — 创建 story/ 子目录

**移动以下文件到 `src/server/story/`：**
- story-progression.ts (1201行)
- story-contract.ts (297行)
- story-memory.ts (296行)
- story-lorebook.ts (383行)
- story-seed-patch.ts (244行)

---

### Task E5 — 创建 character/ 子目录

**移动以下文件到 `src/server/character/`：**
- auto-character-discovery.ts (691行)
- auto-character-discovery-runtime.ts (84行)
- character-name-normalization.ts (259行)
- card-progressions.ts (249行)
- card-workshop.ts (169行)

---

## Phase F — 引入数据库迁移机制

> 预计：1 天

### Task F1 — 引入 drizzle-kit 迁移

**安装：**
```bash
pnpm add -D drizzle-kit
```

**新建文件：**
- `platform/drizzle.config.ts` — drizzle-kit 配置
- `platform/migrations/` — 迁移目录

**修改文件：**
- `src/server/db/init.ts` — 把 `CREATE TABLE IF NOT EXISTS` 改为 drizzle-kit 迁移执行

**步骤：**
1. 从当前 schema 生成初始迁移快照（`drizzle-kit generate`）
2. 把现有 CREATE TABLE SQL 转为迁移文件
3. init.ts 改为执行迁移而非硬编码 SQL
4. 后续表结构变更通过 `drizzle-kit generate` + `drizzle-kit migrate` 管理

---

## Phase G — 补全高风险测试

> 预计：2 天

### Task G1 — run-manager 主循环 smoke test

**新建：** `src/server/run-manager-smoke.test.ts`

为 `runDetachedExecution` 建立最小的 stub 环境（stub LLM + 内存 SQLite + temp FS），验证：
- 单章节生成流程能从 start 到 commit
- pause/resume 正确暂停和恢复
- 崩溃后从 checkpoint 恢复

---

### Task G2 — 前端组件基础测试

**安装：**
```bash
pnpm add -D @testing-library/react @testing-library/jest-dom vitest @vitejs/plugin-react jsdom
```

**为最关键的 3 个组件添加渲染测试：**
- `src/components/__tests__/settings-client.test.tsx` — apiKey 不可见
- `src/components/__tests__/dashboard-client.test.tsx` — 项目列表渲染
- `src/components/__tests__/project-detail-client.test.tsx` — 基础渲染不报错

---

## 依赖关系与执行顺序

```
Phase A (route 直连)     ← 最先做，解锁 lint 边界
  A1-A7 可并行
  A8 依赖 A1-A7 全部完成

Phase B (project-files 拆分)  ← A 之后做，因为新 service 需要 import 拆分后的文件
  B1-B5 按顺序

Phase C (前端拆分)       ← 可和 B 并行
  C1 先做（公共类型）
  C2-C5 可并行

Phase D (前端基础设施)    ← C 之后做
  D1-D2 可并行

Phase E (目录归组)       ← B 之后做，避免同时改 import 路径
  E1-E5 可并行

Phase F (DB 迁移)        ← 独立，任何时候都可以做

Phase G (测试补全)       ← 最后做，依赖 A-E 的稳定代码
  G1-G2 可并行
```

---

## CI 验证门禁

每个 Task 完成后必须通过：

```bash
pnpm typecheck
pnpm lint                    # Phase A8 之后应 0 boundary warnings
node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/*.test.ts
```

Phase C/D 的前端改动还需要：
```bash
pnpm build                   # 确保 SSR 不报错
```

---

## 预期最终状态

| 指标 | 当前 | 目标 |
|------|------|------|
| ESLint boundary 豁免 | 14 个 | 0 |
| project-files.ts 行数 | 938 | ~250（含 re-export） |
| 最大前端组件行数 | 1,391 | <800 |
| server/ 根目录文件数 | 60 | ~20（其余归入子目录） |
| 前端组件内联 interface | 30+ | <10 |
| Error Boundary | 无 | 有 |
| DB 迁移机制 | 无 | drizzle-kit |
| 前端测试 | 0 | 3+ |
