import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));
process.env.AINOVEL_APP_ROOT ??= configDir;

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    AINOVEL_APP_ROOT: configDir,
    AINOVEL_PUBLIC_ORIGINS: process.env.AINOVEL_PUBLIC_ORIGINS ?? "",
  },
  output: "standalone",
  outputFileTracingRoot: configDir,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: configDir,
  },
};

export default nextConfig;
