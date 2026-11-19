import { getFoundationWorkshopSnapshot, sendFoundationWorkshopMessage, streamFoundationWorkshopMessage } from "@/server/foundation/foundation-workshop";
import { createJsonLineStreamResponse, jsonFromError, jsonOk, readJsonBody, wantsJsonLineStream } from "@/server/http";
import { foundationWorkshopMessageSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk(getFoundationWorkshopSnapshot(projectId));
  } catch (error) {
    return jsonFromError(error, "读取设定工作台失败", 400);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = foundationWorkshopMessageSchema.parse(await readJsonBody(request));
    const wantsStream = wantsJsonLineStream(request);

    if (!wantsStream) {
      return jsonOk(await sendFoundationWorkshopMessage(projectId, payload));
    }

    return createJsonLineStreamResponse(async (emitSafe) => {
      try {
        await streamFoundationWorkshopMessage(projectId, payload, emitSafe);
      } catch (error) {
        await emitSafe({
          type: "error",
          error: error instanceof Error ? error.message : "设定共创失败",
        });
      }
    });
  } catch (error) {
    return jsonFromError(error, "设定共创失败", 400);
  }
}
