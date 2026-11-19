import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { importManualFoundation } from "@/server/services/manual-foundation-import.service";
import { manualFoundationImportSchema, projectIdSchema } from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const foundation = manualFoundationImportSchema.parse(await readJsonBody(request));
    return jsonOk({ foundation: await importManualFoundation(projectId, foundation) });
  } catch (error) {
    return jsonFromError(error, "导入人工设定失败", 400);
  }
}
