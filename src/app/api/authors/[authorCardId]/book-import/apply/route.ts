import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { applyAuthorBookImportSchema, authorCardIdSchema } from "@/server/validation";
import { applyBookImportPreviewForAuthor } from "@/server/services/author-card.service";

export async function POST(
  request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);

    const rawPayload = (await readJsonBody(request)) as { profileId?: unknown };
    const payload = applyAuthorBookImportSchema.parse(rawPayload);
    const profileId =
      typeof rawPayload?.profileId === "string" && rawPayload.profileId.trim()
        ? rawPayload.profileId.trim()
        : undefined;

    const result = await applyBookImportPreviewForAuthor(authorCardId, {
      previewId: payload.previewId,
      profileId,
    });
    return jsonOk(result);
  } catch (error) {
    return jsonFromError(error, "确认拆书导入失败", 400);
  }
}
