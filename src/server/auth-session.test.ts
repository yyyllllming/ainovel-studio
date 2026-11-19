import test from "node:test";
import assert from "node:assert/strict";
import {
  isUserAllowed,
  safeNextPath,
  signSession,
  verifySession,
} from "../lib/auth-session.ts";

test("allowlist accepts everyone for * or empty", () => {
  assert.equal(isUserAllowed("alice", 1, "*"), true);
  assert.equal(isUserAllowed("alice", 1, ""), true);
});

test("allowlist matches username and @admin role", () => {
  assert.equal(isUserAllowed("Alice", 1, "bob,alice"), true);
  assert.equal(isUserAllowed("carol", 1, "bob,alice"), false);
  assert.equal(isUserAllowed("root", 100, "@admin"), true);
  assert.equal(isUserAllowed("user", 1, "@admin"), false);
});

test("safeNextPath rejects open redirects", () => {
  assert.equal(safeNextPath("/projects/x"), "/projects/x");
  assert.equal(safeNextPath("//evil.test"), "/");
  assert.equal(safeNextPath("https://evil.test"), "/");
  assert.equal(safeNextPath(null), "/");
});

test("session roundtrip and tamper detection", async () => {
  process.env.AINOVEL_AUTH_SECRET = "test-secret-value";
  const token = await signSession({ i: 7, u: "alice", r: 1 }, 1_700_000_000_000);
  const session = await verifySession(token, 1_700_000_000_000);
  assert.deepEqual(session ? { i: session.i, u: session.u, r: session.r } : null, {
    i: 7,
    u: "alice",
    r: 1,
  });
  assert.equal(await verifySession(token.slice(0, -2) + "ab", 1_700_000_000_000), null);
  assert.equal(await verifySession(token, 1_800_000_000_000), null);
});
