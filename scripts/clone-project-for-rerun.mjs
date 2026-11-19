async function main() {
  const sourceProjectId = process.argv[2];
  const titleSuffix = process.argv[3] ?? "-opening-rerun-2026-04-01";

  if (!sourceProjectId) {
    throw new Error("用法: node --import tsx scripts/clone-project-for-rerun.mjs <sourceProjectId> [titleSuffix]");
  }

  process.env.AINOVEL_SKIP_SERVER_ONLY = "1";
  const cloneModule = await import("../src/server/services/project-rerun-clone.service.ts");
  const createProjectRerunCloneService
    = cloneModule.createProjectRerunCloneService
    ?? cloneModule.default?.createProjectRerunCloneService;

  if (typeof createProjectRerunCloneService !== "function") {
    throw new Error("clone service 导出不可用");
  }

  const service = createProjectRerunCloneService();
  const result = await service.cloneProjectForRerun({
    sourceProjectId,
    titleSuffix,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
