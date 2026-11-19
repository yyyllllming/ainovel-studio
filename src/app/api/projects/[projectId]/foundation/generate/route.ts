import { jsonFromError, jsonOk } from "@/server/http";
import { ensureFoundationGenerated } from "@/server/services/foundation-generate.service";
import { projectIdSchema } from "@/server/validation";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const foundation = await ensureFoundationGenerated(projectId);
    return jsonOk({ foundation });
  } catch (error) {
    return jsonFromError(error, "生成设定失败", 400);
  }
}
