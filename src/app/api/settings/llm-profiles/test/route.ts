import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { assertLocalBrowserRequest } from "@/server/security/request-guard";
import { testProfileConnectionFromInput } from "@/server/services/settings.service";

export async function POST(request: Request) {
  try {
    assertLocalBrowserRequest(request);
    const payload = (await readJsonBody(request)) as { profileId?: string; profile?: unknown; model?: string };
    const result = await testProfileConnectionFromInput(payload, { signal: request.signal });
    return jsonOk(result);
  } catch (error) {
    return jsonFromError(error, "测试连接失败", 400);
  }
}
