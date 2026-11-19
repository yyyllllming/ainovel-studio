import "./server-only.ts";

import { copyFile, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { z } from "zod";
import { appPaths, ensureBasePaths } from "./paths.ts";
import { CUSTOM_PROVIDER_ID } from "../lib/model-provider-presets.ts";
import type { LlmProfile, LlmProfileFile } from "./types.ts";
import { nowIso } from "./utils.ts";
import { listModels, minimalChatProbe, type LlmProbeOptions } from "./llm.ts";
import { safeParseJson } from "./utils/safe-json.ts";

const profileSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  providerId: z.string().default(CUSTOM_PROVIDER_ID),
  protocol: z.literal("openai_compatible"),
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().min(1),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const profileActionInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().optional(),
  providerId: z.string().default(CUSTOM_PROVIDER_ID),
  protocol: z.literal("openai_compatible").default("openai_compatible"),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(1),
  defaultModel: z.string().trim().default(""),
  enabled: z.boolean().default(true),
});

const profileFileSchema = z.object({
  version: z.number().default(1),
  profiles: z.array(profileSchema),
});

let cache: { path: string; mtimeMs: number; data: LlmProfileFile } | null = null;

async function readProfileFile() {
  ensureBasePaths();
  const fileStat = await stat(appPaths.profileFile);
  if (cache && cache.path === appPaths.profileFile && cache.mtimeMs === fileStat.mtimeMs) {
    return cache.data;
  }

  const raw = await readFile(appPaths.profileFile, "utf8");
  let parsed: LlmProfileFile;
  try {
    parsed = profileFileSchema.parse(safeParseJson<unknown>(raw));
  } catch (error) {
    // 备份文件名带上损坏文件的 mtime，反复读取同一份损坏文件时只产生一个备份。
    const backupFile = `${appPaths.profileFile}.corrupt-${Math.round(fileStat.mtimeMs)}`;
    await copyFile(appPaths.profileFile, backupFile).catch(() => {});
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `LLM Profile 配置文件已损坏，原文件已备份到 ${backupFile}，请修复或删除 ${appPaths.profileFile} 后重试：${detail}`,
    );
  }
  cache = { path: appPaths.profileFile, mtimeMs: fileStat.mtimeMs, data: parsed };
  return parsed;
}

async function writeProfileFile(next: LlmProfileFile) {
  // temp + rename 原子写，避免进程中途被杀时留下截断的 JSON（该文件是唯一的 API Key 存储）。
  const payload = JSON.stringify(next, null, 2);
  const tempFile = `${appPaths.profileFile}.tmp`;
  await writeFile(tempFile, payload, "utf8");
  try {
    await rename(tempFile, appPaths.profileFile);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows 上目标文件被占用时 rename 可能报 EPERM/EEXIST，退化为直接覆写。
    if (code !== "EPERM" && code !== "EEXIST") {
      await rm(tempFile, { force: true }).catch(() => {});
      throw error;
    }
    await writeFile(appPaths.profileFile, payload, "utf8");
    await rm(tempFile, { force: true }).catch(() => {});
  }
  cache = null;
}

export async function getProfiles() {
  const file = await readProfileFile();
  return file.profiles;
}

export async function getProfileById(profileId: string) {
  const profiles = await getProfiles();
  return profiles.find((profile) => profile.id === profileId);
}

export async function saveProfiles(input: Partial<LlmProfile>[]) {
  const previous = await readProfileFile();
  const now = nowIso();

  const profiles = input.map((entry) =>
    profileSchema.parse({
      id: entry.id ?? nanoid(),
      name: entry.name ?? "未命名中转",
      providerId: entry.providerId ?? CUSTOM_PROVIDER_ID,
      protocol: "openai_compatible",
      baseUrl: entry.baseUrl ?? "",
      apiKey: entry.apiKey ?? "",
      defaultModel: entry.defaultModel ?? "",
      enabled: entry.enabled ?? true,
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
    }),
  );

  const next = {
    version: previous.version + 1,
    profiles,
  };
  await writeProfileFile(next);
  return next.profiles;
}

export async function upsertProfile(input: Partial<LlmProfile>) {
  const file = await readProfileFile();
  const now = nowIso();
  const found = file.profiles.find((profile) => profile.id === input.id);
  const normalizedApiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;

  const nextProfile = profileSchema.parse({
    id: found?.id ?? input.id ?? nanoid(),
    name: input.name ?? found?.name ?? "未命名中转",
    providerId: input.providerId ?? found?.providerId ?? CUSTOM_PROVIDER_ID,
    protocol: "openai_compatible",
    baseUrl: input.baseUrl ?? found?.baseUrl ?? "",
    apiKey: normalizedApiKey ? normalizedApiKey : found?.apiKey ?? "",
    defaultModel: input.defaultModel ?? found?.defaultModel ?? "",
    enabled: input.enabled ?? found?.enabled ?? true,
    createdAt: found?.createdAt ?? now,
    updatedAt: now,
  });

  const profiles = found
    ? file.profiles.map((profile) => (profile.id === nextProfile.id ? nextProfile : profile))
    : [...file.profiles, nextProfile];

  await writeProfileFile({ version: file.version + 1, profiles });
  return nextProfile;
}

export async function deleteProfile(profileId: string) {
  const file = await readProfileFile();
  const target = file.profiles.find((profile) => profile.id === profileId);

  if (!target) {
    throw new Error("未找到对应的 LLM Profile");
  }

  const profiles = file.profiles.filter((profile) => profile.id !== profileId);
  await writeProfileFile({ version: file.version + 1, profiles });
  return { ok: true as const, deletedId: profileId };
}

function buildTransientProfile(input: unknown): LlmProfile {
  const now = nowIso();
  const parsed = profileActionInputSchema.parse(input);
  return {
    id: parsed.id ?? "__transient_profile__",
    name: parsed.name || "未保存配置",
    providerId: parsed.providerId,
    protocol: parsed.protocol,
    baseUrl: parsed.baseUrl,
    apiKey: parsed.apiKey,
    defaultModel: parsed.defaultModel,
    enabled: parsed.enabled,
    createdAt: now,
    updatedAt: now,
  };
}

async function resolveProfileForAction(input: { profileId?: string; profile?: unknown }) {
  if (input.profileId) {
    const profile = await getProfileById(input.profileId);
    if (!profile) {
      throw new Error("未找到对应的 LLM Profile");
    }
    return profile;
  }

  if (input.profile) {
    return buildTransientProfile(input.profile);
  }

  throw new Error("缺少可用的模型配置");
}

// 设置页「测试连接 / 拉取模型」属交互场景：短超时、不重试，用户取消即中断。
const INTERACTIVE_PROBE_TIMEOUT_MS = 15_000;

export interface ProfileActionOptions {
  signal?: AbortSignal;
}

function interactiveProbeOptions(options?: ProfileActionOptions): LlmProbeOptions {
  return {
    timeoutMs: INTERACTIVE_PROBE_TIMEOUT_MS,
    maxAttempts: 1,
    signal: options?.signal,
  };
}

export async function fetchProfileModels(profileId: string, options?: ProfileActionOptions) {
  const profile = await getProfileById(profileId);
  if (!profile) {
    throw new Error("未找到对应的 LLM Profile");
  }
  return listModels(profile, interactiveProbeOptions(options));
}

export async function fetchProfileModelsFromInput(
  input: { profileId?: string; profile?: unknown },
  options?: ProfileActionOptions,
) {
  const profile = await resolveProfileForAction(input);
  return listModels(profile, interactiveProbeOptions(options));
}

export async function testProfileConnection(profileId: string, model?: string, options?: ProfileActionOptions) {
  const profile = await getProfileById(profileId);
  if (!profile) {
    throw new Error("未找到对应的 LLM Profile");
  }
  const selectedModel = model || profile.defaultModel;
  return minimalChatProbe(profile, selectedModel, interactiveProbeOptions(options));
}

export async function testProfileConnectionFromInput(
  input: {
    profileId?: string;
    profile?: unknown;
    model?: string;
  },
  options?: ProfileActionOptions,
) {
  const profile = await resolveProfileForAction(input);
  let selectedModel = input.model?.trim() || profile.defaultModel.trim();

  if (!selectedModel) {
    try {
      const models = await listModels(profile, interactiveProbeOptions(options));
      selectedModel = models[0] ?? "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "自动拉取模型失败";
      throw new Error(`当前配置未填写默认模型，且自动拉取模型失败：${message}`);
    }
  }

  if (!selectedModel) {
    throw new Error("当前配置没有返回任何模型，请先填写默认模型或检查接口权限。");
  }

  return minimalChatProbe(profile, selectedModel, interactiveProbeOptions(options));
}

export async function snapshotProfiles() {
  const profiles = await getProfiles();
  return structuredClone(profiles);
}
