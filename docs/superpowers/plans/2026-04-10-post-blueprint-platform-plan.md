# Post-Blueprint Platform Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `ChapterPlan -> blueprint -> prose -> review -> commit` 主链已经收口的前提下，把剩余平台断点按优先级补成完整闭环。

**Architecture:** 先把 `hook` 从 advisory diagnostics 升级成 authoritative lifecycle，再把作者卡从“单书 steering card”升级成“作者画像 + 外部校准”。拆书规则和 foundation 上游继续补厚，但放在 hook lifecycle 和作者画像之后，避免同时拉太多真源。

**Tech Stack:** Next.js, TypeScript, SQLite/Drizzle, file-backed project artifacts, test runner (`node --test`), existing author-card / story planning services

---

## File Map

### Hook lifecycle authoritative

- Modify: `src/server/db/schema.ts`
- Modify: `migrations/00xx_hook_lifecycle_authoritative.sql`
- Modify: `src/server/story/hook-plan.ts`
- Modify: `src/server/repositories/hook-plan.repository.ts`
- Modify: `src/server/story/hook-diagnostics.ts`
- Modify: `src/server/commit/chapter-commit-engine.ts`
- Modify: `src/server/run/context-engine.ts`
- Modify: `src/server/run/chapter-review.ts`
- Test: `src/server/hook-commit-diagnostics.test.ts`
- Test: `src/server/hook-guidance.test.ts`
- Test: `src/server/context-engine.test.ts`

### Author card / author profile calibration

- Modify: `src/server/services/author-card.service.ts`
- Modify: `src/server/style-reference-import.ts`
- Modify: `src/server/style-snapshot.ts`
- Create: `src/server/author-style-profile.ts`
- Create: `src/server/author-style-profile.test.ts`
- Modify: `src/server/author-book-import.test.ts`

### Split engine v2

- Modify: `src/server/author-book-import-parser.ts`
- Create: `src/server/author-book-import-parser.modes.ts`
- Test: `src/server/author-book-import-parser.test.ts`

### Foundation structured suggestions

- Create: `src/server/foundation/foundation-character-suggestions.ts`
- Modify: `src/server/foundation/foundation-workshop.ts`
- Modify: `src/components/foundation/foundation-preview.tsx`
- Test: `src/server/foundation-character-suggestions.test.ts`

## Phase 3.1: Hook Lifecycle Authoritative

**Intent:** 把现在的 `hook_plans + advisory diagnostics` 升成真正的平台级 lifecycle，但仍保持“结构化前置 authoritative、LLM 逆推只做 evidence 输入”的原则。

- [ ] **Step 1: 扩展 hook 数据模型**
  - 在 `schema.ts` 和迁移中补：
    - `hook_plans.lifecycle_status`
    - `resolved_by_chapter`
    - `resolved_at`
    - `resolution_source`
    - `deferred_until_chapter`
  - authoritative 状态只允许：
    - `planned`
    - `planted`
    - `resolved`
    - `deferred`
    - `cancelled`

- [ ] **Step 2: 定义 authoritative state transition**
  - `planned -> planted`：只允许由 blueprint binding + commit setup evidence 双重满足时进入
  - `planted -> resolved`：需要后续 payoff evidence 达到阈值，且通过 deterministic rules + evidence confidence gate
  - `planned|planted -> deferred`：只能由新的 `ChapterPlan` 明确延长窗口触发
  - `planned|planted -> cancelled`：只能由新的 `ChapterPlan` 明确取消

- [ ] **Step 3: 在 commit 里加 confidence-gated resolution**
  - `chapter-commit-engine.ts` 读取最新 hook diagnostics
  - 只有 `setup/payoff` 证据达到阈值才推进 authoritative 状态
  - 低置信度保留 advisory，不改变 authoritative lifecycle

- [ ] **Step 4: 让 context/review 消费 authoritative + advisory 双层信息**
  - `context-engine.ts` 优先注入 authoritative lifecycle
  - `hook-diagnostics.ts` 继续提供 advisory notes
  - `chapter-review.ts` 只在 authoritative hook debt / deferred miss / duplicate risk 达到条件时才推高为 `planning_failure`

- [ ] **Step 5: 补测试和验收**
  - 覆盖 planted / resolved / deferred / cancelled 四类转换
  - 覆盖低置信 evidence 不推进 authoritative status
  - 覆盖 authoritative hook debt 才触发 planning_repair

**Done Criteria**

- `hook_plans` 自己就能表达当前生命周期，不再只靠 `logic_state` 文本诊断
- `resolved / deferred / cancelled` 能被 context / review / planning_repair 读取
- 低置信度 evidence 不会误推进状态机

## Phase 3.2: Author Card -> Author Profile

**Intent:** 让作者卡不再只是“单本书 steering card”，而能汇总多本书形成作者画像，并输出置信度来源。

- [ ] **Step 1: 新增作者画像聚合层**
  - 新建 `author-style-profile.ts`
  - 输入：
    - 多本书卡
    - 每本书的 `styleDigest / styleExemplars / confidence / chapter coverage`
  - 输出：
    - `authorProfileSummary`
    - `stableTraits`
    - `bookSpecificTraits`
    - `confidence`
    - `coverageReport`

- [ ] **Step 2: 明确“单书风格”和“作者稳定风格”边界**
  - `author-card.service.ts` 返回两层结果：
    - `bookCards`
    - `authorProfile`
  - 如果只有一本书，则 authorProfile 标注为 `single-book inferred`

- [ ] **Step 3: 把书卡置信度拆成可解释指标**
  - `style-reference-import.ts` 和 `style-snapshot.ts` 增加：
    - sample coverage
    - chapter spread
    - excerpt diversity
    - mid/late coverage
  - 最终 `confidence` 不再只有 `low/medium/high`，还要有 explanation fields

- [ ] **Step 4: 给作者画像留外部对账槽位**
  - 先不自动抓网
  - 但 profile 结构要预留：
    - `externalConsensusSummary`
    - `externalConfidence`
    - `mismatchNotes`

**Done Criteria**

- 至少两本书时，authorProfile 能稳定区分“作者稳定特征”和“单书特征”
- 只有一本书时，不再把单书书卡误包装成完整作者画像
- 置信度能解释“为什么是 high / medium / low”

## Phase 3.3: Split Engine v2

**Intent:** 把现在的 `heading / fallback` 升成更明确的 split modes，但不直接搬第三方源码。

- [ ] **Step 1: 拆分解析模式**
  - `author-book-import-parser.modes.ts`
  - 首版模式：
    - `heading_strict`
    - `heading_relaxed`
    - `marker`
    - `window_fallback`

- [ ] **Step 2: 模式选择与告警**
  - `author-book-import-parser.ts` 输出：
    - `parserMode`
    - `parseConfidence`
    - `warnings`
    - `modeCandidates`

- [ ] **Step 3: 改进中文章节规则**
  - 增强常见网文 heading / marker / 番外 / 序章 / 尾声识别
  - 继续保留编码确认与预览确认

**Done Criteria**

- 解析结果不再只有 `heading / fallback`
- 用户能知道这次拆章是靠哪套规则成立的
- 对超长中文网文的拆章稳定性继续提升

## Phase 3.4: Foundation Structured Suggestions

**Intent:** 把 foundation 上游做厚，降低中后期角色崩盘和 world rule 漏注入。

- [ ] **Step 1: 新建 structured suggestions 服务**
  - 输入：
    - workshop draft
    - confirmed cards
    - relationships
    - worldview
    - unresolved questions
  - 输出：
    - `name / role / goal / traits / secret / relationHints / worldBinding / dramaticFunction / riskFlags`

- [ ] **Step 2: 绑定 digest stale 机制**
  - foundation digest 变化后 suggestion 自动 stale
  - apply 只写回 draft，不直接写正式卡

- [ ] **Step 3: 前端补最小操作**
  - `generate`
  - `apply to draft`
  - `dismiss`

**Done Criteria**

- AI suggestion 不再只是角色名字列表
- apply/dismiss/stale 都有闭环
- 正式 foundation 真源不被 suggestion 直接污染

## Recommended Execution Order

1. `Phase 3.1 Hook Lifecycle Authoritative`
2. `Phase 3.2 Author Card -> Author Profile`
3. `Phase 3.3 Split Engine v2`
4. `Phase 3.4 Foundation Structured Suggestions`

## Verification Gate

- Hook authoritative phase:
  - `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/hook-commit-diagnostics.test.ts src/server/hook-guidance.test.ts src/server/context-engine.test.ts`
- Author profile phase:
  - `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/author-book-import.test.ts src/server/style-reference-import.test.ts src/server/style-snapshot.test.ts src/server/author-style-profile.test.ts`
- Split engine phase:
  - `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/author-book-import-parser.test.ts`
- Foundation phase:
  - `node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/foundation-character-suggestions.test.ts`
- Global gate:
  - `npm run typecheck`

