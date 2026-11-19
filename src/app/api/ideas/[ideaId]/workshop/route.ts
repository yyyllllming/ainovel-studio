import { assertIdeaWorkshopFresh } from "@/server/foundation/idea-workshop";
import { getWorkshopSnapshot, streamWorkshopMessage } from "@/server/services/idea.service";
import { createJsonLineStreamResponse, jsonFromError, jsonOk } from "@/server/http";
import { ideaIdSchema, ideaWorkshopMessageSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ ideaId: string }> },
) {
  try {
    const { ideaId } = await context.params;
    ideaIdSchema.parse(ideaId);
    return jsonOk(getWorkshopSnapshot(ideaId));
  } catch (error) {
    return jsonFromError(error, "读取想法工作坊失败", 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ ideaId: string }> },
) {
  try {
    const { ideaId } = await context.params;
    ideaIdSchema.parse(ideaId);
    const payload = ideaWorkshopMessageSchema.parse(await request.json());
    // 流式响应一旦建立就只能返回 200，冲突预检必须在建流前完成，文档承诺的 409/404 才可达。
    assertIdeaWorkshopFresh(ideaId, payload.baseUpdatedAt);

    return createJsonLineStreamResponse(async (emitSafe) => {
      try {
        await streamWorkshopMessage(ideaId, payload, emitSafe);
      } catch (error) {
        await emitSafe({
          type: "error",
          error: error instanceof Error ? error.message : "想法共创失败",
        });
      }
    });
  } catch (error) {
    return jsonFromError(error, "想法共创失败", 400);
  }
}
