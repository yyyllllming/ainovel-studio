# Codex Prompt — Session B: DB/文件系统写一致性

## 上下文

AINovel Studio（`platform/`）有多处"写文件 + 写 DB"的关键路径。当前这些操作没有一致性保证：DB 成功但文件失败（或反过来）会导致脏数据。需要引入简单的补偿模式。

SQLite 使用 better-sqlite3（同步），文件操作使用 Node.js fs（异步）。事务嵌套通过 `rawDb.transaction(() => { ... })` 实现。

## 任务

### 1. 新建 `src/server/utils/safe-write.ts`

```typescript
import { unlink } from "node:fs/promises";

/**
 * 先写文件，再执行 DB 操作。
 * 如果 DB 操作失败，自动清理已写的文件（补偿）。
 * 如果文件写入失败，直接 throw，不碰 DB。
 *
 * @param fileOps - 执行文件写入操作，返回已写文件的绝对路径列表
 * @param dbOp - 执行 DB 写入操作
 */
export async function writeFileThenDb(
  fileOps: () => Promise<string[]>,
  dbOp: () => void,
): Promise<void> {
  const writtenFiles: string[] = [];
  try {
    const paths = await fileOps();
    writtenFiles.push(...paths);
  } catch (error) {
    throw error; // 文件写入失败，直接抛出，不碰 DB
  }

  try {
    dbOp();
  } catch (error) {
    // DB 失败，补偿删除已写文件
    await Promise.allSettled(
      writtenFiles.map((filePath) => unlink(filePath).catch(() => {})),
    );
    throw error;
  }
}

/**
 * 先执行 DB 操作，再写文件。
 * 如果文件写入失败，此函数不回滚 DB（因为 better-sqlite3 是同步的，
 * transaction 已经 commit 了）。调用方应在此情况下记录告警。
 *
 * 适用于 DB 是主数据源、文件是辅助镜像的场景。
 */
export async function writeDbThenFile(
  dbOp: () => void,
  fileOps: () => Promise<void>,
  onFileError?: (error: unknown) => void,
): Promise<void> {
  dbOp();
  try {
    await fileOps();
  } catch (error) {
    if (onFileError) {
      onFileError(error);
    } else {
      throw error;
    }
  }
}
```

### 2. 加固 author-card 导入路径

**修改文件：** `src/server/services/author-card.service.ts`

找到 `importTextToAuthorCard` 函数。当前逻辑是：
1. 写入文件到 `library/author-cards/{authorCardId}/imports/{importId}.txt`
2. 写入 DB `author_text_imports` 表

改为用 `writeFileThenDb` 包装：
```typescript
await writeFileThenDb(
  async () => {
    await writeFile(importFilePath, cleanedContent);
    return [importFilePath];
  },
  () => {
    saveTextImport(record);
  },
);
```

### 3. 加固 author-card mirror 写入

**修改文件：** `src/server/services/author-card.service.ts`

找到调用 `writeAuthorCardMirror` 的地方。这些是"DB 已写入，文件做镜像"的模式。
用 `writeDbThenFile` 包装，`onFileError` 记录 warning 但不阻塞（因为 mirror 是辅助文件，丢失不影响核心数据）。

### 4. 加固 commit stage 路径

**修改文件：** `src/server/commit/chapter-commit.service.ts`

找到 `commitChapter` 函数的核心写入段。当前逻辑：
1. 写文件（writeCommitStage、writeVersionFile 等）
2. DB transaction 写入 chapterVersions + reviewReports

改为：先写文件，收集路径列表；然后在 `writeFileThenDb` 中执行 DB 操作。

### 5. 不要改的地方

- `src/server/project-files.ts` 中的底层写入函数本身不改（它们只负责单一职责的文件写入）
- runner 中的 checkpoint / heartbeat 写入不改（这些写入本身就是幂等的，丢失一次不影响正确性）
- `writeFoundationFiles` 调用点太多且逻辑复杂，此轮不改（标注 TODO 即可）

### 6. 测试

不需要新建专门的测试文件。现有的 `author-card-library.test.ts` 和 `apply-stored-patch.service.test.ts` 覆盖了相关路径，确保它们通过即可。

## 验证命令

```bash
cd platform
pnpm typecheck
pnpm test
pnpm build
```

## 约束

- 不改任何函数的公开签名
- 补偿操作用 `Promise.allSettled` 确保不会因清理失败而吞掉原始错误
- 不添加不必要的 console.log
- 不重构无关代码
