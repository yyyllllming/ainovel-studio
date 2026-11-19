# AINovel Studio 框架总览

最后核对时间：2026-04-12

这份文档是当前仓库里关于系统结构、关键路径、运行链路和降 AI 味机制的统一说明。它以代码为准，替代旧的 `PROJECT_ARCHITECTURE.md`。

## 1. 真实入口在哪里

当前真正运行的应用根目录是 `platform/`。

- `platform/package.json`
  - 前端开发、构建、后台 runner 和 reconciler 的入口都在这里定义。
- `platform/src/app`
  - Next.js App Router 页面和 API 路由。
- `platform/src/components`
  - 页面级客户端组件和通用 UI 组件。
- `platform/src/server`
  - 写作编排、上下文组装、审稿、数据库访问、运行控制和后台进程逻辑。
- `platform/prompts`
  - `planner / writer / reviewer-quick / reviewer-deep / editor / archivist` 提示词。
- `platform/data/app.db`
  - 运行期 SQLite 数据库。
- `platform/projects/{projectId}`
  - 每个小说项目的章节、蓝图、审稿、canon、summary、版本等产物。

仓库根目录也有 `config/`、`data/`、`projects/` 等目录，但当前 Web 应用和运行脚本的主入口是 `platform/`，日常应优先以 `platform/` 下的内容为准。

## 2. 技术栈

- Web 框架：Next.js 16.1.7
- UI：React 19.2.3
- 语言：TypeScript 5
- 样式：Tailwind CSS 4
- 数据库：SQLite + `better-sqlite3`
- ORM：Drizzle ORM
- 前端数据获取：TanStack React Query
- 后台构建：`tsup`
- LLM 接入：OpenAI-compatible relay

## 3. 目录与职责

### 3.1 页面层

`platform/src/app` 当前有 10 个页面文件：

- `page.tsx`
- `api-demo/page.tsx`
- `authors/page.tsx`
- `ideas/page.tsx`
- `ideas/[ideaId]/page.tsx`
- `projects/page.tsx`
- `projects/[projectId]/page.tsx`
- `projects/[projectId]/chapters/[chapterNo]/page.tsx`
- `projects/[projectId]/preview/page.tsx`
- `settings/page.tsx`

页面职责可以粗分为：

- 首页与项目总览
- 想法库与想法详情
- 作者卡库
- 项目详情、章节工作台、预览页
- 模型配置页

### 3.2 组件层

`platform/src/components` 当前有 44 个组件文件（含子目录）。

核心组件包括：

- `dashboard-client.tsx`
- `project-detail-client.tsx`
- `chapter-workshop-client.tsx`
- `foundation-workshop-client.tsx`
- `manuscript-preview-client.tsx`
- `ideas-client.tsx`
- `idea-detail-client.tsx`
- `author-library-client.tsx`
- `card-library-client.tsx`
- `settings-client.tsx`

辅助组件包括：

- `app-sidebar.tsx`
- `role-assignment-editor.tsx`
- `status-badge.tsx`
- `collapsible-section.tsx`
- `toast.tsx`
- `trash-panel-client.tsx`

组件子目录：

- `foundation/` - 设定工作台相关组件
- `project/` - 项目详情页相关组件
- `cards/` - 卡片库相关组件
- `author/` - 作者卡相关组件
- `idea/` - 想法库相关组件
- `dashboard/` - 仪表盘相关组件

### 3.3 API 层

所有接口位于 `platform/src/app/api/**/route.ts`。

当前规模：

- 64 个 route 文件
- 约 75 个 HTTP 方法导出
- 其中 `demo` 下有 2 个演示接口，其余为业务接口

主要分组：

- `api/authors` - 作者卡管理
- `api/ideas` - 想法库
- `api/projects` - 项目、章节、蓝图、运行控制
- `api/settings/llm-profiles` - 模型配置
- `api/files/read` - 文件读取
- `api/demo` - 演示接口

如果要看逐接口契约，优先读 `platform/API_DOCUMENTATION.md`。

### 3.4 服务端层

`platform/src/server` 是系统核心，包含约 201 个 TypeScript 文件。

主要分为几类：

- 数据库与仓储
  - `db/schema.ts` - 34 张表定义
  - `db/init.ts`
  - `repositories/*.ts`
  - `repository.ts`
- 写作编排与运行控制
  - `run/runner-main.ts` - Runner 进程入口
  - `run/runner-orchestrator.ts`
  - `run/session.service.ts`
  - `run/launcher.service.ts`
  - `run/control.service.ts`
  - `run/progress.service.ts`
- 内容生成与返修
  - `run/chapter-draft.ts`
  - `run/chapter-review.ts`
  - `run/chapter-style-pass.ts`
  - `blueprint-planner.ts`
  - `run/context-engine.ts`
  - `prose-normalizer.ts`
  - `prose-rescue.ts`
  - `content/review-repair.ts`
  - `content/scene-rescue.ts`
  - `content/voice-engine.ts`
- 设定、题材和记忆
  - `foundation/foundation-workshop.ts`
  - `story/story-contract.ts`
  - `story/story-progression.ts`
  - `story/story-lorebook.ts`
  - `story/story-memory.ts`
  - `canon.ts`
- 文风系统（整合后的 `style/` 目录）
  - `style/foundation-style.ts`
  - `style/style-reference-import.ts`
  - `style/style-snapshot.ts`
  - `style/style-steering.ts`
- LLM 与 prompts
  - `llm.ts`
  - `prompts.ts`
  - `writing-dna.ts`
- 业务服务层（`services/` 目录）
  - `author-card.service.ts`
  - `blueprint-generate.service.ts`
  - `canon.service.ts`
  - `card.service.ts`
  - `chapter-optimize.service.ts`
  - `chapter-query.service.ts`
  - `foundation-generate.service.ts`
  - `project.service.ts`
  - `settings.service.ts`
  - 等 25 个服务文件

## 4. 数据层

数据库 schema 在 `platform/src/server/db/schema.ts`。

当前共有 34 张表，主要可以分为：

- 项目与想法
  - `projects`
  - `ideas`
  - `idea_workshop_states`
  - `idea_workshop_messages`
- 作者风格与设定
  - `author_cards`
  - `author_card_versions`
  - `foundations`
  - `style_reference_imports`
  - `style_card_snapshots`
  - `foundation_workshop_states`
  - `foundation_workshop_messages`
- 写作规划与章节
  - `blueprints`
  - `chapter_versions`
  - `chapter_delta_records`
  - `chapter_invalidations`
  - `chapter_review_states`
  - `review_reports`
- 运行控制
  - `run_states`
  - `run_sessions`
  - `run_checkpoints`
  - `run_events`
  - `run_config_snapshots`
  - `run_logs`
- 提交与后台任务
  - `chapter_commits`
  - `artifact_outbox`
- 记忆、canon、摘要与冲突
  - `context_packs`
  - `canon_fact_index`
  - `summary_index`
  - `conflicts`
- 卡片系统
  - `project_cards`
  - `project_card_messages`
  - `card_progressions`
- 角色分工
  - `agent_assignments`

## 5. 后台进程架构

当前不是“单进程任务管理”，而是前台应用加后台进程的组合：

- Next.js 主进程
  - 页面渲染、API 路由、交互入口
- Runner 独立进程
  - 入口：`platform/src/server/run/runner-main.ts`
  - 负责长时间运行的章节写作编排
- Commit Reconciler 独立进程
  - 入口：`platform/src/server/commit/commit-reconciler-main.ts`
  - 负责章节提交、落盘和产物 outbox 协调

相关调度逻辑位于：

- `platform/src/server/run/runner-orchestrator.ts`
- `platform/src/server/run/session.service.ts`
- `platform/src/server/run/launcher.service.ts`

## 6. 真实运行阶段

系统在运行状态上使用的是一组明确的 stage：

- `blueprint`
- `context`
- `writing`
- `style_pass`
- `review`
- `analysis`

此外还有状态类 stage：

- `manual_review`
- `completed`
- `paused`
- `interrupted`
- `failed`
- `idle`

这些定义在 `platform/src/server/types/run.ts`。

## 7. 一章的实际业务链路

如果从业务上看，一章通常会经历下面这条链路：

1. 读取项目、设定、story contract 和当前 segment 绑定。
2. 生成当前章蓝图。
3. 对蓝图做 verifier 校验，不通过时先 repair，再不行就回退到 recovery blueprint。
4. 组装 context pack，默认总预算 128000 tokens。
5. 调用 writer 流式写初稿。
6. 执行确定性 `style_pass`。
7. 在 quick audit 前做本地 prose 风险检查，必要时先执行自动 prose rescue。
8. 做 deterministic quick audit。
9. 按策略决定是否进入 deep review。
10. deep review 通过则进入 analysis 和落盘；不通过则走 scene rescue 或 voice polish 返修。
11. 多次返修仍失败时转入 `manual_review`。

关键文件：

- `platform/src/server/run-manager.ts`
- `platform/src/server/writing/quick-audit.ts`
- `platform/src/server/writing/prose-rescue.ts`
- `platform/src/server/content/review-repair.ts`

## 8. 规划与主推进机制

这套系统不是“想到哪写到哪”，而是强规划写作：

- `story-progression.ts`
  - 定义 7 种核心 `requiredProgressDelta`
  - 默认按 6 章一个 segment 预生成计划
  - 维护 `stuckDimensions`、`mustAdvance`、`consumedFutureBeats`
- `blueprint-planner.ts`
  - 默认生成 3 个候选蓝图
  - 对候选做具体性、推进性、题材履约和循环风险校验
  - 必要时使用 recovery blueprint 兜底
- `context-engine.ts`
  - 把当前章、下一章、下下章和 avoidance 指令注入上下文
  - 同时组装 facts、summary、lorebook、character state、writer notes 和 obligation cards

## 9. 降 AI 味机制放在哪里

降 AI 味不是单个文件，而是一整条漏斗。

### 9.1 Prompt 预防层

- `platform/prompts/writer.md`
  - Writer 基本规则
  - 禁写句式和负面样例
- `platform/src/server/writing/writing-dna.ts`
  - 内置 anti-AI 规则
  - 按题材和风格动态拼接写作 DNA

### 9.2 确定性检测与清洗

- `platform/src/server/writing/prose-normalizer.ts`
  - 检测代词起句、解释句起手、判断句起手、比喻密度、模板句、硬转词、叠词副词、眸系套话、词块复用等
- `platform/src/server/writing/style-pass.ts`
  - 套话替换
  - forbidden lexicon 清除
  - 写作宪章 regex guard

### 9.3 Quick Audit

- `platform/src/server/writing/quick-audit.ts`
  - 检测结构破损、草稿残留、蓝图跑偏、style drift、story progression、loop risk、genre fulfillment

### 9.4 自动返修

- `platform/src/server/writing/prose-rescue.ts`
  - prose 风险门控
  - 自动 prose rescue
  - 写作宪章预算修复指令

### 9.5 深审与结构返修

- `platform/src/server/content/review-repair.ts`
  - 在 `scene_rescue` 和 `voice_polish` 两条返修路径间做分类
- `platform/src/server/content/scene-rescue.ts`
  - 压 recap、合并重复场景、强化章末 hook

### 9.6 人工审阅

- `platform/src/server/run/manual-review.ts`
- `platform/src/server/run/manual-review-route.service.ts`

## 10. Prompt 与风格入口

Prompt 文件在 `platform/prompts/`：

- `planner.md`
- `writer.md`
- `reviewer-quick.md`
- `reviewer-deep.md`
- `reviewer.md`
- `editor.md`
- `archivist.md`
- `foundation-coach.md`

风格相关入口已整合到 `platform/src/server/style/` 目录：

- `style/foundation-style.ts` - 设定阶段文风生成
- `style/style-reference-import.ts` - 参考文件导入
- `style/style-snapshot.ts` - 文风快照管理
- `style/style-steering.ts` - 文风约束与调优
- `writing-dna.ts` - 写作 DNA 与反 AI 规则

## 11. 产物文件在哪里

项目级持久化产物主要写到 `platform/projects/{projectId}/` 下。

常见类型包括：

- foundation 设定文件
- chapter final / draft / versions
- blueprint 文件
- review 文件
- canon facts / conflicts / summaries
- planner trace
- checkpoint
- commit stage 目录

对应读写逻辑主要在：

- `platform/src/server/project-files.ts`
- `platform/src/server/commit/*.ts`

## 12. 测试覆盖

当前测试规模：

- 服务端单元测试：约 321 个测试文件（含 `.test.ts`）
- UI 组件测试：17 个测试文件（`src/components/__tests__/`）
- E2E 测试：3 个关键流程测试（`e2e/`）
  - 项目创建流程
  - 章节写作流程
  - 版本管理流程
- Storybook 文档：3 个核心组件 stories

测试命令：

```bash
# 服务端测试
pnpm test

# UI 组件测试
pnpm test:ui

# E2E 测试
pnpm test:e2e

# Storybook
pnpm storybook
```

## 13. 相关文档

- `platform/README.md`
  - 启动、基础介绍和常用命令
- `platform/API_DOCUMENTATION.md`
  - 逐接口后端契约说明（2222 行，覆盖 64 个路由）
- `platform/DEVELOPER_GUIDE.md`
  - 开发者指南：调试技巧、常见问题、贡献指南

如果只读一份总说明，优先读这份文档。
