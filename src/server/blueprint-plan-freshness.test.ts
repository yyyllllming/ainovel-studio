import test from "node:test";
import assert from "node:assert/strict";

import { isBlueprintFreshForPlan } from "./services/blueprint-generate.service.ts";

test("isBlueprintFreshForPlan only reuses blueprints from the same ChapterPlan generation", () => {
  assert.equal(
    isBlueprintFreshForPlan(
      {
        sourcePlanGenerationId: 4,
      },
      { generationId: 4 } as { generationId: number },
    ),
    true,
  );

  assert.equal(
    isBlueprintFreshForPlan(
      {
        sourcePlanGenerationId: 3,
      },
      { generationId: 4 } as { generationId: number },
    ),
    false,
  );

  assert.equal(
    isBlueprintFreshForPlan(
      {
      },
      { generationId: 4 } as { generationId: number },
    ),
    false,
  );
});
