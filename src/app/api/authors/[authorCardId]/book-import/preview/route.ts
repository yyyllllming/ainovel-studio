import { jsonFromError, jsonOk } from "@/server/http";
import { authorBookImportPreviewSchema, authorCardIdSchema } from "@/server/validation";
import { previewBookImportForAuthor } from "@/server/services/author-card.service";

function getExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[^.]+$/u);
  return match?.[0] ?? "";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("缺少导入文件");
    }

    if (getExtension(file.name) !== ".txt") {
      throw new Error("拆书导入当前只支持 .txt 文件。");
    }

    const payload = authorBookImportPreviewSchema.parse({
      title: String(formData.get("title") ?? "").trim() || undefined,
      author: String(formData.get("author") ?? "").trim() || undefined,
      encoding: String(formData.get("encoding") ?? "").trim() || undefined,
    });

    const preview = await previewBookImportForAuthor(authorCardId, {
      fileName: file.name,
      mediaType: file.type || "text/plain",
      title: payload.title,
      author: payload.author,
      encoding: payload.encoding,
      buffer: Buffer.from(await file.arrayBuffer()),
    });

    return jsonOk(preview);
  } catch (error) {
    return jsonFromError(error, "创建拆书预览失败", 400);
  }
}
