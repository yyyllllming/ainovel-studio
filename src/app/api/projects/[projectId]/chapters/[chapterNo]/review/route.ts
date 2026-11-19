import { jsonFromError, jsonOk } from "@/server/http";
import { listProjectChapterReviews } from "@/server/services/chapter-query.service";
import { chapterNoSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    return jsonOk({ reviews: listProjectChapterReviews(projectId, parsedChapterNo) });
  } catch (error) {
    return jsonFromError(error, "读取审核报告失败", 500);
  }
}
