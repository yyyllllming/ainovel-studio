import test from "node:test";
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { nanoid } from "nanoid";
import { appPaths, authorCardDir, ideaDir, projectDir } from "./paths.ts";
import { listPublicProfiles } from "./services/settings.service.ts";
import { createProject } from "./repositories/project.repository.ts";
import type { ProjectRecord } from "./repositories/shared.ts";
import { getProjectDetail } from "./services/project.service.ts";
import { createRunProgressService } from "./run/progress.service.ts";
import { createIdeaWithMeta } from "./services/idea.service.ts";
import { createAuthorCard, appendAuthorCardVersion } from "./repositories/author-card.repository.ts";
import { listAuthorCardSummaries } from "./services/author-card.service.ts";
import { listIdeaSummaries } from "./services/idea.service.ts";
import { rawDb } from "./db/client.ts";
import { PROJECT_PURGE_TABLES } from "./project-trash.ts";
import { buildFallbackStyleProfile } from "./style/style-steering.ts";
import {
  approveAuthorSubmissionInputSchema,
  submissionIdSchema,
} from "./validation.ts";

function createAssignments() {
  return [
    { role: "coauthor", profileId: "test-profile", model: "fake-model", temperature: 0.6, maxTokens: 4000 },
    { role: "planner", profileId: "test-profile", model: "fake-model", temperature: 0.4, maxTokens: 4000 },
    { role: "writer", profileId: "test-profile", model: "fake-model", temperature: 0.7, maxTokens: 4000 },
    { role: "reviewer", profileId: "test-profile", model: "fake-model", temperature: 0.2, maxTokens: 4000 },
  ] as const;
}

function createProjectFixture(title: string): ProjectRecord {
  const project = createProject({
    title,
    genre: "悬疑",
    style: "default",
    seriesMode: "standalone",
    storyLength: "medium",
    narrativePerson: "third",
    chapterPlanningMode: "fixed",
    paceProfile: "medium",
    completionCriteria: "主线闭环",
    targetChapters: 10,
    premise: "主角必须在夜禁城市里找回失踪的人。",
    assignments: [...createAssignments()],
  });

  if (!project) {
    throw new Error("项目创建失败");
  }

  return project;
}

function cleanupProject(projectId: string) {
  rawDb.transaction(() => {
    for (const table of PROJECT_PURGE_TABLES) {
      rawDb.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId);
    }
    rawDb.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  })();
}

function cleanupIdea(ideaId: string) {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM idea_workshop_messages WHERE idea_id = ?").run(ideaId);
    rawDb.prepare("DELETE FROM idea_workshop_states WHERE idea_id = ?").run(ideaId);
    rawDb.prepare("DELETE FROM ideas WHERE id = ?").run(ideaId);
  })();
}

function cleanupAuthorCard(authorCardId: string) {
  rawDb.transaction(() => {
    rawDb.prepare("DELETE FROM author_card_versions WHERE author_card_id = ?").run(authorCardId);
    rawDb.prepare("DELETE FROM author_cards WHERE id = ?").run(authorCardId);
  })();
}

async function withTempProfileStore(
  profiles: unknown[],
  run: () => Promise<void>,
) {
  const original = {
    configDir: appPaths.configDir,
    profileFile: appPaths.profileFile,
    profileExampleFile: appPaths.profileExampleFile,
  };
  const tempRoot = await mkdtemp(join(tmpdir(), "ainovel-api-contracts-"));
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
    await run();
  } finally {
    appPaths.configDir = original.configDir;
    appPaths.profileFile = original.profileFile;
    appPaths.profileExampleFile = original.profileExampleFile;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readJson<T>(response: Response) {
  return await response.json() as T;
}

function serializeJson(data: unknown) {
  return Response.json(data);
}

test("author submission API schemas reject unsafe IDs and incomplete human overrides", () => {
  assert.equal(submissionIdSchema.safeParse("../../escape").success, false);
  assert.equal(submissionIdSchema.safeParse("submission_safe-1").success, true);
  assert.equal(approveAuthorSubmissionInputSchema.safeParse({ humanOverride: true }).success, false);
  assert.equal(approveAuthorSubmissionInputSchema.safeParse({ humanOverride: true, overrideReason: "作者确认接受风险" }).success, true);
});

test("settings profiles GET contract stays secret-safe", async () => {
  await withTempProfileStore(
    [{
      id: "profile-contract-1",
      name: "Contract Relay",
      providerId: "custom",
      protocol: "openai_compatible",
      baseUrl: "https://relay.example.com/v1",
      apiKey: "sk-contract-secret-1234",
      defaultModel: "gpt-5.4",
      enabled: true,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z",
    }],
    async () => {
      const response = serializeJson({ profiles: await listPublicProfiles() });
      const payload = await readJson<{ profiles: Array<Record<string, unknown>> }>(response);
      const profile = payload.profiles[0];

      assert.equal(Array.isArray(payload.profiles), true);
      assert.equal(Boolean(profile), true);
      assert.equal("apiKey" in (profile ?? {}), false);
      assert.deepEqual(
        Object.keys(profile ?? {}).sort(),
        ["baseUrl", "defaultModel", "enabled", "hasApiKey", "id", "maskedApiKey", "name", "providerId"],
      );
    },
  );
});

test("projects GET, project detail GET, and run progress GET keep their public shapes", async () => {
  const project = createProjectFixture(`Contract Project ${nanoid()}`);
  const progressService = createRunProgressService();

  try {
    const listResponse = serializeJson({ projects: [project] });
    const listPayload = await readJson<{ projects: Array<Record<string, unknown>> }>(listResponse);
    assert.deepEqual(
      Object.keys(listPayload.projects[0] ?? {}).sort(),
      [
        "chapterBudgetMax",
        "chapterBudgetMin",
        "chapterBudgetTarget",
        "chapterPlanningMode",
        "completionCriteria",
        "createdAt",
        "deletedAt",
        "genre",
        "hardChapterCap",
        "hasVolumes",
        "id",
        "narrativePerson",
        "paceProfile",
        "plannedVolumes",
        "premise",
        "reviewPolicy",
        "seriesIndex",
        "seriesMode",
        "seriesTitle",
        "sourceIdeaId",
        "status",
        "steeringNotes",
        "storyContract",
        "storyLength",
        "style",
        "targetChapters",
        "title",
        "updatedAt",
      ],
    );

    const detailResponse = serializeJson(await getProjectDetail(project.id));
    const detailPayload = await readJson<Record<string, unknown>>(detailResponse);
    assert.deepEqual(
      Object.keys(detailPayload).sort(),
      [
        "assignments",
        "blockingReason",
        "blueprints",
        "conflicts",
        "coreDrift",
        "degradedArtifacts",
        "foundation",
        "foundationLocked",
        "foundationWorkshop",
        "invalidatedHistory",
        "logs",
        "novelExport",
        "project",
        "recentReviews",
        "resolvedReviewPolicy",
        "reviewStates",
        "runState",
        "runStatisticsSummary",
        "sourceIdea",
        "steeringNotes",
        "storyContract",
        "writtenChapters",
      ],
    );

    const progressResponse = serializeJson(progressService.getRunProgressView(project.id));
    const progressPayload = await readJson<Record<string, unknown>>(progressResponse);
    assert.deepEqual(
      Object.keys(progressPayload).sort(),
      [
        "confidence",
        "currentChapter",
        "currentPosition",
        "desiredState",
        "forecastRange",
        "hardChapterCap",
        "heartbeatAgeMs",
        "heartbeatAt",
        "lastActiveStage",
        "logs",
        "nextPlan",
        "planningMode",
        "recoverable",
        "retryCount",
        "running",
        "stage",
        "stageDetails",
        "staleHeartbeat",
        "totalChapters",
        "wordCount",
      ],
    );
  } finally {
    cleanupProject(project.id);
    await rm(projectDir(project.id), { recursive: true, force: true });
  }
});

test("ideas GET contract stays wrapped as summaries", async () => {
  const summary = await createIdeaWithMeta({ title: `Contract Idea ${nanoid()}` });
  if (!summary) {
    throw new Error("创建想法失败");
  }

  try {
    const response = serializeJson({ ideas: listIdeaSummaries() });
    const payload = await readJson<{ ideas: Array<Record<string, unknown>> }>(response);
    const ideaSummary = payload.ideas.find((entry) => {
      const idea = entry.idea as { id?: string } | undefined;
      return idea?.id === summary.idea.id;
    });

    assert.equal(Boolean(ideaSummary), true);
    assert.deepEqual(
      Object.keys(ideaSummary ?? {}).sort(),
      ["idea", "preview", "projectCount", "updatedAt"],
    );
    assert.deepEqual(
      Object.keys(((ideaSummary?.idea as Record<string, unknown>) ?? {})).sort(),
      ["createdAt", "deletedAt", "id", "title", "updatedAt"],
    );
  } finally {
    cleanupIdea(summary.idea.id);
    await rm(ideaDir(summary.idea.id), { recursive: true, force: true });
  }
});

test("authors GET contract stays wrapped as author card summaries", async () => {
  const authorCard = createAuthorCard({
    displayName: `Contract Author ${nanoid()}`,
    normalizedName: `contractauthor${nanoid()}`,
  });
  if (!authorCard) {
    throw new Error("创建作者卡失败");
  }

  try {
    appendAuthorCardVersion({
      authorCardId: authorCard.id,
      snapshot: {
        styleCard: "作者风格卡",
        styleProfile: buildFallbackStyleProfile({
          references: [],
          manualGuidance: "句子要短，动作先行。",
          avoidances: "不要解释腔。",
        }),
        styleDigest: "风格摘要",
        styleExemplars: [],
        sampledExcerpts: [],
        confidence: "high",
      },
      sourceWorks: [],
    });

    const response = serializeJson({ authors: listAuthorCardSummaries() });
    const payload = await readJson<{ authors: Array<Record<string, unknown>> }>(response);
    const summary = payload.authors.find((entry) => entry.id === authorCard.id);

    assert.equal(Boolean(summary), true);
    assert.deepEqual(
      Object.keys(summary ?? {}).sort(),
      [
        "archivedAt",
        "createdAt",
        "displayName",
        "id",
        "latestConfidence",
        "latestCreatedAt",
        "latestVersion",
        "normalizedName",
        "updatedAt",
        "versionCount",
      ],
    );
  } finally {
    cleanupAuthorCard(authorCard.id);
    await rm(authorCardDir(authorCard.id), { recursive: true, force: true });
  }
});
