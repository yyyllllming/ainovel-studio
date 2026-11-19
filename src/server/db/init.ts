import type Database from "better-sqlite3";
import { resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { getGlobalAppRoot } from "../paths.ts";
import { runMigrations } from "./migration-runner.ts";

function migrationsFolder() {
  return resolve(getGlobalAppRoot(), "migrations");
}

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

export function ensureDatabase(db: Database.Database) {
  applyPragmas(db);
  runMigrations(db, readMigrationFiles({ migrationsFolder: migrationsFolder() }));
}
