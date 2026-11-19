import { z } from "zod";
import { jsonFromError, jsonOk } from "@/server/http";
import { getProjectManuscriptPreview } from "@/server/services/project.service";
import { projectIdSchema } from "@/server/validation";

const manuscriptPreviewFormatSchema = z.enum(["txt", "md"]).default("md");

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const url = new URL(request.url);
    const format = manuscriptPreviewFormatSchema.parse(url.searchParams.get("format") ?? undefined);
    return jsonOk(await getProjectManuscriptPreview(projectId, format));
  } catch (error) {
    return jsonFromError(error, "读取合卷预览失败", 500);
  }
}
