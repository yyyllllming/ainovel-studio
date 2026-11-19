# TASK-005: 建立 route 层 import 禁令

## 优先级：P0 边界

## 目标
通过 ESLint 规则或自定义脚本，禁止 `app/api/**/route.ts` 直接 import 以下模块：
- `@/server/run-manager`
- `@/server/repository`
- `@/server/project-files`
- `@/server/db/**`

## 涉及文件

| 文件 | 操作 |
|---|---|
| `platform/.eslintrc.*` 或 `platform/eslint.config.*` | 添加 import 限制规则 |
| `platform/scripts/check-route-imports.mjs` | 备选：自定义检查脚本 |
| `platform/package.json` | 添加 lint:routes 命令 |

## 具体操作

### 方案 A：ESLint no-restricted-imports（推荐）

如果项目使用 flat config（`eslint.config.mjs`），添加针对 route 文件的覆盖规则：

```javascript
{
  files: ["src/app/api/**/route.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        { group: ["@/server/run-manager", "@/server/run-manager.*"], message: "route 不允许直接 import run-manager，请通过 application service" },
        { group: ["@/server/repository", "@/server/repository.*"], message: "route 不允许直接 import repository barrel，请通过 application service" },
        { group: ["@/server/project-files", "@/server/project-files.*"], message: "route 不允许直接 import project-files，请通过 application service" },
        { group: ["@/server/db/**"], message: "route 不允许直接 import db 层" },
        { group: ["@/server/repositories/**"], message: "route 不允许直接 import 具体 repository，请通过 application service" },
      ]
    }]
  }
}
```

### 方案 B：自定义脚本（如果 ESLint 配置复杂度太高）

新建 `platform/scripts/check-route-imports.mjs`：

```javascript
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FORBIDDEN = [
  "@/server/run-manager",
  "@/server/repository",
  "@/server/project-files",
  "@/server/db/",
  "@/server/repositories/",
];

const apiDir = join(process.cwd(), "src/app/api");
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (entry === "route.ts") {
      const content = readFileSync(full, "utf8");
      for (const pattern of FORBIDDEN) {
        if (content.includes(pattern)) {
          violations.push({ file: relative(process.cwd(), full), pattern });
        }
      }
    }
  }
}

walk(apiDir);

if (violations.length) {
  console.error("❌ Route import 禁令违规：");
  for (const v of violations) {
    console.error(`  ${v.file} → ${v.pattern}`);
  }
  process.exit(1);
} else {
  console.log("✅ 所有 route 文件符合 import 禁令");
}
```

在 `package.json` 中添加：
```json
"scripts": {
  "lint:routes": "node scripts/check-route-imports.mjs"
}
```

## 当前状态

当前已知违规（来自之前的扫描）：

| route 文件 | 违规 import |
|---|---|
| `blueprints/generate/route.ts` | `@/server/run-manager` |
| `blueprints/[chapterNo]/route.ts` | `@/server/repository` |
| `canon/conflicts/route.ts` | `@/server/repository` |
| `canon/facts/route.ts` | `@/server/project-files` |
| `cards/route.ts` | `@/server/repository` |
| `cards/[cardId]/confirm/route.ts` | `@/server/repository` |
| `cards/[cardId]/progressions/route.ts` | `@/server/repository` |
| `cards/[cardId]/route.ts` | `@/server/repository` |
| `cards/[cardId]/workshop/route.ts` | `@/server/card-workshop` |
| `chapters/delete-range/route.ts` | `@/server/run-manager` |
| `chapters/[chapterNo]/apply-patch/route.ts` | `@/server/run-manager` |
| `chapters/[chapterNo]/generate-versions/route.ts` | `@/server/run-manager` |
| `chapters/[chapterNo]/optimize/route.ts` | `@/server/run-manager` |
| `files/read/route.ts` | `@/server/project-files` |
| `ideas/[ideaId]/workshop/route.ts` | `@/server/idea-workshop` |

## 完成标准

- lint/脚本能检出上述所有违规
- 脚本以非零退出码报错
- `package.json` 有可执行的检查命令
- **当前违规先标记为 known violations（不阻断 CI），后续 TASK-006/007/008 逐步消除**

## 注意

- 这个任务只是建立检查机制，不修复违规
- 违规修复在 TASK-006、TASK-007 中完成
- 检查脚本应支持 `--known-violations` 参数或白名单文件，避免在修复完成前阻断所有开发
