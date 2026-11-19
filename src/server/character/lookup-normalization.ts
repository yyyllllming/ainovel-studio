export function normalizeEntityLookupKey(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[\p{P}\p{S}]+$/gu, "");
}

export function normalizeEntityLookupKeys(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeEntityLookupKey(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}
