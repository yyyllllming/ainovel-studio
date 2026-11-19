import test from "node:test";
import assert from "node:assert/strict";
import { buildFtsMatchQuery } from "./search-query.ts";

test("buildFtsMatchQuery strips boolean operators and quotes each token", () => {
  assert.equal(buildFtsMatchQuery('hero OR villain "twist" NOT memory'), '"hero" OR "villain" OR "twist" OR "memory"');
});

test("buildFtsMatchQuery drops empty tokens after sanitization", () => {
  assert.equal(buildFtsMatchQuery('() [] ""'), "");
});
