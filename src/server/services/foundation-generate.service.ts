import "../server-only.ts";

import { notFound } from "../errors.ts";
import { z } from "zod";
import { canonicalizeCharacterName, validateCharacterName } from "../../lib/character-name-policy.ts";
import { hasPlaceholderCharacterNames, normalizeFoundationCharacterReferences } from "../character/character-name-normalization.ts";
import { buildProjectPromptSummary } from "../domain/project-structure.ts";
import {
  buildTranscriptCharacterFallback,
  deriveFoundationCandidate,
  selectFoundationFromCandidate,
} from "../foundation/foundation-candidate.ts";
import {
  hasFoundationPlaceholderResidue,
  listFoundationPlaceholderResidueKinds,
} from "../foundation/foundation-quality-guards.ts";
import { sanitizeProjectPremise } from "../foundation/foundation-summary-sanitizer.ts";
import { canGenerateFormalFoundation } from "../foundation/foundation-workshop-rules.ts";
import { getFoundationWorkshopSnapshot } from "../foundation/foundation-workshop.ts";
import { type ChatMessage } from "../llm.ts";
import { chatJsonWithWorkflowPolicy } from "../llm-workflows.ts";
import { writeFoundationFiles } from "../project-files.ts";
import { listCards } from "../repositories/card.repository.ts";
import { getFoundation, isFoundationLocked, saveFoundation } from "../repositories/foundation.repository.ts";
import { getProject } from "../repositories/project.repository.ts";
import { appendRunLog } from "../repositories/run.repository.ts";
import type { ChapterBlueprint, FoundationPayload, FoundationWorkshopDraft, ProjectCard, RelationshipEdge } from "../types.ts";
import { buildIntegratedWritingDna, formatWritingDnaForPrompt } from "../writing/writing-dna.ts";
import { syncConfirmedCardsFromProjectFoundation } from "./card.service.ts";
import { getProjectExecutionContext, type ProjectExecutionContext } from "./project-execution-context.ts";

export const foundationSchema = z.object({
  premise: z.string().min(1),
  mainline: z.string().optional().default(""),
  storyHook: z.string().optional().default(""),
  styleCard: z.string().min(1),
  characters: z.array(
    z.object({
      name: z.string().min(1),
      role: z.string().min(1),
      goal: z.string().min(1),
      traits: z.array(z.string()).min(1),
      secrets: z.array(z.string()).optional(),
    }),
  ),
  worldview: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
  relationships: z.array(
    z.object({
      source: z.string().min(1),
      target: z.string().min(1),
      label: z.string().min(1),
    }),
  ),
});

export function buildProjectWritingDnaPrompt(input: {
  project: NonNullable<ReturnType<typeof getProject>>;
  styleProfile: ProjectExecutionContext["styleProfile"];
  foundation?: FoundationPayload | null;
  blueprint?: ChapterBlueprint | null;
}) {
  return formatWritingDnaForPrompt(
    buildIntegratedWritingDna({
      genre: input.project.genre,
      premise: input.foundation?.premise ?? sanitizeProjectPremise(input.project.premise),
      styleProfile: input.styleProfile,
      foundation: input.foundation ?? null,
      blueprint: input.blueprint ?? null,
    }),
  );
}

// Keep these explicit so service-level token ceilings do not silently drift back in.
export function resolveFoundationCharacterRenameMaxTokens(maxTokens: number) {
  return maxTokens;
}

export function resolveFoundationGenerationMaxTokens(maxTokens: number) {
  return maxTokens;
}

export function shouldReuseLockedFoundation(input: {
  hasExistingFoundation: boolean;
  foundationLocked: boolean;
  coreDrift: boolean;
}) {
  return input.hasExistingFoundation && input.foundationLocked && !input.coreDrift;
}

function resolveFoundationStyleState(input: {
  workshopDraft: FoundationWorkshopDraft | undefined;
  existing: FoundationPayload | null;
  context: ProjectExecutionContext;
}) {
  const draftHasSnapshot = Boolean(input.workshopDraft?.styleSnapshotId);
  const draftHasDigest = Boolean(input.workshopDraft?.styleDigest?.trim());
  const draftHasExemplars = Boolean(input.workshopDraft?.styleExemplars?.length);

  return {
    styleSnapshotId:
      input.workshopDraft?.styleSnapshotId
      ?? input.existing?.styleSnapshotId
      ?? input.context.activeStyle.styleSnapshotId
      ?? null,
    styleSnapshotVersion:
      input.workshopDraft?.styleSnapshotVersion
      ?? input.existing?.styleSnapshotVersion
      ?? input.context.activeStyle.styleSnapshotVersion
      ?? null,
    styleDigest:
      input.workshopDraft?.styleDigest?.trim()
      || input.existing?.styleDigest?.trim()
      || input.context.activeStyle.styleDigest
      || "",
    styleExemplars:
      input.workshopDraft?.styleExemplars?.length
        ? input.workshopDraft.styleExemplars
        : input.existing?.styleExemplars?.length
          ? input.existing.styleExemplars
          : input.context.activeStyle.styleExemplars,
    styleProfile:
      draftHasSnapshot || draftHasDigest || draftHasExemplars
        ? (input.workshopDraft?.styleProfile ?? input.context.styleProfile)
        : (input.existing?.styleProfile ?? input.context.styleProfile),
  };
}

export function mergeAuthoritativeFoundationCharacters(input: {
  proposed: FoundationPayload["characters"];
  workshopMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  workshopDraft: FoundationWorkshopDraft | undefined;
  existing: FoundationPayload | null;
}) {
  const authoritativeBase = new Map<string, FoundationPayload["characters"][number]>();
  const draftCharacters = (input.workshopDraft?.characterIdeas ?? []).flatMap((character) => {
    const validation = validateCharacterName(character.name);
    if (!validation.accepted || !validation.canonical) {
      return [];
    }
    return [{
      ...character,
      name: validation.canonical,
    }];
  });
  // 草稿里已有具名角色时，草稿就是权威集合：existing / transcript 不再追加成员，
  // 避免被 FoundationDeltaV1 remove 删掉的旧角色复活并让 coreDrift 永远无法消除。
  const draftIsAuthoritative = draftCharacters.length > 0;
  const draftCharacterKeys = new Set(draftCharacters.map((character) => character.name));

  for (const character of input.existing?.characters ?? []) {
    const canonical = canonicalizeCharacterName(character.name);
    if (!canonical || (draftIsAuthoritative && !draftCharacterKeys.has(canonical))) {
      continue;
    }
    authoritativeBase.set(canonical, {
      ...character,
      name: canonical,
    });
  }

  for (const character of draftCharacters) {
    authoritativeBase.set(character.name, character);
  }

  if (!draftIsAuthoritative) {
    for (const character of buildTranscriptCharacterFallback(
      (input.workshopMessages ?? []).filter((message) => message.role === "user"),
    )) {
      const validation = validateCharacterName(character.name);
      if (!validation.accepted || !validation.canonical || authoritativeBase.has(validation.canonical)) {
        continue;
      }
      authoritativeBase.set(validation.canonical, {
        ...character,
        name: validation.canonical,
      });
    }
  }

  const proposedByName = new Map(
    input.proposed
      .map((character) => {
        const canonical = canonicalizeCharacterName(character.name);
        return canonical
          ? ([canonical, {
            ...character,
            name: canonical,
          }] as const)
          : null;
      })
      .filter((entry): entry is readonly [string, FoundationPayload["characters"][number]] => Boolean(entry)),
  );

  return [...authoritativeBase.entries()].map(([canonical, base]) => {
    const proposed = proposedByName.get(canonical);
    if (!proposed) {
      return base;
    }
    return {
      ...proposed,
      name: canonical,
      role: proposed.role || base.role,
      goal: proposed.goal || base.goal,
      traits: proposed.traits.length ? proposed.traits : base.traits,
      secrets: proposed.secrets?.length ? proposed.secrets : base.secrets,
    };
  });
}

function mergeRelationshipEdges(base: RelationshipEdge[], incoming: RelationshipEdge[]) {
  const seen = new Set<string>();
  const merged: RelationshipEdge[] = [];

  for (const edge of [...base, ...incoming]) {
    const key = `${edge.source.trim()}|${edge.target.trim()}|${edge.label.trim()}`.toLocaleLowerCase();
    if (!edge.source.trim() || !edge.target.trim() || !edge.label.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(edge);
  }

  return merged;
}

/**
 * 候选稿是漂移真相源的权威：premise/mainline/storyHook/worldview 以及角色集合与 goal 固定继承 candidate；
 * LLM 整理结果只保留对角色画像（role/traits/secrets）、relationships 与 styleCard 的富化，
 * 避免整理输出与 workshop 草稿推导出的 canonical core facts 漂移。
 */
export function enrichCandidateFoundationFromProposal(input: {
  candidate: FoundationPayload;
  proposed: FoundationPayload;
}): FoundationPayload {
  const proposedByName = new Map(
    input.proposed.characters
      .map((character) => {
        const canonical = canonicalizeCharacterName(character.name);
        return canonical ? ([canonical, character] as const) : null;
      })
      .filter((entry): entry is readonly [string, FoundationPayload["characters"][number]] => Boolean(entry)),
  );
  const characters = input.candidate.characters.map((character) => {
    const canonical = canonicalizeCharacterName(character.name);
    const proposed = canonical ? proposedByName.get(canonical) : undefined;
    if (!proposed) {
      return character;
    }
    return {
      ...character,
      role: proposed.role || character.role,
      traits: proposed.traits.length ? proposed.traits : character.traits,
      secrets: proposed.secrets?.length ? proposed.secrets : character.secrets,
    };
  });

  return {
    ...input.proposed,
    premise: input.candidate.premise,
    mainline: input.candidate.mainline,
    storyHook: input.candidate.storyHook,
    worldview: input.candidate.worldview,
    characters,
    relationships: mergeRelationshipEdges(input.candidate.relationships, input.proposed.relationships),
  };
}

export function buildFoundationFallbackPayload(input: {
  project: { genre: string; premise: string; style: string };
  workshopDraft: FoundationWorkshopDraft | undefined;
  workshopMessages: Array<{ role: "user" | "assistant"; content: string }>;
  context: ProjectExecutionContext;
  existing: FoundationPayload | null;
  confirmedCards?: Array<Pick<ProjectCard, "cardType" | "status" | "draft">>;
}): FoundationPayload {
  return deriveFoundationCandidate({
    project: input.project,
    workshopDraft: input.workshopDraft,
    workshopMessages: input.workshopMessages,
    activeStyle: input.context.activeStyle,
    confirmedCards: input.confirmedCards ?? [],
    existing: input.existing,
  });
}

export function assertCanonicalFoundationOutput(foundation: FoundationPayload) {
  if (!hasFoundationPlaceholderResidue(foundation)) {
    return foundation;
  }

  const residue = listFoundationPlaceholderResidueKinds(foundation);
  throw new Error(`请先把角色实名和世界规则补成具体设定，再整理正式设定。当前结果仍含 placeholder 残留：${residue.join(", ") || "unknown"}。`);
}

export async function ensureConcreteFoundationCharacterNames(
  project: { title: string; genre: string },
  foundation: FoundationPayload,
  workshopDraft: FoundationWorkshopDraft | undefined,
  workshopMessages: Array<{ role: "user" | "assistant"; content: string }>,
  executionContext: ProjectExecutionContext,
) {
  const transcriptCharacters = buildTranscriptCharacterFallback(workshopMessages);
  const renameCandidates = [...(workshopDraft?.characterIdeas ?? []), ...transcriptCharacters];
  let normalized = normalizeFoundationCharacterReferences(foundation, {
    workshopCharacters: renameCandidates,
  });

  if (!hasPlaceholderCharacterNames(normalized.characters)) {
    return normalized;
  }

  try {
    const refined = await chatJsonWithWorkflowPolicy(
      {
        workflow: "foundation_character_rename",
        profile: executionContext.agents.coauthor.profile,
        model: executionContext.agents.coauthor.assignment.model,
        messages: [
          {
            role: "system",
            content: `${executionContext.prompts.planner}\n\n你负责把正式设定里的占位称呼改成故事内真实姓名。必须输出 JSON。`,
          },
          {
            role: "user",
            content: [
              `项目：${project.title}`,
              `题材：${project.genre}`,
              `现有正式设定草案：\n${JSON.stringify(normalized, null, 2)}`,
              workshopDraft ? `共创草案：\n${JSON.stringify(workshopDraft, null, 2)}` : "",
              transcriptCharacters.length ? `对话补抽角色候选：\n${JSON.stringify(transcriptCharacters, null, 2)}` : "",
              "请只做实名化修订：",
              "1. characters[].name 不能是“主角 / 男主 / 女主 / 反派 / 配角 / protagonist / boss”等占位称呼。",
              "2. 如果 premise / worldview / relationships / goal / secrets 里引用了这些占位称呼，要同步换成对应真实姓名。",
              "3. 尽量保留既有角色职责、关系和主线信息，不要另起设定。",
              "4. 输出字段仍然只能是 premise, styleCard, characters, worldview, relationships。",
            ].filter(Boolean).join("\n\n"),
          },
        ],
        assignmentMaxTokens: resolveFoundationCharacterRenameMaxTokens(executionContext.agents.coauthor.assignment.maxTokens),
        temperature: Math.min(executionContext.agents.coauthor.assignment.temperature, 0.6),
      },
      foundationSchema,
    );

    normalized = normalizeFoundationCharacterReferences(refined, {
      workshopCharacters: renameCandidates,
    });
  } catch {
    return normalized;
  }

  return normalized;
}

export async function generateFoundation(projectId: string, executionContext?: ProjectExecutionContext) {
  const project = getProject(projectId);
  if (!project) {
    throw notFound("项目不存在");
  }

  const existing = getFoundation(projectId);
  const workshop = getFoundationWorkshopSnapshot(projectId);
  if (shouldReuseLockedFoundation({
    hasExistingFoundation: Boolean(existing),
    foundationLocked: isFoundationLocked(projectId),
    coreDrift: Boolean(workshop.state?.coreDrift),
  })) {
    return existing!;
  }

  const context = await getProjectExecutionContext(projectId, project.style, executionContext);
  const stableProjectPremise = sanitizeProjectPremise(project.premise);
  const workshopDraft = workshop.state?.draft;
  const workshopTranscript = workshop.messages
    .map((message) => `${message.role === "assistant" ? "设定助手" : "作者"}：${message.content}`)
    .join("\n\n");

  const confirmedCards = listCards(projectId).filter((c) => c.status === "confirmed");
  const confirmedCharacters = confirmedCards
    .filter((c) => c.cardType === "character")
    .map((c) => c.draft);
  const confirmedWorldRules = confirmedCards
    .filter((c) => c.cardType === "world")
    .map((c) => c.draft);
  const candidateFoundation = buildFoundationFallbackPayload({
    project,
    workshopDraft,
    workshopMessages: workshop.messages,
    context,
    existing,
    confirmedCards: confirmedCards.map((card) => ({
      cardType: card.cardType,
      status: card.status,
      draft: card.draft,
    })),
  });
  if (
    !existing &&
    !canGenerateFormalFoundation({
      messages: workshop.messages,
      draft: workshopDraft,
      hasExistingFoundation: false,
      isIdeaSeeded: Boolean(project.sourceIdeaId),
    })
  ) {
    throw new Error("请先和设定助手至少进行一轮共创，再整理正式设定。");
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${context.prompts.planner}\n\n你负责把作者与设定助手已经共创过的草案整理成正式小说项目设定。必须输出 JSON。`,
    },
    {
      role: "user",
      content: [
        `标题：${project.title}`,
        `题材：${project.genre}`,
        buildProjectPromptSummary(project),
        `起点想法：${stableProjectPremise || "未填写"}`,
        `风格卡：\n${context.styleCard}`,
        `内置写作 DNA：\n${buildProjectWritingDnaPrompt({
          project,
          styleProfile: context.styleProfile,
        })}`,
        `共创草案：\n${JSON.stringify(workshopDraft, null, 2)}`,
        `候选正式稿（必须完整继承其核心事实）：\n${JSON.stringify(candidateFoundation, null, 2)}`,
        `最近共创记录：\n${workshopTranscript || "暂无，按项目基础信息保守生成。"}`,
        confirmedCharacters.length ? `已确认角色卡（请优先采用）：\n${JSON.stringify(confirmedCharacters, null, 2)}` : "",
        confirmedWorldRules.length ? `已确认世界书卡（请优先采用）：\n${JSON.stringify(confirmedWorldRules, null, 2)}` : "",
        "硬性规则：characters[].name 必须使用故事内的真实姓名，不能写成“主角 / 男主 / 女主 / 反派 / 配角 / protagonist / boss”这类占位称呼。",
        "硬性继承规则：",
        "1. candidate foundation 里的 premise、characters、worldview、relationships 是当前项目已经确认的核心事实，不得删减或泛化。",
        "2. workshopDraft.premise 如果非空，必须直接继承，不得改成更泛的一句话。",
        "3. workshopDraft.characterIdeas 与 workshopDraft.worldviewIdeas 中出现的具体名字和条目必须全部保留。",
        "4. 你只能在不丢失任何具体事实的前提下补充表达、润色结构、补齐缺失关系。",
        "输出字段：premise, mainline, storyHook, styleCard, characters, worldview, relationships。",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  let foundation: FoundationPayload;
  try {
    foundation = await chatJsonWithWorkflowPolicy(
      {
        workflow: "foundation_generate",
        profile: context.agents.coauthor.profile,
        model: context.agents.coauthor.assignment.model,
        messages,
        assignmentMaxTokens: resolveFoundationGenerationMaxTokens(context.agents.coauthor.assignment.maxTokens),
        temperature: context.agents.coauthor.assignment.temperature,
      },
      foundationSchema,
    );
    foundation = selectFoundationFromCandidate({
      candidate: candidateFoundation,
      proposed: foundation,
    });
  } catch {
    foundation = candidateFoundation;
  }

  foundation = enrichCandidateFoundationFromProposal({
    candidate: candidateFoundation,
    proposed: foundation,
  });

  foundation = await ensureConcreteFoundationCharacterNames(project, foundation, workshopDraft, workshop.messages, context);
  // 实名化只允许修订称呼；核心事实键在改名后重新钉回 candidate，relationships 保留实名化结果。
  foundation = {
    ...foundation,
    premise: candidateFoundation.premise,
    mainline: candidateFoundation.mainline,
    storyHook: candidateFoundation.storyHook,
    worldview: candidateFoundation.worldview,
  };
  const styleState = resolveFoundationStyleState({
    workshopDraft,
    existing,
    context,
  });
  foundation = {
    ...foundation,
    characters: mergeAuthoritativeFoundationCharacters({
      proposed: foundation.characters,
      workshopMessages: workshop.messages,
      workshopDraft,
      existing,
    }),
    styleSnapshotId: styleState.styleSnapshotId,
    styleSnapshotVersion: styleState.styleSnapshotVersion,
    styleDigest: styleState.styleDigest,
    styleExemplars: styleState.styleExemplars,
    styleProfile: styleState.styleProfile,
  };
  foundation = assertCanonicalFoundationOutput(foundation);
  foundation = saveFoundation(projectId, foundation);
  syncConfirmedCardsFromProjectFoundation(projectId);
  await writeFoundationFiles(projectId, foundation);
  appendRunLog(projectId, "info", "设定生成完成");
  return foundation;
}

export interface FoundationGenerateServiceDependencies {
  ensureFoundationGenerated: (projectId: string) => Promise<unknown>;
}

export function createFoundationGenerateService(input?: Partial<FoundationGenerateServiceDependencies>) {
  const deps = { ...input };

  return {
    async ensureFoundationGenerated(projectId: string) {
      const run = deps.ensureFoundationGenerated ?? ensureFoundationGenerated;
      return run(projectId);
    },
  };
}

export async function ensureFoundationGenerated(projectId: string) {
  return generateFoundation(projectId);
}
