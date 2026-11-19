import { jsonFromError, jsonOk } from "@/server/http";
import { listProjectChapterVersions } from "@/server/services/chapter-query.service";
import { chapterNoSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    return jsonOk({ versions: listProjectChapterVersions(projectId, parsedChapterNo) });
  } catch (error) {
    return jsonFromError(error, "读取版本失败", 500);
  }
}
