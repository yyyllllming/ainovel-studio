import { createRunProgressService } from "@/server/run/progress.service";
import { jsonFromError, jsonOk } from "@/server/http";
import { projectIdSchema } from "@/server/validation";

const progressService = createRunProgressService();

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk(progressService.getRunProgressView(projectId));
  } catch (error) {
    return jsonFromError(error, "读取进度失败", 500);
  }
}
