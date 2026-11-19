process.env.AINOVEL_SKIP_SERVER_ONLY = "1";

const prod = process.argv.includes("--prod");
if (prod) {
  await import("../dist-worker/commit/commit-reconciler-main.js");
} else {
  await import("../src/server/commit/commit-reconciler-main.ts");
}
