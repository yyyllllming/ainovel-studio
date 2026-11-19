import test from "node:test";
import assert from "node:assert/strict";
import { getFoundationWorkshopDraftStorageKey } from "../lib/foundation-workshop-draft.ts";

test("getFoundationWorkshopDraftStorageKey scopes unsent drafts by project id", () => {
  assert.equal(
    getFoundationWorkshopDraftStorageKey("project-1"),
    "ainovel.foundation-workshop.draft:project-1",
  );
  assert.notEqual(
    getFoundationWorkshopDraftStorageKey("project-1"),
    getFoundationWorkshopDraftStorageKey("project-2"),
  );
});
