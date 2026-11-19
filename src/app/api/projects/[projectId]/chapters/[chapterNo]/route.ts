import { jsonFromError, jsonOk } from "@/server/http";
import { getChapterDetail } from "@/server/services/chapter-query.service";
import { chapterNoSchema, projectIdSchema } from "@/server/validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const num = chapterNoSchema.parse(chapterNo);
    return jsonOk(await getChapterDetail(projectId, num));
  } catch (error) {
    return jsonFromError(error, "读取章节失败", 500);
  }
}
