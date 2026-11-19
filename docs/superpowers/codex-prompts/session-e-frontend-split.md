# Codex Prompt — Session E: 前端大组件拆分

## 上下文

AINovel Studio（`platform/`）有 3 个 600+ 行的前端客户端组件，将 UI 渲染、数据获取（React Query）、事件处理全部塞在同一个文件中。需要按功能区块提取子组件和自定义 hooks，提升可维护性。

| 文件 | 行数 |
|------|------|
| `src/components/foundation-workshop-client.tsx` | 707 |
| `src/components/idea-detail-client.tsx` | 703 |
| `src/components/project-detail-client.tsx` | 683 |

**约束：**
- 纯拆分重构，不改任何业务逻辑和 UI 外观
- 子组件通过 props 接收数据，不在子组件中直接 useQuery
- 自定义 hooks 文件集中管理该页面的所有 useQuery/useMutation
- 主文件变成"布局编排器"：调用 hooks 拿数据，传给子组件渲染
- 保持现有的 `"use client"` 声明
- 不安装新依赖

## 任务

### 1. 拆分 foundation-workshop-client.tsx（707 行）

**先读全文，识别 UI 区块和 hooks。**

典型结构：
- 顶部操作栏（锁定/解锁/版本/生成按钮）
- 设定编辑区（文本编辑器 + 字段表单）
- 风格卡选择区（已存在 `style-reference-selector.tsx`，保留）
- 大量 useQuery/useMutation hooks

**提取：**

`src/components/foundation/use-foundation-queries.ts`：
- 将主文件中所有 `useQuery(...)`, `useMutation(...)`, `useQueryClient()` 调用提取到此文件
- 导出一个 `useFoundationQueries(projectId: string)` hook，返回所有 query 和 mutation 对象
- 如果 mutation 有 onSuccess 中的 invalidateQueries 逻辑，也一并搬入

`src/components/foundation/workshop-header.tsx`：
- 锁定/解锁按钮
- 版本历史按钮
- 生成按钮
- Props：相关 mutation pending 状态 + handler 函数

`src/components/foundation/workshop-editor.tsx`：
- 设定编辑区域的 UI
- Props：foundation 数据 + onChange handler

主文件保留：
- `"use client"` + 组件声明
- 调用 `useFoundationQueries` 拿数据
- 布局编排：`<WorkshopHeader>` + `<WorkshopEditor>` + `<StyleReferenceSelector>`
- 目标 ≤ 250 行

### 2. 拆分 idea-detail-client.tsx（703 行）

**提取：**

`src/components/idea/use-idea-queries.ts`：
- 所有 useQuery/useMutation 集中管理

`src/components/idea/idea-header.tsx`：
- 想法标题 + 操作按钮（编辑/删除/转项目）

`src/components/idea/idea-cocreation.tsx`：
- 共创对话区域（消息列表 + 输入框）

`src/components/idea/idea-development.tsx`：
- 发展/细化面板

主文件保留：
- 布局编排
- 目标 ≤ 250 行

### 3. 拆分 project-detail-client.tsx（683 行）

**提取：**

`src/components/project/use-project-queries.ts`：
- 所有 useQuery/useMutation 集中管理

`src/components/project/project-header.tsx`：
- 项目信息头（标题、类型、目标章节数等）

`src/components/project/project-run-control.tsx`：
- 运行控制面板（开始/暂停/停止按钮 + 进度显示）

`src/components/project/project-chapter-list.tsx`：
- 章节列表

主文件保留：
- 布局编排 + dynamic import（CardLibraryClient, FoundationWorkshopClient）
- 目标 ≤ 300 行

### 目录结构

```
src/components/
├── foundation/
│   ├── style-reference-selector.tsx  ← 已有，不动
│   ├── use-foundation-queries.ts     ← 新建
│   ├── workshop-header.tsx           ← 新建
│   └── workshop-editor.tsx           ← 新建
├── idea/
│   ├── use-idea-queries.ts           ← 新建
│   ├── idea-header.tsx               ← 新建
│   ├── idea-cocreation.tsx           ← 新建
│   └── idea-development.tsx          ← 新建
├── project/
│   ├── use-project-queries.ts        ← 新建
│   ├── project-header.tsx            ← 新建
│   ├── project-run-control.tsx       ← 新建
│   └── project-chapter-list.tsx      ← 新建
├── foundation-workshop-client.tsx    ← 瘦身
├── idea-detail-client.tsx            ← 瘦身
└── project-detail-client.tsx         ← 瘦身
```

## 验证命令

```bash
cd platform
pnpm lint
pnpm typecheck
pnpm build

# 确认行数
wc -l src/components/foundation-workshop-client.tsx  # ≤ 250
wc -l src/components/idea-detail-client.tsx           # ≤ 250
wc -l src/components/project-detail-client.tsx        # ≤ 300
```

## 约束

- **纯拆分，零逻辑变更** — 不改业务逻辑，不改 CSS class，不改 API 调用
- 子组件用 TypeScript interface 定义 props（不用 `any`）
- 不改后端代码
- 不改 test 文件
- 不添加新依赖
- 自定义 hooks 文件不加 `"use client"`（hooks 文件不需要）
- 子组件文件加 `"use client"`（如果使用了 useState/useEffect 等 client hooks）
