# AINovel Studio 开发者指南

## 目录

- [本地调试技巧](#本地调试技巧)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [测试指南](#测试指南)

## 本地调试技巧

### 调试 Runner 进程

Runner 是独立的后台进程，负责章节写作编排。调试方法：

#### 1. 开发模式启动

```bash
# 终端 1: 启动主应用
pnpm dev

# 终端 2: 启动 Runner（带调试输出）
pnpm runner:dev
```

#### 2. 查看 Runner 日志

Runner 日志存储在数据库 `run_logs` 表中，也可以通过 API 查看：

```bash
curl http://localhost:3000/api/projects/{projectId}/run/progress
```

#### 3. 调试特定章节

在 `src/server/run/runner-main.ts` 中添加断点或日志：

```typescript
console.log('[Runner Debug]', {
  projectId,
  chapterNo,
  stage: runState.stage,
  retryCount: runState.retryCount,
});
```

#### 4. 模拟写作流程

使用监控脚本驱动并观察完整写作链路（需要本地服务已启动，且通过环境变量指定项目与参考书）：

```bash
AINOVEL_PROJECT_ID=<projectId> AINOVEL_REFERENCE_FILE=<参考书txt路径> \
  node scripts/run-beast-reference-test.mjs
```

### 调试 Reconciler 进程

Commit Reconciler 负责章节提交和产物同步：

```bash
# 开发模式启动
pnpm reconciler:dev
```

查看提交队列状态：

```typescript
// src/server/commit/commit-reconciler.ts
console.log('[Reconciler]', {
  queueLength: outbox.length,
  processing: currentCommit,
});
```

### 调试前端组件

#### 使用 React DevTools

1. 安装 React DevTools 浏览器扩展
2. 打开开发者工具 → React 标签
3. 查看组件树和 props

#### 使用 TanStack Query DevTools

Query DevTools 已内置，访问 `http://localhost:3000` 时会自动显示在右下角。

#### 调试流式响应

设定工作台和文风约束支持流式响应，调试方法：

```typescript
// 在浏览器控制台
const response = await fetch('/api/projects/{projectId}/foundation/workshop?stream=1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '测试消息' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}
```

### 调试数据库

#### 查看数据库内容

```bash
# 使用 SQLite CLI
sqlite3 data/app.db

# 或使用 Drizzle Studio
pnpm drizzle-kit studio
```

#### 常用查询

```sql
-- 查看项目列表
SELECT id, title, status FROM projects;

-- 查看运行状态
SELECT * FROM run_states WHERE projectId = 'xxx';

-- 查看章节版本
SELECT * FROM chapter_versions WHERE projectId = 'xxx' ORDER BY chapterNo, versionNo;

-- 查看审稿报告
SELECT * FROM review_reports WHERE projectId = 'xxx' ORDER BY chapterNo DESC;
```

#### 重置数据库

```bash
# 删除数据库文件
rm data/app.db

# 重新运行迁移
pnpm db:migrate
```

### 调试 LLM 调用

#### 查看请求日志

在 `src/server/llm.ts` 中启用详细日志：

```typescript
console.log('[LLM Request]', {
  model,
  temperature,
  maxTokens,
  promptLength: messages.length,
});
```

#### 模拟 LLM 响应

项目没有全局的 mock 开关。单元测试通过依赖注入伪造 LLM 调用（参考 `src/server/*.test.ts` 中向被测模块传入假 client/fetch 的写法），本地手工调试请配置一个指向本地或低成本 relay 的 LLM Profile。

## 常见问题

### 1. 数据库锁定错误

**症状**：`SQLITE_BUSY: database is locked`

**原因**：多个进程同时访问数据库

**解决方案**：

```typescript
// 在 src/server/db/init.ts 中增加超时
db.pragma('busy_timeout = 5000');
```

或者确保只有一个 Runner 进程在运行：

```bash
# 查找并终止旧进程
ps aux | grep runner-main
kill <PID>
```

### 2. 端口占用

**症状**：`Error: listen EADDRINUSE: address already in use :::3000`

**解决方案**：

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3000 | xargs kill -9
```

或使用其他端口：

```bash
PORT=3001 pnpm dev
```

### 3. 模型配置错误

**症状**：`Failed to fetch models` 或 `API key invalid`

**检查清单**：

1. 验证 `config/llm-profiles.json` 格式正确
2. 确认 API Key 有效且未过期
3. 测试 baseUrl 可访问：

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://api.openai.com/v1/models
```

4. 检查网络代理设置

### 4. 章节写作卡住

**症状**：进度长时间停留在某个 stage

**诊断步骤**：

1. 查看 Runner 日志（存储在数据库 `run_logs` 表中）：

```bash
sqlite3 data/app.db "SELECT created_at, level, message FROM run_logs WHERE project_id = '{projectId}' ORDER BY created_at DESC LIMIT 50;"
```

2. 检查心跳状态：

```bash
curl http://localhost:3000/api/projects/{projectId}/run/progress
```

3. 如果 `staleHeartbeat: true`，说明 Runner 进程已挂起，需要重启：

```bash
pnpm runner:dev
```

### 5. 前端组件不更新

**症状**：修改代码后页面不刷新

**解决方案**：

1. 清除 Next.js 缓存：

```bash
rm -rf .next
pnpm dev
```

2. 清除浏览器缓存（Ctrl+Shift+R）

3. 检查是否有 TypeScript 错误：

```bash
pnpm typecheck
```

### 6. 样式不生效

**症状**：Tailwind 类名不生效

**解决方案**：

1. 项目使用 Tailwind 4 CSS-first 配置，没有 `tailwind.config.js`；主题与自定义变量在 `src/app/globals.css` 的 `@import "tailwindcss"` 与 `@theme` 块中，确认相关定义存在
2. 重启开发服务器
3. 检查是否使用了动态类名（Tailwind 不支持）：

```typescript
// ❌ 错误
<div className={`text-${color}-500`} />

// ✅ 正确
<div className={color === 'red' ? 'text-red-500' : 'text-blue-500'} />
```

### 7. 文件读取权限错误

**症状**：`EACCES: permission denied`

**解决方案**：

1. 检查文件路径是否在 `projects/<projectId>/` 内（`GET /api/files/read` 仅允许读取项目目录）
2. 确认文件存在且可读：

```bash
ls -la projects/{projectId}/
```

3. 修复文件权限：

```bash
chmod -R 755 projects/
```

## 贡献指南

### 代码规范

#### TypeScript

- 使用严格模式（`strict: true`）
- 避免使用 `any`，优先使用 `unknown`
- 为公共 API 添加 JSDoc 注释

```typescript
/**
 * 生成章节蓝图
 * @param projectId - 项目 ID
 * @param chapterNo - 章节编号
 * @returns 蓝图对象
 */
export async function generateBlueprint(
  projectId: string,
  chapterNo: number
): Promise<ChapterBlueprint> {
  // ...
}
```

#### React 组件

- 使用函数组件和 Hooks
- 组件文件名使用 kebab-case：`chapter-workshop-client.tsx`
- 导出组件使用 PascalCase：`export function ChapterWorkshopClient`

```typescript
"use client";

import { useState } from "react";

export function MyComponent({ prop1, prop2 }: MyComponentProps) {
  const [state, setState] = useState(initialValue);

  return <div>{/* ... */}</div>;
}
```

#### 样式

- 优先使用 Tailwind 工具类
- 复杂样式使用 CSS 变量：

```css
:root {
  --ink-primary: #1a1a1a;
  --ink-soft: #666666;
  --surface-base: #ffffff;
}
```

### 提交信息格式

使用 Conventional Commits 规范：

```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型（type）**：

- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具链更新

**示例**：

```
feat(foundation): 添加文风参考搜索功能

- 实现 style-search API 端点
- 添加前端搜索组件
- 支持网络和 AI 候选源

Closes #123
```

### Pull Request 流程

1. Fork 仓库并创建功能分支：

```bash
git checkout -b feat/my-feature
```

2. 编写代码并添加测试
3. 确保所有测试通过：

```bash
pnpm test
pnpm test:ui
pnpm typecheck
pnpm lint
```

4. 提交代码并推送到 fork：

```bash
git add .
git commit -m "feat: add my feature"
git push origin feat/my-feature
```

5. 创建 Pull Request，描述清楚：
   - 改动内容
   - 测试方法
   - 相关 issue

### 代码审查标准

- 代码符合项目规范
- 有充分的单元测试覆盖
- 复杂逻辑有注释说明
- API 变更有文档更新
- 无明显性能问题

## 测试指南

### 单元测试

使用 Node.js 内置测试框架：

```bash
pnpm test
```

编写测试：

```typescript
import { test } from 'node:test';
import assert from 'node:assert';

test('should generate blueprint', async () => {
  const blueprint = await generateBlueprint('project-id', 1);
  assert.ok(blueprint.sceneGoal);
  assert.ok(blueprint.characters.length > 0);
});
```

### UI 组件测试

使用 Vitest + Testing Library：

```bash
pnpm test:ui
```

编写测试：

```typescript
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { MyComponent } from './my-component';

test('renders component', () => {
  render(<MyComponent prop="value" />);
  expect(screen.getByText('Expected Text')).toBeInTheDocument();
});
```

### E2E 测试

使用 Playwright：

```bash
# 运行所有 E2E 测试
pnpm test:e2e

# 运行特定测试
pnpm test:e2e e2e/01-project-creation-flow.spec.ts

# 使用 UI 模式
pnpm test:e2e:ui
```

编写测试：

```typescript
import { test, expect } from '@playwright/test';

test('should create project', async ({ page }) => {
  await page.goto('/');
  await page.click('text=创建项目');
  await page.fill('input[name="title"]', 'Test Project');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/projects\/[a-zA-Z0-9_-]+/);
});
```

### Storybook

查看组件文档和交互式示例：

```bash
pnpm storybook
```

访问 `http://localhost:6006`

### 测试覆盖率

```bash
# 生成覆盖率报告
pnpm test:coverage

# 查看报告
open coverage/index.html
```

### 性能测试

使用 Lighthouse 审计：

```bash
# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start

# 在 Chrome DevTools 中运行 Lighthouse
```

## 架构决策

### 为什么使用 SQLite？

- 本地优先，无需额外数据库服务
- 支持 FTS5 全文搜索
- 事务支持良好
- 文件级备份简单

### 为什么使用独立 Runner 进程？

- 避免阻塞主进程
- 支持长时间运行任务
- 进程隔离，崩溃不影响主应用
- 便于资源管理和监控

### 为什么使用文件存储章节？

- 便于版本控制（Git）
- 支持外部编辑器
- 降低数据库压力
- 便于导出和归档

## 性能优化建议

### 数据库优化

1. 为常用查询添加索引：

```sql
CREATE INDEX idx_chapter_versions_project_chapter 
ON chapter_versions(projectId, chapterNo);
```

2. 使用事务批量操作：

```typescript
db.transaction(() => {
  for (const item of items) {
    db.insert(table).values(item).run();
  }
});
```

3. 定期清理旧数据：

```sql
DELETE FROM run_logs WHERE createdAt < datetime('now', '-30 days');
```

### 前端优化

1. 使用 React.memo 避免不必要的重渲染：

```typescript
export const MyComponent = React.memo(({ prop }) => {
  // ...
});
```

2. 使用 useMemo 缓存计算结果：

```typescript
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(input);
}, [input]);
```

3. 使用 React Query 的 staleTime 减少请求：

```typescript
useQuery({
  queryKey: ['project', projectId],
  queryFn: () => fetchProject(projectId),
  staleTime: 5 * 60 * 1000, // 5 分钟
});
```

### LLM 调用优化

1. 使用 Prompt 缓存（如果 API 支持）
2. 批量处理多个请求
3. 设置合理的超时和重试策略

## 安全注意事项

### API Key 管理

- 永远不要提交 API Key 到版本控制
- 使用环境变量或配置文件（加入 .gitignore）
- 定期轮换 API Key

### 文件访问控制

- 严格限制可读取的文件路径
- 验证用户输入，防止路径遍历攻击
- 使用白名单而非黑名单

### 数据验证

- 使用 Zod 验证所有外部输入
- 对 LLM 输出进行结构化验证
- 防止 SQL 注入（使用参数化查询）

## 部署指南

### 构建生产版本

```bash
pnpm build
```

### 启动生产服务器

```bash
pnpm start
```

### 环境变量

创建 `.env.local` 文件：

```env
NODE_ENV=production
PORT=3000
DATABASE_PATH=./data/app.db
```

### Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]
```

## 故障排查

### 日志位置

- 应用日志：`data/app.db` (run_logs 表)
- Runner 日志：控制台输出
- Next.js 日志：`.next/` 目录

### 健康检查

```bash
# 检查主应用
curl http://localhost:3000/api/projects

# 检查 Runner 状态
curl http://localhost:3000/api/projects/{projectId}/run/progress
```

### 备份与恢复

```bash
# 备份数据库
cp data/app.db data/app.db.backup

# 备份项目文件
tar -czf projects-backup.tar.gz projects/

# 恢复
cp data/app.db.backup data/app.db
tar -xzf projects-backup.tar.gz
```

## 联系方式

- 问题反馈：GitHub Issues
- 功能建议：GitHub Discussions
- 安全问题：security@example.com

## 许可证

本项目采用 MIT 许可证。
