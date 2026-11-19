import { jsonFromError, jsonOk } from "@/server/http";
import { createIdeaSchema } from "@/server/validation";
import { createIdeaWithMeta, listIdeaSummaries } from "@/server/services/idea.service";

export async function GET() {
  try {
    return jsonOk({ ideas: listIdeaSummaries() });
  } catch (error) {
    return jsonFromError(error, "读取想法列表失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = createIdeaSchema.parse(await request.json().catch(() => ({})));
    const idea = await createIdeaWithMeta(payload);
    return jsonOk({ idea });
  } catch (error) {
    return jsonFromError(error, "创建想法失败", 400);
  }
}
