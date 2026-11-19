import { applyStoredPatch } from "@/server/commit/apply-stored-patch.service";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { applyPatchPayloadSchema, chapterNoSchema, projectIdSchema } from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    const payload = applyPatchPayloadSchema.parse(await readJsonBody(request));
    const result = await applyStoredPatch({
      projectId,
      chapterNo: parsedChapterNo,
      patchId: payload.patchId,
      patch: payload.patch,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonFromError(error, "应用 Patch 失败", 400);
  }
}
