import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// src/lib 与 src/server/domain 目前各保留一份相同实现（客户端 bundle 与服务端
// 进程各自引用）。在真正合并为单一事实源之前，这里强制两份拷贝保持语义一致：
// 任何只改了一侧的修改都会让本测试失败。
const duplicatedModulePairs = [
  ["src/lib/agent-assignments.ts", "src/server/domain/agent-assignments.ts"],
  ["src/lib/project-structure.ts", "src/server/domain/project-structure.ts"],
] as const;

// 规范化仅消除格式差异（空白折叠、括号内侧空白、闭合括号前的尾随逗号），
// 任何 token 级改动仍会暴露。
function normalizeSource(source: string) {
  return source
    .replace(/\s+/gu, " ")
    .replace(/,\s*([)\]}])/gu, "$1")
    .replace(/([\[({])\s+/gu, "$1")
    .replace(/\s+([\])}])/gu, "$1")
    .trim();
}

test("src/lib and src/server/domain duplicated domain modules stay in sync", async () => {
  for (const [libPath, domainPath] of duplicatedModulePairs) {
    const [libSource, domainSource] = await Promise.all([
      readFile(resolve(platformRoot, libPath), "utf8"),
      readFile(resolve(platformRoot, domainPath), "utf8"),
    ]);

    assert.equal(
      normalizeSource(libSource),
      normalizeSource(domainSource),
      `${libPath} 与 ${domainPath} 内容漂移：两份拷贝必须同步修改（或合并为单一实现后更新本测试）`,
    );
  }
});
