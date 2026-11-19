import { jsonError, jsonFromError, jsonOk } from "@/server/http";
import { assertLocalBrowserRequest } from "@/server/security/request-guard";
import { readProjectFileWindow } from "@/server/services/file-access.service";
import { z } from "zod";

const fileReadQuerySchema = z.object({
  projectId: z.string().trim().optional(),
  relativePath: z.string().trim().optional(),
  path: z.string().trim().optional(),
  start: z.coerce.number().int().nonnegative().default(0),
  end: z.coerce.number().int().nonnegative().optional(),
}).superRefine((value, context) => {
  const hasModernQuery = Boolean(value.projectId && value.relativePath);
  if (hasModernQuery || value.path) {
    return;
  }

  context.addIssue({
    code: "custom",
    message: "缺少 projectId + relativePath",
    path: ["projectId"],
  });
});

export async function GET(request: Request) {
  try {
    assertLocalBrowserRequest(request);
    const url = new URL(request.url);
    const query = fileReadQuerySchema.parse({
      projectId: url.searchParams.get("projectId") ?? undefined,
      relativePath: url.searchParams.get("relativePath") ?? undefined,
      path: url.searchParams.get("path") ?? undefined,
      start: url.searchParams.get("start") ?? 0,
      end: url.searchParams.get("end") ?? undefined,
    });
    if (query.end !== undefined && query.end <= query.start) {
      return jsonError("end 必须大于 start");
    }
    return jsonOk(await readProjectFileWindow(query));
  } catch (error) {
    return jsonFromError(error, "读取文件失败", 400);
  }
}
