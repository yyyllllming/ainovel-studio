import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { applyBookCardSchema, authorCardIdSchema, projectIdSchema } from "@/server/validation";
import { applyBookCardToProject } from "@/server/services/author-card.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ authorCardId: string; bookCardId: string }> },
) {
  try {
    const { authorCardId, bookCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);
    authorCardIdSchema.parse(bookCardId);
    const payload = applyBookCardSchema.parse(await readJsonBody(request));
    projectIdSchema.parse(payload.projectId);
    return jsonOk(await applyBookCardToProject(payload.projectId, bookCardId));
  } catch (error) {
    return jsonFromError(error, "应用书级风格卡失败", 400);
  }
}
