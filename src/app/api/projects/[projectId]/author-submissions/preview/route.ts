import { badRequest } from "@/server/errors";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { createAuthorSubmissionService } from "@/server/services/author-submission.service";
import {
  authorSubmissionMultiPreviewMetadataSchema,
  authorSubmissionSinglePreviewInputSchema,
  projectIdSchema,
} from "@/server/validation";

const MANUSCRIPT_EXTENSION = /\.(?:md|txt)$/iu;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId: rawProjectId } = await context.params;
    const projectId = projectIdSchema.parse(rawProjectId);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !MANUSCRIPT_EXTENSION.test(file.name)) {
        throw badRequest("只接受 .md 或 .txt 作者稿文件");
      }
      const metadata = authorSubmissionMultiPreviewMetadataSchema.parse({
        kind: "multi",
        fileName: file.name,
        startChapterNo: form.get("startChapterNo"),
        encoding: form.get("encoding") || undefined,
        source: form.get("source") || "import",
      });
      const result = await createAuthorSubmissionService().preview(projectId, {
        ...metadata,
        buffer: Buffer.from(await file.arrayBuffer()),
      });
      return jsonOk(result);
    }
    const payload = authorSubmissionSinglePreviewInputSchema.parse(await readJsonBody(request));
    return jsonOk(await createAuthorSubmissionService().preview(projectId, payload));
  } catch (error) {
    return jsonFromError(error, "预览作者稿失败", 400);
  }
}
