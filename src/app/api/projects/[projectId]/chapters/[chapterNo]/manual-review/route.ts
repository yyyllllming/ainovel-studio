import { jsonFromError, jsonOk } from "@/server/http";
import { resolveManualReviewRequest } from "@/server/run/manual-review-route.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; chapterNo: string }> },
) {
  try {
    return jsonOk(await resolveManualReviewRequest(request, context));
  } catch (error) {
    return jsonFromError(error, "人工确认操作失败", 400);
  }
}
