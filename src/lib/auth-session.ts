const encoder = new TextEncoder();

export const SESSION_COOKIE = "ainovel_session";
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

export type SessionPayload = {
  i: number;
  u: string;
  r: number;
  e: number;
};

function b64urlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((value.length * 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256(secret: string, data: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return b64urlEncode(new Uint8Array(signature));
}

export async function signSession(payload: Omit<SessionPayload, "e">, now = Date.now()) {
  const secret = process.env.AINOVEL_AUTH_SECRET?.trim() ?? "";
  if (!secret) throw new Error("AINOVEL_AUTH_SECRET is not set");
  const body: SessionPayload = {
    ...payload,
    e: Math.floor(now / 1000) + SESSION_TTL_SEC,
  };
  const packed = b64urlEncode(encoder.encode(JSON.stringify(body)));
  return `${packed}.${await hmacSha256(secret, packed)}`;
}

export async function verifySession(token: string | undefined | null, now = Date.now()): Promise<SessionPayload | null> {
  if (!token) return null;
  const secret = process.env.AINOVEL_AUTH_SECRET?.trim() ?? "";
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [packed, signature] = parts;
  if (!packed || !signature) return null;
  const expected = await hmacSha256(secret, packed);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(b64urlDecode(packed))) as SessionPayload;
    if (!body.u || typeof body.e !== "number" || body.e * 1000 <= now) return null;
    return body;
  } catch {
    return null;
  }
}

export function parseAllowlist(raw = process.env.AINOVEL_AUTH_ALLOW ?? "*") {
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function isUserAllowed(username: string, role: number, raw?: string) {
  const rules = parseAllowlist(raw);
  if (rules.length === 0 || rules.includes("*")) return true;
  const name = username.trim().toLowerCase();
  if (rules.includes(name)) return true;
  if (rules.includes("@admin") && role >= 10) return true;
  return false;
}

export function safeNextPath(raw: string | null | undefined) {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return "/";
  return raw;
}
