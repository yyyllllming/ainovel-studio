import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { middleware } from "../middleware.ts";
function createRequest(url: string, init?: { method?: string; headers?: Record<string, string> }) {
  return new NextRequest(url, init);
}
test("middleware passes through read requests regardless of origin", async () => {
  const response = await middleware(
    createRequest("http://localhost:3000/api/projects", {
      headers: { origin: "https://evil.example" },
    }),
  );
  assert.equal(response.status, 200);
});
test("middleware allows origin-less write requests (runner/reconciler/curl)", async () => {
  const response = await middleware(
    createRequest("http://localhost:3000/api/projects/p1/purge", { method: "POST" }),
  );
  assert.equal(response.status, 200);
});
test("middleware allows local-origin write requests", async () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
    const response = await middleware(
      createRequest("http://localhost:3000/api/projects/p1/trash", {
        method: "POST",
        headers: { origin },
      }),
    );
    assert.equal(response.status, 200, origin);
  }
});
test("middleware rejects cross-site write requests with non-local origins", async () => {
  for (const origin of ["https://evil.example", "http://192.168.1.5:3000", "null"]) {
    const response = await middleware(
      createRequest("http://localhost:3000/api/projects/p1/purge", {
        method: "POST",
        headers: { origin },
      }),
    );
    assert.equal(response.status, 403, origin);
    const body = await response.json() as { code?: string };
    assert.equal(body.code, "LOCAL_ORIGIN_REQUIRED");
  }
});
test("middleware rejects non-local DELETE/PATCH origins as well", async () => {
  for (const method of ["DELETE", "PATCH", "PUT"]) {
    const response = await middleware(
      createRequest("http://localhost:3000/api/projects/p1/chapters/delete-range", {
        method,
        headers: { origin: "https://attacker.test" },
      }),
    );
    assert.equal(response.status, 403, method);
  }
});
test("middleware allows public host when AUTH_SECRET is unset", async () => {
  const prev = process.env.AINOVEL_AUTH_SECRET;
  delete process.env.AINOVEL_AUTH_SECRET;
  try {
    const response = await middleware(
      createRequest("https://novel.example/api/projects"),
    );
    assert.equal(response.status, 200);
  } finally {
    if (prev === undefined) delete process.env.AINOVEL_AUTH_SECRET;
    else process.env.AINOVEL_AUTH_SECRET = prev;
  }
});
test("middleware requires session on public host when AUTH_SECRET is set", async () => {
  const prev = process.env.AINOVEL_AUTH_SECRET;
  process.env.AINOVEL_AUTH_SECRET = "test-secret";
  try {
    const response = await middleware(
      createRequest("https://novel.example/api/projects"),
    );
    assert.equal(response.status, 401);
    const body = await response.json() as { code?: string };
    assert.equal(body.code, "AUTH_REQUIRED");
  } finally {
    if (prev === undefined) delete process.env.AINOVEL_AUTH_SECRET;
    else process.env.AINOVEL_AUTH_SECRET = prev;
  }
});
test("middleware allows auth API without session", async () => {
  const prev = process.env.AINOVEL_AUTH_SECRET;
  process.env.AINOVEL_AUTH_SECRET = "test-secret";
  try {
    const response = await middleware(
      createRequest("https://novel.example/api/auth/login"),
    );
    assert.equal(response.status, 200);
  } finally {
    if (prev === undefined) delete process.env.AINOVEL_AUTH_SECRET;
    else process.env.AINOVEL_AUTH_SECRET = prev;
  }
});
