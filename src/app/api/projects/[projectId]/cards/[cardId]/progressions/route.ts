import { jsonFromError, jsonOk } from "@/server/http";
import { listProjectCardProgressions } from "@/server/services/card.service";
import { projectIdSchema } from "@/server/validation";
import { z } from "zod";

const cardIdSchema = z.string().trim().min(1, "cardId 不能为空");

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; cardId: string }> },
) {
  try {
    const { projectId, cardId } = await context.params;
    projectIdSchema.parse(projectId);
    cardIdSchema.parse(cardId);
    return jsonOk({ progressions: listProjectCardProgressions(projectId, cardId) });
  } catch (error) {
    return jsonFromError(error, "读取 progression 历史失败", 400);
  }
}
