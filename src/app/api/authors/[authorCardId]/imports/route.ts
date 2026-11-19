import { jsonFromError, jsonOk, readJsonBody } from "@/server/http";
import { deleteAuthorImportSchema, authorCardIdSchema, authorImportSchema } from "@/server/validation";
import {
  deleteAuthorTextImport,
  getAuthorCardFullDetail,
  importTextToAuthorCard,
} from "@/server/services/author-card.service";

function getExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.[^.]+$/u);
  return match?.[0] ?? "";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);
    return jsonOk({ imports: getAuthorCardFullDetail(authorCardId).imports });
  } catch (error) {
    return jsonFromError(error, "读取作者导入记录失败", 400);
  }
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

    const extension = getExtension(file.name);
    if (![".txt", ".md"].includes(extension)) {
      throw new Error("当前仅支持 .txt / .md 导入");
    }

    const payload = authorImportSchema.parse({
      title: String(formData.get("title") ?? "").trim() || undefined,
      author: String(formData.get("author") ?? "").trim() || undefined,
    });

    const imported = await importTextToAuthorCard(authorCardId, {
      fileName: file.name,
      mediaType: file.type || "text/plain",
      title: payload.title,
      author: payload.author,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return jsonOk({ import: imported });
  } catch (error) {
    return jsonFromError(error, "导入作者文本失败", 400);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ authorCardId: string }> },
) {
  try {
    const { authorCardId } = await context.params;
    authorCardIdSchema.parse(authorCardId);
    const payload = deleteAuthorImportSchema.parse(await readJsonBody(request));
    await deleteAuthorTextImport(authorCardId, payload.importId);
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonFromError(error, "删除作者导入记录失败", 400);
  }
}
