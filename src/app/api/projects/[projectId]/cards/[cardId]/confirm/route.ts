import {
  confirmProjectCard,
  unconfirmProjectCard,
} from "@/server/services/card.service";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { cardConfirmActionSchema, projectIdSchema } from "@/server/validation";
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
    const payload = cardConfirmActionSchema.parse(await readJsonBody(request));
    const updated = payload.action === "confirm"
      ? confirmProjectCard(projectId, cardId)
      : unconfirmProjectCard(projectId, cardId);
    return jsonOk({ card: updated });
  } catch (error) {
    return jsonFromError(error, "操作失败", 400);
  }
}
