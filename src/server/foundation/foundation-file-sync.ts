import { existsSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function rewriteIndexedJsonDirectory<T>(input: {
  dir: string;
  entries: T[];
  fileName: (entry: T, index: number) => string;
}) {
  await ensureDir(input.dir);
  const files = existsSync(input.dir) ? await readdir(input.dir) : [];
  await Promise.all(
    files
      .filter((file) => extname(file) === ".json")
      .map((file) => unlink(join(input.dir, file))),
  );
  await Promise.all(
    input.entries.map((entry, index) =>
      writeJson(join(input.dir, input.fileName(entry, index)), entry),
    ),
  );
}
