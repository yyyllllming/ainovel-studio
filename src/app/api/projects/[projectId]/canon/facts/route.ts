import { jsonFromError, jsonOk } from "@/server/http";
import { listCanonFactsForProject } from "@/server/services/canon.service";
import { chapterNoSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const url = new URL(request.url);
    const chapterNo = url.searchParams.get("chapterNo");
    const type = url.searchParams.get("type");
    const keyword = url.searchParams.get("keyword");
    const facts = await listCanonFactsForProject({
      projectId,
      chapterNo: chapterNo ? chapterNoSchema.parse(chapterNo) : null,
      type,
      keyword,
    });
    return jsonOk({ facts });
  } catch (error) {
    return jsonFromError(error, "读取事实表失败", 500);
  }
}
