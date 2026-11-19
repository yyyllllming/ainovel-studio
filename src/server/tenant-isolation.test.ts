import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signSession } from "../lib/auth-session.ts";
import { rawDb } from "./db/client.ts";
import { appPaths, ensureBasePaths } from "./paths.ts";
import { envWithTenant, runWithTenant, tenantIdFromUserId, verifySessionSync } from "./tenant.ts";

test("session hmac matches node verifier and maps to tenant id", async () => {
  process.env.AINOVEL_AUTH_SECRET = "tenant-hmac-secret";
  const token = await signSession({ i: 9, u: "bob", r: 1 }, 1_700_000_000_000);
  const session = verifySessionSync(token, 1_700_000_000_000);
  assert.equal(session?.i, 9);
  assert.equal(session?.u, "bob");
  assert.equal(tenantIdFromUserId(9), "u9");
});

test("two tenants get separate sqlite files and do not share rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "ainovel-tenant-"));
  const previousRoot = process.env.AINOVEL_APP_ROOT;
  process.env.AINOVEL_APP_ROOT = dir;
  symlinkSync(join(process.cwd(), "migrations"), join(dir, "migrations"));
  try {
    let firstDb = "";
    runWithTenant("u1", () => {
      ensureBasePaths();
      firstDb = appPaths.dbFile;
      assert.match(firstDb.replaceAll("\\", "/"), /\/tenants\/u1\/data\/app\.db$/);
      rawDb.exec("CREATE TABLE isolation_probe (id integer); INSERT INTO isolation_probe (id) VALUES (1);");
      assert.equal((rawDb.prepare("SELECT count(*) AS n FROM isolation_probe").get() as { n: number }).n, 1);
    });
    runWithTenant("u2", () => {
      ensureBasePaths();
      assert.match(appPaths.dbFile.replaceAll("\\", "/"), /\/tenants\/u2\/data\/app\.db$/);
      assert.notEqual(appPaths.dbFile, firstDb);
      const row = rawDb.prepare("SELECT name FROM sqlite_master WHERE name = 'isolation_probe'").get();
      assert.equal(row, undefined);
    });
    runWithTenant("u1", () => {
      const row = rawDb.prepare("SELECT count(*) AS n FROM isolation_probe").get() as { n: number };
      assert.equal(row.n, 1);
    });
  } finally {
    if (previousRoot === undefined) delete process.env.AINOVEL_APP_ROOT;
    else process.env.AINOVEL_APP_ROOT = previousRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runner env inherits current tenant", () => {
  const env = runWithTenant("u42", () => envWithTenant({ PATH: "/bin" }));
  assert.equal(env.AINOVEL_TENANT_ID, "u42");
});
