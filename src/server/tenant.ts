import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SESSION_COOKIE, type SessionPayload } from "../lib/auth-session.ts";

const require = createRequire(
  typeof import.meta.url === "string" && import.meta.url
    ? import.meta.url
    : join(process.cwd(), "package.json"),
);
const tenantAls = new AsyncLocalStorage<string>();

export function tenantIdFromUserId(userId: number) {
  if (!Number.isInteger(userId) || userId < 1) {
    throw new Error("非法中转站用户 id");
  }
  return `u${userId}`;
}

export function sanitizeTenantId(raw: string) {
  const tenantId = raw.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenantId)) {
    throw new Error("非法租户 id");
  }
  return tenantId;
}

export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantAls.run(sanitizeTenantId(tenantId), fn);
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function verifySessionSync(token: string | undefined | null, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const secret = process.env.AINOVEL_AUTH_SECRET?.trim() ?? "";
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [packed, signature] = parts;
  if (!packed || !signature) return null;
  const expected = createHmac("sha256", secret).update(packed).digest("base64url");
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(packed, "base64url").toString("utf8")) as SessionPayload;
    if (!body.u || typeof body.e !== "number" || body.e * 1000 <= now) return null;
    return body;
  } catch {
    return null;
  }
}

function sessionTokenFromNextStore(): string | undefined {
  try {
    const mod = require("next/dist/server/app-render/work-unit-async-storage.external.js") as {
      workUnitAsyncStorage: {
        getStore(): { type?: string; cookies?: { get(name: string): { value: string } | undefined } } | undefined;
      };
    };
    const store = mod.workUnitAsyncStorage.getStore();
    if (store?.type !== "request") return undefined;
    return store.cookies?.get(SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

export function isNextRequestStore() {
  try {
    const mod = require("next/dist/server/app-render/work-unit-async-storage.external.js") as {
      workUnitAsyncStorage: { getStore(): { type?: string } | undefined };
    };
    return mod.workUnitAsyncStorage.getStore()?.type === "request";
  } catch {
    return false;
  }
}

export function resolveTenantId(): string | null {
  const fromEnv = process.env.AINOVEL_TENANT_ID?.trim();
  if (fromEnv) return sanitizeTenantId(fromEnv);
  const fromAls = tenantAls.getStore();
  if (fromAls) return fromAls;
  const session = verifySessionSync(sessionTokenFromNextStore());
  if (session) return tenantIdFromUserId(session.i);
  return null;
}

export function envWithTenant(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.AINOVEL_TENANT_ID?.trim()) return env;
  const tenantId = resolveTenantId();
  if (!tenantId) return env;
  return { ...env, AINOVEL_TENANT_ID: tenantId };
}
