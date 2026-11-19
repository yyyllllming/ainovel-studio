import test from "node:test";
import assert from "node:assert/strict";
import { selectIdeaWorkshopProfile } from "./foundation/idea-workshop.ts";
import { ideaWorkshopMessageSchema } from "./validation.ts";
import type { LlmProfile } from "./types/core.ts";

function createProfile(overrides: Partial<LlmProfile> = {}): LlmProfile {
  return {
    id: "profile-1",
    name: "Primary Relay",
    providerId: "custom",
    protocol: "openai_compatible",
    baseUrl: "https://relay.example.com/v1",
    apiKey: "sk-secret-123456",
    defaultModel: "gpt-5.4",
    enabled: true,
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    ...overrides,
  };
}

test("selectIdeaWorkshopProfile honors an explicit usable profile selection", () => {
  const alpha = createProfile({ id: "profile-1", defaultModel: "alpha-chat" });
  const beta = createProfile({ id: "profile-2", name: "Beta", defaultModel: "beta-pro" });

  const selected = selectIdeaWorkshopProfile([alpha, beta], "profile-2");

  assert.equal(selected.id, "profile-2");
  assert.equal(selected.defaultModel, "beta-pro");
});

test("selectIdeaWorkshopProfile falls back to the first usable profile", () => {
  const disabled = createProfile({ id: "disabled", enabled: false });
  const noKey = createProfile({ id: "no-key", apiKey: "" });
  const noModel = createProfile({ id: "no-model", defaultModel: "" });
  const usable = createProfile({ id: "usable", defaultModel: "writer-strong" });

  const selected = selectIdeaWorkshopProfile([disabled, noKey, noModel, usable]);

  assert.equal(selected.id, "usable");
});

test("selectIdeaWorkshopProfile rejects an explicit unusable profile selection", () => {
  const unusable = createProfile({ id: "broken", enabled: false });

  assert.throws(
    () => selectIdeaWorkshopProfile([unusable], "broken"),
    /当前不可用/,
  );
});

test("selectIdeaWorkshopProfile throws when no usable profiles exist", () => {
  const disabled = createProfile({ id: "disabled", enabled: false });
  const noKey = createProfile({ id: "no-key", apiKey: "" });

  assert.throws(
    () => selectIdeaWorkshopProfile([disabled, noKey]),
    /请先在模型配置里添加至少一个可用的模型 Profile/,
  );
});

test("ideaWorkshopMessageSchema accepts an optional profileId", () => {
  const parsed = ideaWorkshopMessageSchema.parse({
    message: "继续补主角动机",
    baseUpdatedAt: "2026-04-06T00:00:00.000Z",
    profileId: "profile-2",
  });

  assert.equal(parsed.profileId, "profile-2");
});
