import { rm } from "node:fs/promises";

import { projectDir } from "./paths.ts";

export async function removeProjectFilesForTests(projectId: string) {
  await rm(projectDir(projectId), {
    recursive: true,
    force: true,
  });
}
