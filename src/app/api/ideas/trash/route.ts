import { jsonFromError, jsonOk } from "@/server/http";
import { listTrashedIdeaSummaries } from "@/server/services/idea.service";

export async function GET() {
  try {
    return jsonOk({ ideas: listTrashedIdeaSummaries() });
  } catch (error) {
    return jsonFromError(error, "读取想法回收站失败", 500);
  }
}
