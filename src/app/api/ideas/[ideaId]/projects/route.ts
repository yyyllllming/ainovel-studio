import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { createProjectFromIdeaSchema, ideaIdSchema } from "@/server/validation";
import { createProjectFromIdeaWithMeta } from "@/server/services/idea.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ ideaId: string }> },
) {
  try {
    const { ideaId } = await context.params;
    ideaIdSchema.parse(ideaId);
    const payload = createProjectFromIdeaSchema.parse(await readJsonBody(request));
    const project = await createProjectFromIdeaWithMeta(ideaId, payload);
    return jsonOk({ project });
  } catch (error) {
    return jsonFromError(error, "从想法创建项目失败", 400);
  }
}
