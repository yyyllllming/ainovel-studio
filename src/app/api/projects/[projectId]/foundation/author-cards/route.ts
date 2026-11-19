import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { authorCardSyncSchema, projectIdSchema } from "@/server/validation";
import { syncAuthorCardFromProjectSnapshot } from "@/server/services/author-card.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = authorCardSyncSchema.parse(await readJsonBody(request));
    const result = await syncAuthorCardFromProjectSnapshot({
      ...payload,
      projectId,
    });
    return jsonOk({ result });
  } catch (error) {
    return jsonFromError(error, "同步作者卡失败", 400);
  }
}
