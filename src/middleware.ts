// 显式带 .js 后缀：next 包没有 exports map，node:test 直接加载本文件时
// 无法解析 "next/server" 裸子路径（Next 构建两种写法均可）。
import { NextResponse, type NextRequest } from "next/server.js";
import { SESSION_COOKIE } from "./lib/auth-session.ts";
// 集中式 CSRF/Origin 防线：覆盖所有改变状态（非 GET/HEAD/OPTIONS）的 /api 请求。
// Runner/Reconciler 等本机 server-to-server 调用与 curl 调试不携带 Origin 头，
// 因此策略是：仅当请求携带 Origin 且不是允许来源时拒绝；浏览器跨站发起的简单
// POST 一定带 Origin，会在这里被挡下。高风险路由内已有的 assertLocalBrowserRequest
// 守卫保持不变，作为更严格的第二道防线。
// 公网 Host 在配置了 AINOVEL_AUTH_SECRET 时要求会话；本机 Host 且无 CF-Ray 时放行，留给 runner / e2e。
const LOCAL_HOSTNAMES: Record<string, true> = {
  localhost: true,
  "127.0.0.1": true,
  "::1": true,
  "[::1]": true,
};
const READ_METHODS: Record<string, true> = {
  GET: true,
  HEAD: true,
  OPTIONS: true,
};
const PUBLIC_PATHS: Record<string, true> = {
  "/api/auth/login": true,
  "/api/auth/logout": true,
  "/api/auth/me": true,
};

function isAllowedOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (LOCAL_HOSTNAMES[host]) return true;
    const raw = process.env.AINOVEL_PUBLIC_ORIGINS ?? "";
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
      if (url.hostname.replace(/^\[|\]$/g, "").toLowerCase() === host) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isPublicPath(pathname: string) {
  return Boolean(PUBLIC_PATHS[pathname]) || pathname.startsWith("/_next/");
}

function isLocalDevRequest(request: NextRequest) {
  if (request.headers.get("cf-ray")) return false;
  const host = request.nextUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return Boolean(LOCAL_HOSTNAMES[host]);
}

export function middleware(request: NextRequest) {
  if (!READ_METHODS[request.method.toUpperCase()]) {
    const origin = request.headers.get("origin")?.trim();
    if (origin && !isAllowedOrigin(origin)) {
      return NextResponse.json(
        {
          error: "仅允许本机或已配置来源的浏览器请求修改 /api 状态",
          code: "LOCAL_ORIGIN_REQUIRED",
        },
        { status: 403 },
      );
    }
  }

  if (!process.env.AINOVEL_AUTH_SECRET?.trim()) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname) || isLocalDevRequest(request)) {
    return NextResponse.next();
  }

  // Edge middleware 拿不到 systemd 里的 AUTH_SECRET，不能在这里 HMAC。
  // 有 cookie 就放行，真伪由 Node 的 verifySessionSync / 租户层校验。
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  return NextResponse.json(
    { error: "请先登录", code: "AUTH_REQUIRED" },
    { status: 401 },
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|taffy-laugh.gif|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
