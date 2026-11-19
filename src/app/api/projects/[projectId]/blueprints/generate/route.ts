import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { ensureBlueprintGenerated } from "@/server/services/blueprint-generate.service";
import { chapterNoSchema, projectIdSchema } from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = (await readJsonBody(request)) as { chapterNo?: number };
    const blueprint = await ensureBlueprintGenerated(projectId, chapterNoSchema.parse(payload.chapterNo ?? 1));
    return jsonOk({ blueprint });
  } catch (error) {
    return jsonFromError(error, "生成蓝图失败", 400);
  }
}
