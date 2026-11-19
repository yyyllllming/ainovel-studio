import "./server-only.ts";

import { resetProjectToFoundationWorkshop } from "./services/foundation-reset.service.ts";
import { projectIdSchema } from "./validation.ts";

export interface FoundationResetRouteDependencies {
  foundationResetService: Pick<typeof import("./services/foundation-reset.service.ts"), "resetProjectToFoundationWorkshop">;
}

const defaultDependencies: FoundationResetRouteDependencies = {
  foundationResetService: {
    resetProjectToFoundationWorkshop,
  },
};

export async function resolveFoundationResetRequest(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
  deps: FoundationResetRouteDependencies = defaultDependencies,
) {
  const { projectId } = await context.params;
  projectIdSchema.parse(projectId);
  return deps.foundationResetService.resetProjectToFoundationWorkshop(projectId);
}
