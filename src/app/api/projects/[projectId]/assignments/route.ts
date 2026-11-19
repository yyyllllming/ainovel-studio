import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { getProjectAssignments, updateProjectAssignments } from "@/server/services/project.service";
import { assignmentsPayloadSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk({ assignments: getProjectAssignments(projectId) });
  } catch (error) {
    return jsonFromError(error, "读取角色分配失败", 500);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = assignmentsPayloadSchema.parse(await readJsonBody(request));

    return jsonOk({ ok: true, assignments: updateProjectAssignments(projectId, payload.assignments) });
  } catch (error) {
    return jsonFromError(error, "保存角色分配失败", 400);
  }
}
