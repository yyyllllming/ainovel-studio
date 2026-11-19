import "../server-only.ts";
import Database from "better-sqlite3";
import { threadId } from "node:worker_threads";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { appPaths, ensureBasePaths } from "../paths.ts";
import { resolveTenantId } from "../tenant.ts";
import { ensureDatabase } from "./init.ts";
import * as schema from "./schema.ts";

type Sqlite = Database.Database;
type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const connections = new Map<string, { sqlite: Sqlite; drizzle: DrizzleDb }>();

function resolveDbFile() {
  if (process.env.AINOVEL_DB_FILE?.trim()) {
    return resolve(process.env.AINOVEL_DB_FILE.trim());
  }
  if (!process.env.NODE_TEST_CONTEXT) {
    return appPaths.dbFile;
  }
  // Keep each test worker on its own database file so concurrent `node --test`
  // runs do not contend on the shared application database.
  return resolve(appPaths.dataDir, `app.test.${process.pid}.${threadId}.db`);
}

function connectionKey() {
  return resolveTenantId() ?? process.env.AINOVEL_DB_FILE?.trim() ?? `__default__:${resolveDbFile()}`;
}

function getConnection() {
  const key = connectionKey();
  const existing = connections.get(key);
  if (existing) return existing;
  ensureBasePaths();
  const sqlite = new Database(resolveDbFile(), { timeout: 5000 });
  ensureDatabase(sqlite);
  const conn = { sqlite, drizzle: drizzle(sqlite, { schema }) };
  connections.set(key, conn);
  return conn;
}

function proxyOf<T extends object>(getTarget: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = getTarget();
      const value = Reflect.get(real, prop, real);
      return typeof value === "function" ? value.bind(real) : value;
    },
    set(_target, prop, value) {
      Reflect.set(getTarget(), prop, value);
      return true;
    },
    has(_target, prop) {
      return Reflect.has(getTarget(), prop);
    },
  });
}

export const rawDb = proxyOf(() => getConnection().sqlite);
export const db = proxyOf(() => getConnection().drizzle);
export { schema };
