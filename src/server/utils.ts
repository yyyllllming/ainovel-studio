import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { countNarrativeUnits } from "./text-metrics.ts";
import { safeParseJson } from "./utils/safe-json.ts";

export function nowIso() {
  return new Date().toISOString();
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function wordCount(input: string) {
  return countNarrativeUnits(input.trim());
}

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

export async function writeTextFile(path: string, content: string) {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

export async function readTextFile(path: string) {
  return readFile(path, "utf8");
}

export function safeJsonParse<T>(input: string, fallback: T): T {
  return safeParseJson(input, fallback) as T;
}

export function unique<T>(input: T[]) {
  return [...new Set(input)];
}

export function extractJsonBlock(input: string) {
  const match = input.match(/```json\s*([\s\S]*?)```/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  const startObject = input.indexOf("{");
  const endObject = input.lastIndexOf("}");
  if (startObject >= 0 && endObject > startObject) {
    return input.slice(startObject, endObject + 1);
  }
  const startArray = input.indexOf("[");
  const endArray = input.lastIndexOf("]");
  if (startArray >= 0 && endArray > startArray) {
    return input.slice(startArray, endArray + 1);
  }
  return input.trim();
}
