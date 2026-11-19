import { jsonFromError, jsonOk } from "@/server/http";
import { resolveRunStartRequest } from "@/server/run/start-route.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    return jsonOk(await resolveRunStartRequest(request, context));
  } catch (error) {
    return jsonFromError(error, "启动写作失败", 400);
  }
}
