import { searchFoundationStyleReferences } from "@/server/foundation/foundation-workshop";
import { jsonFromError, jsonOk } from "@/server/http";
import { foundationStyleSearchQuerySchema, projectIdSchema } from "@/server/validation";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const url = new URL(request.url);
    const payload = foundationStyleSearchQuerySchema.parse({
      query: url.searchParams.get("query") ?? "",
    });
    return jsonOk(await searchFoundationStyleReferences(projectId, payload.query));
  } catch (error) {
    return jsonFromError(error, "搜索文风参考失败", 400);
  }
}
