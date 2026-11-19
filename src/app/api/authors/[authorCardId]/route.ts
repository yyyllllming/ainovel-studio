import { getAuthorCardFullDetail } from "@/server/services/author-card.service";
import { jsonFromError, jsonOk } from "@/server/http";
import { authorCardIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);
    return jsonOk(getAuthorCardFullDetail(authorCardId));
  } catch (error) {
    return jsonFromError(error, "读取作者卡详情失败", 500);
  }
}
