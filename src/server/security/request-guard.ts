import { AppError } from "../errors.ts";
import { isAllowedHostname } from "./allowed-hosts.ts";

const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);

function forbidden(message: string, details?: unknown) {
  return new AppError(message, {
    status: 403,
    code: "LOCAL_BROWSER_REQUEST_REQUIRED",
    details,
  });
}

function getRequestHost(request: Request) {
  const rawHost = request.headers.get("host")?.trim() || new URL(request.url).host;
  if (!rawHost) {
    throw forbidden("缺少 Host，无法校验本地请求来源");
  }

  return new URL(`http://${rawHost}`);
}

function assertAllowedHostname(hostname: string, source: string) {
  if (!isAllowedHostname(hostname)) {
    throw forbidden(`仅允许本地或已配置来源的浏览器请求访问高风险接口（${source}=${hostname}）`);
  }
}

function parseOriginHeader(origin: string) {
  try {
    return new URL(origin);
  } catch {
    throw forbidden("Origin 不合法");
  }
}

// Stopgap only: this is a local-browser same-origin guard until a real auth/session
// layer exists. It intentionally blocks anonymous utility-style access to sensitive
// routes instead of pretending to be full authentication.
export function assertLocalBrowserRequest(request: Request) {
  const requestHostUrl = getRequestHost(request);
  assertAllowedHostname(requestHostUrl.hostname, "host");

  const origin = request.headers.get("origin")?.trim();
  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  const isWriteRequest = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());

  if (!origin && !secFetchSite) {
    throw forbidden("缺少浏览器同源校验头");
  }

  if (secFetchSite && !ALLOWED_FETCH_SITES.has(secFetchSite)) {
    throw forbidden("仅允许同源浏览器请求访问高风险接口");
  }

  if (isWriteRequest && !origin) {
    throw forbidden("写请求必须携带同源 Origin");
  }

  if (origin) {
    const originUrl = parseOriginHeader(origin);
    assertAllowedHostname(originUrl.hostname, "origin");

    if (originUrl.host !== requestHostUrl.host) {
      throw forbidden("Origin 与 Host 不匹配");
    }
  }
}
