import { jsonFromError, jsonOk } from "@/server/http";
import { resolveRunStopRequest } from "@/server/run/stop-route.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    return jsonOk(await resolveRunStopRequest(request, context));
  } catch (error) {
    return jsonFromError(error, "停止失败", 400);
  }
}
