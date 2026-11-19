import { rollbackVersion } from "@/server/commit/rollback-version.service";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { chapterNoSchema, projectIdSchema, rollbackPayloadSchema } from "@/server/validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    const payload = rollbackPayloadSchema.parse(await readJsonBody(request));
    const version = await rollbackVersion(projectId, parsedChapterNo, payload.versionId);
    return jsonOk({ version });
  } catch (error) {
    return jsonFromError(error, "回滚版本失败", 400);
  }
}
