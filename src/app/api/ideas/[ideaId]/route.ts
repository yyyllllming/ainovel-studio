import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { ideaIdSchema, updateIdeaSchema } from "@/server/validation";
import { getIdeaDetail, updateIdeaWithMeta } from "@/server/services/idea.service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ ideaId: string }> },
) {
  try {
    const { ideaId } = await context.params;
    ideaIdSchema.parse(ideaId);
    return jsonOk(await getIdeaDetail(ideaId));
  } catch (error) {
    return jsonFromError(error, "读取想法详情失败", 500);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ ideaId: string }> },
) {
  try {
    const { ideaId } = await context.params;
    ideaIdSchema.parse(ideaId);
    const payload = updateIdeaSchema.parse(await readJsonBody(request));
    const idea = await updateIdeaWithMeta(ideaId, payload);
    return jsonOk({ idea });
  } catch (error) {
    return jsonFromError(error, "保存想法失败", 400);
  }
}
