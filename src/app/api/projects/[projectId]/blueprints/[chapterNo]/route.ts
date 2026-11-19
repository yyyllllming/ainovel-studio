import { jsonError, jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import {
  getBlueprintForChapter,
  saveBlueprintAndSyncCards,
} from "@/server/services/blueprint-generate.service";
import { blueprintUpdateSchema, chapterNoSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    const blueprint = getBlueprintForChapter(projectId, parsedChapterNo);
    if (!blueprint) {
      return jsonError("蓝图不存在", 404);
    }
    return jsonOk({ blueprint });
  } catch (error) {
    return jsonFromError(error, "读取蓝图失败", 500);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    const { projectId, chapterNo } = await context.params;
    projectIdSchema.parse(projectId);
    const parsedChapterNo = chapterNoSchema.parse(chapterNo);
    const blueprint = blueprintUpdateSchema.parse(await readJsonBody(request));
    await saveBlueprintAndSyncCards(projectId, {
      chapterNo: parsedChapterNo,
      ...blueprint,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonFromError(error, "更新蓝图失败", 400);
  }
}
