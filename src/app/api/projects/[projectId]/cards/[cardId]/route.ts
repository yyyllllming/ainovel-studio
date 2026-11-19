import {
  deleteProjectCard,
  getProjectCard,
  listProjectCardMessages,
  updateProjectCard,
} from "@/server/services/card.service";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { projectIdSchema, updateCardSchema } from "@/server/validation";
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
    const card = getProjectCard(projectId, cardId);
    const messages = listProjectCardMessages(projectId, cardId);
    return jsonOk({ card, messages });
  } catch (error) {
    return jsonFromError(error, "读取卡片失败", 400);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; cardId: string }> },
) {
  try {
    const { projectId, cardId } = await context.params;
    projectIdSchema.parse(projectId);
    cardIdSchema.parse(cardId);
    const payload = updateCardSchema.parse(await readJsonBody(request));
    const updated = updateProjectCard(projectId, cardId, payload.name, payload.draft as never, payload.meta);
    return jsonOk({ card: updated });
  } catch (error) {
    return jsonFromError(error, "更新卡片失败", 400);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; cardId: string }> },
) {
  try {
    const { projectId, cardId } = await context.params;
    projectIdSchema.parse(projectId);
    cardIdSchema.parse(cardId);
    deleteProjectCard(projectId, cardId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonFromError(error, "删除卡片失败", 400);
  }
}
