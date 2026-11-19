import { unique } from "./utils.ts";

function sanitizeFtsToken(token: string) {
  const normalized = token
    .replace(/["'`]/g, " ")
    .replace(/[(){}\[\]:*^~]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }

  if (/^(AND|OR|NOT|NEAR)$/i.test(normalized)) {
    return "";
  }

  return `"${normalized}"`;
}

export function buildFtsMatchQuery(query: string) {
  return unique(
    query
      .trim()
      .split(/\s+/)
      .map((token) => sanitizeFtsToken(token))
      .filter(Boolean),
  ).join(" OR ");
}
