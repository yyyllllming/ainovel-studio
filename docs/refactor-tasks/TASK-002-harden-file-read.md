# TASK-002: 收紧 /api/files/read 读取边界

## 优先级：P0 安全

## 目标
- 拒绝路径遍历攻击（`..`、符号链接、绝对路径）
- 限制可读文件的扩展名和大小
- 响应中不暴露服务器真实绝对路径

## 涉及文件

| 文件 | 操作 |
|---|---|
| `platform/src/server/paths.ts` | 加强 `resolveReadablePath()` |
| `platform/src/app/api/files/read/route.ts` | 增加大小限制、扩展名限制、去除绝对路径回显 |
| `platform/src/server/project-files.ts` | `getFileWindow()` 返回相对路径而非绝对路径 |

## 具体操作

### 1. `platform/src/server/paths.ts` — 加强 `resolveReadablePath()`

当前实现（第 97-104 行）已有 allowedRoots 检查，但缺少：

在 `resolveReadablePath` 函数内，`return resolvedPath` 之前新增：

```typescript
export function resolveReadablePath(path: string) {
  // 拒绝绝对路径输入
  if (isAbsolute(path)) {
    throw new Error("不允许使用绝对路径");
  }
  // 拒绝 .. 遍历
  if (path.includes("..")) {
    throw new Error("路径中不允许包含 ..");
  }

  const resolvedPath = resolve(appPaths.root, path);
  const allowedRoots = [appPaths.projectsDir, appPaths.configDir, appPaths.promptsDir, appPaths.stylesDir];
  if (!allowedRoots.some((root) => isWithinRoot(root, resolvedPath))) {
    throw new Error("文件路径不在允许范围内");
  }
  return resolvedPath;
}
```

### 2. `platform/src/app/api/files/read/route.ts` — 增加限制

```typescript
import { getFileWindow } from "@/server/project-files";
import { jsonError, jsonOk } from "@/server/http";
import { z } from "zod";

const ALLOWED_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".yaml", ".yml", ".toml",
]);
const MAX_READ_BYTES = 2 * 1024 * 1024; // 2MB

const fileReadQuerySchema = z.object({
  path: z.string().trim().min(1, "缺少 path"),
  start: z.coerce.number().int().nonnegative().default(0),
  end: z.coerce.number().int().nonnegative().optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = fileReadQuerySchema.parse({
      path: url.searchParams.get("path"),
      start: url.searchParams.get("start") ?? 0,
      end: url.searchParams.get("end") ?? undefined,
    });
    if (query.end !== undefined && query.end <= query.start) {
      return jsonError("end 必须大于 start");
    }

    // 扩展名白名单
    const ext = "." + (query.path.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return jsonError(`不支持读取 ${ext} 类型的文件`, 403);
    }

    // 读取范围限制
    const maxEnd = query.start + MAX_READ_BYTES;
    const effectiveEnd = query.end ? Math.min(query.end, maxEnd) : maxEnd;

    const result = await getFileWindow(query.path, query.start, effectiveEnd);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "读取文件失败", 400);
  }
}
```

### 3. `platform/src/server/project-files.ts` — 返回相对路径

修改 `getFileWindow()`（第 877-889 行）：

```typescript
export async function getFileWindow(path: string, start = 0, end?: number) {
  const safePath = resolveReadablePath(path);
  const stats = await stat(safePath);
  const content = await readTextFile(safePath);
  const slice = content.slice(start, end ?? content.length);
  return {
    content: slice,
    start,
    end: start + slice.length,
    size: stats.size,
    path: path,  // 返回用户输入的相对路径，不暴露服务器绝对路径
  };
}
```

## 验证方式

```bash
# 1. 正常读取（应成功）
curl "http://localhost:3000/api/files/read?path=prompts/writer.md"
# 预期：返回内容，path 字段为 "prompts/writer.md" 不含绝对路径

# 2. 路径遍历攻击（应拒绝）
curl "http://localhost:3000/api/files/read?path=../package.json"
# 预期：400 错误

# 3. 绝对路径（应拒绝）
curl "http://localhost:3000/api/files/read?path=/etc/passwd"
# 预期：400 错误

# 4. 不允许的扩展名（应拒绝）
curl "http://localhost:3000/api/files/read?path=projects/test/chapters/draft.ts"
# 预期：403 错误

# 5. 运行现有测试
cd platform && npx vitest run
```

## 不允许

- 返回服务器绝对路径
- 允许 `..` 路径遍历
- 允许读取非白名单扩展名的文件
- 允许一次读取超过 2MB
- 允许读取 allowedRoots 之外的文件

## 对前端的影响

- `path` 返回字段从绝对路径变为相对路径。如果前端有依赖绝对路径的地方需要适配。
- 读取大文件可能被截断（2MB 限制），但当前章节文件远小于此。

## 回滚方案

恢复 `resolveReadablePath` 和 `getFileWindow` 的旧实现。但路径遍历是确定性风险，不建议回滚。
