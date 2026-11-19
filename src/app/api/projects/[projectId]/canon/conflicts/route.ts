import { jsonFromError, jsonOk } from "@/server/http";
import { listCanonConflictsForProject } from "@/server/services/canon.service";
import { projectIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk({ conflicts: listCanonConflictsForProject(projectId) });
  } catch (error) {
    return jsonFromError(error, "读取冲突失败", 500);
  }
}
