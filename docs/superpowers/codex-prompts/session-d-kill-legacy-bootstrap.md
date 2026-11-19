# Codex Prompt — Session D: 废弃 legacy-bootstrap.ts

## 上下文

AINovel Studio（`platform/`）的数据库初始化有两套 schema 定义：
1. `src/server/db/legacy-bootstrap.ts`（1044 行）— 原始 SQL `CREATE TABLE IF NOT EXISTS` 语句
2. `src/server/db/schema.ts`（~755 行）— drizzle-orm 的 TypeScript schema 定义

当前 `init.ts` 的逻辑：
- 先检查是否有旧表（hasLegacySchema）
- 如果有旧表但没有 drizzle migrations 表 → 跑 legacy-bootstrap 建表 → 补登记所有迁移
- 最后跑 drizzle migrate

这导致两套定义必须手动保持同步。需要将 legacy-bootstrap 的 SQL 转为 drizzle 迁移，然后删除 legacy-bootstrap。

**关键约束：**
- 已有数据库（已经有全部表）必须无感迁移
- 全新数据库（空文件）必须能正常初始化
- 测试数据库（每个 test worker 独立 DB 文件）必须正常

## 当前 migrations 目录

目前只有一个迁移文件：`migrations/0001_romantic_moonstone.sql`（新增 author_book_cards 和 author_text_imports 表）。

`migrations/meta/_journal.json` 和 `migrations/meta/0001_snapshot.json` 已存在。

## 任务

### 1. 生成基线迁移 `migrations/0000_baseline.sql`

从 `src/server/db/legacy-bootstrap.ts` 中提取**全部** CREATE TABLE 和 CREATE INDEX 语句，生成一个 SQL 文件。

**要求：**
- 每条 CREATE TABLE / CREATE INDEX 使用 `IF NOT EXISTS`（幂等，已有 DB 跳过）
- 保持与 legacy-bootstrap.ts 完全一致的表结构（字段名、类型、默认值、约束）
- 包含所有 CREATE INDEX 语句
- 不包含 PRAGMA 语句（PRAGMA 在 init.ts 中单独处理）
- SQL 注释标注这是从 legacy-bootstrap.ts 自动提取的基线迁移

### 2. 更新 `migrations/meta/_journal.json`

在 entries 数组的**最前面**（0001 之前）插入 0000 的记录：
```json
{
  "idx": 0,
  "version": "7",
  "when": 1743600000000,
  "tag": "0000_baseline",
  "breakpoints": true
}
```

并将 0001 的 idx 改为 1（如果需要）。

### 3. 生成 `migrations/meta/0000_snapshot.json`

这个文件需要包含 0000_baseline.sql 执行后的完整 schema 快照。

**方法：** 
- 可以用 `pnpm drizzle-kit generate` 来帮助生成，但由于 0000 是手写 SQL 而非 drizzle push，直接从现有 schema.ts 中提取对应的 0000 时间点的 schema 快照
- 或者更简单：复制现有 0001_snapshot.json，去掉 0001 新增的 author_book_cards 和 author_text_imports 表

### 4. 修改 `src/server/db/init.ts`

**新逻辑：**
```typescript
import type Database from "better-sqlite3";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { appPaths } from "../paths.ts";

const MIGRATIONS_FOLDER = resolve(appPaths.root, "migrations");
const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";

function applyPragmas(db: Database.Database) {
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  try {
    db.pragma("journal_mode = WAL");
  } catch {
    // Another worker may already be toggling WAL during build-time evaluation.
  }
}

function hasTable(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { present: number } | undefined;
  return Boolean(row?.present);
}

/**
 * 兼容性：已有数据库可能由 legacy-bootstrap 创建了全部表，
 * 但没有 __drizzle_migrations 记录。需要先补登记全部迁移，
 * 这样 drizzle migrate 会跳过已应用的迁移。
 */
function backfillMigrationsIfNeeded(db: Database.Database) {
  // 如果已经有 drizzle 迁移表，说明已经是新流程，不需要补登记
  if (hasTable(db, DRIZZLE_MIGRATIONS_TABLE)) return;
  // 如果连 projects 表都没有，说明是全新数据库，让 drizzle migrate 从头执行
  if (!hasTable(db, "projects")) return;

  // 已有旧表但没有迁移记录 → 补登记所有迁移
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  if (!migrations.length) return;

  db.exec([
    `CREATE TABLE IF NOT EXISTS "${DRIZZLE_MIGRATIONS_TABLE}" (`,
    `id INTEGER PRIMARY KEY AUTOINCREMENT,`,
    `hash text NOT NULL,`,
    `created_at numeric`,
    `)`,
  ].join(" "));

  const insert = db.prepare(
    `INSERT INTO "${DRIZZLE_MIGRATIONS_TABLE}" (hash, created_at)
     SELECT ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM "${DRIZZLE_MIGRATIONS_TABLE}" WHERE hash = ?
     )`,
  );

  for (const m of migrations) {
    insert.run(m.hash, m.folderMillis, m.hash);
  }
}

export function ensureDatabase(db: Database.Database) {
  applyPragmas(db);
  backfillMigrationsIfNeeded(db);
  migrate(drizzle(db), { migrationsFolder: MIGRATIONS_FOLDER });
}
```

**关键点：**
- 不再 import `legacy-bootstrap.ts`
- `backfillMigrationsIfNeeded` 兼容旧 DB：有旧表但没有迁移记录时，补登记全部迁移，然后 `migrate()` 会发现全部已应用，跳过
- 全新 DB：没有任何表，`migrate()` 会从 0000_baseline.sql 开始全部执行

### 5. 删除 `src/server/db/legacy-bootstrap.ts`

确认 init.ts 不再引用后，删除整个文件（1044 行）。

### 6. 更新 `legacy-bootstrap.ts` 的导出名

检查是否有其他文件 import `legacy-bootstrap.ts`（除了 init.ts）。如果有，更新或删除引用。

搜索命令：
```bash
grep -rn "legacy-bootstrap" src/server/ --include="*.ts"
```

## 验证命令

```bash
cd platform

# 1. 测试全新数据库
# 测试 runner 自带独立 DB，会自动跑 init.ts → 0000 + 0001 迁移
pnpm test

# 2. TypeScript 检查
pnpm typecheck

# 3. 构建
pnpm build

# 4. 确认 legacy-bootstrap.ts 已删除
test ! -f src/server/db/legacy-bootstrap.ts && echo "DELETED OK"
```

## 约束

- 0000_baseline.sql 必须 100% 覆盖 legacy-bootstrap.ts 中的表和索引
- 所有 CREATE 语句必须加 IF NOT EXISTS
- 不改 schema.ts
- 不改 client.ts
- 不改任何 test 文件
- 不改任何 repository 文件
