import { streamFoundationStyleSteering, updateFoundationStyleSteering } from "@/server/foundation/foundation-workshop";
import { createJsonLineStreamResponse, jsonError, jsonOk, wantsJsonLineStream } from "@/server/http";
import { foundationStyleSteeringSchema, projectIdSchema } from "@/server/validation";

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = foundationStyleSteeringSchema.parse(await request.json());

    if (!wantsJsonLineStream(request)) {
      return jsonOk(await updateFoundationStyleSteering(projectId, payload));
    }

    return createJsonLineStreamResponse(async (emitSafe) => {
      try {
        await streamFoundationStyleSteering(projectId, payload, emitSafe);
      } catch (error) {
        await emitSafe({
          type: "error",
          error: error instanceof Error ? error.message : "更新文风约束失败",
        });
      }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "更新文风约束失败", 400);
  }
}
