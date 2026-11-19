import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3000";
if (!/^\d{1,5}$/u.test(port) || Number(port) > 65_535) {
  throw new Error(`Invalid E2E port: ${port}`);
}

const child = spawn("pnpm", ["dev", "--port", port], {
  stdio: "inherit",
  env: { ...process.env, AINOVEL_DISABLE_DETACHED_WORKERS: "1" },
  shell: process.platform === "win32",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
