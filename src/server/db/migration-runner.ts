import type Database from "better-sqlite3";
import type { MigrationMeta } from "drizzle-orm/migrator";

const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
const MIGRATIONS_TABLE_CREATE_SQL = [
  `CREATE TABLE IF NOT EXISTS "${DRIZZLE_MIGRATIONS_TABLE}" (`,
  `id INTEGER PRIMARY KEY AUTOINCREMENT,`,
  `hash text NOT NULL,`,
  `created_at numeric`,
  `)`,
].join(" ");

function hasTable(db: Database.Database, tableName: string) {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { present: number } | undefined;
  return Boolean(row?.present);
}

function hasColumn(db: Database.Database, tableName: string, columnName: string) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
}

function hasIndex(db: Database.Database, indexName: string) {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'index' AND name = ? LIMIT 1")
    .get(indexName) as { present: number } | undefined;
  return Boolean(row?.present);
}

function markMigrationApplied(db: Database.Database, migration: MigrationMeta) {
  db.prepare(
    `INSERT INTO "${DRIZZLE_MIGRATIONS_TABLE}" (hash, created_at)
      SELECT ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM "${DRIZZLE_MIGRATIONS_TABLE}" WHERE hash = ?
      )`,
  ).run(migration.hash, migration.folderMillis, migration.hash);
}

interface ExpectedSchemaState {
  tables: Set<string>;
  /** index name -> owning table (indexes vanish with their table on DROP TABLE) */
  indexes: Map<string, string>;
  /** `${table}.${column}` entries collected from ALTER TABLE ... ADD */
  columns: Set<string>;
}

const CREATE_TABLE_RE = /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)/i;
const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)/i;
const RENAME_TABLE_RE = /ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+RENAME\s+TO\s+[`"]?([A-Za-z0-9_]+)/i;
const ADD_COLUMN_RE = /ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+ADD\s+(?:COLUMN\s+)?[`"]?([A-Za-z0-9_]+)/i;
const DROP_COLUMN_RE = /ALTER\s+TABLE\s+[`"]?([A-Za-z0-9_]+)[`"]?\s+DROP\s+COLUMN\s+[`"]?([A-Za-z0-9_]+)/i;
const CREATE_INDEX_RE = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s+ON\s+[`"]?([A-Za-z0-9_]+)/i;
const DROP_INDEX_RE = /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)/i;

function applyStatementToExpectedState(state: ExpectedSchemaState, statement: string) {
  const rename = statement.match(RENAME_TABLE_RE);
  if (rename) {
    const [, from, to] = rename;
    if (state.tables.delete(from!)) {
      state.tables.add(to!);
    }
    for (const key of [...state.columns]) {
      if (key.startsWith(`${from}.`)) {
        state.columns.delete(key);
        state.columns.add(`${to}.${key.slice(from!.length + 1)}`);
      }
    }
    for (const [indexName, table] of state.indexes) {
      if (table === from) {
        state.indexes.set(indexName, to!);
      }
    }
    return;
  }

  const dropColumn = statement.match(DROP_COLUMN_RE);
  if (dropColumn) {
    state.columns.delete(`${dropColumn[1]}.${dropColumn[2]}`);
    return;
  }

  const addColumn = statement.match(ADD_COLUMN_RE);
  if (addColumn) {
    state.columns.add(`${addColumn[1]}.${addColumn[2]}`);
    return;
  }

  const dropTable = statement.match(DROP_TABLE_RE);
  if (dropTable) {
    const table = dropTable[1]!;
    state.tables.delete(table);
    for (const key of [...state.columns]) {
      if (key.startsWith(`${table}.`)) {
        state.columns.delete(key);
      }
    }
    for (const [indexName, owner] of [...state.indexes]) {
      if (owner === table) {
        state.indexes.delete(indexName);
      }
    }
    return;
  }

  const createIndex = statement.match(CREATE_INDEX_RE);
  if (createIndex) {
    state.indexes.set(createIndex[1]!, createIndex[2]!);
    return;
  }

  const dropIndex = statement.match(DROP_INDEX_RE);
  if (dropIndex) {
    state.indexes.delete(dropIndex[1]!);
    return;
  }

  const createTable = statement.match(CREATE_TABLE_RE);
  if (createTable) {
    state.tables.add(createTable[1]!);
  }
}

function cloneExpectedState(state: ExpectedSchemaState): ExpectedSchemaState {
  return {
    tables: new Set(state.tables),
    indexes: new Map(state.indexes),
    columns: new Set(state.columns),
  };
}

/** Expected schema state after applying migrations[0..i], for every i. */
function simulateExpectedStates(migrations: MigrationMeta[]) {
  const states: ExpectedSchemaState[] = [];
  const state: ExpectedSchemaState = { tables: new Set(), indexes: new Map(), columns: new Set() };
  for (const migration of migrations) {
    for (const statement of migration.sql) {
      applyStatementToExpectedState(state, statement);
    }
    states.push(cloneExpectedState(state));
  }
  return states;
}

function stateMatchesDatabase(db: Database.Database, state: ExpectedSchemaState) {
  for (const table of state.tables) {
    if (!hasTable(db, table)) {
      return false;
    }
  }
  for (const indexName of state.indexes.keys()) {
    if (!hasIndex(db, indexName)) {
      return false;
    }
  }
  for (const key of state.columns) {
    const dotIndex = key.indexOf(".");
    const table = key.slice(0, dotIndex);
    if (!state.tables.has(table)) {
      continue;
    }
    if (!hasColumn(db, table, key.slice(dotIndex + 1))) {
      return false;
    }
  }
  return true;
}

/**
 * For a database that has real data (projects) but lost its migrations ledger,
 * find the longest migration prefix whose expected tables/columns/indexes all
 * exist. Only that prefix is marked as applied; the remainder is executed for
 * real instead of being silently skipped.
 */
function detectAppliedMigrationPrefix(db: Database.Database, migrations: MigrationMeta[]) {
  const states = simulateExpectedStates(migrations);
  for (let i = migrations.length - 1; i >= 0; i -= 1) {
    if (stateMatchesDatabase(db, states[i]!)) {
      return migrations.slice(0, i + 1);
    }
  }
  return [];
}

function repairKnownPartialMigrations(db: Database.Database, migrations: MigrationMeta[]) {
  for (const migration of migrations) {
    const isHookSlotsMigration = migration.sql.some((stmt) => stmt.includes("ALTER TABLE `hook_plans` ADD `slot_index`"));
    if (isHookSlotsMigration) {
      const hookPlansReady =
        hasColumn(db, "hook_plans", "slot_index")
        && hasColumn(db, "hook_plans", "lifecycle_status")
        && hasColumn(db, "hook_plans", "deferred_until_chapter")
        && hasIndex(db, "hook_plans_project_chapter_slot_idx");
      if (hookPlansReady) {
        markMigrationApplied(db, migration);
      }
      continue;
    }

    const isFoundationSuggestionsMigration =
      migration.sql.length === 1
      && migration.sql[0]?.includes("ALTER TABLE `foundation_workshop_states` ADD `structured_suggestions_json`");
    if (isFoundationSuggestionsMigration) {
      if (hasColumn(db, "foundation_workshop_states", "structured_suggestions_json")) {
        markMigrationApplied(db, migration);
      }
      continue;
    }

    const isChapterPlanHooksMigration =
      migration.sql.length === 1
      && migration.sql[0]?.includes("ALTER TABLE `chapter_plans` ADD `hook_slots_json`");
    if (isChapterPlanHooksMigration && hasColumn(db, "chapter_plans", "hook_slots_json")) {
      markMigrationApplied(db, migration);
    }
  }
}

export function runMigrations(db: Database.Database, migrations: MigrationMeta[]) {
  const hadMigrationsTable = hasTable(db, DRIZZLE_MIGRATIONS_TABLE);
  const hadProjectsTable = hasTable(db, "projects");

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(MIGRATIONS_TABLE_CREATE_SQL);

    if (!hadMigrationsTable && hadProjectsTable && migrations.length) {
      // Do not blindly trust the projects table: probe each migration's
      // representative objects so a database stuck at an older schema is
      // upgraded instead of being marked fully migrated.
      for (const migration of detectAppliedMigrationPrefix(db, migrations)) {
        markMigrationApplied(db, migration);
      }
    } else {
      repairKnownPartialMigrations(db, migrations);
    }

    const lastDbMigration = db
      .prepare(`SELECT id, hash, created_at FROM "${DRIZZLE_MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`)
      .get() as { created_at?: number | string } | undefined;

    for (const migration of migrations) {
      if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
        for (const statement of migration.sql) {
          const trimmed = statement.trim();
          if (!trimmed) {
            continue;
          }
          db.exec(trimmed);
        }
        markMigrationApplied(db, migration);
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failures after a partially opened transaction
    }
    throw error;
  }
}
