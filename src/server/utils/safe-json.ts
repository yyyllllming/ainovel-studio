import { z } from "zod";

/** 安全 JSON 解析，失败返回 fallback 而不是抛异常。 */
export function safeParseJson<T = unknown>(
  raw: string,
  fallback: T | null = null,
): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 安全 JSON 解析并执行 Zod 校验，失败返回 null。 */
export function safeParseJsonSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
): T | null {
  const parsed = safeParseJson<unknown>(raw);
  if (parsed === null) {
    return null;
  }

  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
