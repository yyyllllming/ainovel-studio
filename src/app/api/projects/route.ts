import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { createProjectSchema } from "@/server/validation";
import { createProjectWithMeta, listProjectSummaries } from "@/server/services/project.service";

export async function GET() {
  try {
    return jsonOk({ projects: listProjectSummaries() });
  } catch (error) {
    return jsonFromError(error, "读取项目失败", 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = createProjectSchema.parse(await readJsonBody(request));
    const project = await createProjectWithMeta(payload);
    return jsonOk({ project });
  } catch (error) {
    return jsonFromError(error, "创建项目失败", 400);
  }
}
