import { applyAuthorCardToProject } from "@/server/services/author-card.service";
import { jsonFromError, jsonOk } from "@/server/http";
import { authorCardIdSchema, projectIdSchema } from "@/server/validation";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; authorCardId: string }> },
) {
  try {
    const { projectId, authorCardId } = await context.params;
    projectIdSchema.parse(projectId);
    authorCardIdSchema.parse(authorCardId);
    return jsonOk(await applyAuthorCardToProject(projectId, authorCardId));
  } catch (error) {
    return jsonFromError(error, "应用作者卡失败", 400);
  }
}
