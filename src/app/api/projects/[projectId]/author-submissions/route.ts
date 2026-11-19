import { jsonFromError, jsonOk } from "@/server/http";
import { createAuthorSubmissionService } from "@/server/services/author-submission.service";
import { projectIdSchema, submissionFiltersSchema } from "@/server/validation";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = projectIdSchema.parse(rawProjectId);
    const url = new URL(request.url);
    const filters = submissionFiltersSchema.parse({
      batchId: url.searchParams.get("batchId") ?? undefined,
      chapterNo: url.searchParams.get("chapterNo") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    return jsonOk({ submissions: createAuthorSubmissionService().list(projectId, filters) });
  } catch (error) {
    return jsonFromError(error, "读取作者稿失败", 400);
  }
}
