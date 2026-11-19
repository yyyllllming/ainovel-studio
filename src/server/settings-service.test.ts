import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  profiles: unknown[],
  run: (context: { profileFile: string }) => Promise<void>,
) {
  const original = {
    configDir: appPaths.configDir,
    profileFile: appPaths.profileFile,
    profileExampleFile: appPaths.profileExampleFile,
  };
  const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-settings-service-"));
  const profileFile = join(tempRoot, "llm-profiles.json");

  appPaths.configDir = tempRoot;
  appPaths.profileFile = profileFile;
  appPaths.profileExampleFile = join(tempRoot, "llm-profiles.example.json");

  try {
    await writeFile(
      profileFile,
      JSON.stringify(
        {
          version: 1,
          profiles,
        },
        null,
        2,
      ),
      "utf8",
    );
    await run({ profileFile });
  } finally {
    appPaths.configDir = original.configDir;
    appPaths.profileFile = original.profileFile;
    appPaths.profileExampleFile = original.profileExampleFile;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("listPublicProfiles returns a secret-safe DTO", async () => {
  await withTempProfileStore([seedProfile], async () => {
    const { listPublicProfiles } = await import("./services/settings.service.ts");

    const profiles = await listPublicProfiles();

    assert.equal(profiles.length, 1);
    assert.equal("apiKey" in profiles[0], false);
    assert.equal(profiles[0]?.id, seedProfile.id);
    assert.equal(profiles[0]?.hasApiKey, true);
    assert.match(profiles[0]?.maskedApiKey ?? "", /\.\.\./);
  });
});

test("saveProfileAndReturnPublicView stores the secret but only returns the redacted view", async () => {
  await withTempProfileStore([], async ({ profileFile }) => {
    const { saveProfileAndReturnPublicView } = await import("./services/settings.service.ts");

    const profile = await saveProfileAndReturnPublicView({
      name: "New Relay",
      providerId: "custom",
      protocol: "openai_compatible",
      baseUrl: "https://new-relay.example.com/v1",
      apiKey: "sk-brand-new-secret-1234",
      defaultModel: "gpt-5.4",
      enabled: true,
    });

    const stored = JSON.parse(await readFile(profileFile, "utf8")) as {
      profiles: Array<{ apiKey: string }>;
    };

    assert.equal("apiKey" in profile, false);
    assert.equal(profile.hasApiKey, true);
    assert.match(profile.maskedApiKey ?? "", /\.\.\./);
    assert.equal(stored.profiles[0]?.apiKey, "sk-brand-new-secret-1234");
  });
});

test("saveProfileAndReturnPublicView preserves the stored secret when apiKey is blank during edit", async () => {
  await withTempProfileStore([seedProfile], async ({ profileFile }) => {
    const { saveProfileAndReturnPublicView } = await import("./services/settings.service.ts");

    const profile = await saveProfileAndReturnPublicView({
      id: seedProfile.id,
      name: "Primary Relay Updated",
      providerId: seedProfile.providerId,
      protocol: seedProfile.protocol,
      baseUrl: seedProfile.baseUrl,
      apiKey: "",
      defaultModel: "gpt-5.4-mini",
      enabled: false,
    });

    const stored = JSON.parse(await readFile(profileFile, "utf8")) as {
      profiles: Array<{ id: string; apiKey: string; defaultModel: string; enabled: boolean }>;
    };
    const updated = stored.profiles.find((entry) => entry.id === seedProfile.id);

    assert.equal(profile.id, seedProfile.id);
    assert.equal(profile.hasApiKey, true);
    assert.equal(updated?.apiKey, seedProfile.apiKey);
    assert.equal(updated?.defaultModel, "gpt-5.4-mini");
    assert.equal(updated?.enabled, false);
  });
});

test("deleteProfileAndReturnAck removes the profile and bumps version", async () => {
  await withTempProfileStore(
    [
      seedProfile,
      {
        ...seedProfile,
        id: "profile-2",
        name: "Backup Relay",
      },
    ],
    async ({ profileFile }) => {
      const { deleteProfileAndReturnAck } = await import("./services/settings.service.ts");

      const result = await deleteProfileAndReturnAck({ profileId: "profile-1" });
      const stored = JSON.parse(await readFile(profileFile, "utf8")) as {
        version: number;
        profiles: Array<{ id: string }>;
      };

      assert.deepEqual(result, { ok: true, deletedId: "profile-1" });
      assert.equal(stored.version, 2);
      assert.equal(stored.profiles.some((profile) => profile.id === "profile-1"), false);
      assert.equal(stored.profiles.length, 1);
    },
  );
});

test("deleteProfileAndReturnAck throws when the profile does not exist", async () => {
  await withTempProfileStore([seedProfile], async () => {
    const { deleteProfileAndReturnAck } = await import("./services/settings.service.ts");

    await assert.rejects(
      () => deleteProfileAndReturnAck({ profileId: "missing-profile" }),
      /未找到对应的 LLM Profile/,
    );
  });
});
