import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("drizzle migration entrypoints exist", async () => {
  await Promise.all([
    access(resolve(platformRoot, "drizzle.config.ts")),
    access(resolve(platformRoot, "migrations")),
  ]);
});

test("database init delegates schema management to migrations", async () => {
  const initSource = await readFile(resolve(platformRoot, "src/server/db/init.ts"), "utf8");
  assert.ok(
    !initSource.includes("CREATE TABLE IF NOT EXISTS"),
    "db/init.ts should not embed the full schema once migrations are introduced",
  );
  assert.ok(
    initSource.includes("migrate") || initSource.includes("runMigrations"),
    "db/init.ts should execute migrations during bootstrap",
  );
});
