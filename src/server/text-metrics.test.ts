import test from "node:test";
import assert from "node:assert/strict";
import { countNarrativeUnits, estimateModelTokens } from "./text-metrics.ts";

test("countNarrativeUnits counts Chinese characters as narrative units", () => {
  assert.equal(countNarrativeUnits("山雨欲来"), 4);
  assert.equal(countNarrativeUnits("Hello world 山雨"), 4);
});

test("estimateModelTokens uses a safer mixed Chinese and non-Chinese heuristic", () => {
  assert.equal(estimateModelTokens("abcd"), 1);
  assert.equal(estimateModelTokens("世界观"), 3);
  assert.equal(estimateModelTokens("Hello 世界"), 3);
});
