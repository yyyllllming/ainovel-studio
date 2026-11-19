/**
 * Next.js standalone mode does not include client assets by default.
 * We copy them after every production build so the traced server can
 * serve CSS, JS chunks, fonts, and public assets without extra infra.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, "..");
const NEXT_DIR = join(ROOT_DIR, ".next");
const STANDALONE_ROOT = join(NEXT_DIR, "standalone");

const copyTargets = [
  {
    label: ".next/static",
    src: join(NEXT_DIR, "static"),
    dest: join(STANDALONE_ROOT, ".next", "static"),
  },
  {
    label: "public",
    src: join(ROOT_DIR, "public"),
    dest: join(STANDALONE_ROOT, "public"),
  },
];

function copyDirectory(label, src, dest) {
  if (!existsSync(src)) {
    console.warn(`[copy-assets] Skip missing ${label}: ${src}`);
    return;
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-assets] Copied ${label}: ${src} -> ${dest}`);
}

if (!existsSync(STANDALONE_ROOT)) {
  console.warn(`[copy-assets] Skip asset copy because standalone output is missing: ${STANDALONE_ROOT}`);
  process.exit(0);
}

for (const target of copyTargets) {
  copyDirectory(target.label, target.src, target.dest);
}

console.log("[copy-assets] Done.");
