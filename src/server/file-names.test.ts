import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeArtifactName } from "./file-names.ts";

test("sanitizeArtifactName strips illegal characters and trims trailing dots", () => {
  assert.equal(sanitizeArtifactName('  反派:觉醒/计划?.json.  '), "反派_觉醒_计划_.json");
});

test("sanitizeArtifactName protects Windows reserved names", () => {
  assert.equal(sanitizeArtifactName("CON"), "_CON");
  assert.equal(sanitizeArtifactName("   ", "character"), "character");
});
