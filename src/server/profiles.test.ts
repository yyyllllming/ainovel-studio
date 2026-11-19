import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appPaths } from "./paths.ts";

const seedProfile = {
  id: "profile-1",
  name: "Primary Relay",
  providerId: "custom",
  protocol: "openai_compatible" as const,
  baseUrl: "https://relay.example.com/v1",
  apiKey: "sk-secret-1234567890",
  defaultModel: "gpt-5.4",
  enabled: true,
  createdAt: "2026-04-02T00:00:00.000Z",
  updatedAt: "2026-04-02T00:00:00.000Z",
};

async function withTempProfileStore(
  initialRaw: string | null,
  run: (context: { tempRoot: string; profileFile: string }) => Promise<void>,
) {
  const original = {
    configDir: appPaths.configDir,
    profileFile: appPaths.profileFile,
    profileExampleFile: appPaths.profileExampleFile,
  };
  const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-profiles-"));
  const profileFile = join(tempRoot, "llm-profiles.json");

  appPaths.configDir = tempRoot;
  appPaths.profileFile = profileFile;
  appPaths.profileExampleFile = join(tempRoot, "llm-profiles.example.json");

  try {
    if (initialRaw !== null) {
      await writeFile(profileFile, initialRaw, "utf8");
    }
    await run({ tempRoot, profileFile });
  } finally {
    appPaths.configDir = original.configDir;
    appPaths.profileFile = original.profileFile;
    appPaths.profileExampleFile = original.profileExampleFile;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("upsertProfile persists atomically without leaving temp files behind", async () => {
  await withTempProfileStore(
    JSON.stringify({ version: 1, profiles: [seedProfile] }, null, 2),
    async ({ tempRoot, profileFile }) => {
      const { upsertProfile } = await import("./profiles.ts");

      const saved = await upsertProfile({
        name: "Backup Relay",
        baseUrl: "https://backup.example.com/v1",
        apiKey: "sk-backup-secret",
        defaultModel: "gpt-5.4-mini",
      });

      const stored = JSON.parse(await readFile(profileFile, "utf8")) as {
        version: number;
        profiles: Array<{ id: string; apiKey: string }>;
      };
      const entries = await readdir(tempRoot);

      assert.equal(stored.version, 2);
      assert.equal(stored.profiles.length, 2);
      assert.equal(stored.profiles.some((profile) => profile.id === saved.id), true);
      assert.equal(entries.some((entry) => entry.endsWith(".tmp")), false);
    },
  );
});

test("readProfileFile backs up a corrupt store and throws an actionable error", async () => {
  const truncatedJson = '{ "version": 1, "profiles": [ { "id": "profile-1", "ap';
  await withTempProfileStore(truncatedJson, async ({ tempRoot }) => {
    const { getProfiles } = await import("./profiles.ts");

    await assert.rejects(() => getProfiles(), /配置文件已损坏/);

    const entries = await readdir(tempRoot);
    const backupName = entries.find((entry) => entry.includes(".corrupt-"));
    assert.notEqual(backupName, undefined);
    assert.equal(await readFile(join(tempRoot, backupName ?? ""), "utf8"), truncatedJson);
  });
});

test("fetchProfileModelsFromInput uses interactive probe budgets without retry storms", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    return new Response("service unavailable", { status: 503 });
  };

  try {
    const { fetchProfileModelsFromInput } = await import("./profiles.ts");

    await assert.rejects(
      () => fetchProfileModelsFromInput({
        profile: {
          baseUrl: "https://relay.example.com/v1",
          apiKey: "sk-transient",
        },
      }),
      /503/,
    );
    assert.equal(attempt, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testProfileConnectionFromInput honors an already-aborted caller signal", async () => {
  const originalFetch = globalThis.fetch;
  const aborter = new AbortController();
  aborter.abort();
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;
    return new Response("unreachable", { status: 500 });
  };

  try {
    const { testProfileConnectionFromInput } = await import("./profiles.ts");

    await assert.rejects(
      () => testProfileConnectionFromInput(
        {
          profile: {
            baseUrl: "https://relay.example.com/v1",
            apiKey: "sk-transient",
          },
          model: "test-model",
        },
        { signal: aborter.signal },
      ),
      /abort/i,
    );
    assert.equal(attempt, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
