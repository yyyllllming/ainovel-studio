import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rewriteIndexedJsonDirectory } from "./foundation/foundation-file-sync.ts";

test("rewriteIndexedJsonDirectory removes stale json files before writing the next foundation set", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "ainovel-foundation-sync-"));

  try {
    await rewriteIndexedJsonDirectory({
      dir: baseDir,
      entries: [{ name: "世界基调" }],
      fileName: (entry, index) => `${String(index + 1).padStart(2, "0")}_${entry.name}.json`,
    });

    await rewriteIndexedJsonDirectory({
      dir: baseDir,
      entries: [{ name: "断崖山场" }, { name: "灵纹偷学" }],
      fileName: (entry, index) => `${String(index + 1).padStart(2, "0")}_${entry.name}.json`,
    });

    const files = await readdir(baseDir);
    assert.deepEqual(files.sort(), ["01_断崖山场.json", "02_灵纹偷学.json"]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
