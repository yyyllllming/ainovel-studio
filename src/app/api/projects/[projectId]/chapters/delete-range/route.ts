import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { deleteChapterRange } from "@/server/services/chapter-range-delete.service";
import { deleteChapterRangePayloadSchema, projectIdSchema } from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = deleteChapterRangePayloadSchema.parse(await readJsonBody(request));
    const progress = await deleteChapterRange(projectId, payload);
    return jsonOk(progress);
  } catch (error) {
    return jsonFromError(error, "删除章节区间失败", 400);
  }
}
