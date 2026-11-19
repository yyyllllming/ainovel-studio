import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { badRequest, describeErrorForHttp, isAppError, notFound } from "./errors.ts";

test("describeErrorForHttp 透传 AppError 的状态码与错误码", () => {
  const shape = describeErrorForHttp(notFound("项目不存在"), "兜底消息", 500);
  assert.equal(shape.message, "项目不存在");
  assert.equal(shape.status, 404);
  assert.equal(shape.code, "NOT_FOUND");

  const badShape = describeErrorForHttp(badRequest("参数不合法"), "兜底消息", 500);
  assert.equal(badShape.status, 400);
  assert.equal(badShape.code, "BAD_REQUEST");
});

test("describeErrorForHttp 把 ZodError 映射为 400 校验错误且不泄漏 issue JSON", () => {
  const schema = z.object({
    chapterNo: z.coerce.number().int().positive("chapterNo 必须是正整数"),
    title: z.string().min(1, "标题不能为空"),
  });
  const result = schema.safeParse({ chapterNo: -1, title: "" });
  assert.equal(result.success, false);
  if (result.success) {
    return;
  }

  const shape = describeErrorForHttp(result.error, "读取章节失败", 500);
  assert.equal(shape.status, 400);
  assert.equal(shape.code, "VALIDATION_ERROR");
  assert.equal(shape.message, "chapterNo 必须是正整数; 标题不能为空");
  assert.ok(!shape.message.trimStart().startsWith("["), "message 不应是 Zod issues 的 JSON 串");
  assert.ok(Array.isArray(shape.details), "details 应保留结构化 issues");
});

test("describeErrorForHttp 对普通 Error 与未知值走兜底状态码", () => {
  const errorShape = describeErrorForHttp(new Error("磁盘读取失败"), "兜底消息", 500);
  assert.equal(errorShape.message, "磁盘读取失败");
  assert.equal(errorShape.status, 500);
  assert.equal(errorShape.code, undefined);

  const unknownShape = describeErrorForHttp("oops", "兜底消息", 502);
  assert.equal(unknownShape.message, "兜底消息");
  assert.equal(unknownShape.status, 502);
});

test("notFound 工厂返回可被 isAppError 识别且保留消息的 Error", () => {
  const error = notFound("章节正文不存在");
  assert.ok(error instanceof Error);
  assert.ok(isAppError(error));
  assert.equal(error.message, "章节正文不存在");
  assert.equal(error.status, 404);
});
