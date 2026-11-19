import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const runDir = resolve(arg("--run-dir") ?? "docs/superpowers/runs/2026-07-11-wucheng-80");
const chapterDir = resolve(arg("--chapter-dir") ?? `${runDir}/chapters`);
const expectedChapters = Number(arg("--chapters") ?? 80);
const minChars = Number(arg("--min-chars") ?? 2200);
const maxChars = Number(arg("--max-chars") ?? 3200);
const errors = [];
const rows = [];

if (!existsSync(chapterDir)) errors.push(`章节目录不存在：${chapterDir}`);
else {
  const files = (await readdir(chapterDir)).filter((file) => /^chapter_\d{3}\.md$/u.test(file)).sort();
  if (files.length !== expectedChapters) errors.push(`章节数 ${files.length} != ${expectedChapters}`);
  for (const [index, file] of files.entries()) {
    const content = await readFile(resolve(chapterDir, file), "utf8");
    const nonWhitespaceChars = content.replace(/\s/gu, "").length;
    const expectedFile = `chapter_${String(index + 1).padStart(3, "0")}.md`;
    if (file !== expectedFile) errors.push(`章节文件不连续：期待 ${expectedFile}，实际 ${file}`);
    if (nonWhitespaceChars < minChars || nonWhitespaceChars > maxChars) {
      errors.push(`${file} 字符数 ${nonWhitespaceChars} 不在 ${minChars}-${maxChars}`);
    }
    rows.push({ file, nonWhitespaceChars, sha256: createHash("sha256").update(content).digest("hex") });
  }
}

const ledgerPath = resolve(runDir, "evidence/call-ledger.json");
if (!existsSync(ledgerPath)) errors.push(`缺少调用账本：${ledgerPath}`);
else {
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  if (Number(ledger.writerCalls) !== 0) errors.push(`Writer 调用必须为 0，实际 ${ledger.writerCalls}`);
}

const report = {
  ok: errors.length === 0,
  runDir,
  chapterDir,
  expectedChapters,
  totalNonWhitespaceChars: rows.reduce((sum, row) => sum + row.nonWhitespaceChars, 0),
  rows,
  errors,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
