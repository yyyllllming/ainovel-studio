import { createFoundationStyleSnapshot, listFoundationStyleSnapshots } from "@/server/style/foundation-style";
import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { getStyleReferenceImportsByIds } from "@/server/repositories/style.repository";
import { syncAuthorCardFromProjectSnapshot } from "@/server/services/author-card.service";
import { foundationStyleSnapshotCreateSchema, projectIdSchema } from "@/server/validation";

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    return jsonOk({ snapshots: listFoundationStyleSnapshots(projectId) });
  } catch (error) {
    return jsonFromError(error, "读取 style snapshots 失败", 400);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    projectIdSchema.parse(projectId);
    const payload = foundationStyleSnapshotCreateSchema.parse(await readJsonBody(request));
    const snapshot = await createFoundationStyleSnapshot(projectId, payload);
    let authorCardSync: Awaited<ReturnType<typeof syncAuthorCardFromProjectSnapshot>> | null = null;

    if (payload.mode === "author") {
      const imports = getStyleReferenceImportsByIds(projectId, payload.sourceIds);
      const authorName = imports[0]?.author?.trim();
      if (authorName) {
        try {
          authorCardSync = await syncAuthorCardFromProjectSnapshot({
            projectId,
            snapshotId: snapshot.id,
            authorName,
            conflictResolution: "auto",
          });
        } catch (error) {
          authorCardSync = {
            status: "skipped",
            reason: error instanceof Error ? error.message : "作者卡同步失败",
          };
        }
      } else {
        authorCardSync = {
          status: "skipped",
          reason: "author 模式缺少作者名，未同步到全局作者卡库。",
        };
      }
    }

    return jsonOk({ snapshot, authorCardSync });
  } catch (error) {
    return jsonFromError(error, "生成 style snapshot 失败", 400);
  }
}
