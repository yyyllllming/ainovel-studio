# Codex Execution Prompt — 全局架构改进

你是一个自主执行代理，负责按照 `platform/docs/superpowers/plans/2026-04-02-global-improvement-plan.md` 逐 Task 实施 AINovel-CLI 平台的全局架构改进。

---

## 核心目标

1. **ESLint boundary 豁免从 14 个降到 0**
2. **project-files.ts 从 938 行降到 ~250 行**
3. **最大前端组件从 1,391 行降到 <800 行**
4. **server/ 根目录从 60 文件降到 ~20 文件**
5. **补全 Error Boundary 和前端基础测试**

---

## 执行协议

### 总流程

1. 读取计划文件 `platform/docs/superpowers/plans/2026-04-02-global-improvement-plan.md`
2. 按 Phase A → B → C → D → E → F → G 的顺序执行
3. 每完成一个 Task 执行验证门禁，通过后提交 git commit，然后立即开始下一个 Task
4. Phase 内的 Task 如标注"可并行"，仍按编号顺序逐个做（你是单线程）
5. Phase 之间不可跳跃：A 全部完成才能开始 B，以此类推
6. 全部 28 个 Task 完成后输出最终报告

### 单个 Task 执行步骤

```
1. 读计划中该 Task 的全部内容
2. 读取 Task 涉及的所有现有文件
3. 实现 Task 的 checkbox 清单
4. 验证：
   - pnpm typecheck
   - pnpm lint
   - node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/*.test.ts
   - Phase C/D 的前端改动额外跑 pnpm build
5. 修复失败项（最多重试 3 次）
6. 提交：improve(phaseX): Task XN - <简要描述>
7. 立即开始下一个 Task
```

---

## 关键约束

### Phase A — route 直连消除

- **新建 service 时从具体 repository 文件 import**，不走 repository.ts barrel
- **不改 API 响应形状**：route 内部换 import 来源，对外返回完全不变
- **page.tsx 是 Server Component**，可以直接调用 service 函数
- **A8 是最终验证**：删除 eslint.config.mjs 中的 legacyBoundaryBridgeFiles 数组及所有引用，pnpm lint 必须 0 boundary error

### Phase B — project-files.ts 拆分

- **搬函数体，不重写**：原样剪切到新文件，只改 import 路径
- **project-files.ts 保留 re-export**：`export { writeFinalChapter } from "./files/chapter-files.ts"` 格式，避免破坏现有消费者
- **新建 `src/server/files/` 目录**作为领域文件的容器
- **先搬函数，再更新直接消费者的 import 路径**（可选，不强制一次全改）

### Phase C — 前端组件拆分

- **子组件放在对应的子目录下**：`components/project/`、`components/cards/`、`components/foundation/`、`components/dashboard/`
- **先做 C1（公共类型提取）**，后续拆分可以直接 import 公共类型
- **组件拆分只拆 JSX 和 handler**，不拆 useQuery/useMutation（保持数据获取在父组件，通过 props 传递）
- **不改样式**：Tailwind class 原样搬到子组件

### Phase D — Error Boundary

- `error.tsx` 必须是 Client Component（`"use client"`）
- 接收 `{ error, reset }` props
- 开发模式显示 error.message，生产模式显示通用提示
- `global-error.tsx` 同理，但还需包含 `<html>` 和 `<body>` 标签

### Phase E — 目录归组

- **纯文件移动**：`git mv` 移动文件，再全局替换 import 路径
- **不改逻辑，不改导出**
- **run-manager.ts 不动**：它仍留在 server/ 根目录
- **已在子目录的文件不动**：run/、commit/、services/、repositories/、db/、types/、content/、domain/、security/、compat/ 不变
- 移动后确保 TypeScript path alias `@/server/*` 仍然正确解析

### Phase F — DB 迁移

- 安装 drizzle-kit 为 devDependency
- 从当前 schema.ts 生成初始迁移快照
- init.ts 中的 CREATE TABLE IF NOT EXISTS 改为 drizzle-kit migrate 执行
- **确保对已有数据库文件向后兼容**：用户现有的 app.db 不能因为迁移机制而损坏

### Phase G — 测试补全

- run-manager smoke test 使用 stub LLM（返回固定文本）和内存 SQLite
- 前端测试安装 vitest + @testing-library/react + jsdom
- 前端测试只验证渲染不报错 + 关键交互，不做视觉回归

---

## 项目路径速查

```
platform/
├── eslint.config.mjs                     # Phase A8 修改
├── src/
│   ├── app/
│   │   ├── api/                          # Phase A 的 route 修改目标
│   │   ├── projects/[projectId]/
│   │   │   ├── page.tsx                  # Task A7
│   │   │   └── chapters/[chapterNo]/
│   │   │       └── page.tsx              # Task A7
│   │   ├── error.tsx                     # Task D1 新建
│   │   ├── global-error.tsx              # Task D1 新建
│   │   ├── providers.tsx                 # Task D2 修改
│   │   └── layout.tsx
│   ├── components/
│   │   ├── project-detail-client.tsx     # Task C2 拆分 (1391行)
│   │   ├── foundation-workshop-client.tsx # Task C4 拆分 (1164行)
│   │   ├── card-library-client.tsx       # Task C3 拆分 (1049行)
│   │   ├── dashboard-client.tsx          # Task C5 拆分 (837行)
│   │   └── settings-client.tsx           # 已完成，不动
│   ├── lib/
│   │   ├── api.ts                        # 不动
│   │   ├── types/                        # Task C1 新建
│   │   └── project-structure.ts          # 不动
│   └── server/
│       ├── run-manager.ts                # 不动（本轮不碰）
│       ├── project-files.ts              # Phase B 拆分目标 (938行)
│       ├── repository.ts                 # deprecated barrel，不动
│       ├── files/                        # Phase B 新建目录
│       │   ├── chapter-files.ts
│       │   ├── canon-files.ts
│       │   ├── style-files.ts
│       │   ├── commit-stage-files.ts
│       │   └── export-files.ts
│       ├── writing/                      # Phase E 新建目录
│       ├── style/                        # Phase E 新建目录
│       ├── foundation/                   # Phase E 新建目录
│       ├── story/                        # Phase E 新建目录
│       ├── character/                    # Phase E 新建目录
│       ├── services/                     # Phase A 新建/修改 service
│       │   ├── card.service.ts           # Task A1 新建
│       │   ├── chapter-query.service.ts  # Task A2 新建
│       │   ├── canon.service.ts          # Task A3 新建
│       │   └── (已有 16 个 service)
│       ├── run/
│       ├── commit/
│       ├── repositories/
│       ├── db/
│       │   ├── schema.ts
│       │   └── init.ts                   # Phase F 修改
│       └── types/
```

---

## 测试运行方式

```bash
# 后端测试（Node test runner）
node --experimental-default-type=module --test --experimental-specifier-resolution=node src/server/*.test.ts

# 类型检查
pnpm typecheck

# Lint
pnpm lint

# Next.js 构建（前端改动时）
pnpm build

# 前端测试（Phase G 安装后）
pnpm vitest run
```

---

## 阻塞与降级策略

- **Phase E 的 import 路径更新量大**：如果某个文件移动导致 50+ 个 import 要改，可以在旧位置留一个 re-export 文件，commit message 标注 `[re-export-compat]`
- **Phase F 的 drizzle-kit 如果与当前 drizzle-orm 版本不兼容**：跳过 F，在 commit message 标注版本冲突，记录具体错误
- **Phase G 的 vitest 如果与 Next.js 16 冲突**：用 Node test runner 替代，不安装 vitest
- **pnpm build 超时或 OOM**：记录后跳过 build 验证，继续执行

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
## 改进执行报告
- 完成: Task A1, A2, ...
- 跳过: Task X (原因: ...)
- ESLint 豁免: 当前 N 个
- project-files.ts 行数: N
- 最大前端组件行数: N
- server/ 根目录文件数: N
- 总提交数: N
```

---

## 现在开始

读取 `platform/docs/superpowers/plans/2026-04-02-global-improvement-plan.md`，从 Task A1 开始执行。不要问问题，直接做。
