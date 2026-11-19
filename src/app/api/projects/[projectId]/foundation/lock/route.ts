import { jsonFromError, jsonOk } from "@/server/http";
import { lockProjectFoundation } from "@/server/services/project.service";
import { projectIdSchema } from "@/server/validation";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk(lockProjectFoundation(projectId));
  } catch (error) {
    return jsonFromError(error, "锁定设定失败", 400);
  }
}
