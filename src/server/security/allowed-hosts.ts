const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeHostname(hostname: string) {
  return hostname.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

export function publicHostnames() {
  const raw = process.env.AINOVEL_PUBLIC_ORIGINS ?? "";
  const hosts = new Set<string>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
      if (url.hostname) hosts.add(normalizeHostname(url.hostname));
    } catch {
      // ignore malformed entries
    }
  }
  return hosts;
}

export function isAllowedHostname(hostname: string) {
  const host = normalizeHostname(hostname);
  return LOCAL_HOSTNAMES.has(host) || publicHostnames().has(host);
}

export function isAllowedOrigin(origin: string) {
  try {
    return isAllowedHostname(new URL(origin).hostname);
  } catch {
    return false;
  }
}
