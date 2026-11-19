import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { createAuthorSubmissionService } from "@/server/services/author-submission.service";
import { projectIdSchema, reviewAuthorSubmissionInputSchema, submissionIdSchema } from "@/server/validation";

export async function POST(request: Request, context: { params: Promise<{ projectId: string; submissionId: string }> }) {
  try {
    const params = await context.params;
    const projectId = projectIdSchema.parse(params.projectId);
    const submissionId = submissionIdSchema.parse(params.submissionId);
    reviewAuthorSubmissionInputSchema.parse(await readJsonBody(request));
    return jsonOk(await createAuthorSubmissionService().review(projectId, submissionId));
  } catch (error) {
    return jsonFromError(error, "审查作者稿失败", 400);
  }
}
