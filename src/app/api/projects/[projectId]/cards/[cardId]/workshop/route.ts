import { sendCardWorkshopMessage } from "@/server/character/card-workshop";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { cardWorkshopMessageSchema, projectIdSchema } from "@/server/validation";
import { z } from "zod";

const cardIdSchema = z.string().trim().min(1, "cardId 不能为空");

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; cardId: string }> },
) {
  try {
    const { projectId, cardId } = await context.params;
    projectIdSchema.parse(projectId);
    cardIdSchema.parse(cardId);
    const payload = cardWorkshopMessageSchema.parse(await readJsonBody(request));
    const result = await sendCardWorkshopMessage(cardId, projectId, payload.message);
    return jsonOk(result);
  } catch (error) {
    return jsonFromError(error, "卡片共创失败", 400);
  }
}
