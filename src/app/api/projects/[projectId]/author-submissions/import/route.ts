import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { createAuthorSubmissionService } from "@/server/services/author-submission.service";
import { authorSubmissionImportInputSchema, projectIdSchema } from "@/server/validation";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = projectIdSchema.parse(rawProjectId);
    const input = authorSubmissionImportInputSchema.parse(await readJsonBody(request));
    return jsonOk(await createAuthorSubmissionService().importPreview(projectId, input));
  } catch (error) {
    return jsonFromError(error, "导入作者稿失败", 400);
  }
}
