import { jsonFromError, jsonOk } from "@/server/http";
import { resolveRunResumeRequest } from "@/server/run/resume-route.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    return jsonOk(await resolveRunResumeRequest(request, context));
  } catch (error) {
    return jsonFromError(error, "恢复失败", 400);
  }
}
