import { jsonFromError, jsonOk } from "@/server/http";
import { projectIdSchema } from "@/server/validation";
import { purgeProject } from "@/server/services/project.service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    await purgeProject(projectId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonFromError(error, "永久删除项目失败", 400);
  }
}
