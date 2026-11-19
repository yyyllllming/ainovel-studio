# TASK-004: 加 Origin 校验 + CSRF 防护

## 优先级：P0 安全

## 目标
为所有写接口（POST/PUT/PATCH/DELETE）加上 Origin/Host 校验，防止跨站请求。本地单机应用不需要完整用户系统，但需要防止浏览器被恶意页面利用。

## 涉及文件

| 文件 | 操作 |
|---|---|
| `platform/src/server/security/origin-guard.ts` | 新建 |
| `platform/src/app/api/**/route.ts`（所有写接口） | 在函数入口调用 guard |
| `platform/src/server/http.ts` | 新增 `withOriginGuard` 包装函数 |

## 具体操作

### 1. 新建 `platform/src/server/security/origin-guard.ts`

```typescript
import "./server-only.ts";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

// 允许通过环境变量扩展
const extraOrigins = process.env.AINOVEL_ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? [];
for (const origin of extraOrigins) {
  ALLOWED_ORIGINS.add(origin.trim());
}

export function checkOrigin(request: Request): { ok: true } | { ok: false; reason: string } {
  const method = request.method.toUpperCase();

  // GET/HEAD/OPTIONS 不校验
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { ok: true };
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  // 如果有 Origin header，必须在白名单中
  if (origin) {
    if (ALLOWED_ORIGINS.has(origin)) {
      return { ok: true };
    }
    return { ok: false, reason: `Origin ${origin} 不在允许列表中` };
  }

  // 没有 Origin 的情况：
  // - 同源 fetch 有时不带 Origin（但通常带）
  // - curl/Postman 通常不带 Origin
  // 本地工具场景：允许无 Origin 的请求，但要求 Host 匹配
  if (host && (host.startsWith("localhost:") || host.startsWith("127.0.0.1:"))) {
    return { ok: true };
  }

  return { ok: false, reason: "缺少有效的 Origin 或 Host 头" };
}
```

### 2. 修改 `platform/src/server/http.ts`

新增辅助函数：

```typescript
import { checkOrigin } from "./security/origin-guard";

export function guardOrigin(request: Request): Response | null {
  const result = checkOrigin(request);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, code: "ORIGIN_REJECTED" },
      { status: 403 },
    );
  }
  return null;
}
```

### 3. 在所有写接口入口添加 guard

对每个 POST/PUT/PATCH/DELETE handler，在函数第一行加：

```typescript
import { guardOrigin } from "@/server/http";

export async function POST(request: Request, ...) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  // ...原有逻辑
}
```

需要修改的文件清单（所有含 POST/PUT/PATCH/DELETE 的 route.ts）：

- `api/settings/llm-profiles/save/route.ts`
- `api/settings/llm-profiles/test/route.ts`
- `api/settings/llm-profiles/fetch-models/route.ts`
- `api/ideas/route.ts`（POST）
- `api/ideas/[ideaId]/route.ts`（PUT）
- `api/ideas/[ideaId]/workshop/route.ts`（POST）
- `api/ideas/[ideaId]/projects/route.ts`（POST）
- `api/projects/route.ts`（POST）
- `api/projects/[projectId]/route.ts`（PUT）
- `api/projects/[projectId]/assignments/route.ts`（PUT）
- `api/projects/[projectId]/trash/route.ts`（POST）
- `api/projects/[projectId]/restore/route.ts`（POST）
- `api/projects/[projectId]/purge/route.ts`（POST）
- `api/projects/[projectId]/steering-notes/route.ts`（POST）
- `api/projects/[projectId]/foundation/generate/route.ts`
- `api/projects/[projectId]/foundation/lock/route.ts`
- `api/projects/[projectId]/foundation/workshop/route.ts`（POST）
- `api/projects/[projectId]/foundation/workshop/style-steering/route.ts`（PUT）
- `api/projects/[projectId]/foundation/style-imports/route.ts`（POST）
- `api/projects/[projectId]/foundation/style-snapshots/route.ts`（POST）
- `api/projects/[projectId]/foundation/style-snapshots/[snapshotId]/apply/route.ts`
- `api/projects/[projectId]/foundation/author-cards/route.ts`（POST）
- `api/projects/[projectId]/blueprints/generate/route.ts`
- `api/projects/[projectId]/blueprints/[chapterNo]/route.ts`（PUT）
- `api/projects/[projectId]/cards/route.ts`（POST）
- `api/projects/[projectId]/cards/[cardId]/route.ts`（PATCH/DELETE）
- `api/projects/[projectId]/cards/[cardId]/confirm/route.ts`
- `api/projects/[projectId]/cards/[cardId]/workshop/route.ts`
- `api/projects/[projectId]/chapters/delete-range/route.ts`
- `api/projects/[projectId]/chapters/[chapterNo]/manual-review/route.ts`
- `api/projects/[projectId]/chapters/[chapterNo]/generate-versions/route.ts`
- `api/projects/[projectId]/chapters/[chapterNo]/optimize/route.ts`
- `api/projects/[projectId]/chapters/[chapterNo]/apply-patch/route.ts`
- `api/projects/[projectId]/chapters/[chapterNo]/rollback/route.ts`
- `api/projects/[projectId]/run/start/route.ts`
- `api/projects/[projectId]/run/pause/route.ts`
- `api/projects/[projectId]/run/resume/route.ts`
- `api/projects/[projectId]/run/stop/route.ts`（如果存在）

## 验证方式

```bash
# 1. 正常同源请求（应通过）
curl -X POST http://localhost:3000/api/projects \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期：正常的业务错误（400 缺字段），不是 403

# 2. 跨站 Origin（应拒绝）
curl -X POST http://localhost:3000/api/projects \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期：403 ORIGIN_REJECTED

# 3. 无 Origin 但 Host 是 localhost（应通过，兼容 curl/脚本）
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{}'
# 预期：正常的业务错误

# 4. GET 请求不受影响
curl http://localhost:3000/api/projects
# 预期：正常响应

# 5. 前端正常使用不受影响（React Query 发出的请求自带同源 Origin）
```

## 不允许

- 对 GET 请求做 Origin 校验（会破坏浏览器直接访问）
- 硬编码端口导致换端口后全部失效（用环境变量兜底）
- 在 middleware.ts 全局拦截（当前项目可能没有 middleware，不要引入全局中间件）

## 对前端的影响

无。浏览器 fetch 同源请求自动带 Origin header，React Query 正常工作。

## 回滚方案

删除 `origin-guard.ts`，从 `http.ts` 移除 `guardOrigin`，从各 route 移除调用。
