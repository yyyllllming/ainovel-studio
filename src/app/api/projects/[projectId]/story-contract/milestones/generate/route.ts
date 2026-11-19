import { jsonFromError, jsonOk } from "@/server/http";
import { generateProjectMilestones } from "@/server/services/project.service";
import { projectIdSchema } from "@/server/validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk(await generateProjectMilestones(projectId));
  } catch (error) {
    return jsonFromError(error, "生成卷级里程碑失败", 400);
  }
}
