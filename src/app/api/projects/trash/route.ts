import { jsonFromError, jsonOk } from "@/server/http";
import { listTrashedProjectSummaries } from "@/server/services/project.service";

export async function GET() {
  try {
    return jsonOk({ projects: listTrashedProjectSummaries() });
  } catch (error) {
    return jsonFromError(error, "读取回收站失败", 500);
  }
}
