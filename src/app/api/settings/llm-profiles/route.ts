import { jsonFromError, jsonOk } from "@/server/http";
import { assertLocalBrowserRequest } from "@/server/security/request-guard";
import { listPublicProfiles } from "@/server/services/settings.service";

export async function GET(request: Request) {
  try {
    assertLocalBrowserRequest(request);
    const profiles = await listPublicProfiles();
    return jsonOk(
      { profiles },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return jsonFromError(error, "读取模型配置失败", 500);
  }
}
