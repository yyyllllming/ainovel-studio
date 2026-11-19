import { jsonFromError, jsonOk } from "@/server/http";
import { assertLocalBrowserRequest } from "@/server/security/request-guard";
import { deleteProfileAndReturnAck } from "@/server/services/settings.service";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalBrowserRequest(request);
    const { id } = await context.params;
    const result = await deleteProfileAndReturnAck({ profileId: id });
    return jsonOk(result);
  } catch (error) {
    return jsonFromError(error, "删除模型配置失败", 400);
  }
}
