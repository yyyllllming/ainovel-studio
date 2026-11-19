import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { authorCardIdSchema, generateBookCardSchema } from "@/server/validation";
import { generateBookCardForAuthor, getAuthorCardFullDetail } from "@/server/services/author-card.service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);
    return jsonOk({ bookCards: getAuthorCardFullDetail(authorCardId).bookCards });
  } catch (error) {
    return jsonFromError(error, "读取书级风格卡失败", 400);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);
    const rawPayload = (await readJsonBody(request)) as { profileId?: unknown };
    const payload = generateBookCardSchema.parse(rawPayload);
    const profileId =
      typeof rawPayload?.profileId === "string" && rawPayload.profileId.trim()
        ? rawPayload.profileId.trim()
        : undefined;
    const bookCards = await generateBookCardForAuthor(authorCardId, payload.importIds, { profileId });
    return jsonOk({ bookCards });
  } catch (error) {
    return jsonFromError(error, "生成书级风格卡失败", 400);
  }
}
