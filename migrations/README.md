# migrations

本目录由应用启动时的 `src/server/db/init.ts` 通过 `readMigrationFiles`（drizzle-orm）+
`src/server/db/migration-runner.ts` 执行。**迁移的发现完全依赖 `meta/_journal.json`**：
没有写进 journal 的 SQL 文件不会被执行。

## 手写迁移的规约

历史上 0004-0013 是手写迁移（只写了 `.sql` + journal 条目，没有同步 `meta/NNNN_snapshot.json`），
导致 drizzle 快照链一度停在 0003，`pnpm db:generate` 会基于过期快照产出重复 DDL。
0014 起快照链已按当前 `src/server/db/schema.ts` 重建（`meta/0014_snapshot.json`，其
`prevId` 指向 0003 快照）。**0004-0013 的中间快照缺失属于已知状态，不要试图补写**——
drizzle-kit 只用最新快照做 diff。

新增迁移时二选一：

1. **推荐**：改 `src/server/db/schema.ts` 后运行 `pnpm db:generate`，由 drizzle-kit 同时生成
   `.sql`、journal 条目和新快照。
2. **手写 SQL**：必须同时完成全部三件事，缺一不可：
   - 新建 `NNNN_name.sql`（语句之间用 `--> statement-breakpoint` 分隔）；
   - 在 `meta/_journal.json` 追加 `{ idx, version, when, tag, breakpoints }`，`when` 必须大于
     上一条（migration-runner 按 `when` 判断是否需要执行）；
   - 同步 `schema.ts` 并重建最新快照：用临时 out 目录跑一次 `drizzle-kit generate`，把生成的
     `0000_snapshot.json` 重命名为 `meta/NNNN_snapshot.json`，并把其中的 `prevId` 改为上一个
     存在的快照的 `id`（否则 drizzle-kit 会报快照链冲突）。

## 其他注意事项

- 修改既有表结构请优先用加列/建索引；SQLite 的 `DROP COLUMN` 对带索引/约束引用的列会失败。
- `migration-runner.ts` 对“有 projects 表但缺 `__drizzle_migrations` 账本”的库会按表/列/索引
  探针推断已应用前缀，再执行剩余迁移；新迁移应尽量保证语句幂等（`IF NOT EXISTS`），以便
  部分应用后能安全重放。
