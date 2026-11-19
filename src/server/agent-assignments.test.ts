import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_AGENT_ROLES,
  buildResolvedAgentMap,
  normalizeAssignments,
  normalizeProjectAssignments,
} from "./domain/agent-assignments.ts";
import { assignmentsSchema } from "./validation.ts";

const profiles = [
  {
    id: "relay-a",
    name: "Relay A",
    defaultModel: "model-a",
  },
  {
    id: "relay-b",
    name: "Relay B",
    defaultModel: "model-b",
  },
];

test("normalizeProjectAssignments adds coauthor from planner for legacy assignments", () => {
  const normalized = normalizeProjectAssignments([
    {
      role: "planner",
      profileId: "relay-a",
      model: "planner-fast",
      temperature: 0.5,
      maxTokens: 3200,
    },
    {
      role: "writer",
      profileId: "relay-b",
      model: "writer-strong",
      temperature: 0.9,
      maxTokens: 8192,
    },
    {
      role: "reviewer",
      profileId: "relay-a",
      model: "reviewer-safe",
      temperature: 0.2,
      maxTokens: 4096,
    },
  ]);

  assert.deepEqual(normalized.map((item) => item.role), PROJECT_AGENT_ROLES);
  assert.deepEqual(normalized[0], {
    role: "coauthor",
    profileId: "relay-a",
    model: "planner-fast",
    temperature: 0.5,
    maxTokens: 3200,
  });
});

test("normalizeProjectAssignments keeps explicit coauthor assignment", () => {
  const normalized = normalizeProjectAssignments([
    {
      role: "coauthor",
      profileId: "relay-b",
      model: "coauthor-chat",
      temperature: 0.8,
      maxTokens: 3500,
    },
    {
      role: "planner",
      profileId: "relay-a",
      model: "planner-fast",
      temperature: 0.5,
      maxTokens: 3200,
    },
    {
      role: "writer",
      profileId: "relay-b",
      model: "writer-strong",
      temperature: 0.9,
      maxTokens: 8192,
    },
    {
      role: "reviewer",
      profileId: "relay-a",
      model: "reviewer-safe",
      temperature: 0.2,
      maxTokens: 4096,
    },
  ]);

  assert.equal(normalized[0].role, "coauthor");
  assert.equal(normalized[0].model, "coauthor-chat");
  assert.equal(normalized[0].profileId, "relay-b");
});

test("normalizeAssignments surfaces four editable roles for the UI", () => {
  const normalized = normalizeAssignments(
    [
      {
        role: "planner",
        profileId: "relay-a",
        model: "planner-fast",
        temperature: 0.6,
        maxTokens: 3600,
      },
      {
        role: "writer",
        profileId: "relay-b",
        model: "writer-strong",
        temperature: 0.9,
        maxTokens: 8192,
      },
      {
        role: "reviewer",
        profileId: "relay-a",
        model: "reviewer-safe",
        temperature: 0.2,
        maxTokens: 4096,
      },
    ],
    profiles,
  );

  assert.deepEqual(normalized.map((item) => item.role), PROJECT_AGENT_ROLES);
  assert.equal(normalized[0].model, "planner-fast");
});

test("assignmentsSchema accepts four unique roles and rejects duplicates", () => {
  assert.doesNotThrow(() =>
    assignmentsSchema.parse([
      {
        role: "coauthor",
        profileId: "relay-a",
        model: "coauthor-chat",
        temperature: 0.7,
        maxTokens: 4096,
      },
      {
        role: "planner",
        profileId: "relay-a",
        model: "planner-fast",
        temperature: 0.5,
        maxTokens: 3200,
      },
      {
        role: "writer",
        profileId: "relay-b",
        model: "writer-strong",
        temperature: 0.9,
        maxTokens: 8192,
      },
      {
        role: "reviewer",
        profileId: "relay-a",
        model: "reviewer-safe",
        temperature: 0.2,
        maxTokens: 4096,
      },
    ]),
  );

  assert.throws(() =>
    assignmentsSchema.parse([
      {
        role: "planner",
        profileId: "relay-a",
        model: "planner-fast",
        temperature: 0.5,
        maxTokens: 3200,
      },
      {
        role: "planner",
        profileId: "relay-b",
        model: "planner-alt",
        temperature: 0.6,
        maxTokens: 3600,
      },
      {
        role: "writer",
        profileId: "relay-b",
        model: "writer-strong",
        temperature: 0.9,
        maxTokens: 8192,
      },
      {
        role: "reviewer",
        profileId: "relay-a",
        model: "reviewer-safe",
        temperature: 0.2,
        maxTokens: 4096,
      },
    ]),
  );
});

test("buildResolvedAgentMap falls back coauthor to planner but prefers explicit coauthor", () => {
  const legacyResolved = buildResolvedAgentMap(
    [
      {
        role: "planner",
        profileId: "relay-a",
        model: "planner-fast",
        temperature: 0.5,
        maxTokens: 3200,
      },
      {
        role: "writer",
        profileId: "relay-b",
        model: "writer-strong",
        temperature: 0.9,
        maxTokens: 8192,
      },
      {
        role: "reviewer",
        profileId: "relay-a",
        model: "reviewer-safe",
        temperature: 0.2,
        maxTokens: 4096,
      },
    ],
    [
      { id: "relay-a", enabled: true },
      { id: "relay-b", enabled: true },
    ],
  );

  assert.equal(legacyResolved.coauthor.assignment.model, "planner-fast");
  assert.equal(legacyResolved.coauthor.profile.id, "relay-a");

  const explicitResolved = buildResolvedAgentMap(
    [
      {
        role: "coauthor",
        profileId: "relay-b",
        model: "coauthor-chat",
        temperature: 0.8,
        maxTokens: 3500,
      },
      {
        role: "planner",
        profileId: "relay-a",
        model: "planner-fast",
        temperature: 0.5,
        maxTokens: 3200,
      },
      {
        role: "writer",
        profileId: "relay-b",
        model: "writer-strong",
        temperature: 0.9,
        maxTokens: 8192,
      },
      {
        role: "reviewer",
        profileId: "relay-a",
        model: "reviewer-safe",
        temperature: 0.2,
        maxTokens: 4096,
      },
    ],
    [
      { id: "relay-a", enabled: true },
      { id: "relay-b", enabled: true },
    ],
  );

  assert.equal(explicitResolved.coauthor.assignment.model, "coauthor-chat");
  assert.equal(explicitResolved.coauthor.profile.id, "relay-b");
});
