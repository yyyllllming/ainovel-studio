import { jsonFromError, jsonOk } from "@/server/http";
import { authorCardIdSchema, mergeAuthorStyleSchema } from "@/server/validation";
import { mergeAuthorStyle } from "@/server/services/author-card.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);
    const rawPayload = await request.json().catch(() => ({}));
    mergeAuthorStyleSchema.parse(rawPayload);
    const profileId =
      typeof rawPayload?.profileId === "string" && rawPayload.profileId.trim()
        ? rawPayload.profileId.trim()
        : undefined;
    const version = await mergeAuthorStyle(authorCardId, { profileId });
    return jsonOk({ version });
  } catch (error) {
    return jsonFromError(error, "合并作者风格失败", 400);
  }
}
