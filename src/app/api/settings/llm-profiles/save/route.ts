import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { assertLocalBrowserRequest } from "@/server/security/request-guard";
import { saveProfileAndReturnPublicView } from "@/server/services/settings.service";

export async function POST(request: Request) {
  try {
    assertLocalBrowserRequest(request);
    const payload = await readJsonBody(request);
    const profile = await saveProfileAndReturnPublicView(payload);
    return jsonOk({ profile });
  } catch (error) {
    return jsonFromError(error, "保存模型配置失败", 400);
  }
}
