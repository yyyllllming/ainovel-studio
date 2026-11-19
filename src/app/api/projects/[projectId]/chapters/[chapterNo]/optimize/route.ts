import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { optimizeChapterSelection } from "@/server/services/chapter-optimize.service";
import { chapterNoSchema, optimizePayloadSchema, projectIdSchema } from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    const payload = optimizePayloadSchema.parse(await readJsonBody(request));
    const result = await optimizeChapterSelection({
      projectId,
      chapterNo: parsedChapterNo,
      selection: payload.selection,
      action: payload.action,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonFromError(error, "局部优化失败", 400);
  }
}
