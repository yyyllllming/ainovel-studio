import { jsonFromError, jsonOk } from "@/server/http";
import { restoreProjectFromTrash } from "@/server/services/project.service";
import { projectIdSchema } from "@/server/validation";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const project = restoreProjectFromTrash(projectId);
    return jsonOk({ project });
  } catch (error) {
    return jsonFromError(error, "恢复项目失败", 400);
  }
}
