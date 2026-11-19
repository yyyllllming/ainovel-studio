"use client";
import { useMemo, useState } from "react";
import {
  BadgeInfo,
  DatabaseZap,
  ExternalLink,
  Eye,
  EyeOff,
  FlaskConical,
  PencilLine,
  PlugZap,
  Radar,
  Rocket,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type { PublicLlmProfile } from "@/server/types/settings";
import {
  CUSTOM_PROVIDER_ID,
  getModelProviderPreset,
  inferProviderIdFromBaseUrl,
  isRelayProvider,
  MODEL_PROVIDER_PRESETS,
  RELAY_PROVIDER_ID,
  RELAY_BASE_URLS,
} from "@/lib/model-provider-presets";
import { useConfirm } from "./confirm-dialog.tsx";
import { LoadingSkeleton } from "./loading-skeleton";

type Profile = PublicLlmProfile;

/** buildFormPayload 的返回类型，供 mutation 复用。 */
interface FormPayload {
  id?: string;
  name: string;
  providerId: string;
  protocol: "openai_compatible";
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

interface ProfileFormState {
  name: string;
  providerId: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
}

const emptyForm: ProfileFormState = {
  name: "",
  providerId: RELAY_PROVIDER_ID,
  baseUrl: RELAY_BASE_URLS[0],
  apiKey: "",
  defaultModel: "",
  enabled: true,
};

/** 中转站注册入口。从中转站域名推导，去掉 /v1 后缀加 /register。 */
const RELAY_REGISTER_URL = RELAY_BASE_URLS[0].replace(/\/v1$/, "/register");

function getProviderHelperText(providerId: string) {
  const preset = getModelProviderPreset(providerId);
  if (preset.id === CUSTOM_PROVIDER_ID) {
    return "任意 OpenAI-compatible 网关";
  }
  if (preset.id === RELAY_PROVIDER_ID) {
    return "填 Key 就能写";
  }
  return preset.defaultModel || preset.modelSuggestions[0] || "官方模型";
}

/* ── 模型分组工具 ─────────────────────────────────────── */

interface ModelGroup {
  label: string;
  models: string[];
}

/**
 * 按 model ID 前缀分组。中转站返回的模型 ID 自带厂商前缀
 * (gpt-*, claude-*, gemini-*, glm-*, kimi-*, deepseek-*, grok-*, qwen*, minimax*, sd*, video-*, …)。
 * 无法归类的放入「其他」。
 */
function groupModels(models: string[]): ModelGroup[] {
  // 前缀 → 分组标签，有序。靠前的先匹配。
  const prefixRules: { prefix: string; label: string }[] = [
    { prefix: "gpt-image", label: "图像生成" },
    { prefix: "gpt", label: "OpenAI GPT" },
    { prefix: "claude", label: "Anthropic Claude" },
    { prefix: "gemini", label: "Google Gemini" },
    { prefix: "glm", label: "智谱 GLM" },
    { prefix: "kimi", label: "Kimi" },
    { prefix: "k3", label: "Kimi" },
    { prefix: "deepseek", label: "DeepSeek" },
    { prefix: "dsv4", label: "DeepSeek" },
    { prefix: "grok", label: "xAI Grok" },
    { prefix: "qwen", label: "Qwen" },
    { prefix: "minimax", label: "MiniMax" },
    { prefix: "sd", label: "图像生成" },
    { prefix: "video", label: "视频生成" },
  ];

  // 分组标签 → 模型列表，保持首次出现的顺序。
  const buckets = new Map<string, string[]>();
  const order: string[] = [];

  for (const model of models) {
    const lower = model.toLowerCase();
    const rule = prefixRules.find((r) => lower.startsWith(r.prefix));
    const label = rule?.label ?? "其他";
    if (!buckets.has(label)) {
      buckets.set(label, []);
      order.push(label);
    }
    buckets.get(label)!.push(model);
  }

  return order.map((label) => ({ label, models: buckets.get(label)! }));
}

/* ── 中转站模型选择器 ─────────────────────────────────── */

function RelayModelPicker({
  models,
  selectedModel,
  onSelect,
}: {
  models: string[];
  selectedModel: string;
  onSelect: (model: string) => void;
}) {
  const groups = useMemo(() => groupModels(models), [models]);

  if (models.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-soft)] p-4">
        <p className="text-sm text-[var(--ink-soft)]">
          尚未拉取模型列表。填写 API Key 后点击下方「拉取模型」按钮获取中转站全部可用模型。
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--ink)]">可用模型</span>
        <span className="workspace-pill px-2.5 py-1 text-xs text-[var(--ink-soft)]">
          {models.length} 个
        </span>
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="mb-1 px-1 text-sm font-semibold text-[var(--ink)]">
              {group.label}
              <span className="ml-1.5 text-xs font-normal text-[var(--ink-faint)]">
                ({group.models.length})
              </span>
            </p>
            <div className="flex flex-wrap gap-2 pl-5">
              {group.models.map((model) => (
                <button
                  key={model}
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                    selectedModel === model
                      ? "bg-[var(--accent)] text-white"
                      : "workspace-pill text-[var(--ink-soft)] hover:bg-[var(--accent-soft)]"
                  }`}
                  onClick={() => onSelect(model)}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 主组件 ───────────────────────────────────────────── */

export function SettingsClient({
  initialProfiles,
}: {
  initialProfiles?: { profiles: PublicLlmProfile[] };
}) {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState>(emptyForm);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => apiGet<{ profiles: Profile[] }>("/api/settings/llm-profiles"),
    initialData: initialProfiles,
    refetchOnMount: false,
  });

  const profiles = useMemo(
    () =>
      (data?.profiles ?? []).map((profile) => ({
        ...profile,
        providerId: profile.providerId || inferProviderIdFromBaseUrl(profile.baseUrl),
      })),
    [data?.profiles],
  );
  const editingProfile = useMemo(
    () => profiles.find((profile) => profile.id === editingId) ?? null,
    [editingId, profiles],
  );
  const selectedPreset = useMemo(
    () => getModelProviderPreset(form.providerId),
    [form.providerId],
  );

  const isOfficialPreset =
    selectedPreset.id !== CUSTOM_PROVIDER_ID && selectedPreset.id !== RELAY_PROVIDER_ID;
  const isRelay = isRelayProvider(form.providerId);
  const suggestedModels = fetchedModels.length ? fetchedModels : selectedPreset.modelSuggestions;
  const hasStoredApiKey = Boolean(editingProfile?.hasApiKey);
  const canSave =
    form.name.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    (form.apiKey.trim().length > 0 || hasStoredApiKey) &&
    form.defaultModel.trim().length > 0;
  const canProbeCurrentForm =
    form.baseUrl.trim().length > 0 &&
    (form.apiKey.trim().length > 0 || hasStoredApiKey);

  async function invalidateProfileQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profiles"] }),
      queryClient.invalidateQueries({ queryKey: ["author-library-llm-profiles"] }),
    ]);
  }

  function buildFormPayload(): FormPayload {
    return {
      id: editingId ?? undefined,
      name: form.name.trim() || selectedPreset.label,
      providerId: form.providerId,
      protocol: "openai_compatible" as const,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      defaultModel: form.defaultModel.trim(),
      enabled: form.enabled,
    };
  }

  function buildTestPayload() {
    const model = form.defaultModel.trim() || undefined;

    if (editingProfile && !form.apiKey.trim() && editingProfile.hasApiKey) {
      return {
        profileId: editingProfile.id,
        model,
      };
    }

    return {
      profile: buildFormPayload(),
      model,
    };
  }

  function buildFetchModelsPayload() {
    if (editingProfile && !form.apiKey.trim() && editingProfile.hasApiKey) {
      return {
        profileId: editingProfile.id,
      };
    }

    return {
      profile: buildFormPayload(),
    };
  }

  function resetForm(nextFeedback?: string) {
    setEditingId(null);
    setForm(emptyForm);
    setFetchedModels([]);
    if (nextFeedback) {
      setFeedback(nextFeedback);
    }
  }

  function applyProviderPreset(providerId: string) {
    const preset = getModelProviderPreset(providerId);
    setForm((current) => {
      const previousPreset = getModelProviderPreset(current.providerId);
      const shouldSyncName =
        !current.name.trim() ||
        current.name === previousPreset.label ||
        MODEL_PROVIDER_PRESETS.some((entry) => entry.label === current.name);

      return {
        ...current,
        providerId,
        baseUrl: preset.baseUrl || current.baseUrl,
        defaultModel: preset.defaultModel || current.defaultModel,
        name: shouldSyncName ? preset.label : current.name,
      };
    });
    setFetchedModels(preset.modelSuggestions);
    setFeedback(
      providerId === CUSTOM_PROVIDER_ID
        ? "已切换到自定义模式，你可以填写任意 OpenAI-compatible 地址。"
        : providerId === RELAY_PROVIDER_ID
          ? "已切换到中转站模式，Base URL 已预填。请填写 API Key 后拉取模型。"
          : `已切换到 ${preset.label} 的官方接入模板，系统会内置官方地址。`,
    );
  }

  function loadProfileIntoForm(profile: Profile & { providerId: string }) {
    setEditingId(profile.id);
    setForm({
      name: profile.name,
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      apiKey: "",
      defaultModel: profile.defaultModel,
      enabled: profile.enabled,
    });
    setFetchedModels([]);
    setFeedback(`已载入 ${profile.name}。留空 API Key 会保留当前已保存的密钥。`);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPost<{ profile: PublicLlmProfile }>("/api/settings/llm-profiles/save", buildFormPayload()),
    onSuccess: async () => {
      await invalidateProfileQueries();
      resetForm(editingId ? "Profile 已更新。" : "Profile 已保存。");
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "保存失败"),
  });

  const testMutation = useMutation({
    mutationFn: (input: { profileId?: string; profile?: FormPayload; model?: string }) =>
      apiPost<{ preview: string; model: string }>("/api/settings/llm-profiles/test", input),
    onSuccess: (result) => setFeedback(`测试成功：${result.model} -> ${result.preview}`),
    onError: (error) => setFeedback(error instanceof Error ? error.message : "测试失败"),
  });

  const modelsMutation = useMutation({
    mutationFn: (input: { profileId?: string; profile?: FormPayload }) =>
      apiPost<{ models: string[] }>("/api/settings/llm-profiles/fetch-models", input),
    onSuccess: (result) => {
      setFetchedModels(result.models);
      if (!form.defaultModel.trim() && result.models[0]) {
        setForm((current) => ({
          ...current,
          defaultModel: result.models[0] ?? "",
        }));
      }
      setFeedback(`已拉取 ${result.models.length} 个可用模型。`);
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "获取模型失败"),
  });

  const toggleMutation = useMutation({
    mutationFn: (profile: Profile & { providerId: string }) =>
      apiPost<{ profile: PublicLlmProfile }>("/api/settings/llm-profiles/save", {
        id: profile.id,
        name: profile.name,
        providerId: profile.providerId,
        protocol: "openai_compatible" as const,
        baseUrl: profile.baseUrl,
        apiKey: "",
        defaultModel: profile.defaultModel,
        enabled: !profile.enabled,
      }),
    onSuccess: async (_result, profile) => {
      await invalidateProfileQueries();
      setFeedback(`${profile.enabled ? "已停用" : "已启用"} ${profile.name}。`);
      if (editingId === profile.id) {
        setForm((current) => ({ ...current, enabled: !profile.enabled }));
      }
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "切换启用状态失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (profileId: string) =>
      apiDelete<{ ok: true; deletedId: string }>(`/api/settings/llm-profiles/${profileId}`),
    onSuccess: async (_result, profileId) => {
      await invalidateProfileQueries();
      if (editingId === profileId) {
        resetForm("Profile 已删除。");
        return;
      }
      setFeedback("Profile 已删除。");
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "删除失败"),
  });

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-4">
      <div className="mb-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
          Settings
        </p>
        <h1 className="mt-1 text-2xl font-semibold [font-family:var(--font-serif)]">
          模型配置
        </h1>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="workspace-item active flex items-center gap-3 px-4 py-2.5">
            <DatabaseZap className="h-5 w-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Profiles</p>
              <p className="text-lg font-semibold">{profiles.length}</p>
            </div>
          </div>
          <div className="workspace-item active flex items-center gap-3 px-4 py-2.5">
            <PlugZap className="h-5 w-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Presets</p>
              <p className="text-sm font-semibold">{MODEL_PROVIDER_PRESETS.length - 1} 个预设</p>
            </div>
          </div>
          <div className="workspace-item active flex items-center gap-3 px-4 py-2.5">
            <Radar className="h-5 w-5 text-[var(--accent)]" />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">Status</p>
              <p className="text-sm font-semibold">{canProbeCurrentForm ? "可测试" : "待填写"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        <section className="workspace-panel p-5 sm:p-6">
          {isRelay ? (
            <a
              href={RELAY_REGISTER_URL}
              target="_blank"
              rel="noopener"
              className="mb-5 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--azure)] px-4 py-3 text-sm font-bold text-white no-underline shadow-lg transition hover:brightness-110"
            >
              <Rocket className="h-4 w-4" />
              加入塔菲中转站，获取 API Key
            </a>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="section-title">Profile Editor</p>
              <h2 className="mt-2 text-xl font-semibold [font-family:var(--font-serif)]">
                {editingId ? "编辑 Profile" : "创建 Profile"}
              </h2>
              <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
                {isRelay
                  ? "把中转站的 Key 填上，点一下拉取模型就行。Key 只存在这台机器上。"
                  : "采用 CherryStudio 式单列工具页布局，但继续保留当前项目的深色金红主题和既有交互语义。"}
              </p>
            </div>
            <span className="workspace-pill px-3 py-1.5 text-xs text-[var(--ink-soft)]">
              OpenAI-compatible
            </span>
          </div>

          {/* Provider preset 选择 */}
          <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {MODEL_PROVIDER_PRESETS.map((preset) => {
              const isActive = form.providerId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`workspace-item text-left transition ${isActive ? "active border-[var(--accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]" : ""} px-4 py-3`}
                  onClick={() => applyProviderPreset(preset.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-[var(--accent)]" : "bg-[var(--ink-faint)]"}`} />
                    <p className="text-sm font-semibold">{preset.label}</p>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">
                    {getProviderHelperText(preset.id)}
                  </p>
                </button>
              );
            })}
          </div>

          {/* 表单字段 */}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span>Profile 名称</span>
              <input
                aria-label="Profile 名称"
                className="form-input"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="例如：写作主力 / 备用 Gemini / 公司 relay"
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span>默认模型</span>
              <input
                aria-label="默认模型"
                className="form-input"
                placeholder={selectedPreset.modelSuggestions.join(" / ") || "填写一个可用模型名"}
                value={form.defaultModel}
                onChange={(event) =>
                  setForm((current) => ({ ...current, defaultModel: event.target.value }))
                }
              />
            </label>

            {/* Base URL: 中转站和自定义都显示，官方 preset 隐藏 */}
            {!isOfficialPreset ? (
              <label className="grid gap-2 text-sm md:col-span-2">
                <span>Base URL</span>
                {isRelay ? (
                  <select
                    aria-label="Base URL"
                    className="form-input"
                    value={form.baseUrl}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                  >
                    {RELAY_BASE_URLS.map((url) => (
                      <option key={url} value={url}>
                        {url}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="Base URL"
                    className="form-input"
                    placeholder={selectedPreset.baseUrl || "https://your-relay.example.com/v1"}
                    value={form.baseUrl}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, baseUrl: event.target.value }))
                    }
                  />
                )}
              </label>
            ) : null}
            <div className="grid gap-2 text-sm md:col-span-2">
              <span>API Key {isRelay ? "（中转站令牌）" : ""} {isRelay ? (
                <a
                  href={RELAY_REGISTER_URL}
                  target="_blank"
                  rel="noopener"
                  className="ml-2 text-[var(--accent)] font-semibold hover:underline"
                >
                  点此获取令牌 →
                </a>
              ) : null}</span>
              <div className="relative">
                <input
                  aria-label="API Key"
                  type={showApiKey ? "text" : "password"}
                  className="form-input pr-12"
                  value={form.apiKey}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, apiKey: event.target.value }))
                  }
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  aria-label={showApiKey ? "隐藏令牌" : "显示令牌"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-none border-none text-[var(--ink-soft)] cursor-pointer p-0 text-xs"
                  onClick={() => setShowApiKey((prev) => !prev)}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {editingId && editingProfile?.hasApiKey ? (
                <p className="text-xs text-[var(--ink-soft)]">
                  当前已保存：{editingProfile.maskedApiKey ?? "已保存"}。留空则保持不变。
                </p>
              ) : null}
              {isRelay ? (
                <p className="text-xs text-[var(--ink-soft)]">
                  令牌只保存在本地配置文件，绝不外传。没有令牌？
                  <a
                    href={RELAY_REGISTER_URL}
                    target="_blank"
                    rel="noopener"
                    className="ml-1 text-[var(--accent)] font-semibold hover:underline"
                  >
                    前往中转站获取 →
                  </a>
                </p>
              ) : null}
            </div>

            <label className="flex items-center gap-3 text-sm md:col-span-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, enabled: event.target.checked }))
                }
                className="h-4 w-4 rounded border border-[var(--line)]"
                style={{ accentColor: "var(--accent)" }}
              />
              <span>启用该 Profile</span>
            </label>
          </div>

          {/* 说明面板：中转站不展示，避免一长串厂商说明 */}
          {!isRelay ? (
          <div className="mt-5 rounded-3xl border border-[var(--line)] bg-[var(--panel-soft)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <BadgeInfo className="h-4 w-4 text-[var(--accent)]" />
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {selectedPreset.label}
                    {selectedPreset.id === CUSTOM_PROVIDER_ID
                      ? " 配置说明"
                      : selectedPreset.id === RELAY_PROVIDER_ID
                        ? " 中转站说明"
                        : " 官方接入说明"}
                  </p>
                </div>
                <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">
                  {selectedPreset.description}
                </p>
                {selectedPreset.note ? (
                  <p className="mt-2 text-xs leading-6 text-[var(--ink-soft)]">
                    {selectedPreset.note}
                  </p>
                ) : null}
                {isOfficialPreset ? (
                  <p className="mt-2 text-xs leading-6 text-[var(--ink-soft)]">
                    Base URL 已由系统内置。如需自定义地址，请切换到"自定义 / 本地模型"。
                  </p>
                ) : null}
              </div>

              {selectedPreset.docsUrl ? (
                <a
                  href={selectedPreset.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <ExternalLink className="h-4 w-4" />
                  官方文档
                </a>
              ) : null}
            </div>

            {/* 模型选择区域 */}
            {isRelay ? (
              <RelayModelPicker
                models={suggestedModels}
                selectedModel={form.defaultModel}
                onSelect={(model) =>
                  setForm((current) => ({ ...current, defaultModel: model }))
                }
              />
            ) : suggestedModels.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {suggestedModels.map((model) => (
                  <button
                    key={model}
                    type="button"
                    className={`rounded-full px-3 py-1.5 text-xs transition ${
                      form.defaultModel === model
                        ? "bg-[var(--accent)] text-white"
                        : "workspace-pill text-[var(--ink-soft)]"
                    }`}
                    onClick={() =>
                      setForm((current) => ({ ...current, defaultModel: model }))
                    }
                  >
                    {model}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}

          {/* 操作按钮 */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={!canSave || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "保存中..." : "保存"}
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={!canProbeCurrentForm || testMutation.isPending}
              onClick={() => testMutation.mutate(buildTestPayload())}
            >
              <FlaskConical className="mr-1 inline h-4 w-4" />
              {testMutation.isPending ? "测试中..." : "测试"}
            </button>

            <button
              type="button"
              className="btn-secondary"
              disabled={!canProbeCurrentForm || modelsMutation.isPending}
              onClick={() => modelsMutation.mutate(buildFetchModelsPayload())}
            >
              {modelsMutation.isPending ? "拉取中..." : "拉取模型"}
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => resetForm(editingId ? "已取消编辑。" : "表单已清空。")}
            >
              {editingId ? "取消编辑" : "清空"}
            </button>
          </div>

          {feedback ? (
            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--ink-soft)]">
              {feedback}
            </div>
          ) : null}
        </section>

        <section className="workspace-panel p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="section-title">Saved Profiles</p>
              <h2 className="mt-2 text-xl font-semibold [font-family:var(--font-serif)]">
                已保存 Profiles
              </h2>
            </div>
            <span className="workspace-pill px-3 py-1.5 text-xs text-[var(--ink-soft)]">
              工具型配置网格
            </span>
          </div>

          {isLoading ? (
            <LoadingSkeleton variant="card" count={3} />
          ) : null}

          {!profiles.length && !isLoading ? (
            <div className="mt-5 workspace-item active p-5 text-center text-sm text-[var(--ink-soft)]">
              暂无配置，请在上方添加。
            </div>
          ) : null}

          {profiles.length ? (
            <div className="mt-5 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {profiles.map((profile) => {
                const preset = getModelProviderPreset(profile.providerId);
                const isEditing = editingId === profile.id;
                const isDeleting = deleteMutation.isPending && deleteMutation.variables === profile.id;
                const isToggling = toggleMutation.isPending && toggleMutation.variables?.id === profile.id;
                const toggleDisabled = isEditing || isToggling;

                return (
                  <div
                    key={profile.id}
                    className={`workspace-item p-4 ${isEditing ? "active border-l-2 border-l-[var(--accent)]" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold">{profile.name}</h3>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="workspace-pill px-2.5 py-1 text-[11px] text-[var(--ink-soft)]">
                          {preset.label}
                        </span>
                        <button
                          type="button"
                          aria-label={`${profile.enabled ? "已启用" : "已停用"} ${profile.name}`}
                          title={
                            isEditing
                              ? "当前正在编辑，请在表单内切换启用状态"
                              : "点击切换启用状态"
                          }
                          disabled={toggleDisabled}
                          className={`workspace-pill inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] transition ${
                            profile.enabled
                              ? "text-[var(--ink)]"
                              : "text-[var(--ink-soft)]"
                          } ${toggleDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[var(--accent-soft)]"}`}
                          onClick={() => {
                            if (!profile.enabled && !profile.hasApiKey) {
                              setFeedback("该 Profile 尚未配置 API Key，无法启用。");
                              return;
                            }
                            toggleMutation.mutate(profile);
                          }}
                        >
                          {profile.enabled ? (
                            <ToggleRight className="h-3.5 w-3.5" />
                          ) : (
                            <ToggleLeft className="h-3.5 w-3.5" />
                          )}
                          {profile.enabled ? "启用" : "停用"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="font-mono text-xs text-[var(--ink-soft)]">
                        {profile.defaultModel || "未填写默认模型"}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-xs text-[var(--ink-soft)]">
                        key 状态：{profile.maskedApiKey ?? (profile.hasApiKey ? "已保存" : "未填写")}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`编辑 Profile ${profile.name}`}
                          className="btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full"
                          onClick={() => loadProfileIntoForm(profile)}
                        >
                          <PencilLine className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 Profile ${profile.name}`}
                          disabled={isDeleting}
                          className={`btn-ghost inline-flex h-9 w-9 items-center justify-center rounded-full ${
                            isDeleting ? "opacity-50" : ""
                          }`}
                          onClick={async () => {
                            const confirmed = await confirm({
                              title: `删除 Profile「${profile.name}」`,
                              description:
                                "如果它已绑定项目角色，相关项目在重新分配前将无法运行。此操作不可撤销。",
                              confirmLabel: "删除",
                              variant: "danger",
                            });
                            if (!confirmed) {
                              return;
                            }
                            deleteMutation.mutate(profile.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
