import { jsonFromError, jsonOk } from "@/server/http";
import { moveProjectToTrash } from "@/server/services/project.service";
import { projectIdSchema } from "@/server/validation";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    moveProjectToTrash(projectId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonFromError(error, "删除项目失败", 400);
  }
}
