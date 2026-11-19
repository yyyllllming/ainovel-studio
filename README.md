# AINovel Studio

本地优先的 AI 长篇写作工作台。完整后端在仓库里：项目、设定、蓝图、章节编排、审稿、多版本和后台 Runner / Reconciler。

本仓库不包含前端登录页。本地默认无登录门禁；需要多用户隔离时，自行配置身份源 API。

## 技术栈

- Next.js App Router + TypeScript
- SQLite + Drizzle
- Next.js 主进程 + Runner / Reconciler 后台进程
- 文件驱动的 Prompt / Style / 项目产物 / LLM Profiles
- OpenAI-compatible relay

## 启动

需要 Node.js 22.18+ 和 pnpm。

```bash
pnpm install
cp config/llm-profiles.example.json config/llm-profiles.json
pnpm dev
```

打开 `http://localhost:3000`。

第一次使用：

1. 进入「模型配置」，添加一个 OpenAI-compatible relay。
2. 创建项目。
3. 生成设定并锁定。
4. 生成第一章蓝图，启动写作。
5. 在章节工作台查看蓝图、审稿、多版本、Patch 和回滚。

## 可选身份源

不设 `AINOVEL_AUTH_SECRET` 时，本机和公网都不强制登录。

要启用会话与按用户隔离：

```bash
cp .env.example .env
```

`POST /api/auth/login` 会向 `AINOVEL_IDP_BASE/api/user/login` 校验用户名密码，成功后签发 7 天 HttpOnly 会话，数据落到 `tenants/u{id}`。

身份源响应约定：

```json
{
  "success": true,
  "data": { "id": 1, "username": "alice", "role": 1, "status": 1 }
}
```

没有登录页。需要登录时自己对这个接口发 POST。

## 目录

- `src/server/`：写作编排、上下文、审稿、数据库、Runner
- `src/app/api/`：HTTP 契约
- `prompts/`：Planner / Writer / Reviewer / Editor / Archivist
- `styles/`：风格卡
- `migrations/`：SQLite 迁移
- `config/llm-profiles.json`：本地 Relay 配置（不要提交密钥）
- `data/app.db`、`projects/`：运行期数据，默认 gitignore

## 文档

- `SYSTEM_ARCHITECTURE.md`：结构、关键路径、运行链路
- `API_DOCUMENTATION.md`：后端 API 契约
- `DEVELOPER_GUIDE.md`：调试、常见问题、测试

## 验证

```bash
pnpm typecheck
pnpm test
pnpm test:ui
```

E2E spec 与当前 UI 不完全匹配，默认 skip。

## 许可

MIT
