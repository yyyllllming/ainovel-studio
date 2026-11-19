import { applyFoundationStyleSnapshot } from "@/server/style/foundation-style";
import { jsonFromError, jsonOk } from "@/server/http";
import { projectIdSchema } from "@/server/validation";

export async function POST(
  _request: Request,
  context: { params: Promise<{ projectId: string; snapshotId: string }> },
) {
  try {
    const { projectId, snapshotId } = await context.params;
    projectIdSchema.parse(projectId);
    if (!snapshotId.trim()) {
      throw new Error("snapshotId 不能为空");
    }
    const applied = await applyFoundationStyleSnapshot(projectId, snapshotId);
    return jsonOk(applied);
  } catch (error) {
    return jsonFromError(error, "apply style snapshot 失败", 400);
  }
}
