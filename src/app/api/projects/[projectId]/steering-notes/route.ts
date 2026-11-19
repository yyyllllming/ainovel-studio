import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { addProjectSteeringNote } from "@/server/services/project.service";
import { projectIdSchema, steeringNotePayloadSchema } from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = steeringNotePayloadSchema.parse(await readJsonBody(request));
    return jsonOk(addProjectSteeringNote(projectId, {
      instruction: payload.instruction,
      scope: payload.scope,
    }));
  } catch (error) {
    return jsonFromError(error, "保存追加指令失败", 400);
  }
}
