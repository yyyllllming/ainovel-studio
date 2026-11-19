import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { assertLocalBrowserRequest } from "@/server/security/request-guard";
import { fetchProfileModelsFromInput } from "@/server/services/settings.service";

export async function POST(request: Request) {
  try {
    assertLocalBrowserRequest(request);
    const payload = (await readJsonBody(request)) as { profileId?: string; profile?: unknown };
    const models = await fetchProfileModelsFromInput(payload, { signal: request.signal });
    return jsonOk({ models });
  } catch (error) {
    return jsonFromError(error, "获取模型列表失败", 400);
  }
}
