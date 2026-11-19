import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { authorCardRegisterSchema, createAuthorCardSchema } from "@/server/validation";
import {
  createAuthorCardWithName,
  listAuthorCardSummaries,
  syncAuthorCardFromProjectSnapshot,
} from "@/server/services/author-card.service";

export async function GET() {
  try {
    return jsonOk({ authors: listAuthorCardSummaries() });
  } catch (error) {
    return jsonFromError(error, "读取作者卡失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as { action?: unknown };

    if (body?.action === "create") {
      const payload = createAuthorCardSchema.parse(body);
      const result = await createAuthorCardWithName(payload.displayName);
      return jsonOk({ result });
    }

    const payload = authorCardRegisterSchema.parse(body);
    const result = await syncAuthorCardFromProjectSnapshot(payload);
    return jsonOk({ result });
  } catch (error) {
    return jsonFromError(error, "保存作者卡失败", 400);
  }
}
