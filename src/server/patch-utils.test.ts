import test from "node:test";
import assert from "node:assert/strict";
import { applyPatchOperations, offsetPatch } from "./patch-utils.ts";

test("offsetPatch rebases local patch coordinates onto the full chapter", () => {
  const patch = offsetPatch(
    {
      summary: "rebase",
      operations: [
        {
          type: "replace",
          range: { start: 1, end: 3 },
          text: "XY",
        },
      ],
    },
    3,
    4,
  );

  assert.deepEqual(patch.operations[0]?.range, { start: 4, end: 6 });
  assert.equal(applyPatchOperations("0123456789", patch.operations), "0123XY6789");
});

test("offsetPatch clamps malformed local ranges before rebasing", () => {
  const patch = offsetPatch(
    {
      summary: "insert",
      operations: [
        {
          type: "insert",
          text: "!",
        },
      ],
    },
    2,
    3,
  );

  assert.deepEqual(patch.operations[0]?.range, { start: 5, end: 5 });
  assert.equal(applyPatchOperations("abcdef", patch.operations), "abcde!f");
});
