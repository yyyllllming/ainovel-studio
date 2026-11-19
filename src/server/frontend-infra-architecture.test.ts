import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("route and global error boundaries are present", async () => {
  await Promise.all([
    access(resolve(platformRoot, "src/app/error.tsx")),
    access(resolve(platformRoot, "src/app/global-error.tsx")),
  ]);
});

test("error boundaries expose retry affordances and development stack details", async () => {
  for (const relativePath of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
    const source = await readFile(resolve(platformRoot, relativePath), "utf8");
    assert.ok(source.includes("reset"), `${relativePath} should use reset() for retry`);
    assert.ok(source.includes("重新"), `${relativePath} should show a retry affordance`);
    assert.ok(
      source.includes("NODE_ENV") && source.includes("stack"),
      `${relativePath} should reveal stack details in development`,
    );
  }
});

test("react query provider installs global query and mutation error handlers", async () => {
  const source = await readFile(resolve(platformRoot, "src/app/providers.tsx"), "utf8");
  assert.ok(
    source.includes("QueryCache") || source.includes("MutationCache"),
    "providers.tsx should configure global query caches for error handling",
  );
  assert.ok(source.includes("toast(") || source.includes("notifyQueryError"), "providers.tsx should surface query errors via toast");
});
