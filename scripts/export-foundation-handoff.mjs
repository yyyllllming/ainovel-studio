import { resolve } from "node:path";

process.env.AINOVEL_SKIP_SERVER_ONLY = "1";

const { writeFoundationHandoffExport } = await import("../src/server/services/foundation-handoff.service.ts");

const [, , projectId, outputDirArg] = process.argv;

if (!projectId) {
  console.error("Usage: node --import tsx scripts/export-foundation-handoff.mjs <projectId> [outputDir]");
  process.exit(1);
}

const outputDir = outputDirArg
  ? resolve(outputDirArg)
  : resolve(process.cwd(), "..", "foundation-handoffs", projectId);

const result = await writeFoundationHandoffExport(projectId, outputDir);

console.log(JSON.stringify({
  projectId,
  outputDir,
  markdownPath: result.markdownPath,
  jsonPath: result.jsonPath,
}, null, 2));
