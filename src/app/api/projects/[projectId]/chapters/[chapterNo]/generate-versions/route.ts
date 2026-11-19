import { jsonFromError, jsonOk } from "@/server/http";
import { generateVersionsForChapter } from "@/server/services/chapter-version-generate.service";
import { chapterNoSchema, projectIdSchema } from "@/server/validation";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    const versions = await generateVersionsForChapter(projectId, parsedChapterNo);
    return jsonOk({ versions });
  } catch (error) {
    return jsonFromError(error, "生成多版本失败", 400);
  }
}
