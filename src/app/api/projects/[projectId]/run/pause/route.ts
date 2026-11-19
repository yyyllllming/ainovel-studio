import { jsonFromError, jsonOk } from "@/server/http";
import { resolveRunPauseRequest } from "@/server/run/pause-route.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    return jsonOk(await resolveRunPauseRequest(request, context));
  } catch (error) {
    return jsonFromError(error, "暂停失败", 400);
  }
}
