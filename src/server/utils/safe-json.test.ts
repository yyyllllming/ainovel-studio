import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

import { safeParseJson, safeParseJsonSchema } from "./safe-json.ts";

describe("safeParseJson", () => {
  it("parses valid JSON", () => {
    assert.deepStrictEqual(safeParseJson("{\"a\":1}"), { a: 1 });
  });

  it("returns null for invalid JSON", () => {
    assert.strictEqual(safeParseJson("not json"), null);
  });

  it("returns fallback for invalid JSON", () => {
    assert.deepStrictEqual(safeParseJson("bad", []), []);
  });

  it("returns fallback for empty input", () => {
    assert.strictEqual(safeParseJson("", "fallback"), "fallback");
  });
});

describe("safeParseJsonSchema", () => {
  const schema = z.object({ x: z.number() });

  it("parses valid JSON matching schema", () => {
    assert.deepStrictEqual(safeParseJsonSchema("{\"x\":42}", schema), { x: 42 });
  });

  it("returns null for schema mismatch", () => {
    assert.strictEqual(safeParseJsonSchema("{\"x\":\"bad\"}", schema), null);
  });

  it("returns null for invalid JSON", () => {
    assert.strictEqual(safeParseJsonSchema("nope", schema), null);
  });
});
