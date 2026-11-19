import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { getProjectDetail, updateProjectSettings } from "@/server/services/project.service";
import { projectIdSchema, updateProjectSettingsSchema } from "@/server/validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk(await getProjectDetail(projectId));
  } catch (error) {
    return jsonFromError(error, "读取项目详情失败", 500);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = updateProjectSettingsSchema.parse(await readJsonBody(request));
    const updated = updateProjectSettings(projectId, {
      reviewPolicy: payload.reviewPolicy,
      narrativePerson: payload.narrativePerson,
    });
    return jsonOk({ project: updated });
  } catch (error) {
    return jsonFromError(error, "保存项目设置失败", 400);
  }
}
