# Codex Prompt — Session A: safeParseJson 全量替换

## 上下文

AINovel Studio（`platform/`）服务端有 37 处裸 `JSON.parse` 调用。这些调用分布在文件读取（canon-files, novel-export, voice-snapshot）、commit manifest 解析、DB JSON 列读取等路径上。如果数据源损坏（文件截断、DB 脏数据），裸 `JSON.parse` 会直接 crash 进程。

LLM 调用路径（`src/server/llm.ts`）的 `JSON.parse` 已有完善的 try/catch + 重试机制，**不要改动**。

## 任务

### 1. 新建 `src/server/utils/safe-json.ts`

```typescript
import { z } from "zod";

/** 安全 JSON 解析，失败返回 fallback */
export function safeParseJson<T = unknown>(raw: string, fallback: T | null = null): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 安全 JSON 解析 + Zod 校验，失败返回 null */
export function safeParseJsonSchema<T>(raw: string, schema: z.ZodSchema<T>): T | null {
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
```

### 2. 替换文件读取路径的 JSON.parse

逐个文件处理，**只改 JSON.parse 调用方式，不改函数签名和返回类型**。

**`src/server/files/canon-files.ts`**（5 处）：
- JSONL 逐行解析模式（readCanonFacts, readForeshadowEntries）：`.map(line => JSON.parse(line))` → `.map(line => safeParseJson(line)).filter((v): v is X => v !== null)`
- 单文件 JSON 解析（readCharacterSnapshot, readLatestLogicStateSnapshot）：`JSON.parse(await readTextFile(path))` → `safeParseJson<X>(await readTextFile(path))`，上层已有 null 判断

**`src/server/files/novel-export.ts`**（1 处）：
- `readNovelExportRecord`：`JSON.parse(await readFile(metaPath, "utf8"))` → `safeParseJson<NovelExportRecord>(await readFile(metaPath, "utf8"))`

**`src/server/content/project-voice-snapshot.service.ts`**（1 处）：
- `readProjectVoiceSnapshot`：`JSON.parse(await readTextFile(path))` → `safeParseJson<ProjectVoiceSnapshot>(await readTextFile(path))`

**`src/server/commit/chapter-commit.service.ts`**（1 处）：
- `parseManifest`：这是内部数据且损坏应该报错。改为：
  ```typescript
  function parseManifest(manifestJson: string) {
    const result = safeParseJson<CommitStageManifest>(manifestJson);
    if (!result) throw new Error("commit manifest 数据损坏，无法解析");
    return result as CommitStageManifest;
  }
  ```

**`src/server/commit/commit-reconciler.ts`**（1 处）：
- 同上模式

**`src/server/commit/commit-reconciler-main.ts`**（1 处）：
- `JSON.parse(job.payloadJson)` → `safeParseJson<{ projectId: string }>(job.payloadJson)`，解析失败 skip 该 job 并 log warning

### 3. 替换 DB JSON 列读取路径

搜索 `src/server/repositories/` 和 `src/server/services/` 中所有 `JSON.parse` 调用，替换为 `safeParseJson`。这些通常出现在读取 `*_json` 列后的解析。使用合理的 fallback 值：数组列 → `[]`，对象列 → `null`。

### 4. 不要改的文件

- `src/server/llm.ts` — 全部 JSON.parse 已有完善错误处理，保持原样
- 所有 `*.test.ts` 文件 — 测试中的 JSON.parse 不需要安全包装

### 5. 新建测试 `src/server/utils/safe-json.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeParseJson, safeParseJsonSchema } from "./safe-json.ts";
import { z } from "zod";

describe("safeParseJson", () => {
  it("parses valid JSON", () => {
    assert.deepStrictEqual(safeParseJson('{"a":1}'), { a: 1 });
  });
  it("returns null for invalid JSON", () => {
    assert.strictEqual(safeParseJson("not json"), null);
  });
  it("returns fallback for invalid JSON", () => {
    assert.deepStrictEqual(safeParseJson("bad", []), []);
  });
  it("handles empty string", () => {
    assert.strictEqual(safeParseJson(""), null);
  });
});

describe("safeParseJsonSchema", () => {
  const schema = z.object({ x: z.number() });
  it("parses valid JSON matching schema", () => {
    assert.deepStrictEqual(safeParseJsonSchema('{"x":42}', schema), { x: 42 });
  });
  it("returns null for valid JSON not matching schema", () => {
    assert.strictEqual(safeParseJsonSchema('{"x":"bad"}', schema), null);
  });
  it("returns null for invalid JSON", () => {
    assert.strictEqual(safeParseJsonSchema("nope", schema), null);
  });
});
```

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
# 确认：grep -rn "JSON.parse" src/server/ --include="*.ts" | grep -v ".test.ts" | grep -v "llm.ts" 
# 应只剩 llm.ts 中已有防护的调用
```

## 约束

- 不改任何函数的公开签名和返回类型
- 不改 llm.ts
- 不改 test 文件中的 JSON.parse
- 不添加不必要的日志或 console.log
- 不重构无关代码
