import type { EditorPatch, PatchOperation } from "./types.ts";
import { clamp } from "./utils.ts";

function normalizeLocalRange(operation: PatchOperation, selectionLength: number) {
  const fallbackStart = operation.type === "insert" ? selectionLength : 0;
  const rawStart = operation.range?.start ?? fallbackStart;
  const rawEnd = operation.range?.end ?? rawStart;
  const start = clamp(rawStart, 0, selectionLength);
  const end = clamp(rawEnd, start, selectionLength);
  return { start, end };
}

export function offsetPatch(patch: EditorPatch, offset: number, selectionLength: number): EditorPatch {
  return {
    ...patch,
    operations: patch.operations.map((operation) => {
      const range = normalizeLocalRange(operation, selectionLength);
      return {
        ...operation,
        range: {
          start: offset + range.start,
          end: offset + range.end,
        },
      };
    }),
  };
}

export function applyPatchOperations(text: string, operations: PatchOperation[]) {
  let output = text;
  const replacers = operations
    .filter((operation) => operation.type !== "insert")
    .sort((left, right) => (right.range?.start ?? 0) - (left.range?.start ?? 0));
  const inserts = operations
    .filter((operation) => operation.type === "insert")
    .sort((left, right) => (right.range?.start ?? output.length) - (left.range?.start ?? output.length));

  for (const operation of replacers) {
    const start = clamp(operation.range?.start ?? 0, 0, output.length);
    const end = clamp(operation.range?.end ?? start, start, output.length);
    if (operation.type === "replace") {
      output = `${output.slice(0, start)}${operation.text ?? ""}${output.slice(end)}`;
    } else if (operation.type === "delete") {
      output = `${output.slice(0, start)}${output.slice(end)}`;
    }
  }

  for (const operation of inserts) {
    const position = clamp(operation.range?.start ?? output.length, 0, output.length);
    output = `${output.slice(0, position)}${operation.text ?? ""}${output.slice(position)}`;
  }

  return output;
}
