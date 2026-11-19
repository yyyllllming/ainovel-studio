process.env.AINOVEL_SKIP_SERVER_ONLY ??= "1";

function printUsage() {
  console.error("用法：npm run foundation:diagnose -- <projectId>");
  console.error("      npm run foundation:repair -- <projectId>");
}

async function main() {
  await import("../src/server/server-only.ts");
  const [{ getProject }, { diagnoseFoundationTruthSource, repairFoundationTruthSource }] = await Promise.all([
    import("../src/server/repositories/project.repository.ts"),
    import("../src/server/services/foundation-truth-source.service.ts"),
  ]);

  const mode = process.argv[2];
  const projectId = process.argv[3];

  if ((mode !== "diagnose" && mode !== "repair") || !projectId) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const project = getProject(projectId);
  if (!project) {
    console.error(`项目不存在：${projectId}`);
    process.exitCode = 1;
    return;
  }

  if (mode === "diagnose") {
    const report = diagnoseFoundationTruthSource(projectId);
    console.log(JSON.stringify({
      mode,
      projectId,
      title: project.title,
      report,
    }, null, 2));
    return;
  }

  const report = await repairFoundationTruthSource(projectId);
  console.log(JSON.stringify({
    mode,
    projectId,
    title: project.title,
    report,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "foundation truth-source 脚本执行失败");
  process.exitCode = 1;
});
