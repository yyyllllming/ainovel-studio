import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { createAuthorSubmissionService } from "@/server/services/author-submission.service";
import { projectIdSchema, reviseAuthorSubmissionInputSchema, submissionIdSchema } from "@/server/validation";

export async function POST(request: Request, context: { params: Promise<{ projectId: string; submissionId: string }> }) {
  try {
    const params = await context.params;
    const projectId = projectIdSchema.parse(params.projectId);
    const submissionId = submissionIdSchema.parse(params.submissionId);
    const input = reviseAuthorSubmissionInputSchema.parse(await readJsonBody(request));
    return jsonOk(await createAuthorSubmissionService().revise(projectId, submissionId, input));
  } catch (error) {
    return jsonFromError(error, "修订作者稿失败", 400);
  }
}
