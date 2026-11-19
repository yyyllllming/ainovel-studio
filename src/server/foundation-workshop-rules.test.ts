import test from "node:test";
import assert from "node:assert/strict";
import {
  canGenerateFormalFoundation,
  getFoundationGenerationHint,
  hasWorkshopDraftContent,
  hasUserWorkshopInput,
} from "./foundation/foundation-workshop-rules.ts";
import type { FoundationWorkshopDraft, FoundationWorkshopMessage } from "./types.ts";

const assistantOnly: FoundationWorkshopMessage[] = [
  {
    id: "starter",
    projectId: "project",
    role: "assistant",
    content: "我们先聊聊主角想要什么。",
    createdAt: new Date(0).toISOString(),
  },
];

function createDraft(overrides: Partial<FoundationWorkshopDraft> = {}): FoundationWorkshopDraft {
  return {
    premise: "",
    mainline: "",
    storyHook: "",
    desiredTone: "",
    characterIdeas: [],
    worldviewIdeas: [],
    relationshipIdeas: [],
    unresolvedQuestions: [],
    styleReferences: [],
    styleSamples: [],
    styleManualGuidance: "",
    styleAvoidances: "",
    styleSteeringCard: "",
    styleProfile: undefined,
    styleSnapshotId: null,
    styleSnapshotVersion: null,
    styleDigest: "",
    styleExemplars: [],
    ...overrides,
  };
}

test("hasUserWorkshopInput requires at least one non-empty user message", () => {
  assert.equal(hasUserWorkshopInput(assistantOnly), false);
  assert.equal(
    hasUserWorkshopInput([
      ...assistantOnly,
      {
        id: "user-1",
        projectId: "project",
        role: "user",
        content: "主角是一个会为谎言付出记忆代价的骗子。",
        createdAt: new Date(0).toISOString(),
      },
    ]),
    true,
  );
});

test("canGenerateFormalFoundation blocks fresh projects before collaboration", () => {
  assert.equal(
    canGenerateFormalFoundation({
      messages: assistantOnly,
      draft: createDraft(),
      hasExistingFoundation: false,
    }),
    false,
  );

  assert.equal(
    canGenerateFormalFoundation({
      messages: assistantOnly,
      draft: createDraft(),
      hasExistingFoundation: true,
    }),
    true,
  );
});

test("hasWorkshopDraftContent only treats substantive seeded drafts as ready input", () => {
  assert.equal(hasWorkshopDraftContent(createDraft()), false);
  assert.equal(hasWorkshopDraftContent(createDraft({ premise: "会说谎就失忆的骗子。" })), true);
  assert.equal(
    hasWorkshopDraftContent(
      createDraft({
        worldviewIdeas: [{ name: "谎言代价", description: "每说一次谎都会失去一段真实记忆。" }],
      }),
    ),
    true,
  );
});

test("canGenerateFormalFoundation allows seeded projects with non-empty idea snapshots", () => {
  assert.equal(
    canGenerateFormalFoundation({
      messages: assistantOnly,
      draft: createDraft({ mainline: "主角为了找回记忆潜入夜禁城市。" }),
      hasExistingFoundation: false,
      isIdeaSeeded: true,
    }),
    true,
  );

  assert.equal(
    canGenerateFormalFoundation({
      messages: assistantOnly,
      draft: createDraft(),
      hasExistingFoundation: false,
      isIdeaSeeded: true,
    }),
    false,
  );
});

test("getFoundationGenerationHint explains the next required step", () => {
  assert.match(
    getFoundationGenerationHint({
      messages: assistantOnly,
      draft: createDraft(),
      hasExistingFoundation: false,
    }),
    /先和设定助手聊至少一轮/,
  );
});

test("getFoundationGenerationHint explains seeded project readiness", () => {
  assert.match(
    getFoundationGenerationHint({
      messages: assistantOnly,
      draft: createDraft({ storyHook: "主角第一次说谎就丢掉了母亲的名字。" }),
      hasExistingFoundation: false,
      isIdeaSeeded: true,
    }),
    /想法快照已经带进项目了/,
  );
});
