import { jsonFromError, jsonOk } from "@/server/http";
import { resolveFoundationResetRequest } from "@/server/foundation-reset-route.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    return jsonOk(await resolveFoundationResetRequest(request, context));
  } catch (error) {
    return jsonFromError(error, "重置到设定工坊失败", 400);
  }
}
