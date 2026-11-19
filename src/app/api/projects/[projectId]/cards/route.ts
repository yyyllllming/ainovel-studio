import {
  createProjectCard,
  listProjectCards,
} from "@/server/services/card.service";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { createCardSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const includeDraft = new URL(request.url).searchParams.get("includeDraft") === "1";
    const result = listProjectCards(projectId, { includeDraft });
    return jsonOk(result);
  } catch (error) {
    return jsonFromError(error, "读取卡片库失败", 400);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = createCardSchema.parse(await readJsonBody(request));
    const card = createProjectCard({
      projectId,
      cardType: payload.cardType,
      name: payload.name,
      draft: payload.draft as never,
      meta: payload.meta,
    });
    return jsonOk({ card });
  } catch (error) {
    return jsonFromError(error, "创建卡片失败", 400);
  }
}
